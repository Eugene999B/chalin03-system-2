import { useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/sharedReportsDocuments.css";

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function labelDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function labelDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeFilename(value, fallback) {
  const text = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text || fallback;
}

function responseFilename(headers, fallback) {
  const disposition = headers?.["content-disposition"] || "";
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf?.[1]) return decodeURIComponent(utf[1].replace(/["']/g, ""));
  const normal = disposition.match(/filename="?([^";]+)"?/i);
  return normal?.[1] || fallback;
}

function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function documentRows(catalog, workspaceCode, filters) {
  if (!catalog || typeof catalog !== "object") return [];
  const rows = [];

  function add(collection, mapRow) {
    const items = Array.isArray(catalog[collection]) ? catalog[collection] : [];
    items.forEach((item) => rows.push(mapRow(item)));
  }

  if (workspaceCode === "equipment_hire") {
    add("enquiries", (item) => ({
      id: item.id,
      type: "Hire enquiry",
      reference: item.enquiry_number,
      subject: item.customer_name,
      status: item.status,
      date: item.enquiry_date,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/enquiries/${item.id}/pdf`,
      filename: `${item.enquiry_number || `hire-enquiry-${item.id}`}.pdf`,
    }));
    add("quotations", (item) => ({
      id: item.id,
      type: "Hire quotation",
      reference: item.quotation_number,
      subject: item.customer_name,
      status: item.status,
      date: item.created_at,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/quotations/${item.id}/pdf`,
      filename: `${item.quotation_number || `hire-quotation-${item.id}`}.pdf`,
    }));
    add("contracts", (item) => ({
      id: item.id,
      type: "Hire contract",
      reference: item.contract_number,
      subject: item.customer_name,
      status: item.status,
      date: item.start_date,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/contracts/${item.id}/pdf`,
      filename: `${item.contract_number || `hire-contract-${item.id}`}.pdf`,
    }));
    add("assignments", (item) => ({
      id: item.id,
      type: "Equipment assignment",
      reference: item.contract_number || `Assignment ${item.id}`,
      subject: `${item.customer_name || "-"} · ${item.asset_code || ""} ${item.asset_name || ""}`,
      status: item.status,
      date: item.assigned_from,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/assignments/${item.id}/pdf`,
      filename: `hire-assignment-${item.id}.pdf`,
    }));
    add("dispatches", (item) => ({
      id: item.id,
      type: "Hire dispatch",
      reference: item.contract_number || `Dispatch ${item.id}`,
      subject: `${item.customer_name || "-"} · ${item.asset_code || ""} ${item.asset_name || ""}`,
      status: "dispatched",
      date: item.dispatch_datetime,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/dispatches/${item.id}/pdf`,
      filename: `hire-dispatch-${item.id}.pdf`,
    }));
    add("work_logs", (item) => ({
      id: item.id,
      type: "Hire work log",
      reference: item.contract_number || `Work log ${item.id}`,
      subject: `${item.customer_name || "-"} · ${item.asset_code || ""} ${item.asset_name || ""}`,
      status: item.status,
      date: item.work_date,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/work-logs/${item.id}/pdf`,
      filename: `hire-work-log-${item.id}.pdf`,
    }));
    add("invoices", (item) => ({
      id: item.id,
      type: "Hire invoice",
      reference: item.invoice_number,
      subject: item.customer_name,
      status: item.status,
      date: item.invoice_date,
      amount: item.total_amount,
      balance: item.balance,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/invoices/${item.id}/pdf`,
      filename: `${item.invoice_number || `hire-invoice-${item.id}`}.pdf`,
    }));
    add("payments", (item) => ({
      id: item.id,
      type: "Hire payment receipt",
      reference: item.reference_number || item.invoice_number || `Payment ${item.id}`,
      subject: item.customer_name,
      status: "received",
      date: item.payment_date,
      amount: item.amount,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/payments/${item.id}/receipt.pdf`,
      filename: `hire-payment-receipt-${item.id}.pdf`,
    }));
    add("returns", (item) => ({
      id: item.id,
      type: "Hire return inspection",
      reference: item.contract_number || `Return ${item.id}`,
      subject: `${item.customer_name || "-"} · ${item.asset_code || ""} ${item.asset_name || ""}`,
      status: item.condition_status,
      date: item.return_datetime,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/returns/${item.id}/pdf`,
      filename: `hire-return-${item.id}.pdf`,
    }));
    add("closure_candidates", (item) => ({
      id: item.id,
      type: "Hire closure summary",
      reference: item.contract_number,
      subject: item.customer_name,
      status: item.financial_status || item.status,
      date: item.closed_at,
      context: item.hire_location_name || item.hire_location_code,
      endpoint: `/operations-documents/hire/contracts/${item.id}/closure.pdf`,
      filename: `${item.contract_number || `hire-closure-${item.id}`}-closure.pdf`,
    }));
  }

  if (workspaceCode === "mining") {
    add("daily_logs", (item) => ({
      id: item.id,
      type: "Mining daily report",
      reference: `${item.site_code || "SITE"}-${item.log_date || item.id}-${item.shift_code || "SHIFT"}`,
      subject: item.site_name,
      status: item.status,
      date: item.log_date,
      context: item.site_name || item.site_code,
      endpoint: `/operations-documents/mining/daily-logs/${item.id}/pdf`,
      filename: `mining-daily-report-${item.id}.pdf`,
    }));
    add("incidents", (item) => ({
      id: item.id,
      type: "Mining incident report",
      reference: `${item.incident_type || "Incident"} ${item.id}`,
      subject: item.site_name,
      status: item.status,
      date: item.incident_datetime,
      context: item.site_name || item.site_code,
      endpoint: `/operations-documents/mining/incidents/${item.id}/pdf`,
      filename: `mining-incident-${item.id}.pdf`,
    }));
    add("sites", (item) => ({
      id: item.id,
      type: "Mining period report",
      reference: `${item.site_code || "SITE"}-${filters.from}-to-${filters.to}`,
      subject: item.site_name,
      status: item.status,
      date: filters.to,
      context: item.site_name || item.site_code,
      endpoint: `/operations-documents/mining/sites/${item.id}/period-report.pdf`,
      params: { from: filters.from, to: filters.to },
      filename: `mining-period-report-${item.site_code || item.id}-${filters.from}-to-${filters.to}.pdf`,
    }));
  }

  return rows;
}

function MetricCard({ label, value, note }) {
  return (
    <article className="srd-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

export default function SharedReportsDocumentsPage({ executiveMode = false }) {
  const auth = useAuth();
  const workspaceContext = useWorkspaceContext();
  const viewLogged = useRef(false);
  const [filters, setFilters] = useState({
    from: monthStart,
    to: today,
    search: "",
    status: "",
    type: "",
  });
  const [overview, setOverview] = useState(null);
  const [catalog, setCatalog] = useState({});
  const [operationsSummary, setOperationsSummary] = useState(null);
  const [groupSummary, setGroupSummary] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const workspaceCode = auth.workspaceCode || "spare_parts";
  const managedWorkspace = ["mining", "equipment_hire"].includes(workspaceCode);
  const permissions = new Set(auth.effectivePermissions || []);
  const canViewDocuments = permissions.has("shared.documents.view");
  const canViewReports = permissions.has("shared.reports.view");
  const canExportReports = permissions.has("shared.reports.export");
  const canViewAudit = permissions.has("shared.audit.view");
  const canExportAudit = permissions.has("audit.export");
  const canUseGroupSummary = ["admin", "manager", "auditor"].includes(auth.role);

  const documents = useMemo(
    () => documentRows(catalog, workspaceCode, filters),
    [catalog, filters, workspaceCode]
  );

  const filteredDocuments = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return documents.filter((item) => {
      const matchesSearch =
        !search ||
        [item.type, item.reference, item.subject, item.status, item.context]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      const matchesStatus =
        !filters.status || String(item.status || "").toLowerCase() === filters.status;
      const matchesType = !filters.type || item.type === filters.type;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [documents, filters.search, filters.status, filters.type]);

  const documentTypes = useMemo(
    () => [...new Set(documents.map((item) => item.type))].sort(),
    [documents]
  );
  const documentStatuses = useMemo(
    () =>
      [...new Set(documents.map((item) => String(item.status || "").toLowerCase()).filter(Boolean))].sort(),
    [documents]
  );

  async function loadEvidence() {
    if (!canViewAudit && !canViewDocuments && !canViewReports) return;
    const response = await axiosClient.get("/shared-control/evidence", {
      params: {
        from: filters.from,
        to: filters.to,
        group: executiveMode ? 1 : 0,
        limit: 100,
      },
    });
    setEvidence(Array.isArray(response.data?.evidence) ? response.data.evidence : []);
  }

  useEffect(() => {
    let active = true;

    async function load() {
      if (managedWorkspace && workspaceContext.loading) return;
      if (
        managedWorkspace &&
        !workspaceContext.automaticAccess &&
        !workspaceContext.selectedContextId
      ) {
        setError("Choose an authorized Mining site or Equipment Hire location first.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const requests = [
          axiosClient.get("/shared-control/overview", {
            params: { group: executiveMode ? 1 : 0 },
          }),
        ];

        const requestNames = ["overview"];

        if (canViewDocuments && managedWorkspace) {
          requests.push(axiosClient.get("/operations-documents/catalog"));
          requestNames.push("catalog");
        }

        if (canViewReports && managedWorkspace) {
          requests.push(
            axiosClient.get("/operations-documents/summary", {
              params: { from: filters.from, to: filters.to },
            })
          );
          requestNames.push("operationsSummary");
        }

        if (canViewReports && canUseGroupSummary) {
          requests.push(
            axiosClient.get("/group-executive/summary", {
              params: { from: filters.from, to: filters.to },
            })
          );
          requestNames.push("groupSummary");
        }

        const responses = await Promise.all(requests);
        if (!active) return;

        responses.forEach((response, index) => {
          const name = requestNames[index];
          if (name === "overview") setOverview(response.data || null);
          if (name === "catalog") setCatalog(response.data?.catalog || {});
          if (name === "operationsSummary") {
            setOperationsSummary(response.data?.summary || null);
          }
          if (name === "groupSummary") setGroupSummary(response.data?.summary || null);
        });

        await loadEvidence();

        if (!viewLogged.current) {
          viewLogged.current = true;
          axiosClient
            .post("/shared-control/evidence", {
              control_area: "reports",
              action_type: "view",
              document_type: executiveMode
                ? "group_shared_control_centre"
                : "workspace_shared_control_centre",
              description: executiveMode
                ? "Opened Group Shared Reports, Documents and Audit Centre."
                : "Opened Shared Reports, Documents and Audit Centre.",
            })
            .catch(() => {});
        }
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError.response?.data?.message ||
            requestError.message ||
            "Could not load the shared reports and documents centre."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
    // Context changes and date changes intentionally reload the controlled scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    auth.role,
    canUseGroupSummary,
    canViewDocuments,
    canViewReports,
    executiveMode,
    filters.from,
    filters.to,
    managedWorkspace,
    workspaceCode,
    workspaceContext.automaticAccess,
    workspaceContext.loading,
    workspaceContext.selectedContextId,
  ]);

  async function download(endpoint, filename, params = {}, key = endpoint) {
    setBusy(key);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get(endpoint, {
        params,
        responseType: "blob",
        timeout: 120000,
      });
      saveBlob(
        response.data,
        responseFilename(response.headers, safeFilename(filename, "chalin03-document"))
      );
      setNotice("Document generated and downloaded. The action is recorded in audit evidence.");
      setTimeout(() => loadEvidence().catch(() => {}), 500);
    } catch (requestError) {
      let message = requestError.message || "Could not download the document.";
      const data = requestError.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          message = parsed.message || message;
        } catch {
          // Keep the original message.
        }
      } else if (data?.message) {
        message = data.message;
      }
      setError(message);
    } finally {
      setBusy("");
    }
  }

  const assurance = overview?.assurance;
  const group = groupSummary?.group;
  const hire = operationsSummary?.hire;
  const mining = operationsSummary?.mining;

  return (
    <main className="srd-page">
      <header className="srd-hero">
        <div>
          <span className="srd-kicker">Release 3E · Shared control</span>
          <h1>Shared Reports, Documents & Audit Centre</h1>
          <p>
            Search authorized documents, generate controlled reports, confirm role and
            location scope, and review download/export evidence without mixing business data.
          </p>
        </div>
        <div className="srd-scope-badge">
          <strong>{workspaceCode.replaceAll("_", " ")}</strong>
          <span>
            {assurance?.scope?.context_type || "workspace"}: {assurance?.scope?.context_id || "authorized scope"}
          </span>
        </div>
      </header>

      {error ? <div className="srd-alert srd-alert--error">{error}</div> : null}
      {notice ? <div className="srd-alert srd-alert--success">{notice}</div> : null}

      <section className="srd-panel">
        <div className="srd-panel__heading">
          <div>
            <h2>Reporting period</h2>
            <p>Dates apply to summaries, period reports and exported workbooks.</p>
          </div>
        </div>
        <div className="srd-filter-grid">
          <label>
            <span>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            />
          </label>
          <label>
            <span>Document search</span>
            <input
              type="search"
              placeholder="Number, customer, site, location or status"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </label>
          <label>
            <span>Document type</span>
            <select
              value={filters.type}
              onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="">All types</option>
              {documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">All statuses</option>
              {documentStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
        </div>
      </section>

      {loading ? <div className="srd-loading">Loading controlled reports and evidence…</div> : null}

      {!loading && assurance ? (
        <section className="srd-panel">
          <div className="srd-panel__heading">
            <div>
              <h2>Role & scope assurance</h2>
              <p>Effective access calculated by the server for this login and selected context.</p>
            </div>
            <span className={`srd-readonly ${assurance.capabilities?.read_only ? "is-readonly" : ""}`}>
              {assurance.capabilities?.read_only ? "Read-only evidence role" : "Operational role"}
            </span>
          </div>
          <div className="srd-assurance-grid">
            <div><span>User</span><strong>{assurance.user?.full_name || assurance.user?.username}</strong></div>
            <div><span>Global role</span><strong>{assurance.user?.global_role || "-"}</strong></div>
            <div><span>Workspace role</span><strong>{assurance.user?.workspace_role || "-"}</strong></div>
            <div><span>Location isolation</span><strong>{assurance.scope?.location_isolation_enforced ? "Enforced" : "Branch/workspace controlled"}</strong></div>
            <div><span>Documents</span><strong>{assurance.capabilities?.documents_view ? "Allowed" : "Not granted"}</strong></div>
            <div><span>Report export</span><strong>{assurance.capabilities?.reports_export ? "Allowed" : "View only"}</strong></div>
            <div><span>Audit evidence</span><strong>{assurance.capabilities?.audit_evidence_view ? "Allowed" : "Not granted"}</strong></div>
            <div><span>Request evidence</span><strong>{overview.evidence_available ? "Database active" : "Migration required"}</strong></div>
          </div>
        </section>
      ) : null}

      {!loading && canViewReports ? (
        <section className="srd-panel">
          <div className="srd-panel__heading">
            <div>
              <h2>Shared management reporting</h2>
              <p>Financial and operational summaries remain separated by their original business records.</p>
            </div>
          </div>
          <div className="srd-metrics">
            {group ? (
              <>
                <MetricCard label="Group recorded revenue" value={money(group.recorded_revenue)} note={`${filters.from} to ${filters.to}`} />
                <MetricCard label="Payments received" value={money(group.cash_received)} />
                <MetricCard label="Operating cost" value={money(group.operating_cost)} />
                <MetricCard label="Outstanding receivables" value={money(group.outstanding_receivables)} />
              </>
            ) : null}
            {hire ? (
              <>
                <MetricCard label="Hire invoiced" value={money(hire.invoiced)} />
                <MetricCard label="Hire payments" value={money(hire.payments_received)} />
                <MetricCard label="Hire balance" value={money(hire.balance)} />
                <MetricCard label="Active hire contracts" value={numberValue(hire.active_contracts).toLocaleString()} />
              </>
            ) : null}
            {mining ? (
              <>
                <MetricCard label="Mining production" value={numberValue(mining.production_quantity).toLocaleString()} />
                <MetricCard label="Mining operating cost" value={money(mining.operating_cost)} />
                <MetricCard label="Working hours" value={numberValue(mining.working_hours).toLocaleString()} />
                <MetricCard label="Open incidents" value={numberValue(mining.open_incidents).toLocaleString()} />
              </>
            ) : null}
          </div>
          <div className="srd-action-row">
            {canExportReports && managedWorkspace ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => download(
                  "/operations-documents/workbook.xlsx",
                  `chalin03-${workspaceCode}-operations-${filters.from}-to-${filters.to}.xlsx`,
                  { from: filters.from, to: filters.to },
                  "operations-workbook"
                )}
              >
                {busy === "operations-workbook" ? "Preparing…" : "Download workspace workbook"}
              </button>
            ) : null}
            {canExportReports && canUseGroupSummary ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => download(
                  "/group-executive/workbook.xlsx",
                  `chalin03-group-executive-${filters.from}-to-${filters.to}.xlsx`,
                  { from: filters.from, to: filters.to },
                  "group-workbook"
                )}
              >
                {busy === "group-workbook" ? "Preparing…" : "Download group workbook"}
              </button>
            ) : null}
            {canExportAudit ? ["xlsx", "pdf", "doc", "csv"].map((format) => (
              <button
                type="button"
                key={format}
                className="srd-button--secondary"
                disabled={Boolean(busy)}
                onClick={() => download(
                  `/activity-log/export.${format}`,
                  `chalin03-audit-${filters.from}-to-${filters.to}.${format}`,
                  { from: filters.from, to: filters.to },
                  `audit-${format}`
                )}
              >
                {busy === `audit-${format}` ? "Preparing…" : `Audit ${format.toUpperCase()}`}
              </button>
            )) : null}
          </div>
        </section>
      ) : null}

      {!loading && canViewDocuments ? (
        <section className="srd-panel">
          <div className="srd-panel__heading">
            <div>
              <h2>Authorized document register</h2>
              <p>{filteredDocuments.length} matching document(s). Mining and Hire records are filtered by the selected authorized context.</p>
            </div>
          </div>
          {managedWorkspace ? (
            <div className="srd-table-wrap">
              <table className="srd-table">
                <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Customer / Site</th><th>Status</th><th>Context</th><th>Amount</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredDocuments.map((item) => (
                    <tr key={`${item.type}-${item.id}-${item.reference}`}>
                      <td>{labelDate(item.date)}</td>
                      <td>{item.type}</td>
                      <td><strong>{item.reference || `Record ${item.id}`}</strong></td>
                      <td>{item.subject || "-"}</td>
                      <td><span className="srd-status">{item.status || "recorded"}</span></td>
                      <td>{item.context || "Authorized context"}</td>
                      <td>{item.amount !== undefined ? money(item.amount) : "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="srd-table-button"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            download(
                              item.endpoint,
                              item.filename,
                              { ...(item.params || {}), evidence_action: "reprint" },
                              `document-${item.type}-${item.id}`
                            )
                          }
                        >
                          {busy === `document-${item.type}-${item.id}` ? "Preparing…" : "Download / reprint"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredDocuments.length ? <tr><td colSpan="8" className="srd-empty">No documents match the selected filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="srd-empty-card">
              Spare Parts receipts, statements and accounting exports remain in their existing controlled pages. Use the report and audit export controls above; this register does not duplicate sales records.
            </div>
          )}
        </section>
      ) : null}

      {!loading && canViewAudit ? (
        <section className="srd-panel">
          <div className="srd-panel__heading">
            <div>
              <h2>Document, report & export evidence</h2>
              <p>Recent controlled access history, including request IDs for troubleshooting.</p>
            </div>
            <button type="button" className="srd-button--secondary" onClick={() => loadEvidence().catch(() => {})}>Refresh evidence</button>
          </div>
          <div className="srd-table-wrap">
            <table className="srd-table">
              <thead><tr><th>Time</th><th>User</th><th>Workspace</th><th>Area</th><th>Action</th><th>Document / format</th><th>Details</th><th>Request ID</th></tr></thead>
              <tbody>
                {evidence.map((row) => (
                  <tr key={row.id}>
                    <td>{labelDateTime(row.created_at)}</td>
                    <td>{row.full_name || row.username || "System"}</td>
                    <td>{String(row.workspace_code || "-").replaceAll("_", " ")}</td>
                    <td>{row.control_area}</td>
                    <td>{row.action_type}</td>
                    <td>{row.document_number || row.document_type || row.export_format || "-"}</td>
                    <td>{row.description || "-"}</td>
                    <td><code>{row.request_id || "-"}</code></td>
                  </tr>
                ))}
                {!evidence.length ? <tr><td colSpan="8" className="srd-empty">No matching Release 3E evidence has been recorded yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
