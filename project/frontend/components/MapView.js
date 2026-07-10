"use client";

import { useEffect, useRef, useState, useCallback } from "react";
const WORLD = {
  xMin: -190,
  xMax: 370,
  yMin: -220,
  yMax: 160
};

const FIELDS = [
  { name: "Sawah Kiri", x: -175, y: -145, w: 220, h: 290, color: "#163f29" },
  { name: "Sawah Kanan Atas", x: 45, y: -87.5, w: 280, h: 175, color: "#1b4d2e" },
  { name: "Sawah Tengah Bawah", x: 45, y: -201.5, w: 170, h: 115, color: "#19442b" },
  { name: "Sawah Biru", x: 215, y: -201.5, w: 140, h: 115, color: "#16354d" }
];

function useCanvasSize(ref) {
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(420, Math.floor(rect.height))
      });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function makeTransform(width, height) {
  const pad = 40;
  const sx = (width - pad * 2) / (WORLD.xMax - WORLD.xMin);
  const sy = (height - pad * 2) / (WORLD.yMax - WORLD.yMin);
  const scale = Math.min(sx, sy);
  const offsetX = (width - (WORLD.xMax - WORLD.xMin) * scale) * 0.5;
  const offsetY = (height - (WORLD.yMax - WORLD.yMin) * scale) * 0.5;

  return {
    toScreen(point) {
      return {
        x: offsetX + (point.x - WORLD.xMin) * scale,
        y: offsetY + (WORLD.yMax - point.y) * scale
      };
    },
    toWorld(point) {
      return {
        x: WORLD.xMin + (point.x - offsetX) / scale,
        y: WORLD.yMax - (point.y - offsetY) / scale,
        z: 0
      };
    },
    scale
  };
}

export default function MapView({
  connected,
  odomRef, // Pakai Ref untuk data frekuensi tinggi
  yawRef,
  trail,
  goal,
  pathDraft,
  plannedPath,
  pathsJson,
  obstacles,
  sensorScan,
  setPathDraft,
  setGoal,
  publishGoal,
  onObstacleSelect
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const size = useCanvasSize(wrapRef);

  // RequestAnimationFrame Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let animationId;
    const render = () => {
      // Ambil data terbaru langsung dari Ref (no React re-render)
      const odom = odomRef?.current;
      const yaw = yawRef?.current || 0;
      
      drawMap(ctx, size, { 
        odom, 
        yaw, 
        trail, 
        goal, 
        pathDraft, 
        plannedPath,
        pathsJson,
        obstacles,
        sensorScan 
      });
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [size, trail, goal, pathDraft, plannedPath, obstacles, sensorScan, odomRef, yawRef]);

  const handleClick = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    
    // transform defined here
    const transform = makeTransform(size.width, size.height);
    const world = transform.toWorld({ x: px, y: py });

    // Cek apakah klik pada obstacle
    const clickedObs = obstacles.find((obs) => {
      const radius = Number(obs.radius || 0) + Number(obs.clearance || 0);
      return Math.hypot(world.x - Number(obs.x), world.y - Number(obs.y)) <= radius;
    });

    if (clickedObs) {
      if (onObstacleSelect) onObstacleSelect(clickedObs);
      return;
    }

    // Hanya draw pathDraft dan update state goal (untuk ControlPanel), tidak langsung publish
    const dronePos = odomRef?.current;
    if (!dronePos) return; // Abaikan klik jika belum ada telemetry
    const dest = { x: world.x, y: world.y, z: world.z || 0 };
    setPathDraft({ start: { ...dronePos }, end: dest });
    if (setGoal) setGoal(dest);
  }, [size, obstacles, onObstacleSelect, odomRef, setPathDraft, setGoal]);

  const handleDoubleClick = useCallback((e) => {
    e.preventDefault();
    setPathDraft(null);
    if (setGoal) setGoal(null);
  }, [setPathDraft, setGoal]);

  return (
    <section className="panel map-panel" ref={wrapRef}>
      <div className="map-toolbar">
        <div className="status-pill" style={{ background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(8px)" }}>
          <span className={connected ? "dot ok" : "dot"} />
          {connected ? "LIVE TELEMETRY MAP" : "ROSBRIDGE OFFLINE"}
        </div>
        <div className="status-pill subtle" style={{ background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(8px)" }}>
          PX4 / Gazebo Harmonic
        </div>
      </div>
      <canvas className="map-canvas" ref={canvasRef} onClick={handleClick} onDoubleClick={handleDoubleClick} />
    </section>
  );
}

function drawMap(ctx, size, state) {
  const { width, height } = size;
  const transform = makeTransform(width, height);
  ctx.clearRect(0, 0, width, height);

  drawGrid(ctx, width, height, transform);
  drawFields(ctx, transform);
  drawObstacles(ctx, transform, state.obstacles || []);
  drawPathsJson(ctx, transform, state.pathsJson);
  drawTrail(ctx, transform, state.trail || []);
  
  if (!state.pathsJson || !state.pathsJson.final || state.pathsJson.final.length === 0) {
    drawDraftPath(ctx, transform, state.pathDraft);
  }
  
  drawSensorScan(ctx, transform, state.odom, state.yaw, state.sensorScan);
  drawGoal(ctx, transform, state.goal);
  drawDrone(ctx, transform, state.odom, state.yaw);
}

function drawGrid(ctx, width, height, transform) {
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  ctx.font = "500 10px 'Inter', sans-serif";
  ctx.fillStyle = "#475569";

  for (let x = -180; x <= 360; x += 40) {
    const a = transform.toScreen({ x, y: WORLD.yMin });
    const b = transform.toScreen({ x, y: WORLD.yMax });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillText(`${x}m`, b.x + 4, b.y + 14);
  }

  for (let y = -200; y <= 160; y += 40) {
    const a = transform.toScreen({ x: WORLD.xMin, y });
    const b = transform.toScreen({ x: WORLD.xMax, y });
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillText(`${y}m`, a.x + 4, a.y - 4);
  }
}

function drawFields(ctx, transform) {
  FIELDS.forEach((field) => {
    const topLeft = transform.toScreen({ x: field.x, y: field.y + field.h });
    const bottomRight = transform.toScreen({ x: field.x + field.w, y: field.y });
    
    ctx.fillStyle = field.color;
    ctx.strokeStyle = "rgba(52, 211, 153, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    ctx.globalAlpha = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "600 11px 'Inter', sans-serif";
    ctx.fillText(field.name, topLeft.x + 10, topLeft.y + 20);
  });
}

function drawTrail(ctx, transform, trail) {
  if (trail.length < 2) return;
  ctx.strokeStyle = "rgba(163, 230, 53, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  trail.forEach((point, index) => {
    const p = transform.toScreen(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawPathsJson(ctx, transform, pathsJson) {
  if (!pathsJson) return;

  const drawPath = (path, color, dash, width) => {
    if (!path || path.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    else ctx.setLineDash([]);
    ctx.beginPath();
    path.forEach((point, index) => {
      const p = transform.toScreen(point);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  drawPath(pathsJson.global, "#64748b", [4, 4], 2); // Slate grey for Global A*
  drawPath(pathsJson.local, "#f59e0b", [6, 4], 2);  // Amber for Local RRT
  drawPath(pathsJson.final, "#0ea5e9", [6, 4], 2);  // Dashed Cyan for Final (thinner)
  drawPath(pathsJson.orbit, "#10b981", [4, 2], 2);  // Emerald green for Orbit
}

function drawObstacles(ctx, transform, obstacles) {
  obstacles.forEach((obstacle) => {
    const p = transform.toScreen(obstacle);
    const radius = Number(obstacle.radius || 0) * transform.scale;
    const clearance = (Number(obstacle.radius || 0) + Number(obstacle.clearance || 0)) * transform.scale;
    const isBuilding = obstacle.kind === "building";

    ctx.fillStyle = isBuilding ? "rgba(244, 63, 94, 0.05)" : "rgba(245, 158, 11, 0.05)";
    ctx.strokeStyle = isBuilding ? "rgba(244, 63, 94, 0.3)" : "rgba(245, 158, 11, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, clearance, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    if (isBuilding) {
      const half = radius;
      ctx.fillStyle = "#4c0519";
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fda4af";
      ctx.font = "500 11px 'Inter', sans-serif";
      ctx.fillText(obstacle.id || "Structure", p.x + half + 6, p.y + 4);
    } else {
      ctx.fillStyle = "#064e3b";
      ctx.strokeStyle = "#b45309";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#a7f3d0";
      ctx.font = "500 11px 'Inter', sans-serif";
      const label = obstacle.id?.startsWith("sawit") ? "🌴 Sawit" : (obstacle.id?.startsWith("pohon_tengah_obstacle") ? "🌴 Pohon" : "Tree");
      ctx.fillText(label, p.x + radius + 6, p.y + 4);
    }
  });
}

function drawSensorScan(ctx, transform, odom, yaw, scan) {
  const ranges = scan?.ranges || [];
  if (!odom || !ranges.length) return;
  const origin = transform.toScreen(odom);
  const fov = Math.PI * 1.5;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.lineWidth = 1;

  let minRange = Infinity;
  let minIndex = -1;

  ranges.forEach((range, index) => {
    const val = Number(range || 0);
    if (val < minRange && val > 0.1) {
      minRange = val;
      minIndex = index;
    }
    const angle = yaw - fov / 2 + (index / Math.max(1, ranges.length - 1)) * fov;
    const point = {
      x: odom.x + Math.cos(angle) * val,
      y: odom.y + Math.sin(angle) * val
    };
    const end = transform.toScreen(point);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });

  // Removed dotted line and text for nearest obstacle (moved to sidebar)
}

function drawDraftPath(ctx, transform, draft) {
  if (!draft?.start || !draft?.end) return;
  const start = transform.toScreen(draft.start);

  // Start point marker (posisi drone) — lingkaran hijau
  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Destination marker — lingkaran amber
  const end = transform.toScreen(draft.end);
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d97706";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Garis draft dari start ke end
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGoal(ctx, transform, goal) {
  if (!goal) return;
  const p = transform.toScreen(goal);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 12, p.y);
  ctx.lineTo(p.x + 12, p.y);
  ctx.moveTo(p.x, p.y - 12);
  ctx.lineTo(p.x, p.y + 12);
  ctx.stroke();
}

function drawDrone(ctx, transform, odom, yaw) {
  if (!odom) return;
  const p = transform.toScreen(odom);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-yaw);
  
  // Drone Body Vector Graphics
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -10);
  ctx.lineTo(-6, 0);
  ctx.lineTo(-10, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}