import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const emptyFilters = {
  search: "",
  action: "",
  category: "",
  workspace: "",
  role: "",
  outcome: "",
  severity: "",
  entity_type: "",
  entity_id: "",
  request_id: "",
  from: "",
  to: "",
  page: 1,
  limit: 50,
};

function label(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function downloadBlob(response, fallbackName) {
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || fallbackName;
  const url = window.URL.createObjectURL(response.data instanceof Blob ? response.data : new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function ActivityLogPage() {
  const { user, hasPermission } = useAuth();
  const [filters, setFilters] = useState(emptyFilters);
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState({});
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1 });
  const [selectedLog, setSelectedLog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");

  const canView =
    hasPermission("audit.view") || hasPermission("spare_parts.audit");
  const canExport = hasPermission("audit.export");

  const queryParams = useMemo(() => {
    return Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== "")
    );
  }, [filters]);

  async function loadAuditTrail(nextFilters = filters) {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/activity-log", {
        params: Object.fromEntries(
          Object.entries(nextFilters).filter(([, value]) => value !== "")
        ),
      });
      setLogs(response.data.logs || []);
      setActions(response.data.actions || []);
      setCategories(response.data.categories || []);
      setSummary(response.data.summary || {});
      setPagination(response.data.pagination || { page: 1, total_pages: 1 });
    } catch (loadError) {
      setError(loadError.response?.data?.message || "Failed to load audit trail.");
    } finally {
      setLoading(false);
    }
  }

  async function exportActivity(format) {
    setExporting(format);
    setError("");

    try {
      const response = await axiosClient.get(`/activity-log/export.${format}`, {
        params: queryParams,
        responseType: "blob",
      });
      const fallback = `chalin03-audit-${filters.category || "all"}.${format}`;
      downloadBlob(response, fallback);
    } catch (exportError) {
      setError(exportError.response?.data?.message || `Failed to export audit trail as ${format.toUpperCase()}.`);
    } finally {
      setExporting("");
    }
  }

  useEffect(() => {
    if (canView) {
      loadAuditTrail(emptyFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: 1 }));
  }

  function changePage(nextPage) {
    const page = Math.max(1, Math.min(nextPage, pagination.total_pages || 1));
    const nextFilters = { ...filters, page };
    setFilters(nextFilters);
    loadAuditTrail(nextFilters);
  }

  if (!canView) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>Only authorized admin and auditor accounts can view audit records.</p>
          </div>
        </div>
        <div className="error-box">Your account cannot open the audit trail.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audit Trail</h1>
          <p>Search structured user, security and operational activity.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={() => loadAuditTrail()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {[
            ["xlsx", "📊 Excel"],
            ["pdf", "📄 PDF"],
            ["doc", "📝 Word"],
            ["csv", "CSV"],
          ].map(([format, text]) => (
            <button
              key={format}
              type="button"
              className="secondary-button"
              onClick={() => exportActivity(format)}
              disabled={!canExport || Boolean(exporting)}
            >
              {exporting === format ? "Preparing..." : text}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid activity-summary-grid">
        <div className="stat-card">
          <span>Total records</span>
          <strong>{summary.total_logs || 0}</strong>
        </div>
        <div className="stat-card">
          <span>Users involved</span>
          <strong>{summary.active_users || 0}</strong>
        </div>
        <div className="stat-card">
          <span>Selected category</span>
          <strong>{filters.category ? label(filters.category) : "All"}</strong>
        </div>
      </div>

      <div className="section-card">
        <h2>Activity Categories</h2>
        <p>Choose one category to review or download separately, or keep All Categories for a complete control report.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px" }}>
          <button type="button" className={!filters.category ? "" : "secondary-button"} onClick={() => updateFilter("category", "")}>
            All Categories
          </button>
          {categories.map((item) => (
            <button
              type="button"
              key={item.key}
              className={filters.category === item.key ? "" : "secondary-button"}
              onClick={() => updateFilter("category", item.key)}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      </div>

      <div className="section-card">
        <h2>Filters</h2>
        <div className="activity-filter-grid">
          <label>
            Search
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="User, action, request ID or details"
            />
          </label>
          <label>
            Action
            <select
              value={filters.action}
              onChange={(event) => updateFilter("action", event.target.value)}
            >
              <option value="">All actions</option>
              {actions.map((actionItem) => (
                <option key={actionItem.action} value={actionItem.action}>
                  {label(actionItem.action)} ({actionItem.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={filters.category}
              onChange={(event) => updateFilter("category", event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label} ({item.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Workspace
            <select
              value={filters.workspace}
              onChange={(event) => updateFilter("workspace", event.target.value)}
            >
              <option value="">All workspaces</option>
              <option value="spare_parts">Spare Parts</option>
              <option value="mining">Mining Operations</option>
              <option value="equipment_hire">Equipment Hire</option>
            </select>
          </label>
          <label>
            Role
            <input
              value={filters.role}
              onChange={(event) => updateFilter("role", event.target.value)}
              placeholder="admin, auditor, manager"
            />
          </label>
          <label>
            Outcome
            <select
              value={filters.outcome}
              onChange={(event) => updateFilter("outcome", event.target.value)}
            >
              <option value="">All outcomes</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label>
            Severity
            <select
              value={filters.severity}
              onChange={(event) => updateFilter("severity", event.target.value)}
            >
              <option value="">All severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Entity type
            <input
              value={filters.entity_type}
              onChange={(event) => updateFilter("entity_type", event.target.value)}
              placeholder="sale, user, backup"
            />
          </label>
          <label>
            Entity ID
            <input
              value={filters.entity_id}
              onChange={(event) => updateFilter("entity_id", event.target.value)}
              placeholder="Record ID"
            />
          </label>
          <label>
            Request ID
            <input
              value={filters.request_id}
              onChange={(event) => updateFilter("request_id", event.target.value)}
              placeholder="Request ID"
            />
          </label>
          <label>
            From
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter("from", event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter("to", event.target.value)}
            />
          </label>
          <div className="filter-actions">
            <button type="button" onClick={() => loadAuditTrail()}>
              Apply
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setFilters(emptyFilters);
                loadAuditTrail(emptyFilters);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Records</h2>
        {logs.length === 0 ? (
          <p>No matching audit records found.</p>
        ) : (
          <div className="activity-list">
            {logs.map((log) => (
              <button
                type="button"
                key={log.id}
                className="activity-item"
                style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
                onClick={() => setSelectedLog(log)}
              >
                <div className="activity-top">
                  <span className="activity-badge activity-neutral">
                    {label(log.activity_category)} · {label(log.action_type || log.action)}
                  </span>
                  <small>{formatDateTime(log.created_at)}</small>
                </div>
                <p className="activity-details">{log.details}</p>
                <div className="activity-user">
                  <strong>{log.full_name || "System"}</strong>
                  {log.username && <span>@{log.username}</span>}
                  {log.role && <span>{label(log.role)}</span>}
                  {log.workspace_code && <span>{label(log.workspace_code)}</span>}
                  {log.request_id && <span>{log.request_id}</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "16px" }}>
          <button
            type="button"
            className="secondary-button"
            onClick={() => changePage((pagination.page || 1) - 1)}
            disabled={(pagination.page || 1) <= 1}
          >
            Previous
          </button>
          <strong>
            Page {pagination.page || 1} of {pagination.total_pages || 1}
          </strong>
          <button
            type="button"
            className="secondary-button"
            onClick={() => changePage((pagination.page || 1) + 1)}
            disabled={(pagination.page || 1) >= (pagination.total_pages || 1)}
          >
            Next
          </button>
        </div>
      </div>

      {selectedLog && (
        <div className="section-card">
          <div className="page-header">
            <div>
              <h2>Audit Details</h2>
              <p>{selectedLog.request_id || "No request ID recorded"}</p>
            </div>
            <button type="button" onClick={() => setSelectedLog(null)}>
              Close
            </button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", overflow: "auto" }}>
            {JSON.stringify(selectedLog, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
