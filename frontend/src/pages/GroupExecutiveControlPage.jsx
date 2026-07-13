import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/groupExecutive.css";

const now = new Date();
const today = now.toISOString().slice(0, 10);
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

function shortDate(value) {
  if (!value) return "-";
  const text = String(value).slice(0, 10);
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? text
    : date.toLocaleDateString("en-GB", {
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

  const normalMatch = disposition.match(/filename="?([^";]+)"?/i);
  return normalMatch?.[1] || fallback;
}

function MetricCard({ icon, label, value, note, tone = "blue" }) {
  return (
    <article className={`gec-metric-card gec-tone-${tone}`}>
      <span className="gec-metric-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {note ? <small>{note}</small> : null}
      </div>
    </article>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="gec-section-header">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        {description ? <span>{description}</span> : null}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="gec-empty-state">{children}</div>;
}

function PriorityBadge({ value }) {
  const priority = String(value || "low").toLowerCase();
  return (
    <span className={`gec-priority gec-priority-${priority}`}>
      {priority}
    </span>
  );
}

function TableWrap({ children }) {
  return <div className="gec-table-wrap">{children}</div>;
}

export default function GroupExecutiveControlPage() {
  const {
    user,
    branchCode,
    branchName,
    canAccessAllBranches,
  } = useAuth();

  const [filters, setFilters] = useState({
    from: monthStart,
    to: today,
    branch_scope: canAccessAllBranches ? "all" : "selected",
  });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const queryParams = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      branch_scope:
        canAccessAllBranches && filters.branch_scope === "all"
          ? "all"
          : "selected",
    }),
    [filters, canAccessAllBranches]
  );

  const selectedStoreLabel = `${branchCode || user?.branch_code || "STORE"} — ${
    branchName || user?.branch_name || "Selected Store"
  }`;

  async function loadSummary() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get("/group-executive/summary", {
        params: queryParams,
        timeout: 120000,
      });
      setSummary(response.data?.summary || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not load Group Executive Control."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    // Initial load only. Staff apply later filter changes with the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function downloadWorkbook() {
    setDownloading(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get(
        "/group-executive/workbook.xlsx",
        {
          params: queryParams,
          responseType: "blob",
          timeout: 120000,
        }
      );

      const filename = extractFilename(
        response.headers,
        `chalin03-group-executive-${filters.from}-to-${filters.to}.xlsx`
      );
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
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not download the Group Executive workbook."
      );
    } finally {
      setDownloading(false);
    }
  }

  if (loading && !summary) {
    return (
      <div className="gec-loading-page">
        <div className="gec-loader" />
        <strong>Preparing Group Executive Control...</strong>
        <span>Reading Spare Parts, Mining, Equipment Hire and Fleet data.</span>
      </div>
    );
  }

  const group = summary?.group || {};
  const spare = summary?.spare_parts || {};
  const mining = summary?.mining || {};
  const hire = summary?.hire || {};
  const fleet = summary?.fleet || {};
  const production = Array.isArray(mining.production_by_unit)
    ? mining.production_by_unit
    : [];
  const alertCounts = summary?.alert_counts || {};

  return (
    <div className="gec-page">
      <section className="gec-hero">
        <div className="gec-hero-glow gec-hero-glow-one" />
        <div className="gec-hero-glow gec-hero-glow-two" />

        <div className="gec-hero-copy">
          <p className="gec-eyebrow">Chalin 03 Group Operations Platform</p>
          <h1>Group Executive Control Centre</h1>
          <p>
            One boss-level view of Spare Parts, Mining, Equipment Hire and the
            shared Fleet. Review money, operations, risk and urgent actions
            without changing the existing working pages.
          </p>

          <div className="gec-hero-badges">
            <span>📅 {shortDate(summary?.period?.from)} – {shortDate(summary?.period?.to)}</span>
            <span>
              🏬 {summary?.branch_scope?.mode === "all" ? "All spare-parts stores" : selectedStoreLabel}
            </span>
            <span>🔄 Generated {new Date(summary?.generated_at || Date.now()).toLocaleString("en-GB")}</span>
          </div>
        </div>

        <div className="gec-hero-score">
          <span>Management alerts</span>
          <strong>{numberValue(alertCounts.total)}</strong>
          <small>
            {numberValue(alertCounts.critical)} critical • {numberValue(alertCounts.high)} high
          </small>
        </div>
      </section>

      <section className="gec-filter-panel">
        <div>
          <p className="gec-panel-kicker">Reporting period</p>
          <h2>Choose what the boss should review</h2>
          <span>
            Mining, Hire and Fleet are group-wide. The branch selector controls
            the Spare Parts figures.
          </span>
        </div>

        <div className="gec-filter-grid">
          <label>
            <span>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  to: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>Spare Parts scope</span>
            <select
              value={filters.branch_scope}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  branch_scope: event.target.value,
                }))
              }
            >
              <option value="selected">Selected store</option>
              {canAccessAllBranches ? (
                <option value="all">All stores</option>
              ) : null}
            </select>
          </label>

          <button type="button" onClick={loadSummary} disabled={loading}>
            {loading ? "Refreshing..." : "Apply filters"}
          </button>

          <button
            type="button"
            className="gec-secondary-button"
            onClick={downloadWorkbook}
            disabled={downloading}
          >
            {downloading ? "Preparing Excel..." : "Download executive workbook"}
          </button>
        </div>
      </section>

      {error ? <div className="gec-message gec-message-error">{error}</div> : null}
      {notice ? <div className="gec-message gec-message-success">{notice}</div> : null}

      {summary ? (
        <>
          <section className="gec-metric-grid gec-metric-grid-main">
            <MetricCard
              icon="💰"
              label="Recorded group revenue"
              value={money(group.recorded_revenue)}
              note="Spare Parts sales + Hire invoices"
              tone="gold"
            />
            <MetricCard
              icon="🏦"
              label="Cash received"
              value={money(group.cash_received)}
              note="Store receipts + Hire payments"
              tone="green"
            />
            <MetricCard
              icon="📉"
              label="Operating cost"
              value={money(group.operating_cost)}
              note="Store expenses + Mining costs"
              tone="red"
            />
            <MetricCard
              icon="📞"
              label="Outstanding receivables"
              value={money(group.outstanding_receivables)}
              note="Store debts + Hire invoice balances"
              tone="purple"
            />
            <MetricCard
              icon="🧮"
              label="Indicative balance"
              value={money(group.indicative_balance)}
              note="Management estimate, not statutory profit"
              tone="blue"
            />
          </section>

          <section className="gec-business-grid">
            <article className="gec-business-panel gec-business-spare">
              <div className="gec-business-panel-head">
                <span>🧰</span>
                <div>
                  <p>Workspace 01</p>
                  <h2>Spare Parts</h2>
                </div>
                <Link to="/reports">Open reports →</Link>
              </div>
              <div className="gec-business-metrics">
                <div><span>Sales</span><strong>{money(spare.sales_total)}</strong></div>
                <div><span>Received</span><strong>{money(spare.sales_received)}</strong></div>
                <div><span>Expenses</span><strong>{money(spare.expenses_total)}</strong></div>
                <div><span>Current debt</span><strong>{money(spare.debt_balance)}</strong></div>
                <div><span>Cost stock value</span><strong>{money(spare.stock_value_cost)}</strong></div>
                <div><span>Low-stock items</span><strong>{decimal(spare.low_stock_count, 0)}</strong></div>
              </div>
            </article>

            <article className="gec-business-panel gec-business-mining">
              <div className="gec-business-panel-head">
                <span>⛏️</span>
                <div>
                  <p>Workspace 02</p>
                  <h2>Mining Operations</h2>
                </div>
                <Link to="/mining">Open mining →</Link>
              </div>
              <div className="gec-business-metrics">
                <div><span>Active sites</span><strong>{decimal(mining.active_sites, 0)}</strong></div>
                <div><span>Working hours</span><strong>{decimal(mining.working_hours)}</strong></div>
                <div><span>Fuel issued</span><strong>{decimal(mining.fuel_litres)} L</strong></div>
                <div><span>Operating cost</span><strong>{money(mining.operating_cost)}</strong></div>
                <div><span>Open incidents</span><strong>{decimal(mining.open_incidents, 0)}</strong></div>
                <div><span>Unapproved logs</span><strong>{decimal(mining.unapproved_daily_logs, 0)}</strong></div>
              </div>
              <div className="gec-production-strip">
                {production.length > 0 ? (
                  production.map((item) => (
                    <span key={item.unit}>
                      <strong>{decimal(item.quantity, 3)}</strong> {item.unit}
                    </span>
                  ))
                ) : (
                  <span>No production recorded in this period.</span>
                )}
              </div>
            </article>

            <article className="gec-business-panel gec-business-hire">
              <div className="gec-business-panel-head">
                <span>🏗️</span>
                <div>
                  <p>Workspace 03</p>
                  <h2>Equipment Hire</h2>
                </div>
                <Link to="/equipment-hire-operations">Open hire →</Link>
              </div>
              <div className="gec-business-metrics">
                <div><span>Invoiced</span><strong>{money(hire.invoiced_total)}</strong></div>
                <div><span>Payments</span><strong>{money(hire.payments_total)}</strong></div>
                <div><span>Outstanding</span><strong>{money(hire.invoice_balance)}</strong></div>
                <div><span>Overdue</span><strong>{money(hire.overdue_balance)}</strong></div>
                <div><span>Active contracts</span><strong>{decimal(hire.active_contracts, 0)}</strong></div>
                <div><span>Billable hours</span><strong>{decimal(hire.billable_hours)}</strong></div>
              </div>
            </article>

            <article className="gec-business-panel gec-business-fleet">
              <div className="gec-business-panel-head">
                <span>🚜</span>
                <div>
                  <p>Shared foundation</p>
                  <h2>Fleet & Maintenance</h2>
                </div>
                <Link to="/fleet-assets">Open fleet →</Link>
              </div>
              <div className="gec-business-metrics">
                <div><span>Total assets</span><strong>{decimal(fleet.total_assets, 0)}</strong></div>
                <div><span>Available</span><strong>{decimal(fleet.available_assets, 0)}</strong></div>
                <div><span>Assigned</span><strong>{decimal(fleet.assigned_assets, 0)}</strong></div>
                <div><span>Unavailable</span><strong>{decimal(fleet.unavailable_assets, 0)}</strong></div>
                <div><span>Service due</span><strong>{decimal(fleet.service_due_count, 0)}</strong></div>
                <div><span>Open maintenance</span><strong>{decimal(fleet.open_maintenance_count, 0)}</strong></div>
              </div>
            </article>
          </section>

          <section className="gec-section-card">
            <SectionHeader
              eyebrow="Management attention"
              title="Exceptions and urgent alerts"
              description="Open the linked workspace to investigate and correct each item."
            />

            {summary.alerts?.length ? (
              <div className="gec-alert-list">
                {summary.alerts.map((alert, index) => (
                  <article key={`${alert.category}-${alert.title}-${index}`}>
                    <PriorityBadge value={alert.severity} />
                    <div>
                      <span>{alert.category}</span>
                      <strong>{alert.title}</strong>
                      <p>{alert.detail}</p>
                    </div>
                    <Link to={alert.path || "/"}>Review →</Link>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState>No urgent exception was detected for the selected period.</EmptyState>
            )}
          </section>

          <section className="gec-section-card">
            <SectionHeader
              eyebrow="Boss action list"
              title="Management recommendations"
              description="Practical actions generated from current system records."
            />

            <div className="gec-recommendation-grid">
              {(summary.recommendations || []).map((item, index) => (
                <article key={`${item.area}-${item.title}-${index}`}>
                  <div>
                    <PriorityBadge value={item.priority} />
                    <span>{item.area}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                  <Link to={item.path || "/"}>Open related page →</Link>
                </article>
              ))}
            </div>
          </section>

          <section className="gec-section-card">
            <SectionHeader
              eyebrow="Two-store control"
              title="Spare Parts branch comparison"
              description="Sales and expenses use the selected date period; debt and stock are current balances."
            />
            <TableWrap>
              <table className="gec-table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th>Sales</th>
                    <th>Received</th>
                    <th>Expenses</th>
                    <th>Debt</th>
                    <th>Cost stock value</th>
                    <th>Low stock</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.branch_comparison || []).map((row) => (
                    <tr key={row.id}>
                      <td data-label="Store">
                        <strong>{row.branch_code}</strong>
                        <span>{row.branch_name}</span>
                      </td>
                      <td data-label="Sales">{money(row.sales_total)}</td>
                      <td data-label="Received">{money(row.sales_received)}</td>
                      <td data-label="Expenses">{money(row.expenses_total)}</td>
                      <td data-label="Debt">{money(row.debt_balance)}</td>
                      <td data-label="Cost stock value">{money(row.stock_value_cost)}</td>
                      <td data-label="Low stock">{decimal(row.low_stock_count, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>

          <section className="gec-two-column">
            <article className="gec-section-card">
              <SectionHeader
                eyebrow="Mining performance"
                title="Site summary"
                description="Production, machine hours and direct site expenses."
              />
              <TableWrap>
                <table className="gec-table">
                  <thead>
                    <tr>
                      <th>Site</th>
                      <th>Production</th>
                      <th>Target</th>
                      <th>Hours</th>
                      <th>Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.mining_sites || []).map((row) => (
                      <tr key={row.id}>
                        <td data-label="Site"><strong>{row.site_code}</strong><span>{row.site_name}</span></td>
                        <td data-label="Production">{decimal(row.production_quantity, 3)} {row.production_unit}</td>
                        <td data-label="Target">{decimal(row.daily_target, 3)}</td>
                        <td data-label="Hours">{decimal(row.working_hours)}</td>
                        <td data-label="Expenses">{money(row.expenses_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </article>

            <article className="gec-section-card">
              <SectionHeader
                eyebrow="Hire accounts"
                title="Top customer balances"
                description="Invoices and balances within the selected period."
              />
              <TableWrap>
                <table className="gec-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Invoiced</th>
                      <th>Paid</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.hire_customers || []).map((row) => (
                      <tr key={row.id}>
                        <td data-label="Customer"><strong>{row.customer_name}</strong><span>{row.customer_code}</span></td>
                        <td data-label="Invoiced">{money(row.invoiced_total)}</td>
                        <td data-label="Paid">{money(row.paid_total)}</td>
                        <td data-label="Balance">{money(row.balance_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </article>
          </section>

          <section className="gec-section-card">
            <SectionHeader
              eyebrow="Shared machine intelligence"
              title="Fleet utilization across Mining and Hire"
              description="The same asset register is used across both operational businesses."
            />
            <TableWrap>
              <table className="gec-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Status / location</th>
                    <th>Mining hours</th>
                    <th>Hire hours</th>
                    <th>Total productive</th>
                    <th>Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.fleet_utilization || []).map((row) => (
                    <tr key={row.id}>
                      <td data-label="Asset"><strong>{row.asset_code}</strong><span>{row.asset_name}</span></td>
                      <td data-label="Status / location"><strong>{row.current_status}</strong><span>{row.current_location || "Not set"}</span></td>
                      <td data-label="Mining hours">{decimal(row.mining_working_hours)}</td>
                      <td data-label="Hire hours">{decimal(row.hire_billable_hours)}</td>
                      <td data-label="Total productive">{decimal(row.total_productive_hours)}</td>
                      <td data-label="Breakdown">{decimal(row.breakdown_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>

          <section className="gec-quick-links">
            <Link to="/mining"><span>⛏️</span><strong>Mining Operations</strong><small>Sites, production, fuel and incidents</small></Link>
            <Link to="/equipment-hire-operations"><span>🏗️</span><strong>Equipment Hire</strong><small>Contracts, work logs, invoices and returns</small></Link>
            <Link to="/fleet-assets"><span>🚜</span><strong>Fleet & Equipment</strong><small>Meters, fuel, maintenance and inspections</small></Link>
            <Link to="/operations-documents-accounting"><span>📑</span><strong>Operations Documents</strong><small>PDFs, statements and accounting workbook</small></Link>
            <Link to="/advanced-accounting-intelligence"><span>📈</span><strong>Accounting Intelligence</strong><small>Advanced audit and financial review</small></Link>
            <Link to="/backup"><span>💾</span><strong>Backup & Restore</strong><small>Admin-only full-system data protection</small></Link>
          </section>
        </>
      ) : null}
    </div>
  );
}
