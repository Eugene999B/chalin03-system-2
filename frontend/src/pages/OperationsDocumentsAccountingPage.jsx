import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "./../styles/operationsDocuments.css";

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

function decimal(value, places = 2) {
  return numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
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

function extractFilename(headers, fallback) {
  const disposition = headers?.["content-disposition"] || "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1].replace(/["']/g, ""));
  }

  const normalMatch = disposition.match(/filename="?([^"]+)"?/i);
  return normalMatch?.[1] || fallback;
}

function RecordSelect({
  label,
  value,
  onChange,
  options,
  getLabel,
  placeholder = "Select a record",
}) {
  return (
    <label className="oda-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {getLabel(item)}
          </option>
        ))}
      </select>
    </label>
  );
}

function DocumentCard({
  icon,
  title,
  description,
  children,
  onDownload,
  disabled,
  busy,
  buttonLabel = "Download PDF",
}) {
  return (
    <article className="oda-document-card">
      <div className="oda-document-card__head">
        <span className="oda-document-card__icon">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      <div className="oda-document-card__body">{children}</div>

      <button
        type="button"
        className="oda-primary-button"
        onClick={onDownload}
        disabled={disabled || busy}
      >
        {busy ? "Preparing document..." : buttonLabel}
      </button>
    </article>
  );
}

function SummaryCard({ icon, label, value, note }) {
  return (
    <article className="oda-summary-card">
      <span className="oda-summary-card__icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {note ? <small>{note}</small> : null}
      </div>
    </article>
  );
}

export default function OperationsDocumentsAccountingPage({ workspaceScope = "equipment_hire" }) {
  const scope = workspaceScope === "mining" ? "mining" : "equipment_hire";
  const {
    selectedContextId,
    selectedContext,
    automaticAccess,
    loading: contextLoading,
  } = useWorkspaceContext();
  const workspaceTitle =
    scope === "mining" ? "Mining Documents & Accounting" : "Equipment Hire Documents & Accounting";

  const [catalog, setCatalog] = useState({
    customers: [],
    enquiries: [],
    quotations: [],
    contracts: [],
    assignments: [],
    dispatches: [],
    work_logs: [],
    invoices: [],
    payments: [],
    returns: [],
    closure_candidates: [],
    sites: [],
    daily_logs: [],
    incidents: [],
  });
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({
    from: monthStart,
    to: today,
    customer_id: "",
    site_id: "",
  });

  const [selection, setSelection] = useState({
    enquiry: "",
    quotation: "",
    assignment: "",
    contract: "",
    closure_contract: "",
    dispatch: "",
    work_log: "",
    invoice: "",
    payment: "",
    customer: "",
    return_record: "",
    daily_log: "",
    mining_site: "",
    incident: "",
  });

  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const queryParams = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      ...(filters.customer_id
        ? { customer_id: Number(filters.customer_id) }
        : {}),
      ...(filters.site_id ? { site_id: Number(filters.site_id) } : {}),
    }),
    [filters]
  );

  async function loadCatalog() {
    const response = await axiosClient.get("/operations-documents/catalog");
    setCatalog(response.data?.catalog || {});
  }

  async function loadSummary() {
    setSummaryLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/operations-documents/summary", {
        params: queryParams,
      });
      setSummary(response.data?.summary || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not load operations accounting summary."
      );
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      if (contextLoading) return;

      if (!automaticAccess && !selectedContextId) {
        setCatalog({
          customers: [],
          enquiries: [],
          quotations: [],
          contracts: [],
          assignments: [],
          dispatches: [],
          work_logs: [],
          invoices: [],
          payments: [],
          returns: [],
          closure_candidates: [],
          sites: [],
          daily_logs: [],
          incidents: [],
        });
        setSummary(null);
        setError(
          scope === "mining"
            ? "Ask an administrator to assign this account to a Mining site."
            : "Ask an administrator to assign this account to an Equipment Hire location."
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setNotice("");
      setSelection({
        enquiry: "",
        quotation: "",
        assignment: "",
        contract: "",
        closure_contract: "",
        dispatch: "",
        work_log: "",
        invoice: "",
        payment: "",
        customer: "",
        return_record: "",
        daily_log: "",
        mining_site: "",
        incident: "",
      });

      try {
        const [catalogResponse, summaryResponse] = await Promise.all([
          axiosClient.get("/operations-documents/catalog"),
          axiosClient.get("/operations-documents/summary", {
            params: queryParams,
          }),
        ]);

        if (!active) return;
        setCatalog(catalogResponse.data?.catalog || {});
        setSummary(summaryResponse.data?.summary || null);
      } catch (requestError) {
        if (!active) return;
        setError(
          requestError.response?.data?.message ||
            requestError.message ||
            "Could not load Operations Documents & Accounting."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
    // Filter changes are applied with the button. A context change reloads all
    // document lists so records from the previous site/location cannot remain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, contextLoading, selectedContextId, automaticAccess]);

  async function download(path, fallbackFilename, params = {}, key = path) {
    setDownloading(key);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get(path, {
        params,
        responseType: "blob",
        timeout: 120000,
      });

      const filename = extractFilename(response.headers, fallbackFilename);
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotice(`${filename} downloaded successfully.`);
    } catch (requestError) {
      let message =
        requestError.response?.data?.message ||
        requestError.message ||
        "The document could not be downloaded.";

      if (requestError.response?.data instanceof Blob) {
        try {
          const text = await requestError.response.data.text();
          const parsed = JSON.parse(text);
          message = parsed.message || parsed.details || message;
        } catch {
          // Keep the original message when the blob is not JSON.
        }
      }

      setError(message);
    } finally {
      setDownloading("");
    }
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function updateSelection(field, value) {
    setSelection((current) => ({ ...current, [field]: value }));
  }

  const hire = summary?.hire || {};
  const mining = summary?.mining || {};
  const productionByUnit = mining.production_by_unit || [];
  const debtAging = summary?.debt_aging || [];
  const revenueByAsset = summary?.revenue_by_asset || [];
  const revenueByCustomer = summary?.revenue_by_customer || [];

  if (loading) {
    return (
      <section className={`oda-page oda-page--center oda-scope-${scope}`}>
        <div className="oda-loader" />
        <h2>Loading {workspaceTitle}…</h2>
        <p>Preparing records for this independent business workspace.</p>
      </section>
    );
  }

  return (
    <section className={`oda-page oda-scope-${scope}`}>
      <header className="oda-hero">
        <div>
          <p className="oda-eyebrow">Chalin 03 Group Operations Platform</p>
          <h1>{workspaceTitle}</h1>
          <p>
            {scope === "mining"
              ? "Generate Mining site reports, incident documents and a Mining-only accounting workbook."
              : "Generate Equipment Hire quotations, agreements, job cards, invoices, statements and a Hire-only accounting workbook."}
          </p>
          <p>
            <strong>Active operating context:</strong>{" "}
            {selectedContext
              ? `${selectedContext.code ? `${selectedContext.code} — ` : ""}${selectedContext.name}`
              : automaticAccess
                ? scope === "mining"
                  ? "All Mining sites"
                  : "All Equipment Hire locations"
                : "No assigned context"}
          </p>
        </div>

        <nav className="oda-hero__links">
          {scope === "mining" ? (
            <>
              <Link to="/mining">Mining Dashboard</Link>
              <Link to="/mining/fleet">Mining Fleet</Link>
            </>
          ) : (
            <>
              <Link to="/equipment-hire-operations">Hire Dashboard</Link>
              <Link to="/equipment-hire-operations/fleet">Hire Fleet</Link>
            </>
          )}
        </nav>
      </header>

      {error ? <div className="oda-alert oda-alert--error">{error}</div> : null}
      {notice ? (
        <div className="oda-alert oda-alert--success">{notice}</div>
      ) : null}

      <section className="oda-filter-panel">
        <div className="oda-filter-panel__intro">
          <h2>Accounting period and scope</h2>
          <p>
            These filters control the summary, customer statement, Mining
            management pack and Excel workbook.
          </p>
        </div>

        <div className="oda-filter-grid">
          <label className="oda-field">
            <span>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter("from", event.target.value)}
            />
          </label>

          <label className="oda-field">
            <span>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter("to", event.target.value)}
            />
          </label>

          <label className="oda-field oda-hire-only">
            <span>Hire customer</span>
            <select
              value={filters.customer_id}
              onChange={(event) =>
                updateFilter("customer_id", event.target.value)
              }
            >
              <option value="">All hire customers</option>
              {(catalog.customers || []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.customer_code} — {customer.customer_name}
                </option>
              ))}
            </select>
          </label>

          <label className="oda-field oda-mining-only">
            <span>Mining site</span>
            <select
              value={filters.site_id}
              onChange={(event) => updateFilter("site_id", event.target.value)}
            >
              <option value="">All mining sites</option>
              {(catalog.sites || []).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_code} — {site.site_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="oda-filter-actions">
          <button
            type="button"
            className="oda-secondary-button"
            onClick={loadSummary}
            disabled={summaryLoading}
          >
            {summaryLoading ? "Refreshing…" : "Apply filters"}
          </button>

          <button
            type="button"
            className="oda-primary-button"
            disabled={downloading === "workbook"}
            onClick={() =>
              download(
                "/operations-documents/workbook.xlsx",
                `Chalin03-Operations-Accounting-${filters.from}-to-${filters.to}.xlsx`,
                queryParams,
                "workbook"
              )
            }
          >
            {downloading === "workbook"
              ? "Building workbook…"
              : scope === "mining" ? "Download Mining Excel workbook" : "Download Hire Excel workbook"}
          </button>

          <button
            type="button"
            className="oda-text-button"
            onClick={async () => {
              setLoading(true);
              try {
                await loadCatalog();
                await loadSummary();
                setNotice("Catalog and accounting summary refreshed.");
              } finally {
                setLoading(false);
              }
            }}
          >
            Refresh all records
          </button>
        </div>
      </section>

      <section className="oda-section oda-hire-only">
        <div className="oda-section__heading">
          <div>
            <p className="oda-eyebrow">Executive view</p>
            <h2>Equipment Hire financial position</h2>
          </div>
          <span>
            {labelDate(filters.from)} — {labelDate(filters.to)}
          </span>
        </div>

        <div className="oda-summary-grid">
          <SummaryCard
            icon="🧾"
            label="Amount invoiced"
            value={money(hire.invoiced)}
            note={`${hire.invoice_count || 0} invoices`}
          />
          <SummaryCard
            icon="✅"
            label="Invoice amount paid"
            value={money(hire.invoice_paid)}
            note={`${hire.payment_count || 0} payments recorded`}
          />
          <SummaryCard
            icon="⚠️"
            label="Outstanding balance"
            value={money(hire.balance)}
            note={`${money(hire.overdue_balance)} overdue`}
          />
          <SummaryCard
            icon="🏗️"
            label="Active contracts"
            value={hire.active_contracts || 0}
            note={`${decimal(hire.billable_hours)} billable hours`}
          />
          <SummaryCard
            icon="💰"
            label="Deposits received"
            value={money(hire.deposits_received)}
            note={`${money(hire.payments_received)} total receipts`}
          />
          <SummaryCard
            icon="⏱️"
            label="Equipment time"
            value={`${decimal(hire.billable_hours)} hours`}
            note={`${decimal(hire.idle_hours)} idle · ${decimal(
              hire.breakdown_hours
            )} breakdown`}
          />
        </div>
      </section>

      <section className="oda-section oda-mining-only">
        <div className="oda-section__heading">
          <div>
            <p className="oda-eyebrow">Mining control</p>
            <h2>Mining operations cost and performance</h2>
          </div>
        </div>

        <div className="oda-summary-grid">
          <SummaryCard
            icon="⛏️"
            label="Production"
            value={
              productionByUnit.length
                ? productionByUnit
                    .map(
                      (item) =>
                        `${decimal(item.quantity, 3)} ${item.unit || "units"}`
                    )
                    .join(" · ")
                : "No production"
            }
            note={`${productionByUnit.reduce(
              (sum, item) => sum + numberValue(item.record_count),
              0
            )} records`}
          />
          <SummaryCard
            icon="🚜"
            label="Working hours"
            value={`${decimal(mining.working_hours)} hours`}
            note={`${decimal(mining.idle_hours)} idle · ${decimal(
              mining.breakdown_hours
            )} breakdown`}
          />
          <SummaryCard
            icon="⛽"
            label="Fuel issued"
            value={`${decimal(mining.fuel_issued)} litres`}
            note={`${money(mining.fuel_cost)} recorded fuel cost`}
          />
          <SummaryCard
            icon="💳"
            label="Other site expenses"
            value={money(mining.expenses)}
            note={`${mining.expense_count || 0} expense records`}
          />
          <SummaryCard
            icon="📉"
            label="Operating cost"
            value={money(mining.operating_cost)}
            note={
              mining.estimated_cost_per_unit != null
                ? `${money(mining.estimated_cost_per_unit)} per ${
                    mining.estimated_cost_unit
                  }`
                : "Cost per unit requires one production unit"
            }
          />
          <SummaryCard
            icon="🦺"
            label="Open incidents"
            value={mining.open_incidents || 0}
            note={`${mining.serious_incidents || 0} high or critical`}
          />
        </div>
      </section>

      <section className="oda-two-column oda-hire-only">
        <article className="oda-data-panel">
          <div className="oda-data-panel__heading">
            <h2>Equipment Hire debt aging</h2>
            <p>Current balances grouped by overdue period.</p>
          </div>
          <div className="oda-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Age</th>
                  <th>Invoices</th>
                  <th className="oda-number">Balance</th>
                </tr>
              </thead>
              <tbody>
                {debtAging.length ? (
                  debtAging.map((row) => (
                    <tr key={row.aging_bucket}>
                      <td>{row.aging_bucket}</td>
                      <td>{row.invoice_count}</td>
                      <td className="oda-number">{money(row.balance)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3">No invoice aging records available.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="oda-data-panel">
          <div className="oda-data-panel__heading">
            <h2>Revenue by customer</h2>
            <p>Highest invoiced customers in the selected period.</p>
          </div>
          <div className="oda-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="oda-number">Invoiced</th>
                  <th className="oda-number">Balance</th>
                </tr>
              </thead>
              <tbody>
                {revenueByCustomer.length ? (
                  revenueByCustomer.map((row) => (
                    <tr key={row.customer_id}>
                      <td>{row.customer_name}</td>
                      <td className="oda-number">{money(row.invoiced)}</td>
                      <td className="oda-number">{money(row.balance)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3">No customer revenue for this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="oda-data-panel oda-hire-only">
        <div className="oda-data-panel__heading">
          <h2>Estimated earned revenue by equipment</h2>
          <p>
            Approved billable hours multiplied by the contract rate for each
            machine in the selected period.
          </p>
        </div>
        <div className="oda-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="oda-number">Billable hours</th>
                <th className="oda-number">Estimated revenue</th>
              </tr>
            </thead>
            <tbody>
              {revenueByAsset.length ? (
                revenueByAsset.map((row) => (
                  <tr key={row.asset_id}>
                    <td>
                      <strong>{row.asset_code}</strong>
                      <span className="oda-table-subtitle">
                        {row.asset_name}
                      </span>
                    </td>
                    <td className="oda-number">
                      {decimal(row.billable_hours)}
                    </td>
                    <td className="oda-number">
                      {money(row.estimated_revenue)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3">No equipment revenue for this period.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="oda-section oda-hire-only">
        <div className="oda-section__heading">
          <div>
            <p className="oda-eyebrow">Equipment Hire paperwork</p>
            <h2>Professional hire documents</h2>
          </div>
          <span>{catalog.invoices?.length || 0} invoices available</span>
        </div>

        <div className="oda-document-grid">
          <DocumentCard
            icon="📨"
            title="Enquiry summary"
            description="Customer request, equipment need, dates and location."
            disabled={!selection.enquiry}
            busy={downloading === "enquiry"}
            onDownload={() =>
              download(
                `/operations-documents/hire/enquiries/${selection.enquiry}/pdf`,
                "Equipment-Hire-Enquiry-Summary.pdf",
                {},
                "enquiry"
              )
            }
          >
            <RecordSelect
              label="Enquiry"
              value={selection.enquiry}
              onChange={(value) => updateSelection("enquiry", value)}
              options={catalog.enquiries || []}
              getLabel={(item) =>
                `${item.enquiry_number} — ${item.customer_name} (${item.status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="📄"
            title="Quotation"
            description="Customer pricing, scope, equipment and acceptance."
            disabled={!selection.quotation}
            busy={downloading === "quotation"}
            onDownload={() =>
              download(
                `/operations-documents/hire/quotations/${selection.quotation}/pdf`,
                "Equipment-Hire-Quotation.pdf",
                {},
                "quotation"
              )
            }
          >
            <RecordSelect
              label="Quotation"
              value={selection.quotation}
              onChange={(value) => updateSelection("quotation", value)}
              options={catalog.quotations || []}
              getLabel={(item) =>
                `${item.quotation_number} — ${item.customer_name} (${item.status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="📝"
            title="Hire agreement"
            description="Contract terms, charges and assigned equipment."
            disabled={!selection.contract}
            busy={downloading === "contract"}
            onDownload={() =>
              download(
                `/operations-documents/hire/contracts/${selection.contract}/pdf`,
                "Equipment-Hire-Agreement.pdf",
                {},
                "contract"
              )
            }
          >
            <RecordSelect
              label="Contract"
              value={selection.contract}
              onChange={(value) => updateSelection("contract", value)}
              options={catalog.contracts || []}
              getLabel={(item) =>
                `${item.contract_number} — ${item.customer_name} (${item.status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="🚜"
            title="Assignment sheet"
            description="Equipment, operator, meter and contract assignment."
            disabled={!selection.assignment}
            busy={downloading === "assignment"}
            onDownload={() =>
              download(
                `/operations-documents/hire/assignments/${selection.assignment}/pdf`,
                "Equipment-Hire-Assignment-Sheet.pdf",
                {},
                "assignment"
              )
            }
          >
            <RecordSelect
              label="Assignment"
              value={selection.assignment}
              onChange={(value) => updateSelection("assignment", value)}
              options={catalog.assignments || []}
              getLabel={(item) =>
                `${item.contract_number} — ${item.asset_code} — ${item.customer_name} (${item.status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="🚚"
            title="Dispatch note"
            description="Mobilization, condition, meter and receiving details."
            disabled={!selection.dispatch}
            busy={downloading === "dispatch"}
            onDownload={() =>
              download(
                `/operations-documents/hire/dispatches/${selection.dispatch}/pdf`,
                "Equipment-Dispatch-Note.pdf",
                {},
                "dispatch"
              )
            }
          >
            <RecordSelect
              label="Dispatch"
              value={selection.dispatch}
              onChange={(value) => updateSelection("dispatch", value)}
              options={catalog.dispatches || []}
              getLabel={(item) =>
                `${item.contract_number} — ${item.asset_code} — ${item.customer_name}`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="⏱️"
            title="Daily job card"
            description="Signed meter, billable time and work-description record."
            disabled={!selection.work_log}
            busy={downloading === "work-log"}
            onDownload={() =>
              download(
                `/operations-documents/hire/work-logs/${selection.work_log}/pdf`,
                "Equipment-Hire-Job-Card.pdf",
                {},
                "work-log"
              )
            }
          >
            <RecordSelect
              label="Work log"
              value={selection.work_log}
              onChange={(value) => updateSelection("work_log", value)}
              options={catalog.work_logs || []}
              getLabel={(item) =>
                `${labelDate(item.work_date)} — ${item.contract_number} — ${
                  item.asset_code
                } (${item.status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="🧾"
            title="Invoice"
            description="Charges, tax, payments and current balance."
            disabled={!selection.invoice}
            busy={downloading === "invoice"}
            onDownload={() =>
              download(
                `/operations-documents/hire/invoices/${selection.invoice}/pdf`,
                "Equipment-Hire-Invoice.pdf",
                {},
                "invoice"
              )
            }
          >
            <RecordSelect
              label="Invoice"
              value={selection.invoice}
              onChange={(value) => updateSelection("invoice", value)}
              options={catalog.invoices || []}
              getLabel={(item) =>
                `${item.invoice_number} — ${item.customer_name} — ${money(
                  item.balance
                )} balance`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="💵"
            title="Payment receipt"
            description="Proof of deposit or invoice payment received."
            disabled={!selection.payment}
            busy={downloading === "payment"}
            onDownload={() =>
              download(
                `/operations-documents/hire/payments/${selection.payment}/receipt.pdf`,
                "Equipment-Hire-Payment-Receipt.pdf",
                {},
                "payment"
              )
            }
          >
            <RecordSelect
              label="Payment"
              value={selection.payment}
              onChange={(value) => updateSelection("payment", value)}
              options={catalog.payments || []}
              getLabel={(item) =>
                `${labelDate(item.payment_date)} — ${item.customer_name} — ${money(
                  item.amount
                )}`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="📚"
            title="Customer statement"
            description="Invoices, payments and balances for the selected period."
            disabled={!selection.customer}
            busy={downloading === "statement"}
            onDownload={() =>
              download(
                `/operations-documents/hire/customers/${selection.customer}/statement.pdf`,
                "Equipment-Hire-Customer-Statement.pdf",
                { from: filters.from, to: filters.to },
                "statement"
              )
            }
          >
            <RecordSelect
              label="Customer"
              value={selection.customer}
              onChange={(value) => updateSelection("customer", value)}
              options={catalog.customers || []}
              getLabel={(item) =>
                `${item.customer_code} — ${item.customer_name}`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="🔎"
            title="Return inspection"
            description="Closing meter, condition, damage and release record."
            disabled={!selection.return_record}
            busy={downloading === "return"}
            onDownload={() =>
              download(
                `/operations-documents/hire/returns/${selection.return_record}/pdf`,
                "Equipment-Return-Inspection.pdf",
                {},
                "return"
              )
            }
          >
            <RecordSelect
              label="Return inspection"
              value={selection.return_record}
              onChange={(value) => updateSelection("return_record", value)}
              options={catalog.returns || []}
              getLabel={(item) =>
                `${item.contract_number} — ${item.asset_code} — ${labelDate(
                  item.return_datetime
                )}`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="🔒"
            title="Closure summary"
            description="Final contract, return, invoice and balance summary."
            disabled={!selection.closure_contract}
            busy={downloading === "closure"}
            onDownload={() =>
              download(
                `/operations-documents/hire/contracts/${selection.closure_contract}/closure.pdf`,
                "Equipment-Hire-Contract-Closure-Summary.pdf",
                {},
                "closure"
              )
            }
          >
            <RecordSelect
              label="Closed contract"
              value={selection.closure_contract}
              onChange={(value) => updateSelection("closure_contract", value)}
              options={catalog.closure_candidates || []}
              getLabel={(item) =>
                `${item.contract_number} — ${item.customer_name} (${item.financial_status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="📊"
            title="Customer outstanding summary"
            description="Customer-level balances and overdue totals."
            disabled={false}
            busy={downloading === "outstanding-summary"}
            onDownload={() =>
              download(
                "/operations-documents/hire/outstanding-summary.pdf",
                "Equipment-Hire-Customer-Outstanding-Summary.pdf",
                filters.customer_id ? { customer_id: Number(filters.customer_id) } : {},
                "outstanding-summary"
              )
            }
          >
            <RecordSelect
              label="Optional customer filter"
              value={filters.customer_id}
              onChange={(value) => updateFilter("customer_id", value)}
              options={catalog.customers || []}
              getLabel={(item) =>
                `${item.customer_code} — ${item.customer_name}`
              }
            />
          </DocumentCard>
        </div>
      </section>

      <section className="oda-section oda-mining-only">
        <div className="oda-section__heading">
          <div>
            <p className="oda-eyebrow">Mining reporting</p>
            <h2>Professional site documents</h2>
          </div>
          <span>{catalog.sites?.length || 0} mining sites available</span>
        </div>

        <div className="oda-document-grid oda-document-grid--mining">
          <DocumentCard
            icon="📋"
            title="Daily site report"
            description="Shift log, production, equipment, fuel, expenses and incidents."
            disabled={!selection.daily_log}
            busy={downloading === "mining-daily"}
            onDownload={() =>
              download(
                `/operations-documents/mining/daily-logs/${selection.daily_log}/pdf`,
                "Mining-Daily-Site-Report.pdf",
                {},
                "mining-daily"
              )
            }
          >
            <RecordSelect
              label="Daily log"
              value={selection.daily_log}
              onChange={(value) => updateSelection("daily_log", value)}
              options={catalog.daily_logs || []}
              getLabel={(item) =>
                `${labelDate(item.log_date)} — ${item.site_code} — ${
                  item.shift_code
                } (${item.status})`
              }
            />
          </DocumentCard>

          <DocumentCard
            icon="📊"
            title="Site management pack"
            description="Period production, utilization, fuel, expenses and incident report."
            disabled={!selection.mining_site}
            busy={downloading === "mining-pack"}
            onDownload={() =>
              download(
                `/operations-documents/mining/sites/${selection.mining_site}/period-report.pdf`,
                "Mining-Site-Management-Pack.pdf",
                { from: filters.from, to: filters.to },
                "mining-pack"
              )
            }
          >
            <RecordSelect
              label="Mining site"
              value={selection.mining_site}
              onChange={(value) => updateSelection("mining_site", value)}
              options={catalog.sites || []}
              getLabel={(item) => `${item.site_code} — ${item.site_name}`}
            />
          </DocumentCard>

          <DocumentCard
            icon="🦺"
            title="Incident report"
            description="Safety or operational incident investigation and closure record."
            disabled={!selection.incident}
            busy={downloading === "incident"}
            onDownload={() =>
              download(
                `/operations-documents/mining/incidents/${selection.incident}/pdf`,
                "Mining-Incident-Report.pdf",
                {},
                "incident"
              )
            }
          >
            <RecordSelect
              label="Incident"
              value={selection.incident}
              onChange={(value) => updateSelection("incident", value)}
              options={catalog.incidents || []}
              getLabel={(item) =>
                `${labelDate(item.incident_datetime)} — ${item.site_code} — ${
                  item.incident_type
                } (${item.severity})`
              }
            />
          </DocumentCard>
        </div>
      </section>

      <footer className="oda-footer-note">
        <strong>Independent workspace:</strong> This page shows documents and
        accounting only for the business selected at login. Spare Parts stores
        and the other business workspace are not mixed into this view.
      </footer>
    </section>
  );
}
