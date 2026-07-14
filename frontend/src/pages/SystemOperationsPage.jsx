import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

function StatusPill({ ok, label }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "999px",
        padding: "6px 10px",
        fontWeight: 900,
        fontSize: "12px",
        color: ok ? "#065f46" : "#991b1b",
        background: ok ? "#d1fae5" : "#fee2e2",
        border: `1px solid ${ok ? "#6ee7b7" : "#fecaca"}`,
      }}
    >
      {label}
    </span>
  );
}

function JsonBlock({ value }) {
  return (
    <pre
      style={{
        overflow: "auto",
        whiteSpace: "pre-wrap",
        borderRadius: "10px",
        background: "#0f172a",
        color: "#e2e8f0",
        padding: "14px",
        fontSize: "12px",
        lineHeight: 1.55,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function SystemOperationsPage() {
  const { user, hasPermission } = useAuth();
  const [health, setHealth] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canView = String(user?.role || "").toLowerCase() === "admin" &&
    hasPermission("system.diagnostics");

  async function loadSystemOperations() {
    setLoading(true);
    setError("");

    try {
      const [healthResponse, readinessResponse, diagnosticsResponse] =
        await Promise.all([
          axiosClient.get("/health"),
          axiosClient.get("/readiness"),
          axiosClient.get("/system/diagnostics"),
        ]);

      setHealth(healthResponse.data);
      setReadiness(readinessResponse.data);
      setDiagnostics(diagnosticsResponse.data.diagnostics || {});
    } catch (loadError) {
      setError(
        loadError.response?.data?.message ||
          "Could not load system operations safely."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canView) {
      loadSystemOperations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  if (!canView) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>System Operations is available only to administrators.</p>
          </div>
        </div>
        <div className="error-box">Your account cannot view diagnostics.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>System Operations</h1>
          <p>Health, readiness, backup readiness and safe diagnostics.</p>
        </div>
        <button type="button" onClick={loadSystemOperations} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid">
        <div className="stat-card">
          <span>API health</span>
          <strong>{health?.status || "-"}</strong>
          <StatusPill ok={health?.status === "success"} label={health?.version || "unknown"} />
        </div>
        <div className="stat-card">
          <span>Readiness</span>
          <strong>{readiness?.ready ? "Ready" : "Degraded"}</strong>
          <StatusPill ok={Boolean(readiness?.ready)} label={readiness?.status || "unknown"} />
        </div>
        <div className="stat-card">
          <span>Database</span>
          <strong>{diagnostics?.database?.database_name || "-"}</strong>
          <StatusPill
            ok={Boolean(diagnostics?.database?.reachable)}
            label={`${diagnostics?.database?.query_latency_ms || 0} ms`}
          />
        </div>
      </div>

      <div className="section-card">
        <h2>Operational Readiness</h2>
        <JsonBlock
          value={{
            database: diagnostics?.database || readiness?.database,
            enabled_workspaces: diagnostics?.enabled_workspaces || [],
            missing_configuration:
              diagnostics?.missing_configuration ||
              readiness?.missing_configuration ||
              [],
            backup: diagnostics?.backup || {},
            sms: diagnostics?.sms || {},
            recent_error_counts: diagnostics?.recent_error_counts || [],
          }}
        />
      </div>

      <div className="section-card">
        <h2>Maintenance Notes</h2>
        <ul style={{ lineHeight: 1.8, fontWeight: 750 }}>
          <li>Use the Backup page for downloads and dry-run validation.</li>
          <li>Web restore remains disabled unless `ALLOW_WEB_RESTORE=true` is set for a local restore window.</li>
          <li>Run `tools\\run_full_local_acceptance.ps1` before handover.</li>
          <li>Keep private backups outside the project folder.</li>
        </ul>
      </div>
    </div>
  );
}
