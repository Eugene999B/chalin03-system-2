import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/systemOperations.css";
import "../styles/delegatedAdministration.css";

function formatDate(value, empty = "Permanent") {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GB");
}

function StatusBadge({ tone = "neutral", children }) {
  return <span className={`sysops-badge is-${tone}`}>{children}</span>;
}

function MetricCard({ icon, label, value, note, tone = "neutral" }) {
  return (
    <article className={`sysops-metric is-${tone}`}>
      <div className="sysops-metric-icon" aria-hidden="true">{icon}</div>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </article>
  );
}

function Notice({ tone = "info", children }) {
  return <div className={`delegate-notice is-${tone}`}>{children}</div>;
}

function blankCapabilities(catalog = []) {
  return Object.fromEntries(catalog.map((item) => [item.code, false]));
}

export default function SystemOperationsPage() {
  const { user, hasPermission } = useAuth();
  const [health, setHealth] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [delegation, setDelegation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  const [selectedAdminId, setSelectedAdminId] = useState("");
  const [capabilities, setCapabilities] = useState({});
  const [delegationReason, setDelegationReason] = useState("");
  const [delegationExpiry, setDelegationExpiry] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [protectedToken, setProtectedToken] = useState(null);
  const [actionLoading, setActionLoading] = useState("");

  const canView =
    String(user?.role || "").toLowerCase() === "admin" &&
    hasPermission("system.diagnostics");
  const tokenReady = Boolean(
    protectedToken?.value && protectedToken.expiresAt > Date.now()
  );

  async function loadSystemOperations() {
    setLoading(true);
    setError("");
    try {
      const [healthResult, readinessResult, diagnosticsResult, delegationResult] =
        await Promise.allSettled([
          axiosClient.get("/health"),
          axiosClient.get("/readiness"),
          axiosClient.get("/system/diagnostics"),
          axiosClient.get("/delegated-administration/overview"),
        ]);

      const data = (result) =>
        result.status === "fulfilled"
          ? result.value?.data || null
          : result.reason?.response?.data || null;
      const healthData = data(healthResult);
      const readinessData = data(readinessResult);
      const diagnosticsData = data(diagnosticsResult);
      const delegationData = data(delegationResult)?.delegated_administration || null;

      setHealth(healthData || {});
      setReadiness(readinessData || {});
      setDiagnostics(diagnosticsData?.diagnostics || {});
      setDelegation(delegationData);
      setLastRefreshedAt(new Date());

      if (!selectedAdminId && delegationData?.candidates?.length) {
        setSelectedAdminId(String(delegationData.candidates[0].id));
      }

      const unavailable = [];
      if (!healthData) unavailable.push("API health");
      if (!readinessData) unavailable.push("readiness");
      if (!diagnosticsData?.diagnostics) unavailable.push("protected diagnostics");
      if (!delegationData) unavailable.push("delegated administration");
      if (unavailable.length) {
        setError(
          `Some checks are unavailable: ${unavailable.join(", ")}. The owner may need to grant System Operations authority before this Administrator can use the protected sections.`
        );
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canView) loadSystemOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const catalog = useMemo(
    () => delegation?.capability_catalog || [],
    [delegation?.capability_catalog]
  );
  const activeAuthorities = useMemo(
    () => delegation?.active_authorities || [],
    [delegation?.active_authorities]
  );
  const selectedAuthority = useMemo(
    () =>
      activeAuthorities.find(
        (item) => Number(item.user?.id) === Number(selectedAdminId)
      ),
    [activeAuthorities, selectedAdminId]
  );

  useEffect(() => {
    if (!catalog.length) return;
    setCapabilities(
      selectedAuthority?.capabilities || blankCapabilities(catalog)
    );
    setDelegationExpiry(
      selectedAuthority?.expires_at
        ? new Date(selectedAuthority.expires_at).toISOString().slice(0, 16)
        : ""
    );
  }, [catalog, selectedAuthority]);

  async function unlockProtectedActions(event) {
    event.preventDefault();
    setActionLoading("unlock");
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post("/release2-final/security/unlock", {
        password: unlockPassword,
      });
      setUnlockPassword("");
      setProtectedToken({
        value: response.data.protected_action_token,
        expiresAt:
          Date.now() + Number(response.data.expires_in_minutes || 10) * 60 * 1000,
      });
      setMessage(response.data.message || "Protected administration actions unlocked.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The current Administrator password was not accepted."
      );
    } finally {
      setActionLoading("");
    }
  }

  function delegationReady() {
    if (!selectedAdminId) {
      setError("Choose an Administrator account.");
      return false;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return false;
    }
    if (delegationReason.trim().length < 8) {
      setError("Enter a clear reason of at least 8 characters.");
      return false;
    }
    if (!Object.entries(capabilities).some(([code, allowed]) => code !== "enabled" && allowed)) {
      setError("Choose at least one delegated authority.");
      return false;
    }
    return true;
  }

  async function saveDelegation() {
    if (!delegationReady()) return;
    if (!window.confirm("Save this delegated System Administrator authority and end the selected user's active sessions?")) return;
    setActionLoading("save");
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.put(
        `/delegated-administration/authorities/${selectedAdminId}`,
        {
          capabilities,
          reason: delegationReason.trim(),
          expires_at: delegationExpiry
            ? new Date(delegationExpiry).toISOString()
            : null,
        },
        { headers: { "X-Protected-Action-Token": protectedToken.value } }
      );
      setMessage(response.data.message);
      setDelegationReason("");
      await loadSystemOperations();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Delegated administration authority could not be saved."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function revokeDelegation() {
    if (!selectedAuthority) {
      setError("The selected Administrator has no active delegated authority.");
      return;
    }
    if (!tokenReady || delegationReason.trim().length < 8) {
      setError("Unlock protected actions and enter a clear revocation reason first.");
      return;
    }
    if (!window.confirm("Revoke all delegated authority for this Administrator immediately?")) return;
    setActionLoading("revoke");
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/delegated-administration/authorities/${selectedAdminId}/revoke`,
        { reason: delegationReason.trim() },
        { headers: { "X-Protected-Action-Token": protectedToken.value } }
      );
      setMessage(response.data.message);
      setDelegationReason("");
      await loadSystemOperations();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Delegated administration authority could not be revoked."
      );
    } finally {
      setActionLoading("");
    }
  }

  const database = diagnostics?.database || {};
  const missingTables = database.missing_tables || [];
  const missingConfiguration = diagnostics?.missing_configuration || [];
  const workspaces = diagnostics?.enabled_workspaces || [];
  const recentErrors = useMemo(
    () => diagnostics?.recent_error_counts || [],
    [diagnostics?.recent_error_counts]
  );
  const permissionControls = diagnostics?.permission_controls || {};
  const permissionOverrideCounts = permissionControls.overrides || {};
  const delegatedCounts = permissionControls.delegated_administration || {};
  const ready = Boolean(readiness?.ready);
  const totalRecentErrors = useMemo(
    () => recentErrors.reduce((total, row) => total + Number(row.count || 0), 0),
    [recentErrors]
  );

  if (!canView) {
    return (
      <div className="sysops-page"><section className="sysops-denied">
        <span aria-hidden="true">🔒</span><h1>System Operations is restricted</h1>
        <p>Only an Administrator with System Diagnostics permission can open this page.</p>
      </section></div>
    );
  }

  return (
    <div className="sysops-page">
      <section className="sysops-hero">
        <div><div className="sysops-kicker"><span>🖥️</span> CHALIN 03 ADMIN CONTROL</div>
          <h1>System Operations</h1>
          <p>Live health, Railway deployment evidence, database readiness, delegated authority, backup posture and access controls.</p>
          <div className="sysops-hero-status">
            <StatusBadge tone={error ? "danger" : ready ? "success" : "warning"}>
              {error ? "Attention required" : ready ? "All core services ready" : "System degraded"}
            </StatusBadge>
            <span>{lastRefreshedAt ? `Updated ${lastRefreshedAt.toLocaleTimeString("en-GB")}` : "Waiting for first check"}</span>
          </div>
        </div>
        <button type="button" className="sysops-refresh" onClick={loadSystemOperations} disabled={loading}>
          {loading ? "Refreshing system…" : "↻ Refresh System Status"}
        </button>
      </section>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <section className="sysops-metric-grid">
        <MetricCard icon="🌐" label="API Service" value={health?.status === "success" ? "Online" : "Unknown"} note={`Version ${health?.version || diagnostics?.version || "not reported"}`} tone={health?.status === "success" ? "success" : "warning"} />
        <MetricCard icon="✅" label="Operational Readiness" value={ready ? "Ready" : "Degraded"} note={readiness?.status || "No result"} tone={ready ? "success" : "warning"} />
        <MetricCard icon="🗄️" label="Railway Database" value={database.database_name || "Not reported"} note={`${Number(database.query_latency_ms || 0)} ms query latency`} tone={database.reachable ? "success" : "danger"} />
        <MetricCard icon="🚆" label="Deployment" value={diagnostics?.deployment?.provider || "Unknown"} note={diagnostics?.deployment?.commit_short || "Commit SHA unavailable"} />
        <MetricCard icon="🔐" label="Delegated Administrators" value={Number(delegatedCounts.active_delegated_administrators || 0)} note={`${Number(delegatedCounts.delegated_rules_expiring_within_7_days || 0)} rules expire within 7 days`} tone={Number(delegatedCounts.active_delegated_administrators || 0) ? "warning" : "success"} />
        <MetricCard icon="🚨" label="Errors in 24 Hours" value={totalRecentErrors.toLocaleString("en-GH")} note="Grouped application error responses" tone={totalRecentErrors ? "warning" : "success"} />
      </section>

      {delegation?.can_manage ? (
        <section className="delegate-panel">
          <div className="delegate-heading"><div><span>RELEASE 3F-D</span><h2>Delegated System Administrator</h2>
            <p>The original owner remains permanently protected. Delegation requires a reason, optional expiry, password confirmation, audit evidence and immediate session refresh.</p></div>
            <StatusBadge tone="success">Owner controls</StatusBadge>
          </div>

          <div className="delegate-selection">
            <label>Administrator account<select value={selectedAdminId} onChange={(event) => setSelectedAdminId(event.target.value)}>
              {(delegation.candidates || []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.full_name || candidate.username} · @{candidate.username}</option>)}
            </select></label>
            <label>Authority expiry<input type="datetime-local" value={delegationExpiry} onChange={(event) => setDelegationExpiry(event.target.value)} /><small>Leave blank for no automatic expiry.</small></label>
            <label className="delegate-reason">Mandatory reason<textarea rows={3} maxLength={500} value={delegationReason} onChange={(event) => setDelegationReason(event.target.value)} placeholder="Example: Approved to administer the system while the owner is away" /><small>{delegationReason.trim().length}/500 · minimum 8</small></label>
          </div>

          <div className="delegate-capability-grid">
            {catalog.filter((item) => item.code !== "enabled").map((item) => (
              <label key={item.code} className={capabilities[item.code] ? "is-selected" : ""}>
                <input type="checkbox" checked={Boolean(capabilities[item.code])} onChange={(event) => setCapabilities((current) => ({ ...current, [item.code]: event.target.checked }))} />
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </label>
            ))}
          </div>

          <form className="delegate-unlock" onSubmit={unlockProtectedActions} autoComplete="off">
            <div><strong>Protected action confirmation</strong><small>{tokenReady ? "Unlocked for this page session." : "Enter your current owner password. Passwords are never recorded."}</small></div>
            {!tokenReady ? <><input type="password" value={unlockPassword} onChange={(event) => setUnlockPassword(event.target.value)} placeholder="Current owner password" autoComplete="new-password" required /><button type="submit" disabled={actionLoading === "unlock"}>{actionLoading === "unlock" ? "Unlocking…" : "Unlock"}</button></> : <StatusBadge tone="success">Unlocked</StatusBadge>}
          </form>

          <div className="delegate-actions">
            <button type="button" onClick={saveDelegation} disabled={!tokenReady || Boolean(actionLoading)}>{actionLoading === "save" ? "Saving…" : "Save delegated authority"}</button>
            <button type="button" className="is-danger" onClick={revokeDelegation} disabled={!tokenReady || !selectedAuthority || Boolean(actionLoading)}>{actionLoading === "revoke" ? "Revoking…" : "Revoke active authority"}</button>
          </div>

          <div className="delegate-authority-list">
            <h3>Active delegated Administrators</h3>
            {activeAuthorities.length ? activeAuthorities.map((item) => (
              <article key={item.user.id}><div><strong>{item.user.full_name || item.user.username}</strong><span>@{item.user.username} · {(item.user.primary_workspace_code || "spare_parts").replaceAll("_", " ")}</span></div><div><strong>{Object.entries(item.capabilities || {}).filter(([code, allowed]) => code !== "enabled" && allowed).length} authorities</strong><span>Expires: {formatDate(item.expires_at)}</span></div></article>
            )) : <Notice>No delegated System Administrator is currently active.</Notice>}
          </div>
        </section>
      ) : delegation?.viewer?.is_delegated_system_administrator ? (
        <section className="delegate-panel"><div className="delegate-heading"><div><span>DELEGATED AUTHORITY</span><h2>Your owner-approved administration scope</h2><p>Your authority is category-isolated and ends automatically at the recorded expiry.</p></div><StatusBadge tone="warning">Delegated</StatusBadge></div>
          <div className="delegate-capability-grid is-readonly">{catalog.filter((item) => item.code !== "enabled" && delegation.viewer.capabilities?.[item.code]).map((item) => <div key={item.code}><strong>{item.label}</strong><small>{item.description}</small></div>)}</div>
          <Notice>Authority expiry: {formatDate(delegation.viewer.expires_at)}</Notice>
        </section>
      ) : null}

      <div className="sysops-layout">
        <section className="sysops-panel"><div className="sysops-panel-heading"><div><span>CORE READINESS</span><h2>Service checks</h2></div><StatusBadge tone={ready ? "success" : "warning"}>{ready ? "PASS" : "REVIEW"}</StatusBadge></div>
          <div className="sysops-check-list">{Object.entries(readiness?.checks || {}).map(([name, status]) => <div className="sysops-check" key={name}><span className={status === "ready" ? "is-ready" : "is-warning"}>{status === "ready" ? "✓" : "!"}</span><div><strong>{name.replaceAll("_", " ")}</strong><small>{status}</small></div></div>)}</div>
          {missingTables.length ? <Notice tone="error">Missing database tables: {missingTables.join(", ")}</Notice> : <Notice tone="success">No expected database table is missing.</Notice>}
        </section>

        <section className="sysops-panel"><div className="sysops-panel-heading"><div><span>DEPLOYMENT & CORS</span><h2>Railway and public origins</h2></div></div>
          <div className="sysops-detail-grid"><div><span>Provider</span><strong>{diagnostics?.deployment?.provider || "unknown"}</strong></div><div><span>Railway service</span><strong>{diagnostics?.deployment?.railway_service || "not reported"}</strong></div><div><span>Commit</span><strong>{diagnostics?.deployment?.commit_short || "not reported"}</strong></div><div><span>Environment</span><strong>{diagnostics?.deployment?.railway_environment || diagnostics?.environment || "unknown"}</strong></div></div>
          <Notice tone={diagnostics?.cors?.canonical_configured && diagnostics?.cors?.alternate_configured ? "success" : "warning"}>Canonical and www domains are hardcoded safely in Express. Railway should also retain FRONTEND_URL and FRONTEND_URL_ALT for visible configuration evidence.</Notice>
        </section>

        <section className="sysops-panel"><div className="sysops-panel-heading"><div><span>BUSINESS WORKSPACES</span><h2>Workspace availability</h2></div><StatusBadge>{workspaces.length} found</StatusBadge></div>
          <div className="sysops-workspace-list">{workspaces.map((workspace) => <div key={workspace.code}><span>{workspace.code === "mining" ? "⛏️" : workspace.code === "equipment_hire" ? "🚜" : "🧰"}</span><div><strong>{workspace.name}</strong><small>{workspace.code}</small></div><StatusBadge tone={workspace.enabled ? "success" : "warning"}>{workspace.enabled ? "Enabled" : "Disabled"}</StatusBadge></div>)}</div>
        </section>

        <section className="sysops-panel"><div className="sysops-panel-heading"><div><span>ACCESS CONTROL</span><h2>Permissions and sessions</h2></div></div>
          <div className="sysops-detail-grid"><div><span>Active overrides</span><strong>{Number(permissionOverrideCounts.active_overrides || 0)}</strong></div><div><span>Explicit denies</span><strong>{Number(permissionOverrideCounts.active_denies || 0)}</strong></div><div><span>Active sessions</span><strong>{Number(diagnostics?.session_controls?.active_sessions || 0)}</strong></div><div><span>Protected windows</span><strong>{Number(diagnostics?.session_controls?.active_protected_windows || 0)}</strong></div></div>
          <div className="sysops-control-links"><Link to="/user-permissions">Open User Permission Manager</Link><Link to="/activity-log">Open Activity Log</Link><Link to="/security-centre">Open Security Centre</Link></div>
        </section>

        <section className="sysops-panel"><div className="sysops-panel-heading"><div><span>CONFIGURATION</span><h2>Safe configuration posture</h2></div></div>
          {missingConfiguration.length ? <Notice tone="error">Missing required variable names: {missingConfiguration.join(", ")}</Notice> : <Notice tone="success">Required secret variable names are present. Secret values are not displayed.</Notice>}
          <div className="sysops-setting-list"><div><span>Web restore</span><strong>{diagnostics?.backup?.web_restore_enabled ? "Enabled for controlled window" : "Disabled"}</strong></div><div><span>SMS provider</span><strong>{diagnostics?.sms?.provider || "not reported"}</strong></div></div>
        </section>
      </div>

      <section className="sysops-safety"><div className="sysops-safety-icon">🛡️</div><div><span>PRODUCTION SAFETY</span><h2>Controlled maintenance only</h2><p>Never run <code>database/schema.sql</code> against the live Railway database. Use additive release migrations only after local tests and readiness verification.</p></div><ul><li>The original owner cannot be deleted, disabled, demoted or overridden.</li><li>Delegated changes revoke active sessions immediately.</li><li>Restore remains disabled unless Railway explicitly opens the controlled window.</li></ul></section>
    </div>
  );
}
