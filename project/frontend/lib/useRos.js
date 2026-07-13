"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ROSLIB from "roslib/src/RosLib";

const DEFAULT_URL = "ws://localhost:9090";
const MAX_TRAIL_POINTS = 10000;

function quaternionToYaw(q) {
  if (!q) return 0;
  const siny = 2 * ((q.w || 0) * (q.z || 0) + (q.x || 0) * (q.y || 0));
  const cosy = 1 - 2 * ((q.y || 0) * (q.y || 0) + (q.z || 0) * (q.z || 0));
  return Math.atan2(siny, cosy);
}

function distance2(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function useRos(url = DEFAULT_URL) {
  const rosRef = useRef(null);
  const topicsRef = useRef({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  // Data frekuensi tinggi (120Hz) disimpan di Ref agar tidak trigger re-render
  const odomRef = useRef(null);
  const yawRef = useRef(0);
  
  // Data frekuensi rendah untuk UI Text (Throttled)
  const [uiOdom, setUiOdom] = useState(null);
  const lastUiUpdate = useRef(0);

  // Tracking freshness posisi drone
  const lastOdomTime = useRef(0);

  const [trail, setTrail] = useState([]);
  const [goal, setGoal] = useState(null);
  const [pathDraft, setPathDraft] = useState({ start: null, end: null });
  const [dashboardState, setDashboardState] = useState({});
  const obstaclesRef = useRef([]);
  const [sensorScan, setSensorScan] = useState({ ranges: [], nearest: null });
  const [plannedPath, setPlannedPath] = useState([]);
  const pathsJsonRef = useRef({ global: [], local: [], final: [] });
  const [metrics, setMetrics] = useState({});

  const prevModeRef = useRef("idle");

  // Hapus draft rute ketika misi selesai atau dibatalkan (emergency stop)
  useEffect(() => {
    const currentMode = dashboardState.mode;
    if ((prevModeRef.current === "auto" || prevModeRef.current === "takeoff") && 
        (currentMode === "hold" || currentMode === "idle" || currentMode === "manual")) {
      setPathDraft({ start: null, end: null });
    }
    prevModeRef.current = currentMode;
  }, [dashboardState.mode]);
  function parseJsonMessage(msg, fallback) {
    try {
      return JSON.parse(msg?.data || "");
    } catch {
      return fallback;
    }
  }

  function pathToPoints(msg) {
    return (msg?.poses || []).map((pose) => ({
      x: Number(pose.pose?.position?.x || 0),
      y: Number(pose.pose?.position?.y || 0),
      z: Number(pose.pose?.position?.z || 0)
    }));
  }

  useEffect(() => {
    let reconnectTimer;
    let isUnmounted = false;

    function connectRos() {
      if (isUnmounted) return;
      
      const ros = new ROSLIB.Ros({ url });
      rosRef.current = ros;

      ros.on("connection", () => {
        if (isUnmounted) return;
        setConnected(true);
        setError("");
        clearTimeout(reconnectTimer);
      });

      ros.on("close", () => {
        if (isUnmounted) return;
        setConnected(false);
        // Auto-reconnect
        reconnectTimer = setTimeout(connectRos, 2000);
      });

      ros.on("error", (event) => {
        if (isUnmounted) return;
        setConnected(false);
        setError(event?.message || "Tidak bisa terhubung ke rosbridge.");
        // Close event usually fires after error, so reconnect is handled there.
      });

      const odomTopic = new ROSLIB.Topic({
        ros,
        name: "/odom",
        messageType: "nav_msgs/msg/Odometry",
        throttle_rate: 10
      });

      const tfTopic = new ROSLIB.Topic({
        ros,
        name: "/tf",
        messageType: "tf2_msgs/msg/TFMessage",
        throttle_rate: 10
      });

      const stateTopic = new ROSLIB.Topic({
        ros,
        name: "/dashboard/state",
        messageType: "std_msgs/msg/String",
        throttle_rate: 200
      });

      const obstaclesTopic = new ROSLIB.Topic({
        ros,
        name: "/dashboard/obstacles",
        messageType: "std_msgs/msg/String",
        throttle_rate: 500
      });

      const sensorTopic = new ROSLIB.Topic({
        ros,
        name: "/dashboard/sensor_scan",
        messageType: "std_msgs/msg/String",
        throttle_rate: 200
      });

      const metricsTopic = new ROSLIB.Topic({
        ros,
        name: "/dashboard/metrics",
        messageType: "std_msgs/msg/String",
        throttle_rate: 500
      });

      const plannedPathTopic = new ROSLIB.Topic({
        ros,
        name: "/dashboard/planned_path",
        messageType: "nav_msgs/msg/Path",
        throttle_rate: 200
      });

      const pathsJsonTopic = new ROSLIB.Topic({
        ros,
        name: "/dashboard/paths_json",
        messageType: "std_msgs/msg/String",
        throttle_rate: 200
      });

      odomTopic.subscribe((msg) => {
        const pose = msg.pose?.pose;
        if (!pose) return;
        const next = {
          x: Number(pose.position?.x || 0),
          y: Number(pose.position?.y || 0),
          z: Number(pose.position?.z || 0)
        };
        
        odomRef.current = next;
        yawRef.current = quaternionToYaw(pose.orientation);
        lastOdomTime.current = Date.now();

        const now = Date.now();
        if (now - lastUiUpdate.current > 100) {
          setUiOdom(next);
          lastUiUpdate.current = now;
        }

        setTrail((prev) => {
          const last = prev[prev.length - 1];
          if (distance2(last, next) < 0.16) return prev;
          const merged = [...prev, next];
          return merged.length > MAX_TRAIL_POINTS
            ? merged.slice(merged.length - MAX_TRAIL_POINTS)
            : merged;
        });
      });

      tfTopic.subscribe((msg) => {
        const transforms = msg.transforms || [];
        const base = transforms.find((tf) => {
          const child = tf.child_frame_id || "";
          return child.includes("base_link") || child.includes("drone");
        });
        if (base?.transform?.rotation) {
          yawRef.current = quaternionToYaw(base.transform.rotation);
        }
      });

      stateTopic.subscribe((msg) => {
        setDashboardState((prev) => ({ ...prev, ...parseJsonMessage(msg, {}) }));
      });

      obstaclesTopic.subscribe((msg) => {
        const next = parseJsonMessage(msg, []);
        if (Array.isArray(next)) obstaclesRef.current = next;
      });

      sensorTopic.subscribe((msg) => {
        setSensorScan(parseJsonMessage(msg, { ranges: [], nearest: null }));
      });

      metricsTopic.subscribe((msg) => {
        setMetrics(parseJsonMessage(msg, {}));
      });

      plannedPathTopic.subscribe((msg) => {
        setPlannedPath(pathToPoints(msg));
      });

      pathsJsonTopic.subscribe((msg) => {
        pathsJsonRef.current = parseJsonMessage(msg, { global: [], local: [], final: [] });
      });

      topicsRef.current.cmdVel = new ROSLIB.Topic({
        ros,
        name: "/cmd_vel",
        messageType: "geometry_msgs/msg/Twist"
      });

      topicsRef.current.goalPose = new ROSLIB.Topic({
        ros,
        name: "/dashboard/goal_pose",
        messageType: "geometry_msgs/msg/PoseStamped"
      });

      return () => {
        odomTopic.unsubscribe();
        tfTopic.unsubscribe();
        stateTopic.unsubscribe();
        obstaclesTopic.unsubscribe();
        sensorTopic.unsubscribe();
        metricsTopic.unsubscribe();
        plannedPathTopic.unsubscribe();
        pathsJsonTopic.unsubscribe();
        ros.close();
      };
    }

    let cleanup = connectRos();

    return () => {
      isUnmounted = true;
      clearTimeout(reconnectTimer);
      if (cleanup) cleanup();
      rosRef.current = null;
      topicsRef.current = {};
    };
  }, [url]);

  const publishVelocity = useCallback((linearX = 0, linearY = 0, angularZ = 0, linearZ = 0) => {
    const topic = topicsRef.current.cmdVel;
    if (!topic) return;
    topic.publish(
      new ROSLIB.Message({
        linear: { x: linearX, y: linearY, z: linearZ },
        angular: { x: 0, y: 0, z: angularZ }
      })
    );
  }, []);

  const callTriggerService = useCallback((name) => {
    const ros = rosRef.current;
    if (!ros) return Promise.reject(new Error("rosbridge belum terhubung"));

    const service = new ROSLIB.Service({
      ros,
      name,
      serviceType: "std_srvs/srv/Trigger"
    });

    return new Promise((resolve, reject) => {
      service.callService(
        new ROSLIB.ServiceRequest({}),
        (result) => resolve(result),
        (err) => reject(err)
      );
    });
  }, []);

  const isDronePositionFresh = useCallback(() => {
    return (Date.now() - lastOdomTime.current) < 3000;
  }, []);

  const publishGoal = useCallback((x, y, z = 0, frame = "map") => {
    const topic = topicsRef.current.goalPose;
    if (!topic) return;

    // Validasi: posisi drone harus tersedia dan fresh
    const dronePos = odomRef.current;
    if (!dronePos) {
      console.warn("[useRos] publishGoal dibatalkan: posisi drone belum tersedia.");
      return;
    }
    if ((Date.now() - lastOdomTime.current) > 3000) {
      console.warn("[useRos] publishGoal dibatalkan: posisi drone sudah stale (>3s).");
      return;
    }

    const nextGoal = { x: Number(x), y: Number(y), z: Number(z) };
    setGoal(nextGoal);
    // Start selalu dari posisi drone aktual
    setPathDraft({ start: { ...dronePos }, end: nextGoal });

    topic.publish(
      new ROSLIB.Message({
        header: {
          frame_id: frame,
          stamp: { sec: 0, nanosec: 0 }
        },
        pose: {
          position: nextGoal,
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        }
      })
    );

    // Otomatis buat mission di database dengan start = posisi drone aktual
    createMission(dronePos, nextGoal).catch((err) =>
      console.error("[useRos] Gagal membuat mission:", err)
    );
  }, []);

  async function createMission(start, target) {
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.NEXT_PUBLIC_API_WRITE_KEY || "change-this-api-key"
        },
        body: JSON.stringify({
          droneId: 1,
          missionName: `Auto Mission ${new Date().toLocaleTimeString("id-ID")}`,
          mode: "auto",
          status: "in_progress",
          start: { x: start.x, y: start.y, z: start.z },
          target: { x: target.x, y: target.y, z: target.z },
          startedAt: new Date().toISOString(),
          pathPlanningResult: { startAuto: true, startSource: "drone_realtime_odom" }
        })
      });
      const data = await res.json();
      console.log("[useRos] Mission dibuat:", data);
      return data;
    } catch (err) {
      console.error("[useRos] createMission error:", err);
    }
  }

  const clearTrail = useCallback(() => {
    setTrail([]);
  }, []);

  return useMemo(
    () => ({
      url,
      connected,
      error,
      odomRef,
      yawRef,
      odom: uiOdom,
      trail,
      goal,
      pathDraft,
      dashboardState,
      sensorScan,
      plannedPath,
      pathsJsonRef,
      obstaclesRef,
      metrics,
      setGoal,
      setPathDraft,
      publishVelocity,
      callTriggerService,
      publishGoal,
      clearTrail,
      isDronePositionFresh
    }),
    [
      url,
      connected,
      error,
      uiOdom,
      trail,
      goal,
      pathDraft,
      dashboardState,
      sensorScan,
      plannedPath,
      metrics,
      publishVelocity,
      callTriggerService,
      publishGoal,
      clearTrail,
      isDronePositionFresh
    ]
  );
}
