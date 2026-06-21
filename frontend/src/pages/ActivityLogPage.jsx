import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ActivityLogPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [summary, setSummary] = useState({
    total_logs: 0,
    active_users: 0,
  });

  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [error, setError] = useState("");

  async function loadActivityLog() {
    setError("");

    try {
      const response = await axiosClient.get("/activity-log", {
        params: {
          search,
          action,
          from,
          to,
        },
      });

      setLogs(response.data.logs || []);
      setActions(response.data.actions || []);
      setSummary(response.data.summary || {});
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load activity log. Make sure you are logged in as admin."
      );
    }
  }

  useEffect(() => {
    loadActivityLog();
  }, []);

  function formatAction(actionText) {
    return String(actionText || "")
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function getActionClass(actionText) {
    const text = String(actionText || "").toLowerCase();

    if (text.includes("delete") || text.includes("disable")) {
      return "activity-danger";
    }

    if (text.includes("create") || text.includes("record")) {
      return "activity-success";
    }

    if (text.includes("update") || text.includes("toggle")) {
      return "activity-warning";
    }

    return "activity-neutral";
  }

  if (role !== "admin") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Activity Log.</p>
          </div>
        </div>

        <div className="error-box">
          Only admin accounts can view staff activity logs.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Activity Log</h1>
          <p>Track important actions performed inside the system</p>
        </div>

        <button onClick={loadActivityLog}>Refresh</button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid activity-summary-grid">
        <div className="stat-card">
          <span>Total Logs</span>
          <strong>{summary.total_logs || 0}</strong>
        </div>

        <div className="stat-card">
          <span>Users Involved</span>
          <strong>{summary.active_users || 0}</strong>
        </div>
      </div>

      <div className="section-card">
        <h2>Filter Activity</h2>

        <div className="activity-filter-grid">
          <div>
            <label>Search</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search user, username, action or details"
            />
          </div>

          <div>
            <label>Action</label>
            <select
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              <option value="">All actions</option>

              {actions.map((actionItem) => (
                <option key={actionItem.action} value={actionItem.action}>
                  {formatAction(actionItem.action)} ({actionItem.count})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>From Date</label>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div>
            <label>To Date</label>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div className="filter-actions">
            <button type="button" onClick={loadActivityLog}>
              Apply
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setAction("");
                setFrom("");
                setTo("");
                setTimeout(loadActivityLog, 0);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Recent Activities</h2>

        {logs.length === 0 ? (
          <p>No activity logs found yet.</p>
        ) : (
          <div className="activity-list">
            {logs.map((log) => (
              <div className="activity-item" key={log.id}>
                <div className="activity-top">
                  <span className={`activity-badge ${getActionClass(log.action)}`}>
                    {formatAction(log.action)}
                  </span>

                  <small>{new Date(log.created_at).toLocaleString()}</small>
                </div>

                <p className="activity-details">{log.details}</p>

                <div className="activity-user">
                  <strong>{log.full_name || "System"}</strong>
                  {log.username && <span>@{log.username}</span>}
                  {log.role && <span>{log.role}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}