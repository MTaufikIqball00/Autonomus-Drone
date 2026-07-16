#!/usr/bin/env python3

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
ROS_WS = ROOT / "ros2_ws"
DB_SCHEMA = ROOT / "database" / "drone_schema.sql"
PX4_DIR = Path(os.environ.get("PX4_DIR", "/home/iqball/drone-stack/external/PX4-Autopilot"))


def run(name, command, cwd=None, env=None):
    print(f"[launcher] starting {name}: {command}")
    process_env = os.environ.copy()
    if env:
        process_env.update(env)
    process = subprocess.Popen(
        command,
        cwd=cwd or ROOT,
        shell=True,
        executable="/bin/bash",
        preexec_fn=os.setsid,
        env=process_env,
    )
    return name, process


def ros_command(command):
    ros_setup = os.environ.get("ROS_SETUP", "/opt/ros/jazzy/setup.bash")
    ws_setup = ROS_WS / "install" / "setup.bash"
    setup_parts = [f"source {ros_setup}"]
    if ws_setup.exists():
        setup_parts.append(f"source {ws_setup}")
    setup_parts.append(command)
    return " && ".join(setup_parts)


def load_env_file(path):
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def db_env_from_frontend():
    frontend_env = load_env_file(FRONTEND / ".env.local")
    return {
        "DRONE_DB_HOST": os.environ.get("DRONE_DB_HOST", frontend_env.get("DB_HOST", "127.0.0.1")),
        "DRONE_DB_PORT": os.environ.get("DRONE_DB_PORT", frontend_env.get("DB_PORT", "3306")),
        "DRONE_DB_USER": os.environ.get("DRONE_DB_USER", frontend_env.get("DB_USER", "drone_app")),
        "DRONE_DB_PASSWORD": os.environ.get(
            "DRONE_DB_PASSWORD",
            frontend_env.get("DB_PASSWORD", "change-this-password"),
        ),
        "DRONE_DB_NAME": os.environ.get("DRONE_DB_NAME", frontend_env.get("DB_NAME", "drone_ops")),
        "DRONE_DB_DRONE_ID": os.environ.get("DRONE_DB_DRONE_ID", "1"),
    }


def mysql_quote(value):
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def maybe_install_frontend():
    node_modules = FRONTEND / "node_modules"
    if node_modules.exists():
        return
    subprocess.check_call("npm install", cwd=FRONTEND, shell=True, executable="/bin/bash")


def maybe_install_db_deps():
    subprocess.check_call(
        "sudo apt-get update && sudo apt-get install -y mysql-server mysql-client python3-pymysql",
        cwd=ROOT,
        shell=True,
        executable="/bin/bash",
    )


def ensure_mysql(schema=True):
    if subprocess.call("command -v mysql >/dev/null 2>&1", shell=True, executable="/bin/bash") != 0:
        print("[launcher] mysql client belum terpasang.")
        print("[launcher] jalankan sekali: sudo apt-get install -y mysql-server mysql-client python3-pymysql")
        sys.exit(1)

    print("[launcher] starting MySQL service")
    subprocess.check_call("sudo service mysql start", cwd=ROOT, shell=True, executable="/bin/bash")

    if schema and DB_SCHEMA.exists():
        print("[launcher] applying database schema:", DB_SCHEMA)
        subprocess.check_call(f"sudo mysql < {DB_SCHEMA}", cwd=ROOT, shell=True, executable="/bin/bash")

    db_env = db_env_from_frontend()
    db_name = mysql_quote(db_env["DRONE_DB_NAME"])
    db_user = mysql_quote(db_env["DRONE_DB_USER"])
    db_password = mysql_quote(db_env["DRONE_DB_PASSWORD"])
    if db_user and db_user != "root":
        print(f"[launcher] ensuring MySQL app user: {db_user}")
        user_sql = (
            f"CREATE USER IF NOT EXISTS '{db_user}'@'%' IDENTIFIED BY '{db_password}'; "
            f"ALTER USER '{db_user}'@'%' IDENTIFIED BY '{db_password}'; "
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON `{db_name}`.* TO '{db_user}'@'%'; "
            "FLUSH PRIVILEGES;"
        )
        subprocess.check_call(
            ["sudo", "mysql", "-e", user_sql],
            cwd=ROOT,
        )

    driver_check = (
        "python3 -c 'import mysql.connector' >/dev/null 2>&1 || "
        "python3 -c 'import pymysql' >/dev/null 2>&1"
    )
    if subprocess.call(driver_check, shell=True, executable="/bin/bash") != 0:
        print("[launcher] Python MySQL driver belum tersedia.")
        print("[launcher] jalankan sekali: sudo apt-get install -y python3-pymysql")
        sys.exit(1)


def ensure_frontend_cache_writable():
    next_cache = FRONTEND / ".next"
    if not next_cache.exists():
        return

    probe = next_cache / ".codex-write-test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return
    except OSError:
        pass

    user = os.environ.get("USER", "iqball")
    print("[launcher] frontend cache tidak writable:", next_cache)
    print("[launcher] perbaiki sekali dengan:")
    print(f"  sudo chown -R {user}:{user} {next_cache}")
    print("  rm -rf " + str(next_cache))
    sys.exit(1)


def maybe_build_ros():
    subprocess.check_call(
        ros_command("colcon build --symlink-install"),
        cwd=ROS_WS,
        shell=True,
        executable="/bin/bash",
    )


def ensure_port_available(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        if sock.connect_ex(("127.0.0.1", int(port))) == 0:
            print(f"[launcher] port {port} sudah dipakai.")
            print("Matikan proses Next.js lama atau pakai --frontend-port lain.")
            sys.exit(1)


def px4_make_target(model):
    if model.startswith("gz_"):
        return model
    return f"gz_{model}"


def stop_all(processes):
    for name, process in reversed(processes):
        if process.poll() is None:
            print(f"[launcher] stopping {name}")
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)


def force_cleanup_px4():
    print("[launcher] Membersihkan sisa socket & proses PX4/Gazebo agar drone pasti spawn...")
    subprocess.call("pkill -9 px4", shell=True, stderr=subprocess.DEVNULL)
    subprocess.call("pkill -9 ruby", shell=True, stderr=subprocess.DEVNULL)
    subprocess.call("pkill -9 gz", shell=True, stderr=subprocess.DEVNULL)
    subprocess.call("rm -rf /tmp/px4*", shell=True, stderr=subprocess.DEVNULL)



def main():
    parser = argparse.ArgumentParser(description="Run drone dashboard stack.")
    parser.add_argument("--install", action="store_true", help="run npm install and colcon build when needed")
    parser.add_argument("--gazebo", action="store_true", help="launch PX4 SITL + Gazebo immediately")
    parser.add_argument("--px4", action="store_true", help="launch PX4 SITL, MicroXRCEAgent, and Gazebo")
    parser.add_argument("--no-db", action="store_true", help="jangan start MySQL dan jangan jalankan telemetry database logger")
    parser.add_argument("--skip-db-schema", action="store_true", help="jangan apply database/drone_schema.sql saat start")
    parser.add_argument("--no-db-logger", action="store_true", help="start MySQL tetapi jangan jalankan mysql_telemetry_logger")
    parser.add_argument("--px4-model", default="x500_lidar_2d")
    parser.add_argument("--px4-world", default="agricultural_field")
    parser.add_argument("--px4-pose", default="-65,0,0.4,0,0,0")
    parser.add_argument("--frontend-port", default="3000")
    args = parser.parse_args()

    if args.install:
        if not args.no_db:
            maybe_install_db_deps()
        maybe_install_frontend()
        maybe_build_ros()
    if not args.no_db:
        ensure_mysql(schema=not args.skip_db_schema)
    ensure_frontend_cache_writable()
    ensure_port_available(args.frontend_port)

    processes = []
    try:
        launch_px4 = args.px4 or args.gazebo
        if launch_px4:
            custom_world_dir = ROS_WS / "src" / "agricultural_world" / "worlds"
            custom_model_dir = ROS_WS / "src" / "agricultural_world" / "models"
            
            # Tentukan apakah world ada di custom dir atau default PX4
            use_custom_world = (custom_world_dir / f"{args.px4_world}.sdf").exists()
            px4_world_dir = PX4_DIR / "Tools" / "simulation" / "gz" / "worlds"
            
            if use_custom_world:
                target_world_file = custom_world_dir / f"{args.px4_world}.sdf"
                symlink_dest = px4_world_dir / f"{args.px4_world}.sdf"
                # Hapus symlink/file lama jika ada agar bisa buat symlink baru
                if symlink_dest.exists() or symlink_dest.is_symlink():
                    symlink_dest.unlink()
                # Buat symlink dari ros2_ws ke PX4 dir
                os.symlink(target_world_file, symlink_dest)
            
            gz_resource_path = ":".join(
                [
                    str(custom_model_dir),
                    str(PX4_DIR / "Tools" / "simulation" / "gz" / "models"),
                    str(px4_world_dir),
                    os.environ.get("GZ_SIM_RESOURCE_PATH", ""),
                ]
            )
            px4_env = {
                "PX4_GZ_WORLD": args.px4_world,
                "PX4_SIM_MODEL": args.px4_model,
                "PX4_GZ_MODEL_POSE": args.px4_pose,
                "PX4_GZ_MODELS": str(PX4_DIR / "Tools" / "simulation" / "gz" / "models"),
                "PX4_GZ_WORLDS": str(px4_world_dir),
                "GZ_SIM_RESOURCE_PATH": gz_resource_path,
            }
            processes.append(
                run(
                    "micro_xrce_agent",
                    "MicroXRCEAgent udp4 -p 8888",
                    cwd=ROOT,
                )
            )
            time.sleep(1.0)
            
            force_cleanup_px4()
            
            processes.append(
                run(
                    "px4_sitl_gazebo",
                    f"make px4_sitl {px4_make_target(args.px4_model)}",
                    cwd=PX4_DIR,
                    env=px4_env,
                )
            )
            lidar_gz_topic = (
                f"/world/{args.px4_world}/model/{args.px4_model}_0/"
                "link/link/sensor/lidar_2d_v2/scan"
            )
            print(f"[launcher] Menunggu Gazebo memuat {lidar_gz_topic}...")
            for _ in range(60):
                try:
                    out = subprocess.check_output("gz topic -l", shell=True, text=True, stderr=subprocess.DEVNULL)
                    if lidar_gz_topic in out:
                        print("[launcher] Gazebo Lidar topic ditemukan, melanjutkan bridge...")
                        break
                except Exception:
                    pass
                time.sleep(1.0)
            else:
                print("[launcher] Peringatan: Gazebo Lidar topic tidak ditemukan setelah 60 detik! Bridge mungkin gagal.")
            processes.append(
                run(
                    "gz_lidar_bridge",
                    ros_command(
                        "ros2 run ros_gz_bridge parameter_bridge "
                        f"{lidar_gz_topic}@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan "
                        f"--ros-args -r {lidar_gz_topic}:=/drone/lidar/scan"
                    ),
                    cwd=ROS_WS,
                )
            )
            time.sleep(1.0)

        processes.append(
            run(
                "rosbridge",
                ros_command("ros2 launch rosbridge_server rosbridge_websocket_launch.xml"),
                cwd=ROS_WS,
            )
        )
        time.sleep(1.5)

        processes.append(
            run(
                "dashboard_bridge_node",
                ros_command("ros2 run drone_dashboard_bridge dashboard_bridge_node"),
                cwd=ROS_WS,
            )
        )
        time.sleep(1.0)

        if not args.no_db and not args.no_db_logger:
            processes.append(
                run(
                    "mysql_telemetry_logger",
                    ros_command("ros2 run drone_dashboard_bridge mysql_telemetry_logger"),
                    cwd=ROS_WS,
                    env=db_env_from_frontend(),
                )
            )
            time.sleep(0.5)

        processes.append(
            run(
                "nextjs",
                f"npm run build && npm start -- -p {args.frontend_port}",
                cwd=FRONTEND,
            )
        )

        print("[launcher] dashboard: http://localhost:" + args.frontend_port)
        print("[launcher] rosbridge: ws://localhost:9090")
        if not args.no_db:
            print("[launcher] database: drone_ops")
        if launch_px4:
            print("[launcher] PX4 model:", args.px4_model)
            print("[launcher] Gazebo world:", args.px4_world)
        print("[launcher] press Ctrl+C to stop all processes")


        while True:
            time.sleep(1.0)
            failed = [(name, proc.returncode) for name, proc in processes if proc.poll() not in (None, 0)]
            if failed:
                print(f"[launcher] process exited unexpectedly: {failed}")
                break

    except KeyboardInterrupt:
        print("\n[launcher] interrupted")
    finally:
        stop_all(processes)


if __name__ == "__main__":
    if os.name != "posix":
        print("Launcher ini ditujukan untuk Linux/WSL karena ROS 2 dan Gazebo berjalan di sana.")
        sys.exit(1)
    main()
