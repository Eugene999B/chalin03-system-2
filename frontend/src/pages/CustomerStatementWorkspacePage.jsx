import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/customerStatementWorkspace.css";

const PAGE_SIZE = 25;

function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function defaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return dateInputValue(date);
}

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return includeTime ? date.toLocaleString("en-GB") : date.toLocaleDateString("en-GB");
}

function titleCase(value) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getDispositionFilename(response, fallback) {
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function downloadBlob(response, fallbackName) {
  const blob = new Blob([response.data], {
    type: response.headers?.["content-type"] || "application/octet-stream",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getDispositionFilename(response, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

function MetricCard({ icon, label, value, note, tone = "navy" }) {
  return (
    <article className={`csw-metric csw-tone-${tone}`}>
      <span className="csw-metric-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function Pagination({ page, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);

  return (
    <div className="csw-pagination">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div>
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <b>
          Page {page} of {totalPages}
        </b>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function EmptyState({ title, note }) {
  return (
    <div className="csw-empty">
      <span>📄</span>
      <h3>{title}</h3>
      <p>{note}</p>
    </div>
  );
}

export default function CustomerStatementWorkspacePage() {
  const {
    branchId,
    branchCode,
    branchName,
    branchLocation,
    selectedBranch,
    user,
  } = useAuth();

  const currentStoreCode =
    branchCode || user?.branch_code || selectedBranch?.code || selectedBranch?.branch_code || "STORE";
  const currentStoreName =
    branchName || user?.branch_name || selectedBranch?.name || selectedBranch?.branch_name || "Selected Store";
  const currentStoreLocation =
    branchLocation || user?.branch_location || selectedBranch?.location || selectedBranch?.branch_location || "";

  const initialFilters = useMemo(
    () => ({ from: defaultFromDate(), to: dateInputValue(new Date()), customer: "" }),
    []
  );

  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [itemsPage, setItemsPage] = useState(1);
  const [expandedCustomer, setExpandedCustomer] = useState("");

  useEffect(() => {
    setAppliedFilters(initialFilters);
    setDraftFilters(initialFilters);
  }, [branchId, initialFilters]);

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError("");
      setMessage("");

      try {
        const response = await axiosClient.get("/customer-statement-workspace/report", {
          params: {
            report_type: "statement",
            from: appliedFilters.from,
            to: appliedFilters.to,
            customer: appliedFilters.customer,
          },
        });

        if (!cancelled) {
          setReport(response.data);
          setLedgerPage(1);
          setItemsPage(1);
          setExpandedCustomer("");
        }
      } catch (requestError) {
        if (!cancelled) {
          setReport(null);
          setError(
            requestError.response?.data?.message ||
              "Unable to load the filtered customer statement."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, [appliedFilters, branchId]);

  const activeFilterChips = useMemo(() => {
    const chips = [
      `Store: ${currentStoreCode}`,
      `Period: ${report?.period || `${appliedFilters.from || "All"} to ${appliedFilters.to || "All"}`}`,
      appliedFilters.customer
        ? `Customer: ${appliedFilters.customer}`
        : "Customer: All matching customers",
      `Results: ${Number(report?.summary?.transaction_count || 0)} transactions`,
    ];
    return chips;
  }, [appliedFilters, currentStoreCode, report]);

  const pagedTransactions = useMemo(() => {
    const rows = report?.transactions || [];
    return rows.slice((ledgerPage - 1) * PAGE_SIZE, ledgerPage * PAGE_SIZE);
  }, [ledgerPage, report]);

  const pagedItems = useMemo(() => {
    const rows = report?.items || [];
    return rows.slice((itemsPage - 1) * PAGE_SIZE, itemsPage * PAGE_SIZE);
  }, [itemsPage, report]);

  const topCustomers = useMemo(() => (report?.customers || []).slice(0, 6), [report]);

  function applyFilters(event) {
    event.preventDefault();
    setError("");
    if (draftFilters.from && draftFilters.to && draftFilters.from > draftFilters.to) {
      setError("The start date cannot be after the end date.");
      return;
    }
    setAppliedFilters({
      from: draftFilters.from,
      to: draftFilters.to,
      customer: draftFilters.customer.trim(),
    });
  }

  function clearFilters() {
    const cleared = { from: "", to: "", customer: "" };
    setDraftFilters(cleared);
    setAppliedFilters(cleared);
  }

  async function exportReport(format) {
    setExporting(format);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get(
        `/customer-statement-workspace/export/${format}`,
        {
          params: {
            report_type: "statement",
            from: appliedFilters.from,
            to: appliedFilters.to,
            customer: appliedFilters.customer,
          },
          responseType: "blob",
        }
      );

      if (format === "print") {
        const url = window.URL.createObjectURL(
          new Blob([response.data], { type: "application/pdf" })
        );
        const printWindow = window.open(url, "_blank", "noopener,noreferrer");
        if (!printWindow) {
          downloadBlob(response, "chalin03-customer-statement.pdf");
          setMessage(
            "The browser blocked the print tab, so the PDF was downloaded. Open it and choose Print."
          );
        } else {
          setMessage("The printer-ready statement opened in a new tab.");
        }
        window.setTimeout(() => window.URL.revokeObjectURL(url), 120000);
      } else {
        const extension = format === "word" ? "doc" : format === "excel" ? "xlsx" : "pdf";
        downloadBlob(
          response,
          `chalin03-${currentStoreCode.toLowerCase()}-customer-statement.${extension}`
        );
        setMessage(`${titleCase(format)} export downloaded using the current filters.`);
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          `Unable to create the ${format} customer statement.`
      );
    } finally {
      setExporting("");
    }
  }

  const summary = report?.summary || {};

  return (
    <div className="csw-page">
      <section className="csw-hero">
        <div className="csw-hero-copy">
          <p>Customer Financial Intelligence • {currentStoreCode}</p>
          <h1>Customer Statement & Account Analysis</h1>
          <span>
            Apply one set of filters, view the exact result beautifully, then print or export that same result to PDF, Word or Excel.
          </span>
        </div>
        <div className="csw-store-context">
          <small>Selected Store</small>
          <strong>{currentStoreCode} — {currentStoreName}</strong>
          <span>{currentStoreLocation || "Store location not set"}</span>
        </div>
      </section>

      <section className="csw-filter-card">
        <div className="csw-filter-heading">
          <div>
            <p>One Filter Engine</p>
            <h2>Filter the report before viewing or exporting</h2>
          </div>
          <span className="csw-filter-badge">Screen = Export</span>
        </div>

        <form className="csw-filter-grid" onSubmit={applyFilters}>
          <label>
            <span>From Date</span>
            <input
              type="date"
              value={draftFilters.from}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </label>

          <label>
            <span>To Date</span>
            <input
              type="date"
              value={draftFilters.to}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </label>

          <label className="csw-customer-filter">
            <span>Customer Name or Phone</span>
            <input
              type="search"
              value={draftFilters.customer}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, customer: event.target.value }))
              }
              placeholder="Leave blank for all customers"
            />
          </label>

          <div className="csw-filter-actions">
            <button type="submit" className="csw-primary-button">
              Apply Filters
            </button>
            <button type="button" className="csw-secondary-button" onClick={clearFilters}>
              Clear
            </button>
          </div>
        </form>

        <div className="csw-active-filters">
          {activeFilterChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>

        <div className="csw-export-bar">
          <div>
            <strong>Export this exact filtered result</strong>
            <span>Every format uses the filters shown above.</span>
          </div>
          <div className="csw-export-actions">
            <button type="button" onClick={() => exportReport("print")} disabled={Boolean(exporting)}>
              🖨️ {exporting === "print" ? "Opening..." : "Print"}
            </button>
            <button type="button" onClick={() => exportReport("pdf")} disabled={Boolean(exporting)}>
              📄 {exporting === "pdf" ? "Preparing..." : "PDF"}
            </button>
            <button type="button" onClick={() => exportReport("word")} disabled={Boolean(exporting)}>
              📝 {exporting === "word" ? "Preparing..." : "Word"}
            </button>
            <button type="button" onClick={() => exportReport("excel")} disabled={Boolean(exporting)}>
              📊 {exporting === "excel" ? "Preparing..." : "Excel"}
            </button>
          </div>
        </div>
      </section>

      {error ? <div className="csw-alert csw-alert-error">{error}</div> : null}
      {message ? <div className="csw-alert csw-alert-success">{message}</div> : null}
      {report?.capped ? (
        <div className="csw-alert csw-alert-warning">
          The result reached the safety display limit. Narrow the date or customer filter before exporting.
        </div>
      ) : null}

      {loading ? (
        <div className="csw-loading">
          <span />
          Building the filtered customer statement...
        </div>
      ) : (
        <>
          <section className="csw-metrics-grid">
            <MetricCard icon="👥" label="Matching Customers" value={summary.customer_count || 0} note="Customers in current filters" tone="navy" />
            <MetricCard icon="🧾" label="Sales" value={summary.sales_count || 0} note={`${summary.transaction_count || 0} total ledger entries`} tone="blue" />
            <MetricCard icon="📦" label="Items Purchased" value={summary.item_quantity || 0} note={`${summary.item_line_count || 0} item lines`} tone="purple" />
            <MetricCard icon="💰" label="Total Sales" value={formatMoney(summary.total_sales)} note="Valid sales in current filters" tone="gold" />
            <MetricCard icon="✅" label="Total Received" value={formatMoney(summary.total_received)} note="Sale payments plus debt payments" tone="green" />
            <MetricCard icon="⚠️" label="Outstanding" value={formatMoney(summary.outstanding_balance)} note={`${summary.debt_count || 0} debt record(s)`} tone="red" />
          </section>

          <section className="csw-workspace">
            <div className="csw-tabs" role="tablist" aria-label="Customer statement views">
              {[
                ["overview", "Overview", "📌"],
                ["customers", "Customer Summary", "👥"],
                ["ledger", "Transaction Ledger", "🧾"],
                ["items", "Items Purchased", "📦"],
              ].map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  className={activeTab === id ? "active" : ""}
                  onClick={() => setActiveTab(id)}
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            <div className="csw-tab-content">
              {activeTab === "overview" ? (
                <div className="csw-overview-grid">
                  <article className="csw-overview-panel csw-overview-wide">
                    <div className="csw-panel-heading">
                      <div>
                        <p>Applied Report</p>
                        <h2>{report?.period || "Filtered period"}</h2>
                      </div>
                      <span>{appliedFilters.customer || "All customers"}</span>
                    </div>
                    <div className="csw-overview-stats">
                      <div><span>Paid on Sales</span><strong>{formatMoney(summary.paid_on_sales)}</strong></div>
                      <div><span>Debt Payments</span><strong>{formatMoney(summary.debt_payments)}</strong></div>
                      <div><span>Collection Rate</span><strong>{summary.total_sales > 0 ? `${Math.min(100, Math.round((summary.total_received / summary.total_sales) * 100))}%` : "0%"}</strong></div>
                      <div><span>Average Sale</span><strong>{formatMoney(summary.sales_count > 0 ? summary.total_sales / summary.sales_count : 0)}</strong></div>
                    </div>
                  </article>

                  <article className="csw-overview-panel">
                    <div className="csw-panel-heading">
                      <div><p>Top Accounts</p><h2>Highest purchase value</h2></div>
                    </div>
                    <div className="csw-ranking-list">
                      {topCustomers.length ? topCustomers.map((customer, index) => (
                        <div key={customer.customer_key}>
                          <b>{index + 1}</b>
                          <span><strong>{customer.customer_name}</strong><small>{customer.customer_phone || "No phone"}</small></span>
                          <em>{formatMoney(customer.total_sales)}</em>
                        </div>
                      )) : <EmptyState title="No matching customers" note="Change the filters to find customer activity." />}
                    </div>
                  </article>

                  <article className="csw-overview-panel">
                    <div className="csw-panel-heading">
                      <div><p>Account Attention</p><h2>Outstanding balances</h2></div>
                    </div>
                    <div className="csw-ranking-list">
                      {(report?.customers || []).filter((customer) => Number(customer.outstanding_balance) > 0).slice(0, 6).map((customer, index) => (
                        <div key={customer.customer_key}>
                          <b>{index + 1}</b>
                          <span><strong>{customer.customer_name}</strong><small>{titleCase(customer.account_status)}</small></span>
                          <em className="danger">{formatMoney(customer.outstanding_balance)}</em>
                        </div>
                      ))}
                      {(report?.customers || []).filter((customer) => Number(customer.outstanding_balance) > 0).length === 0 ? (
                        <EmptyState title="No outstanding balance" note="All matching customer accounts are clear." />
                      ) : null}
                    </div>
                  </article>
                </div>
              ) : null}

              {activeTab === "customers" ? (
                <div className="csw-customer-grid">
                  {(report?.customers || []).map((customer) => {
                    const expanded = expandedCustomer === customer.customer_key;
                    const rows = (report?.transactions || []).filter(
                      (row) => row.customer_key === customer.customer_key
                    );
                    return (
                      <article key={customer.customer_key} className="csw-customer-card">
                        <div className="csw-customer-card-head">
                          <div className="csw-customer-avatar">
                            {String(customer.customer_name || "C").slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <h3>{customer.customer_name}</h3>
                            <p>{customer.customer_phone || "No phone recorded"}</p>
                          </div>
                          <span className={`csw-status csw-status-${customer.account_status}`}>
                            {titleCase(customer.account_status)}
                          </span>
                        </div>
                        <div className="csw-customer-values">
                          <div><span>Total Purchases</span><strong>{formatMoney(customer.total_sales)}</strong></div>
                          <div><span>Total Received</span><strong>{formatMoney(customer.total_received)}</strong></div>
                          <div><span>Outstanding</span><strong>{formatMoney(customer.outstanding_balance)}</strong></div>
                          <div><span>Transactions</span><strong>{rows.length}</strong></div>
                        </div>
                        <div className="csw-customer-meta">
                          <span>{customer.item_quantity} item(s)</span>
                          <span>Last activity {formatDate(customer.last_activity)}</span>
                        </div>
                        <button
                          type="button"
                          className="csw-expand-button"
                          onClick={() => setExpandedCustomer(expanded ? "" : customer.customer_key)}
                        >
                          {expanded ? "Hide Account Details" : "View Account Details"}
                        </button>
                        {expanded ? (
                          <div className="csw-customer-details">
                            {rows.slice(0, 12).map((row) => (
                              <div key={row.id}>
                                <span>{formatDate(row.date, true)}</span>
                                <strong>{titleCase(row.type)} • {row.receipt_number}</strong>
                                <small>{row.description}</small>
                                <b>{formatMoney(row.amount)}</b>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {(report?.customers || []).length === 0 ? (
                    <EmptyState title="No matching customer accounts" note="Apply a wider date range or clear the customer search." />
                  ) : null}
                </div>
              ) : null}

              {activeTab === "ledger" ? (
                <div>
                  <div className="csw-table-wrap">
                    <table className="csw-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Customer</th>
                          <th>Receipt</th>
                          <th>Type</th>
                          <th>Items / Details</th>
                          <th>Amount</th>
                          <th>Paid</th>
                          <th>Balance</th>
                          <th>Method</th>
                          <th>Staff</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedTransactions.map((row) => (
                          <tr key={row.id}>
                            <td>{formatDate(row.date, true)}</td>
                            <td><strong>{row.customer_name}</strong><small>{row.customer_phone || "-"}</small></td>
                            <td>{row.receipt_number}</td>
                            <td><span className={`csw-type csw-type-${row.type}`}>{titleCase(row.type)}</span></td>
                            <td>
                              <div className="csw-items-cell">
                                {(row.items || []).length ? row.items.map((item) => (
                                  <span key={item.id}>{item.product_name} × {item.quantity} <small>{formatMoney(item.line_total)}</small></span>
                                )) : <span>{row.description || "-"}</span>}
                              </div>
                            </td>
                            <td>{formatMoney(row.amount)}</td>
                            <td>{formatMoney(row.paid)}</td>
                            <td>{formatMoney(row.balance)}</td>
                            <td>{titleCase(row.payment_method)}</td>
                            <td>{row.staff_name}</td>
                            <td>{titleCase(row.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(report?.transactions || []).length === 0 ? (
                    <EmptyState title="No ledger records" note="No sales, debts or payments matched the applied filters." />
                  ) : (
                    <Pagination page={ledgerPage} total={(report?.transactions || []).length} onChange={setLedgerPage} />
                  )}
                </div>
              ) : null}

              {activeTab === "items" ? (
                <div>
                  <div className="csw-table-wrap">
                    <table className="csw-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Customer</th>
                          <th>Receipt</th>
                          <th>Product</th>
                          <th>Quantity</th>
                          <th>Unit Price</th>
                          <th>Line Total</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedItems.map((item) => (
                          <tr key={`${item.sale_id}-${item.id}`}>
                            <td>{formatDate(item.date, true)}</td>
                            <td><strong>{item.customer_name}</strong><small>{item.customer_phone || "-"}</small></td>
                            <td>{item.receipt_number}</td>
                            <td><strong>{item.product_name}</strong></td>
                            <td>{item.quantity}</td>
                            <td>{formatMoney(item.unit_price)}</td>
                            <td>{formatMoney(item.line_total)}</td>
                            <td>{titleCase(item.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(report?.items || []).length === 0 ? (
                    <EmptyState title="No purchased items" note="No sale item lines matched the applied filters." />
                  ) : (
                    <Pagination page={itemsPage} total={(report?.items || []).length} onChange={setItemsPage} />
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
