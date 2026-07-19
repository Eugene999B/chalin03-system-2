import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/userPermissionManager.css";

function formatDate(value) {
  if (!value) return "Permanent";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

function statusForPermission(permission, permissionState) {
  const roleDefaults = new Set(permissionState?.role_default_permissions || []);
  const allows = new Set(permissionState?.explicit_allows || []);
  const denies = new Set(permissionState?.explicit_denies || []);
  const effective = new Set(permissionState?.effective_permissions || []);

  if (denies.has(permission.code)) {
    return { code: "deny", label: "Restricted", note: "Explicit deny overrides every allow" };
  }
  if (allows.has(permission.code)) {
    return { code: "allow", label: "Allowed", note: "Explicit user grant" };
  }
  if (roleDefaults.has(permission.code)) {
    return { code: "role_allow", label: "Role allows", note: "Inherited from assigned role" };
  }
  if (effective.has(permission.code)) {
    return { code: "effective", label: "Effective", note: "Available through another active rule" };
  }
  return { code: "role_deny", label: "Role restricts", note: "Not granted by assigned role" };
}

function Notice({ type = "info", children }) {
  return <div className={`upm-notice is-${type}`}>{children}</div>;
}

function normalizedWorkspace(value) {
  const workspace = String(value || "").trim().toLowerCase();
  return ["spare_parts", "mining", "equipment_hire"].includes(workspace)
    ? workspace
    : "spare_parts";
}

export default function UserPermissionManagerPage() {
  const { user: signedInUser } = useAuth();
  const [catalog, setCatalog] = useState([]);
  const [workspaceOptions, setWorkspaceOptions] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [workspaceCode, setWorkspaceCode] = useState(() => normalizedWorkspace(signedInUser?.workspace_code));
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [protectedToken, setProtectedToken] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [workerConflicts, setWorkerConflicts] = useState([]);
  const [conflictSelections, setConflictSelections] = useState({});
  const [conflictReason, setConflictReason] = useState("");
  const [canReviewConflicts, setCanReviewConflicts] = useState(false);

  const tokenReady = Boolean(
    protectedToken?.value && protectedToken.expiresAt > Date.now()
  );

  const selectedUser = useMemo(
    () => users.find((item) => Number(item.id) === Number(selectedUserId)) || null,
    [users, selectedUserId]
  );

  const categories = useMemo(
    () => [...new Set(catalog.map((item) => item.category))].sort(),
    [catalog]
  );

  const visiblePermissions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!term) return true;
      return `${item.code} ${item.label} ${item.category}`.toLowerCase().includes(term);
    });
  }, [catalog, category, search]);

  async function loadWorkspaceData(workspace = workspaceCode) {
    setLoading(true);
    setError("");
    try {
      const [catalogResponse, usersResponse, conflictResponse] = await Promise.all([
        axiosClient.get("/user-permissions/catalog", {
          params: { workspace_code: workspace },
        }),
        axiosClient.get("/user-permissions/users", {
          params: { workspace_code: workspace },
        }),
        axiosClient.get("/user-permissions/category-conflicts"),
      ]);

      const loadedUsers = usersResponse.data?.users || [];
      setCatalog(catalogResponse.data?.permissions || []);
      setWorkspaceOptions(catalogResponse.data?.workspace_options || []);
      setUsers(loadedUsers);
      setConflicts(conflictResponse.data?.conflicts || []);
      setWorkerConflicts(conflictResponse.data?.worker_conflicts || []);
      setCanReviewConflicts(Boolean(conflictResponse.data?.can_review_conflicts));
      setCategory("all");
      setSearch("");

      const currentStillVisible = loadedUsers.some(
        (item) => Number(item.id) === Number(selectedUserId)
      );
      if (!currentStillVisible) {
        const preferred = loadedUsers.find(
          (item) => Number(item.id) !== Number(signedInUser?.id)
        );
        setSelectedUserId(loadedUsers.length ? String(preferred?.id || loadedUsers[0].id) : "");
        setDetail(null);
        setHistory([]);
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "User Permission Manager could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(userId = selectedUserId, workspace = workspaceCode) {
    if (!userId) return;
    setDetailLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(`/user-permissions/users/${userId}`, {
        params: { workspace_code: workspace },
      });
      setDetail(response.data);
      setHistory(response.data?.history || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The selected user's effective permissions could not be loaded."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    const signedInWorkspace = normalizedWorkspace(signedInUser?.workspace_code);
    if (signedInWorkspace !== workspaceCode && workspaceOptions.length === 0) {
      setWorkspaceCode(signedInWorkspace);
      return;
    }
    loadWorkspaceData(workspaceCode);
    // Selection changes are handled by the detail effect below; avoid reloading the catalog on each user click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceCode, signedInUser?.workspace_code]);

  useEffect(() => {
    if (selectedUserId) loadDetail(selectedUserId, workspaceCode);
    // The explicit IDs are the complete reload key for this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, workspaceCode]);

  async function unlockProtectedActions(event) {
    event.preventDefault();
    setUnlockLoading(true);
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
      setMessage(response.data.message || "Protected permission actions unlocked.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Current password was not accepted."
      );
    } finally {
      setUnlockLoading(false);
    }
  }

  function actionPrerequisites() {
    if (!selectedUserId) {
      setError("Choose a user first.");
      return false;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return false;
    }
    if (reason.trim().length < 8) {
      setError("Enter a clear reason of at least 8 characters.");
      return false;
    }
    return true;
  }

  async function applyOverride(permissionCode, effect) {
    if (!actionPrerequisites()) return;

    const verb = effect === "allow" ? "allow" : "restrict";
    if (
      !window.confirm(
        `${verb === "allow" ? "Allow" : "Restrict"} ${permissionCode} for ${
          selectedUser?.full_name || selectedUser?.username
        } in ${workspaceCode.replaceAll("_", " ")}?`
      )
    ) {
      return;
    }

    setActionLoading(`${permissionCode}:${effect}`);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/user-permissions/users/${selectedUserId}/override`,
        {
          workspace_code: workspaceCode,
          permission_code: permissionCode,
          effect,
          reason: reason.trim(),
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          revoke_sessions: revokeSessions,
        },
        {
          headers: {
            "X-Protected-Action-Token": protectedToken.value,
          },
        }
      );
      setDetail((current) => ({
        ...current,
        permission_state: response.data.permission_state,
      }));
      setHistory(response.data.history || []);
      setMessage(response.data.message);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Permission override could not be saved."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function resetPermission(permissionCode) {
    if (!actionPrerequisites()) return;
    if (!window.confirm(`Return ${permissionCode} to the assigned role default?`)) return;

    setActionLoading(`${permissionCode}:reset`);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/user-permissions/users/${selectedUserId}/reset-permission`,
        {
          workspace_code: workspaceCode,
          permission_code: permissionCode,
          reason: reason.trim(),
          revoke_sessions: revokeSessions,
        },
        {
          headers: {
            "X-Protected-Action-Token": protectedToken.value,
          },
        }
      );
      setDetail((current) => ({
        ...current,
        permission_state: response.data.permission_state,
      }));
      setHistory(response.data.history || []);
      setMessage(response.data.message);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Permission could not be reset to the role default."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function resetAll() {
    if (!actionPrerequisites()) return;
    if (
      !window.confirm(
        `Reset every ${workspaceCode.replaceAll("_", " ")} override for ${
          selectedUser?.full_name || selectedUser?.username
        }?`
      )
    ) {
      return;
    }

    setActionLoading("reset-all");
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/user-permissions/users/${selectedUserId}/reset-all`,
        {
          workspace_code: workspaceCode,
          reason: reason.trim(),
          revoke_sessions: revokeSessions,
        },
        {
          headers: {
            "X-Protected-Action-Token": protectedToken.value,
          },
        }
      );
      setDetail((current) => ({
        ...current,
        permission_state: response.data.permission_state,
      }));
      setHistory(response.data.history || []);
      setMessage(response.data.message);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Permission overrides could not be reset."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function resolveCategoryConflict(conflict) {
    const selectedWorkspace = conflictSelections[conflict.user_id];
    if (!selectedWorkspace) {
      setError("Choose the single category this account must retain.");
      return;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return;
    }
    if (conflictReason.trim().length < 8) {
      setError("Enter a clear conflict-resolution reason of at least 8 characters.");
      return;
    }
    const label = selectedWorkspace.replaceAll("_", " ");
    if (!window.confirm(`Assign ${conflict.full_name || conflict.username} only to ${label}? Other category access will be disabled and active sessions revoked.`)) {
      return;
    }

    setActionLoading(`conflict:${conflict.user_id}`);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.put(
        `/user-permissions/category-conflicts/${conflict.user_id}/resolve`,
        {
          workspace_code: selectedWorkspace,
          reason: conflictReason.trim(),
        },
        {
          headers: { "X-Protected-Action-Token": protectedToken.value },
        }
      );
      setMessage(response.data.message);
      setConflictReason("");
      setConflictSelections((current) => {
        const next = { ...current };
        delete next[conflict.user_id];
        return next;
      });
      await loadWorkspaceData(workspaceCode);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The category assignment conflict could not be resolved."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function resolveWorkerCategoryConflict(conflict) {
    const selectionKey = `worker:${conflict.worker_id}`;
    const selectedWorkspace = conflictSelections[selectionKey];
    if (!selectedWorkspace) {
      setError("Choose the single category this worker profile must retain.");
      return;
    }
    if (!tokenReady) {
      setError("Unlock protected actions with your current password first.");
      return;
    }
    if (conflictReason.trim().length < 8) {
      setError("Enter a clear conflict-resolution reason of at least 8 characters.");
      return;
    }
    if (!window.confirm(`Assign ${conflict.full_name} only to ${selectedWorkspace.replaceAll("_", " ")}? Historical assignments will remain auditable and other active category assignments will be ended.`)) {
      return;
    }

    setActionLoading(`worker-conflict:${conflict.worker_id}`);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.put(
        `/user-permissions/worker-category-conflicts/${conflict.worker_id}/resolve`,
        { workspace_code: selectedWorkspace, reason: conflictReason.trim() },
        { headers: { "X-Protected-Action-Token": protectedToken.value } }
      );
      setMessage(response.data.message);
      setConflictReason("");
      setConflictSelections((current) => {
        const next = { ...current };
        delete next[selectionKey];
        return next;
      });
      await loadWorkspaceData(workspaceCode);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The worker category conflict could not be resolved.");
    } finally {
      setActionLoading("");
    }
  }

  if (loading) {
    return <div className="upm-loading">Loading User Permission Manager...</div>;
  }

  const state = detail?.permission_state;
  const activeOverrideCount = state?.active_overrides?.length || 0;

  return (
    <div className="upm-page">
      <header className="upm-hero">
        <div>
          <p>Release 3F-C2 · Independent Category Control</p>
          <h1>User Permission Manager</h1>
          <span>
            Select one independent business category at a time. Only its users and permissions are shown. Explicit deny overrides allow, every change needs a reason, and ambiguous category assignments remain blocked until reviewed.
          </span>
        </div>
        <div className="upm-hero-badge">🔐 Protected changes</div>
      </header>

      {error ? <Notice type="error">{error}</Notice> : null}
      {message ? <Notice type="success">{message}</Notice> : null}

      {canReviewConflicts && (conflicts.length || workerConflicts.length) ? (
        <section className="upm-card upm-conflict-panel">
          <div className="upm-card-heading">
            <div>
              <h2>Category Assignment Conflicts</h2>
              <p>These accounts were preserved exactly as found but are blocked from category login. The original System Administrator must choose one category. No access is silently deleted.</p>
            </div>
            <span className="upm-conflict-count">{conflicts.length + workerConflicts.length} awaiting review</span>
          </div>

          <label className="upm-conflict-reason">
            Resolution reason for the next conflict
            <textarea value={conflictReason} onChange={(event) => setConflictReason(event.target.value)} rows={2} maxLength={500} placeholder="Example: Management confirmed this worker belongs only to Mining Operations" />
          </label>

          <div className="upm-conflict-list">
            {conflicts.map((conflict) => (
              <article key={conflict.user_id}>
                <div>
                  <strong>{conflict.full_name || conflict.username}</strong>
                  <span>@{conflict.username} · Detected: {(conflict.detected_workspaces || []).join(", ") || "multiple categories"}</span>
                  <small>{conflict.conflict_reason}</small>
                </div>
                <select value={conflictSelections[conflict.user_id] || ""} onChange={(event) => setConflictSelections((current) => ({ ...current, [conflict.user_id]: event.target.value }))}>
                  <option value="">Choose retained category</option>
                  <option value="spare_parts">Spare Parts</option>
                  <option value="mining">Mining Operations</option>
                  <option value="equipment_hire">Equipment Hire</option>
                </select>
                <button type="button" onClick={() => resolveCategoryConflict(conflict)} disabled={actionLoading === `conflict:${conflict.user_id}`}>
                  {actionLoading === `conflict:${conflict.user_id}` ? "Resolving..." : "Resolve safely"}
                </button>
              </article>
            ))}

            {workerConflicts.map((conflict) => {
              const selectionKey = `worker:${conflict.worker_id}`;
              return (
                <article key={selectionKey}>
                  <div>
                    <strong>{conflict.full_name} · {conflict.employee_number}</strong>
                    <span>Worker profile · Detected: {(conflict.detected_workspaces || []).join(", ") || "multiple categories"}</span>
                    <small>{conflict.conflict_reason}</small>
                  </div>
                  <select value={conflictSelections[selectionKey] || ""} onChange={(event) => setConflictSelections((current) => ({ ...current, [selectionKey]: event.target.value }))}>
                    <option value="">Choose retained category</option>
                    <option value="spare_parts">Spare Parts</option>
                    <option value="mining">Mining Operations</option>
                    <option value="equipment_hire">Equipment Hire</option>
                  </select>
                  <button type="button" onClick={() => resolveWorkerCategoryConflict(conflict)} disabled={actionLoading === `worker-conflict:${conflict.worker_id}`}>
                    {actionLoading === `worker-conflict:${conflict.worker_id}` ? "Resolving..." : "Resolve worker safely"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : canReviewConflicts ? (
        <Notice type="success">No unresolved multi-category account assignments were detected.</Notice>
      ) : null}

      <section className="upm-card upm-selection-grid">
        <label>
          Staff account
          <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
            {users.map((item) => (
              <option key={item.id} value={item.id}>
                {item.full_name || item.username} · {item.role}
              </option>
            ))}
          </select>
        </label>

        <label>
          Business workspace
          <select value={workspaceCode} onChange={(event) => setWorkspaceCode(event.target.value)}>
            {workspaceOptions.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <div className="upm-selected-user">
          <small>Selected account</small>
          <strong>{selectedUser?.full_name || selectedUser?.username || "-"}</strong>
          <span>
            @{selectedUser?.username || "-"} · {selectedUser?.role || "-"} ·{
              selectedUser?.is_active ? " Active" : " Disabled"
            } · {selectedUser?.primary_workspace_code === "*" ? "System Administrator" : (selectedUser?.primary_workspace_code || "Conflict review").replaceAll("_", " ")}
          </span>
        </div>
      </section>

      <Notice type="info">
        Showing {workspaceCode.replaceAll("_", " ")} users and permissions only. A grant or restriction made here cannot affect another business category.
      </Notice>

      <section className="upm-card">
        <div className="upm-card-heading">
          <div>
            <h2>Protected Action Unlock</h2>
            <p>Your current password opens a short protected window. Passwords are never recorded.</p>
          </div>
          <span className={`upm-token-state ${tokenReady ? "is-ready" : ""}`}>
            {tokenReady ? "Unlocked" : "Locked"}
          </span>
        </div>

        {tokenReady ? (
          <Notice type="success">Permission changes are unlocked for this page session.</Notice>
        ) : (
          <form className="upm-unlock-form" onSubmit={unlockProtectedActions} autoComplete="off">
            <input
              type="password"
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              placeholder="Current administrator password"
              autoComplete="new-password"
              data-lpignore="true"
              required
            />
            <button type="submit" disabled={unlockLoading}>
              {unlockLoading ? "Unlocking..." : "Unlock Permission Changes"}
            </button>
          </form>
        )}
      </section>

      <section className="upm-card">
        <div className="upm-card-heading">
          <div>
            <h2>Change Controls</h2>
            <p>These controls apply to every Allow, Restrict or Reset action below.</p>
          </div>
          <button
            type="button"
            className="upm-reset-all"
            onClick={resetAll}
            disabled={!activeOverrideCount || actionLoading === "reset-all"}
          >
            {actionLoading === "reset-all" ? "Resetting..." : "Reset all to role defaults"}
          </button>
        </div>

        <div className="upm-control-grid">
          <label className="upm-reason-field">
            Mandatory reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Example: Temporary stock-audit duty approved by the Administrator"
            />
            <small>{reason.trim().length}/500 characters · minimum 8</small>
          </label>

          <label>
            Expiry date and time
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
            <small>Leave blank for no automatic expiry.</small>
          </label>

          <label className="upm-check-control">
            <input
              type="checkbox"
              checked={revokeSessions}
              onChange={(event) => setRevokeSessions(event.target.checked)}
            />
            <span>
              <strong>Revoke the user's active sessions</strong>
              <small>Recommended so the changed permission takes effect on the next login.</small>
            </span>
          </label>
        </div>
      </section>

      <section className="upm-summary-grid">
        <article><span>Assigned role</span><strong>{state?.workspace_role || selectedUser?.role || "-"}</strong></article>
        <article><span>Role defaults</span><strong>{state?.role_default_permissions?.length || 0}</strong></article>
        <article><span>Explicit allows</span><strong>{state?.explicit_allows?.length || 0}</strong></article>
        <article><span>Explicit denies</span><strong>{state?.explicit_denies?.length || 0}</strong></article>
        <article><span>Effective permissions</span><strong>{state?.effective_permissions?.length || 0}</strong></article>
      </section>

      <section className="upm-card">
        <div className="upm-card-heading upm-permission-heading">
          <div>
            <h2>Feature, Page and Action Permissions</h2>
            <p>Use Allow or Restrict for a direct user rule. Reset returns the permission to the assigned role.</p>
          </div>
          <div className="upm-filters">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search permission..."
            />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>

        {detailLoading ? <div className="upm-loading-inline">Loading effective permission preview...</div> : null}

        <div className="upm-table-wrap">
          <table className="upm-permission-table">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Current result</th>
                <th>Expiry</th>
                <th>One-click control</th>
              </tr>
            </thead>
            <tbody>
              {visiblePermissions.map((permission) => {
                const permissionStatus = statusForPermission(permission, state);
                const activeOverride = state?.active_overrides?.find(
                  (item) => item.permission_code === permission.code
                );
                const denyProtected =
                  selectedUser?.is_original_system_administrator && permission.owner_protected;
                const allowProtected =
                  selectedUser?.role !== "admin" && permission.admin_only_grant;

                return (
                  <tr key={permission.code}>
                    <td data-label="Permission">
                      <strong>{permission.label}</strong>
                      <code>{permission.code}</code>
                      <small>{permission.category}</small>
                      {permission.owner_protected ? <em>Owner protected</em> : null}
                    </td>
                    <td data-label="Current Result">
                      <span className={`upm-status is-${permissionStatus.code}`}>
                        {permissionStatus.label}
                      </span>
                      <small>{permissionStatus.note}</small>
                    </td>
                    <td data-label="Expiry">
                      {activeOverride ? formatDate(activeOverride.expires_at) : "Role default"}
                    </td>
                    <td data-label="Controls">
                      <div className="upm-actions">
                        <button
                          type="button"
                          className="is-allow"
                          onClick={() => applyOverride(permission.code, "allow")}
                          disabled={
                            allowProtected ||
                            Boolean(actionLoading) ||
                            !tokenReady
                          }
                          title={allowProtected ? "Protected administration grants require an Administrator account." : "Allow this permission"}
                        >
                          {actionLoading === `${permission.code}:allow` ? "Saving..." : "Allow"}
                        </button>
                        <button
                          type="button"
                          className="is-deny"
                          onClick={() => applyOverride(permission.code, "deny")}
                          disabled={
                            denyProtected ||
                            Boolean(actionLoading) ||
                            !tokenReady
                          }
                          title={denyProtected ? "This owner-security permission cannot be denied." : "Restrict this permission"}
                        >
                          {actionLoading === `${permission.code}:deny` ? "Saving..." : "Restrict"}
                        </button>
                        <button
                          type="button"
                          className="is-reset"
                          onClick={() => resetPermission(permission.code)}
                          disabled={!activeOverride || Boolean(actionLoading) || !tokenReady}
                        >
                          {actionLoading === `${permission.code}:reset` ? "Resetting..." : "Role default"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="upm-card">
        <div className="upm-card-heading">
          <div>
            <h2>Permission Change History</h2>
            <p>Reasons, expiry, creator and reset evidence are retained for review.</p>
          </div>
          <span>{history.length} recent records</span>
        </div>
        <div className="upm-table-wrap">
          <table className="upm-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Permission</th>
                <th>Rule</th>
                <th>Reason</th>
                <th>Expiry / reset</th>
                <th>Administrator</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td data-label="Date">{formatDate(item.created_at)}</td>
                  <td data-label="Permission"><code>{item.permission_code}</code></td>
                  <td data-label="Rule">{String(item.effect || "").toUpperCase()}</td>
                  <td data-label="Reason">{item.reason}</td>
                  <td data-label="Expiry / Reset">
                    {item.revoked_at
                      ? `Reset ${formatDate(item.revoked_at)} · ${item.revocation_reason || "No reason"}`
                      : formatDate(item.expires_at)}
                  </td>
                  <td data-label="Administrator">{item.created_by_name || item.created_by_username || "System"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.length === 0 ? <Notice>No permission overrides have been recorded for this user and workspace.</Notice> : null}
      </section>
    </div>
  );
}
