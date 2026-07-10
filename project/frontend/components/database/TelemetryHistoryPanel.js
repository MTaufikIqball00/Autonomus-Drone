"use client";

import { useEffect, useMemo, useState } from "react";

function fmt(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "--";
}

function timeLabel(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function statusTotal(rows, status) {
  const row = rows.find((item) => item.status === status);
  return Number(row?.total || 0);
}

export default function TelemetryHistoryPanel({ droneId = 1 }) {
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [telemetryRes, analyticsRes] = await Promise.all([
          fetch(`/api/telemetry?droneId=${droneId}&limit=120`, { cache: "no-store" }),
          fetch(`/api/analytics?droneId=${droneId}`, { cache: "no-store" }),
        ]);

        if (!telemetryRes.ok || !analyticsRes.ok) {
          throw new Error("Database API tidak tersedia");
        }

        const telemetryJson = await telemetryRes.json();
        const analyticsJson = await analyticsRes.json();
        if (!cancelled) {
          setHistory(Array.isArray(telemetryJson.data) ? telemetryJson.data : []);
          setAnalytics(analyticsJson);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Gagal membaca database");
      }
    }

    load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [droneId]);

  useEffect(() => {
    const events = new EventSource(`/api/telemetry/stream?droneId=${droneId}&intervalMs=1000`);
    events.addEventListener("telemetry", (event) => {
      const data = JSON.parse(event.data);
      if (!data) return;
      setLatest(data);
      setHistory((prev) => {
        if (prev.some((item) => item.id === data.id)) return prev;
        return [...prev.slice(-119), data];
      });
    });
    events.addEventListener("error", () => setError("Stream database terputus"));
    return () => events.close();
  }, [droneId]);

  const speedBars = useMemo(() => {
    const points = history.slice(-36);
    const maxSpeed = Math.max(1, ...points.map((item) => Number(item.speed_mps || 0)));
    return points.map((item) => ({
      id: item.id,
      height: Math.max(6, (Number(item.speed_mps || 0) / maxSpeed) * 100),
      label: timeLabel(item.recorded_at),
    }));
  }, [history]);

  const missionStatus = analytics?.missionStatus || [];
  const batteryRows = analytics?.batteryUsage || [];
  const latestBattery = batteryRows[0];

  return (
    <section className="database-grid">
      <div className="panel db-panel">
        <div className="panel-title">
          <h2>Database Telemetry</h2>
          <span className="status-pill subtle">{history.length} samples</span>
        </div>

        <div className="db-stat-grid">
          <div className="metric">
            <span>Persisted Altitude</span>
            <strong>{fmt(latest?.altitude_m ?? history.at(-1)?.altitude_m)} m</strong>
          </div>
          <div className="metric">
            <span>Persisted Speed</span>
            <strong>{fmt(latest?.speed_mps ?? history.at(-1)?.speed_mps)} m/s</strong>
          </div>
          <div className="metric">
            <span>Heading</span>
            <strong>{fmt(latest?.heading_deg ?? history.at(-1)?.heading_deg, 0)} deg</strong>
          </div>
        </div>

        <div className="db-bars" aria-label="Persisted speed chart">
          {speedBars.map((bar) => (
            <span key={bar.id} title={bar.label} style={{ height: `${bar.height}%` }} />
          ))}
        </div>

        {error ? <p className="db-error">{error}</p> : null}
      </div>

      <div className="panel db-panel">
        <div className="panel-title">
          <h2>Mission History</h2>
          <span className="status-pill subtle">MySQL</span>
        </div>

        <div className="db-stat-grid">
          <div className="metric">
            <span>Success</span>
            <strong>{statusTotal(missionStatus, "success")}</strong>
          </div>
          <div className="metric">
            <span>Failed</span>
            <strong>{statusTotal(missionStatus, "failed")}</strong>
          </div>
          <div className="metric">
            <span>Running</span>
            <strong>{statusTotal(missionStatus, "running")}</strong>
          </div>
        </div>

        <div className="db-table">
          <div className="db-table-row head">
            <span>Mission</span>
            <span>Mode</span>
            <span>Battery</span>
          </div>
          {batteryRows.slice(0, 5).map((row) => (
            <div className="db-table-row" key={row.mission_id}>
              <span>{row.mission_name}</span>
              <span>{row.mode}</span>
              <span>{fmt(row.battery_used_percent, 2)}%</span>
            </div>
          ))}
          {!batteryRows.length ? (
            <div className="db-table-row">
              <span>No mission data</span>
              <span>--</span>
              <span>{fmt(latestBattery?.battery_used_percent, 2)}%</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
