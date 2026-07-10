"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "--";
}

export default function ControlPanel({
  connected,
  odom,
  goal,
  state,
  callService,
  publishVelocity,
  publishGoal,
  clearTrail,
  sensorScan
}) {
  const [manual, setManual] = useState({ x: "0", y: "0", z: "8" });
  const [busy, setBusy] = useState("");
  const [lastResult, setLastResult] = useState("");
  const [keys, setKeys] = useState({});
  const [gamepadName, setGamepadName] = useState("");
  const activeKeysRef = useRef({});

  const battery = state?.battery || {};
  const vehicle = state?.vehicle || {};
  const wind = state?.wind || {};

  useEffect(() => {
    if (goal) {
      setManual({
        x: String(goal.x.toFixed(2)),
        y: String(goal.y.toFixed(2)),
        z: String((goal.z || 8).toFixed(2))
      });
    }
  }, [goal]);

  useEffect(() => {
    function setKey(event, value) {
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e", "r", "f"].includes(key)) return;
      event.preventDefault();
      activeKeysRef.current = { ...activeKeysRef.current, [key]: value };
      setKeys(activeKeysRef.current);
    }
    const down = (event) => setKey(event, true);
    const up = (event) => setKey(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      const k = activeKeysRef.current;
      const x = (k.w ? 1 : 0) + (k.s ? -1 : 0);
      const y = (k.a ? 1 : 0) + (k.d ? -1 : 0);
      const yaw = (k.q ? 1 : 0) + (k.e ? -1 : 0);
      const z = (k.r ? 1 : 0) + (k.f ? -1 : 0);
      if (x || y || yaw || z) publishVelocity(x, y, yaw, z);
    }, 70);
    return () => window.clearInterval(timer);
  }, [connected, publishVelocity]);

  useEffect(() => {
    let raf = 0;
    function loop() {
      const pads = navigator.getGamepads?.() || [];
      const pad = Array.from(pads).find(Boolean);
      if (pad && connected) {
        setGamepadName(pad.id || "USB gamepad");
        const dead = 0.12;
        const lx = Math.abs(pad.axes[0] || 0) > dead ? pad.axes[0] : 0;
        const ly = Math.abs(pad.axes[1] || 0) > dead ? pad.axes[1] : 0;
        const rx = Math.abs(pad.axes[2] || 0) > dead ? pad.axes[2] : 0;
        const up = pad.buttons[5]?.pressed ? 1 : 0;
        const down = pad.buttons[4]?.pressed ? -1 : 0;
        if (lx || ly || rx || up || down) {
          publishVelocity(-ly, -lx, -rx, up + down);
        }
      }
      raf = window.requestAnimationFrame(loop);
    }
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [connected, publishVelocity]);

  const keyText = useMemo(() => {
    const active = Object.entries(keys)
      .filter(([, value]) => value)
      .map(([key]) => key.toUpperCase());
    return active.length ? active.join(" ") : "idle";
  }, [keys]);

  async function runService(name) {
    setBusy(name);
    setLastResult("");
    try {
      const result = await callService(name);
      setLastResult(result?.message || `${name} OK`);
    } catch (err) {
      setLastResult(String(err?.message || err));
    } finally {
      setBusy("");
    }
  }

  function sendManualGoal() {
    publishGoal(Number(manual.x), Number(manual.y), Number(manual.z || 8));
  }

  function press(x = 0, y = 0, yaw = 0, z = 0) {
    publishVelocity(x, y, yaw, z);
  }

  const disabled = !connected || Boolean(busy);

  return (
    <aside className="panel control-panel">
      <div>
        <div className="panel-title">
          <h2>Flight Control</h2>
          <span className="status-pill">{vehicle.navStateName || state?.mode || "waiting"}</span>
        </div>
        <div className="button-grid">
          <button className="btn safe" disabled={disabled} onClick={() => runService("/arm")}>Arm</button>
          <button className="btn primary" disabled={disabled} onClick={() => runService("/takeoff")}>Takeoff</button>
          <button className="btn warn" disabled={disabled} onClick={() => runService("/land")}>Land</button>
          <button className="btn primary" disabled={disabled} onClick={() => runService("/return_home")}>Return Home</button>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button
            className="btn full"
            style={{ background: "#7c3aed", color: "#fff", fontWeight: 700 }}
            disabled={disabled}
            onClick={() => runService("/force_arm_takeoff")}
          >
            ⚡ Force Arm &amp; Takeoff
          </button>
        </div>
        
        {/* --- TOMBOL BARU UNTUK AUTO SURVEY --- */}
        <div className="button-row" style={{ marginTop: 6 }}>
          <button
            className="btn full"
            style={{ background: "#0ea5e9", color: "#fff", fontWeight: 700 }}
            disabled={disabled}
            onClick={() => runService("/start_auto_survey")}
          >
            🗺️ Start Auto Survey (Boustrophedon)
          </button>
        </div>
        
        {/* --- ORBIT MISSION --- */}
        <div className="button-row" style={{ marginTop: 6 }}>
          <button
            className="btn full"
            style={{ background: "#10b981", color: "#fff", fontWeight: 700 }}
            disabled={disabled}
            onClick={() => runService("/start_orbit_mission")}
          >
            🌴 Start Orbit Mission (360°)
          </button>
        </div>
        {/* ------------------------------------- */}

        <div className="button-row" style={{ marginTop: 6 }}>
          <button className="btn danger full" disabled={disabled} onClick={() => runService("/emergency_stop")}>
            Emergency Stop
          </button>
        </div>
      </div>

      <div className="section">
        <h3>Battery</h3>
        <div className="battery-row">
          <div className="battery-shell">
          <div
            className="battery-fill"
            style={{ width: `${Math.max(0, Math.min(100, (Number(battery.remaining) || 0) * 100))}%` }}
          />
          </div>
          <strong>{pct(battery.remaining)}</strong>
        </div>
        <div className="telemetry">
          <div className="metric"><span>Voltage</span><strong>{fmt(battery.voltage)} V</strong></div>
          <div className="metric"><span>Current</span><strong>{fmt(battery.current)} A</strong></div>
          <div className="metric"><span>ETA</span><strong>{fmt(battery.timeRemaining, 0)} s</strong></div>
        </div>
      </div>

      <div className="section">
        <h3>Telemetry</h3>
        <div className="telemetry">
          <div className="metric"><span>X</span><strong>{fmt(odom?.x)}</strong></div>
          <div className="metric"><span>Y</span><strong>{fmt(odom?.y)}</strong></div>
          <div className="metric"><span>Z</span><strong>{fmt(odom?.z)}</strong></div>
        </div>
        <div className="telemetry two">
          <div className="metric"><span>Wind</span><strong>{fmt(wind.speed)} m/s</strong></div>
          <div className="metric"><span>Offboard</span><strong>{vehicle.acceptsOffboard ? "yes" : "no"}</strong></div>
        </div>
      </div>

      {state?.orbit && (
        <div className="section">
          <h3 style={{ color: "#10b981" }}>Orbit Mission</h3>
          <div className="telemetry" style={{ marginBottom: 8 }}>
            <div className="metric"><span>Phase</span><strong style={{ textTransform: "capitalize" }}>{state.orbit.phase}</strong></div>
            <div className="metric"><span>Tree</span><strong>{state.orbit.treeIndex + 1} / {state.orbit.totalTrees}</strong></div>
            <div className="metric"><span>Target</span><strong>{state.orbit.currentTree || "--"}</strong></div>
          </div>
          <div className="battery-row">
            <div className="battery-shell" style={{ borderColor: "#10b981" }}>
              <div
                className="battery-fill"
                style={{ background: "#10b981", width: `${Math.max(0, Math.min(100, state.orbit.orbitProgress || 0))}%` }}
              />
            </div>
            <strong style={{ color: "#10b981", minWidth: 40 }}>{pct((state.orbit.orbitProgress || 0) / 100)}</strong>
          </div>
        </div>
      )}

      <div className="section">
        <h3>Obstacle Sensor (LiDAR)</h3>
        {(() => {
          const liveNearest = sensorScan?.nearest ?? (sensorScan?.ranges?.length ? Math.min(...sensorScan.ranges) : null);
          
          // Jika tidak ada data atau jarak >= 30m (max range LiDAR), berarti tidak ada rintangan
          const isObstacle = liveNearest !== null && liveNearest !== undefined && liveNearest < 29.9;
          
          const color = !isObstacle ? "#334155" :
                        liveNearest > 10 ? "#10b981" :
                        liveNearest > 5 ? "#eab308" :
                        liveNearest > 2 ? "#f97316" : "#ef4444";
                        
          const textColor = !isObstacle ? "#94a3b8" : color;
          
          return (
            <div style={{
              padding: "12px",
              borderRadius: "8px",
              background: "var(--panel-bg)",
              border: `2px solid ${color}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}>
              <span style={{ fontWeight: 600, color: "#cbd5e1" }}>Distance to Obstacle:</span>
              <span style={{ 
                fontWeight: 800, 
                fontSize: "1.2rem",
                color: textColor
              }}>
                {isObstacle ? `${fmt(liveNearest, 2)} m` : "-- m"}
              </span>
            </div>
          );
        })()}
      </div>

      <div className="section">
        <h3>Manual Control</h3>
        <div className="stick-grid">
          <button className="btn small" disabled={!connected} onPointerDown={() => press(0, 0, 1, 0)} onPointerUp={() => press()}>Yaw L</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(1, 0, 0, 0)} onPointerUp={() => press()}>Fwd</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(0, 0, -1, 0)} onPointerUp={() => press()}>Yaw R</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(0, 1, 0, 0)} onPointerUp={() => press()}>Left</button>
          <button className="btn danger small" disabled={!connected} onClick={() => press()}>Stop</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(0, -1, 0, 0)} onPointerUp={() => press()}>Right</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(0, 0, 0, -1)} onPointerUp={() => press()}>Down</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(-1, 0, 0, 0)} onPointerUp={() => press()}>Back</button>
          <button className="btn small" disabled={!connected} onPointerDown={() => press(0, 0, 0, 1)} onPointerUp={() => press()}>Up</button>
        </div>
        <div className="status-pill subtle">keys: {keyText}</div>
        <div className="status-pill subtle">gamepad: {gamepadName || "not connected"}</div>
      </div>

      <div className="section">
        <h3>Mission Target</h3>
        {/* Start Position — Otomatis dari drone */}
        <div className="auto-start-display">
          <label className="auto-label">📍 Start Position (Auto — Drone Realtime)</label>
          <div className="telemetry">
            <div className="metric"><span>X</span><strong>{fmt(odom?.x)}</strong></div>
            <div className="metric"><span>Y</span><strong>{fmt(odom?.y)}</strong></div>
            <div className="metric"><span>Z</span><strong>{fmt(odom?.z)}</strong></div>
          </div>
        </div>
        {/* Destination — Input manual atau klik map */}
        <label style={{marginTop: 10, display: "block", fontSize: 12, color: "#94a3b8", fontWeight: 500}}>
          🎯 Destination (klik map atau input manual)
        </label>
        <div className="field-grid">
          <div className="field">
            <label>Target X</label>
            <input value={manual.x} onChange={(e) => setManual((v) => ({ ...v, x: e.target.value }))} />
          </div>
          <div className="field">
            <label>Target Y</label>
            <input value={manual.y} onChange={(e) => setManual((v) => ({ ...v, y: e.target.value }))} />
          </div>
          <div className="field">
            <label>Alt (Z)</label>
            <input value={manual.z} onChange={(e) => setManual((v) => ({ ...v, z: e.target.value }))} />
          </div>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="btn primary full" disabled={!connected || !odom} onClick={sendManualGoal}>🚀 Send Mission (Auto Start)</button>
          <button className="btn full" disabled={!connected} onClick={clearTrail}>Clear Trail</button>
        </div>
      </div>

      {lastResult ? <div className="status-pill">{lastResult}</div> : null}
    </aside>
  );
}