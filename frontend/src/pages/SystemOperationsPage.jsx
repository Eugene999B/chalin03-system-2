import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/systemOperations.css";

function formatUptime(value) {
  const seconds = Math.max(Number(value || 0), 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    `${minutes}m`,
  ]
    .filter(Boolean)
    .join(" ");
}

function StatusBadge({ tone = "neutral", children }) {
  return <span className={`sysops-badge is-${tone}`}>{children}</span>;
}

function MetricCard({ icon, label, value, note, tone = "neutral" }) {
  return (
    <article className={`sysops-metric is-${tone}`}>
      <div className="sysops-metric-icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function EmptyState({ children }) {
  return <div className="sysops-empty">{children}</div>;
}

export default function SystemOperationsPage() {
  const { user, hasPermission } = useAuth();
  const [health, setHealth] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const canView =
    String(user?.role || "").toLowerCase() === "admin" &&
    hasPermission("system.diagnostics");

  async function loadSystemOperations() {
    setLoading(true);
    setError("");

    try {
      const [healthResult, readinessResult, diagnosticsResult] =
        await Promise.allSettled([
          axiosClient.get("/health"),
          axiosClient.get("/readiness"),
          axiosClient.get("/system/diagnostics"),
        ]);
      const resultData = (result) =>
        result.status === "fulfilled"
          ? result.value?.data || null
          : result.reason?.response?.data || null;
      const healthData = resultData(healthResult);
      const readinessData = resultData(readinessResult);
      const diagnosticsData = resultData(diagnosticsResult);
      const unavailable = [];

      if (!healthData) unavailable.push("API health");
      if (!readinessData) unavailable.push("readiness");
      if (!diagnosticsData?.diagnostics) unavailable.push("diagnostics");

      setHealth(healthData || {});
      setReadiness(readinessData || {});
      setDiagnostics(diagnosticsData?.diagnostics || {});
      setLastRefreshedAt(new Date());

      if (unavailable.length) {
        setError(
          `Some System Operations checks are unavailable: ${unavailable.join(
            ", "
          )}. Review the request ID and deployment logs.`
        );
      }
    } catch (loadError) {
      setError(
        loadError.response?.data?.message ||
          "Could not load System Operations safely. Review the request ID and backend logs."
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

  const database = diagnostics?.database || {};
  const missingTables = Array.isArray(database.missing_tables)
    ? database.missing_tables
    : [];
  const missingConfiguration = Array.isArray(
    diagnostics?.missing_configuration
  )
    ? diagnostics.missing_configuration
    : [];
  const workspaces = Array.isArray(diagnostics?.enabled_workspaces)
    ? diagnostics.enabled_workspaces
    : [];
  const recentErrors = Array.isArray(diagnostics?.recent_error_counts)
    ? diagnostics.recent_error_counts
    : [];
  const ready = Boolean(readiness?.ready);
  const overallTone = error ? "danger" : ready ? "success" : "warning";
  const overallLabel = error
    ? "Attention required"
    : ready
    ? "All core services ready"
    : "System is degraded";
  const totalRecentErrors = useMemo(
    () =>
      recentErrors.reduce(
        (total, row) => total + Number(row.count || 0),
        0
      ),
    [recentErrors]
  );

  if (!canView) {
    return (
      <div className="sysops-page">
        <section className="sysops-denied">
          <span aria-hidden="true">🔒</span>
          <h1>System Operations is restricted</h1>
          <p>
            Only an administrator with the System Diagnostics permission can
            open this page.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="sysops-page">
      <section className="sysops-hero">
        <div>
          <div className="sysops-kicker">
            <span aria-hidden="true">🖥️</span>
            CHALIN 03 ADMIN CONTROL
          </div>
          <h1>System Operations</h1>
          <p>
            Live health, database readiness, workspace availability, backup
            posture and safe diagnostics in one administrator-only view.
          </p>
          <div className="sysops-hero-status">
            <StatusBadge tone={overallTone}>{overallLabel}</StatusBadge>
            <span>
              {lastRefreshedAt
                ? `Updated ${lastRefreshedAt.toLocaleTimeString("en-GB")}`
                : "Waiting for first health check"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="sysops-refresh"
          onClick={loadSystemOperations}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
          {loading ? "Refreshing system…" : "Refresh System Status"}
        </button>
      </section>

      {error ? <div className="sysops-alert is-danger">{error}</div> : null}

      <section className="sysops-metric-grid" aria-label="System health summary">
        <MetricCard
          icon="🌐"
          label="API Service"
          value={health?.status === "success" ? "Online" : "Unknown"}
          note={`Version ${health?.version || diagnostics?.version || "not reported"}`}
          tone={health?.status === "success" ? "success" : "warning"}
        />
        <MetricCard
          icon="✅"
          label="Operational Readiness"
          value={ready ? "Ready" : "Degraded"}
          note={readiness?.status || "No readiness result"}
          tone={ready ? "success" : "warning"}
        />
        <MetricCard
          icon="🗄️"
          label="Railway Database"
          value={database.database_name || "Not reported"}
          note={`${Number(database.query_latency_ms || 0)} ms query latency`}
          tone={database.reachable ? "success" : "danger"}
        />
        <MetricCard
          icon="⏱️"
          label="Backend Uptime"
          value={formatUptime(
            diagnostics?.uptime_seconds || health?.uptime_seconds
          )}
          note={`${diagnostics?.node_version || "Node version unavailable"}`}
          tone="neutral"
        />
        <MetricCard
          icon="📨"
          label="SMS Provider"
          value={diagnostics?.sms?.provider || "Not reported"}
          note={
            diagnostics?.sms?.enabled
              ? "Provider sending is enabled"
              : "Provider sending is disabled"
          }
          tone={diagnostics?.sms?.enabled ? "success" : "warning"}
        />
        <MetricCard
          icon="🚨"
          label="Errors in 24 Hours"
          value={totalRecentErrors.toLocaleString("en-GH")}
          note="Grouped application error responses"
          tone={totalRecentErrors > 0 ? "warning" : "success"}
        />
      </section>

      <div className="sysops-layout">
        <section className="sysops-panel">
          <div className="sysops-panel-heading">
            <div>
              <span>CORE READINESS</span>
              <h2>Service checks</h2>
            </div>
            <StatusBadge tone={ready ? "success" : "warning"}>
              {ready ? "PASS" : "REVIEW"}
            </StatusBadge>
          </div>

          <div className="sysops-check-list">
            {Object.entries(readiness?.checks || {}).map(([name, status]) => (
              <div className="sysops-check" key={name}>
                <span className={status === "ready" ? "is-ready" : "is-warning"}>
                  {status === "ready" ? "✓" : "!"}
                </span>
                <div>
                  <strong>{name.replaceAll("_", " ")}</strong>
                  <small>{status}</small>
                </div>
              </div>
            ))}
          </div>

          <div className="sysops-detail-grid">
            <div>
              <span>Environment</span>
              <strong>{diagnostics?.environment || "unknown"}</strong>
            </div>
            <div>
              <span>Expected tables</span>
              <strong>{Number(database.expected_table_count || 0)}</strong>
            </div>
            <div>
              <span>Missing tables</span>
              <strong>{missingTables.length}</strong>
            </div>
            <div>
              <span>Manifest</span>
              <strong>{diagnostics?.backup?.manifest_version || "unknown"}</strong>
            </div>
          </div>

          {missingTables.length ? (
            <div className="sysops-alert is-danger">
              Missing database tables: {missingTables.join(", ")}
            </div>
          ) : (
            <div className="sysops-alert is-success">
              No expected database table is missing.
            </div>
          )}
        </section>

        <section className="sysops-panel">
          <div className="sysops-panel-heading">
            <div>
              <span>BUSINESS WORKSPACES</span>
              <h2>Workspace availability</h2>
            </div>
            <StatusBadge tone="neutral">{workspaces.length} found</StatusBadge>
          </div>

          {workspaces.length ? (
            <div className="sysops-workspace-list">
              {workspaces.map((workspace) => (
                <div key={workspace.code || workspace.name}>
                  <span aria-hidden="true">
                    {workspace.code === "mining"
                      ? "⛏️"
                      : workspace.code === "equipment_hire"
                      ? "🚜"
                      : "🧰"}
                  </span>
                  <div>
                    <strong>{workspace.name || workspace.code}</strong>
                    <small>{workspace.code}</small>
                  </div>
                  <StatusBadge tone={workspace.enabled ? "success" : "warning"}>
                    {workspace.enabled ? "Enabled" : "Disabled"}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No workspace status was returned.</EmptyState>
          )}
        </section>

        <section className="sysops-panel">
          <div className="sysops-panel-heading">
            <div>
              <span>CONFIGURATION</span>
              <h2>Safe configuration posture</h2>
            </div>
          </div>

          {missingConfiguration.length ? (
            <div className="sysops-alert is-danger">
              Missing required variable names: {missingConfiguration.join(", ")}
            </div>
          ) : (
            <div className="sysops-alert is-success">
              Required configuration names are present. Secret values are never
              displayed here.
            </div>
          )}

          <div className="sysops-setting-list">
            <div>
              <span>Web restore</span>
              <strong>
                {diagnostics?.backup?.web_restore_enabled
                  ? "Enabled for a controlled window"
                  : "Disabled"}
              </strong>
            </div>
            <div>
              <span>SMS sender ID</span>
              <strong>
                {diagnostics?.sms?.sender_id_configured
                  ? "Configured"
                  : "Not configured"}
              </strong>
            </div>
            <div>
              <span>SMS API key</span>
              <strong>
                {diagnostics?.sms?.api_key_configured
                  ? "Configured securely"
                  : "Not configured"}
              </strong>
            </div>
          </div>
        </section>

        <section className="sysops-panel">
          <div className="sysops-panel-heading">
            <div>
              <span>RECENT ERRORS</span>
              <h2>Last 24-hour response summary</h2>
            </div>
          </div>

          {recentErrors.length ? (
            <div className="sysops-error-list">
              {recentErrors.map((row) => (
                <div key={row.status_code}>
                  <span>{row.status_code}</span>
                  <strong>{Number(row.count || 0).toLocaleString("en-GH")}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No application error response was recorded.</EmptyState>
          )}
        </section>
      </div>

      <section className="sysops-safety">
        <div className="sysops-safety-icon" aria-hidden="true">
          🛡️
        </div>
        <div>
          <span>PRODUCTION SAFETY</span>
          <h2>Controlled maintenance only</h2>
          <p>
            Use Backup & Restore for validated backups. Never run
            <code> database/schema.sql </code> against live Railway production,
            and never expose database credentials on this page.
          </p>
        </div>
        <ul>
          <li>Validate a fresh full-system backup before migrations.</li>
          <li>Apply only the exact additive migration for the release.</li>
          <li>Review request IDs and deployment logs before any rollback.</li>
        </ul>
      </section>
    </div>
  );
}
