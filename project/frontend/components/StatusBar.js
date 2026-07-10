export default function StatusBar({ connected, url, error }) {
  return (
    <div className="status-bar">
      <div className="status-pill" style={{ borderColor: connected ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)" }}>
        <span className={connected ? "dot ok" : "dot"} />
        <span style={{ color: connected ? "#ffffff" : "var(--muted)" }}>
          {connected ? "ROSBridge Socket Connected" : "ROSBridge Disconnected"}
        </span>
        <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>· {url}</span>
      </div>
      {error ? <div className="status-error">⚠ {error}</div> : null}
    </div>
  );
}