import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/notificationCentre.css";

const EMPTY_SUMMARY = {
  counts: {
    total: 0,
    unread: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    by_workspace: {},
    by_category: {},
  },
  urgent: [],
};

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function workspaceLabel(value) {
  return {
    group: "Group",
    spare_parts: "Spare Parts",
    mining: "Mining",
    equipment_hire: "Equipment Hire",
  }[value] || value || "Group";
}

function contextLabel(notification) {
  if (notification.site_name) {
    return `${notification.site_code || "SITE"} — ${notification.site_name}`;
  }
  if (notification.hire_location_name) {
    return `${notification.hire_location_code || "HIRE"} — ${notification.hire_location_name}`;
  }
  if (notification.branch_name) {
    return `${notification.branch_code || "STORE"} — ${notification.branch_name}`;
  }
  return "All authorized contexts";
}

function severityOrder(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[value] ?? 9;
}

export default function NotificationCentrePage({ executiveMode = false }) {
  const auth = useAuth();
  const canSync = auth.hasPermission("notifications.sync");
  const canManage = auth.hasPermission("notifications.manage");
  const canEscalate = auth.hasPermission("notifications.escalate");
  const isSystemAdmin = auth.role === "admin";

  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [notifications, setNotifications] = useState([]);
  const [rules, setRules] = useState([]);
  const [activeTab, setActiveTab] = useState("active");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    title: "",
    message: "",
    severity: "medium",
    category: "management",
    action_path: "",
    target_role: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = {
        archived: activeTab === "archived",
        status: activeTab === "resolved" ? "resolved" : "active",
        severity: severity || undefined,
        category: category || undefined,
        search: search.trim() || undefined,
        limit: 200,
        workspace_scope: executiveMode ? "group" : undefined,
      };

      const requests = [
        axiosClient.get("/notifications/summary", {
          params: { workspace_scope: executiveMode ? "group" : undefined },
        }),
        axiosClient.get("/notifications", { params }),
      ];

      if (activeTab === "rules" && canManage) {
        requests.push(axiosClient.get("/notifications/rules"));
      }

      const [summaryResponse, listResponse, rulesResponse] = await Promise.all(requests);
      setSummary(summaryResponse.data || EMPTY_SUMMARY);
      setNotifications(Array.isArray(listResponse.data?.notifications) ? listResponse.data.notifications : []);
      if (rulesResponse) {
        setRules(Array.isArray(rulesResponse.data?.rules) ? rulesResponse.data.rules : []);
      }
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not load the Notification Centre."));
    } finally {
      setLoading(false);
    }
  }, [activeTab, canManage, category, executiveMode, search, severity]);

  useEffect(() => {
    const timer = setTimeout(loadData, 150);
    return () => clearTimeout(timer);
  }, [loadData]);

  const categories = useMemo(() => {
    const values = new Set([
      ...notifications.map((item) => item.category).filter(Boolean),
      ...Object.keys(summary.counts?.by_category || {}),
    ]);
    return [...values].sort();
  }, [notifications, summary]);

  const sortedNotifications = useMemo(
    () => [...notifications].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    [notifications]
  );

  async function syncNotifications() {
    setSyncing(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post("/notifications/sync", {
        workspace_code: executiveMode && auth.role === "admin" ? "group" : auth.workspaceCode,
      });
      setMessage(
        response.data?.message ||
          `Generated ${response.data?.generated_count || 0} current alert(s).`
      );
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not synchronize notification conditions."));
    } finally {
      setSyncing(false);
    }
  }

  async function updateState(item, changes) {
    setWorkingId(item.id);
    setError("");
    try {
      await axiosClient.patch(`/notifications/${item.id}/state`, changes);
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not update the notification."));
    } finally {
      setWorkingId(null);
    }
  }

  async function markAllRead() {
    setWorkingId("all");
    setError("");
    try {
      const response = await axiosClient.post("/notifications/read-all");
      setMessage(response.data?.message || "Notifications marked as read.");
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not mark notifications as read."));
    } finally {
      setWorkingId(null);
    }
  }

  async function resolveNotification(item) {
    const note = window.prompt("Enter the resolution note:");
    if (!note?.trim()) return;
    setWorkingId(item.id);
    try {
      await axiosClient.patch(`/notifications/${item.id}/resolve`, {
        resolution_note: note.trim(),
      });
      setMessage("Notification resolved.");
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not resolve the notification."));
    } finally {
      setWorkingId(null);
    }
  }

  async function reopenNotification(item) {
    setWorkingId(item.id);
    try {
      await axiosClient.patch(`/notifications/${item.id}/reopen`);
      setMessage("Notification reopened.");
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not reopen the notification."));
    } finally {
      setWorkingId(null);
    }
  }

  async function escalateSms(item) {
    const confirmation = window.prompt(
      "This sends an approved high/critical alert to the configured owner phone. Type exactly: SEND CRITICAL NOTIFICATION SMS"
    );
    if (confirmation !== "SEND CRITICAL NOTIFICATION SMS") return;

    setWorkingId(item.id);
    try {
      const response = await axiosClient.post(
        `/notifications/${item.id}/escalate-owner-sms`,
        { confirmation }
      );
      setMessage(response.data?.message || "SMS escalation submitted.");
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not submit the SMS escalation."));
    } finally {
      setWorkingId(null);
    }
  }

  async function submitManual(event) {
    event.preventDefault();
    setWorkingId("manual");
    setError("");
    try {
      const response = await axiosClient.post("/notifications/manual", {
        ...manualForm,
        workspace_code: executiveMode && auth.role === "admin" ? "group" : auth.workspaceCode,
      });
      setMessage(response.data?.message || "Notification created.");
      setManualForm({
        title: "",
        message: "",
        severity: "medium",
        category: "management",
        action_path: "",
        target_role: "",
      });
      setManualOpen(false);
      setActiveTab("active");
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not create the notification."));
    } finally {
      setWorkingId(null);
    }
  }

  async function updateRule(rule, changes) {
    setWorkingId(`rule-${rule.id}`);
    setError("");
    try {
      await axiosClient.patch(`/notifications/rules/${rule.id}`, changes);
      setMessage(`Rule “${rule.rule_name}” updated.`);
      await loadData();
    } catch (requestError) {
      setError(apiMessage(requestError, "Could not update the notification rule."));
    } finally {
      setWorkingId(null);
    }
  }

  const counts = summary.counts || EMPTY_SUMMARY.counts;

  return (
    <main className="notification-centre">
      <header className="notification-hero">
        <div>
          <span className="notification-eyebrow">Release 3D</span>
          <h1>Notification Centre</h1>
          <p>
            Role-aware operational alerts for Spare Parts, Mining and Equipment Hire,
            kept separate by store, Mining site and Hire location.
          </p>
        </div>
        <div className="notification-hero-actions">
          {canSync ? (
            <button type="button" className="notification-primary" onClick={syncNotifications} disabled={syncing}>
              {syncing ? "Synchronizing…" : "Synchronize alerts"}
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className="notification-secondary" onClick={() => setManualOpen((value) => !value)}>
              {manualOpen ? "Close form" : "Create notification"}
            </button>
          ) : null}
          <button type="button" className="notification-secondary" onClick={markAllRead} disabled={workingId === "all"}>
            Mark all read
          </button>
        </div>
      </header>

      {error ? <div className="notification-alert is-error">{error}</div> : null}
      {message ? <div className="notification-alert is-success">{message}</div> : null}

      <section className="notification-kpis" aria-label="Notification summary">
        {[
          ["Active", counts.total, "all"],
          ["Unread", counts.unread, "unread"],
          ["Critical", counts.critical, "critical"],
          ["High", counts.high, "high"],
          ["Medium", counts.medium, "medium"],
          ["Low", counts.low, "low"],
        ].map(([label, value, tone]) => (
          <article key={label} className={`notification-kpi is-${tone}`}>
            <span>{label}</span>
            <strong>{Number(value || 0).toLocaleString()}</strong>
          </article>
        ))}
      </section>

      {manualOpen && canManage ? (
        <form className="notification-manual-form" onSubmit={submitManual}>
          <div className="notification-section-heading">
            <div>
              <h2>Create targeted notification</h2>
              <p>The active workspace and selected site/location are used automatically.</p>
            </div>
          </div>
          <div className="notification-form-grid">
            <label>
              Title
              <input
                required
                value={manualForm.title}
                onChange={(event) => setManualForm((current) => ({ ...current, title: event.target.value }))}
                maxLength={220}
              />
            </label>
            <label>
              Severity
              <select
                value={manualForm.severity}
                onChange={(event) => setManualForm((current) => ({ ...current, severity: event.target.value }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Category
              <input
                value={manualForm.category}
                onChange={(event) => setManualForm((current) => ({ ...current, category: event.target.value }))}
                maxLength={60}
              />
            </label>
            <label>
              Target role (optional)
              <input
                value={manualForm.target_role}
                onChange={(event) => setManualForm((current) => ({ ...current, target_role: event.target.value }))}
                placeholder="manager, accountant, site_supervisor…"
                maxLength={60}
              />
            </label>
            <label className="is-wide">
              Message
              <textarea
                required
                rows={4}
                value={manualForm.message}
                onChange={(event) => setManualForm((current) => ({ ...current, message: event.target.value }))}
                maxLength={1200}
              />
            </label>
            <label className="is-wide">
              Action path (optional)
              <input
                value={manualForm.action_path}
                onChange={(event) => setManualForm((current) => ({ ...current, action_path: event.target.value }))}
                placeholder="/mining/incidents"
                maxLength={500}
              />
            </label>
          </div>
          <button type="submit" className="notification-primary" disabled={workingId === "manual"}>
            {workingId === "manual" ? "Creating…" : "Create notification"}
          </button>
        </form>
      ) : null}

      <section className="notification-panel">
        <div className="notification-tabs" role="tablist">
          {["active", "archived", "resolved"].map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "is-active" : ""}
              onClick={() => setActiveTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
          {canManage ? (
            <button
              type="button"
              className={activeTab === "rules" ? "is-active" : ""}
              onClick={() => setActiveTab("rules")}
            >
              Rules
            </button>
          ) : null}
        </div>

        {activeTab !== "rules" ? (
          <div className="notification-filters">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, message or reference"
            />
            <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <button type="button" className="notification-secondary" onClick={loadData}>Refresh</button>
          </div>
        ) : null}

        {loading ? <div className="notification-empty">Loading notifications…</div> : null}

        {!loading && activeTab === "rules" ? (
          <div className="notification-rule-grid">
            {rules.map((rule) => (
              <article key={rule.id} className="notification-rule-card">
                <div>
                  <span className={`notification-severity is-${rule.default_severity}`}>{rule.default_severity}</span>
                  <h3>{rule.rule_name}</h3>
                  <p>{rule.description}</p>
                  <small>{workspaceLabel(rule.workspace_code)} • {rule.category} • {rule.target_permission || "No permission target"}</small>
                </div>
                <div className="notification-rule-actions">
                  <label>
                    <input
                      type="checkbox"
                      checked={Number(rule.is_enabled) === 1}
                      onChange={(event) => updateRule(rule, { is_enabled: event.target.checked })}
                      disabled={workingId === `rule-${rule.id}`}
                    />
                    Enabled
                  </label>
                  {isSystemAdmin ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={Number(rule.sms_allowed) === 1}
                        onChange={(event) => updateRule(rule, { sms_allowed: event.target.checked })}
                        disabled={workingId === `rule-${rule.id}`}
                      />
                      SMS allowed
                    </label>
                  ) : (
                    <span className="notification-rule-sms-state">
                      SMS escalation: {Number(rule.sms_allowed) === 1 ? "Admin approved" : "Not approved"}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {!loading && activeTab !== "rules" && sortedNotifications.length === 0 ? (
          <div className="notification-empty">
            <strong>No matching notifications.</strong>
            <span>Synchronize alerts or change the filters.</span>
          </div>
        ) : null}

        {!loading && activeTab !== "rules" ? (
          <div className="notification-list">
            {sortedNotifications.map((item) => {
              const isBusy = workingId === item.id;
              const isRead = Boolean(Number(item.is_read));
              return (
                <article key={item.id} className={`notification-card is-${item.severity} ${isRead ? "is-read" : "is-unread"}`}>
                  <div className="notification-card-marker" aria-hidden="true" />
                  <div className="notification-card-content">
                    <div className="notification-card-heading">
                      <div>
                        <div className="notification-card-badges">
                          <span className={`notification-severity is-${item.severity}`}>{item.severity}</span>
                          <span>{workspaceLabel(item.workspace_code)}</span>
                          <span>{item.category}</span>
                          {!isRead ? <span className="is-unread-badge">Unread</span> : null}
                        </div>
                        <h3>{item.title}</h3>
                      </div>
                      <time>{formatDate(item.last_detected_at || item.occurred_at)}</time>
                    </div>
                    <p>{item.message}</p>
                    <div className="notification-card-meta">
                      <span>{contextLabel(item)}</span>
                      {item.source_reference ? <span>Reference: {item.source_reference}</span> : null}
                      {item.due_at ? <span>Due: {formatDate(item.due_at)}</span> : null}
                    </div>
                    <div className="notification-card-actions">
                      {item.action_path ? <Link to={item.action_path}>Open related work</Link> : null}
                      <button type="button" onClick={() => updateState(item, { is_read: !isRead })} disabled={isBusy}>
                        {isRead ? "Mark unread" : "Mark read"}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateState(item, { is_archived: activeTab !== "archived" })}
                        disabled={isBusy}
                      >
                        {activeTab === "archived" ? "Restore" : "Archive"}
                      </button>
                      {canManage && item.status === "active" ? (
                        <button type="button" onClick={() => resolveNotification(item)} disabled={isBusy}>Resolve</button>
                      ) : null}
                      {canManage && item.status === "resolved" ? (
                        <button type="button" onClick={() => reopenNotification(item)} disabled={isBusy}>Reopen</button>
                      ) : null}
                      {canEscalate && Boolean(Number(item.sms_allowed)) && ["critical", "high"].includes(item.severity) ? (
                        <button type="button" className="is-danger" onClick={() => escalateSms(item)} disabled={isBusy}>
                          Escalate by SMS
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
