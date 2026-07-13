import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ActivityLogPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

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

  async function loadActivityLog(customFilters = null) {
    setError("");

    const filters = customFilters || {
      search,
      action,
      from,
      to,
    };

    try {
      const response = await axiosClient.get("/activity-log", {
        params: filters,
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
    loadActivityLog({
      search: "",
      action: "",
      from: "",
      to: "",
    });
    // Reload activity log when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

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

  function getLogStoreCode(log) {
    return log?.branch_code || log?.store_code || currentStoreCode;
  }

  function getLogStoreName(log) {
    return log?.branch_name || log?.store_name || currentStoreName;
  }

  if (role !== "admin") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Activity Log for {currentStoreCode} —{" "}
              {currentStoreName}.
            </p>
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
          <p>
            Track important actions performed inside{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <button onClick={() => loadActivityLog()}>Refresh</button>
      </div>

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e3a8a",
          fontWeight: "800",
        }}
      >
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Staff activity logs, action filters and summary counts are filtered to
          this selected store only.
        </small>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid activity-summary-grid">
        <div className="stat-card">
          <span>{currentStoreCode} Total Logs</span>
          <strong>{summary.total_logs || 0}</strong>
        </div>

        <div className="stat-card">
          <span>{currentStoreCode} Users Involved</span>
          <strong>{summary.active_users || 0}</strong>
        </div>
      </div>

      <div className="section-card">
        <h2>Filter Activity - {currentStoreCode}</h2>

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
            <button type="button" onClick={() => loadActivityLog()}>
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
                loadActivityLog({
                  search: "",
                  action: "",
                  from: "",
                  to: "",
                });
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Recent Activities - {currentStoreCode}</h2>

        {logs.length === 0 ? (
          <p>No activity logs found yet for {currentStoreCode}.</p>
        ) : (
          <div className="activity-list">
            {logs.map((log) => (
              <div className="activity-item" key={log.id}>
                <div className="activity-top">
                  <span className={`activity-badge ${getActionClass(log.action)}`}>
                    {formatAction(log.action)}
                  </span>

                  <small>
                    {getLogStoreCode(log)} •{" "}
                    {new Date(log.created_at).toLocaleString()}
                  </small>
                </div>

                <p className="activity-details">{log.details}</p>

                <div className="activity-user">
                  <strong>{log.full_name || "System"}</strong>
                  {log.username && <span>@{log.username}</span>}
                  {log.role && <span>{log.role}</span>}
                  <span>
                    {getLogStoreCode(log)} — {getLogStoreName(log)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
