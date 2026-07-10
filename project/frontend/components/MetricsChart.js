"use client";

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

const METRICS = [
  { key: "autoTimeSec", label: "Auto Flight Time", unit: "s", max: 240 },
  { key: "manualTimeSec", label: "Manual Flight Time", unit: "s", max: 240 },
  { key: "autoBatteryUsed", label: "Auto Battery Usage", unit: "%", max: 0.3, scale: 100 },
  { key: "manualBatteryUsed", label: "Manual Battery Usage", unit: "%", max: 0.3, scale: 100 }
];

export default function MetricsChart({ metrics }) {
  return (
    <section className="panel metrics-panel">
      <div className="panel-title">
        <h2>Mission Analytics Hub</h2>
        <span className="status-pill subtle">{metrics?.mode || "STANDBY"}</span>
      </div>
      <div className="chart-grid">
        {METRICS.map((item) => {
          const raw = Number(metrics?.[item.key]);
          const value = Number.isFinite(raw) ? raw : 0;
          const scaled = item.scale ? value * item.scale : value;
          const width = Math.max(4, Math.min(100, (value / item.max) * 100));
          return (
            <div className="chart-row" key={item.key}>
              <div className="chart-header">
                <div className="chart-label">{item.label}</div>
                <strong>{fmt(scaled)} {item.unit}</strong>
              </div>
              <div className="chart-track">
                <div className="chart-fill" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}