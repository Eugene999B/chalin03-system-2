import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoText(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function formatStatus(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getFriendlyError(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function getScoreColor(score) {
  if (score >= 70) return "#166534";
  if (score >= 45) return "#92400e";
  return "#991b1b";
}

function getSeverityStyle(severity) {
  const cleanSeverity = String(severity || "").toLowerCase();

  if (cleanSeverity === "danger" || cleanSeverity === "red") {
    return {
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#991b1b",
    };
  }

  if (cleanSeverity === "warning" || cleanSeverity === "orange") {
    return {
      background: "#fffbeb",
      border: "1px solid #fde68a",
      color: "#92400e",
    };
  }

  if (cleanSeverity === "success" || cleanSeverity === "green" || cleanSeverity === "clean") {
    return {
      background: "#f0fdf4",
      border: "1px solid #bbf7d0",
      color: "#166534",
    };
  }

  return {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
  };
}

function getReviewStatusStyle(status) {
  const cleanStatus = String(status || "").toLowerCase();

  if (cleanStatus === "danger" || cleanStatus === "warning") {
    return getSeverityStyle(cleanStatus);
  }

  if (cleanStatus === "review") {
    return {
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      color: "#1d4ed8",
    };
  }

  if (cleanStatus === "empty") {
    return {
      background: "#f8fafc",
      border: "1px solid #cbd5e1",
      color: "#475569",
    };
  }

  return getSeverityStyle("clean");
}

function SummaryCard({ title, value, note, tone = "normal" }) {
  const toneColor =
    tone === "danger" ? "#991b1b" : tone === "warning" ? "#92400e" : "#0f172a";

  return (
    <div
      style={{
        border: "1px solid #d8e0ea",
        borderRadius: "14px",
        padding: "14px",
        background: "#ffffff",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 800, color: "#64748b" }}>
        {title}
      </div>
      <div
        style={{
          fontSize: "22px",
          fontWeight: 950,
          color: toneColor,
          marginTop: "6px",
        }}
      >
        {value}
      </div>
      {note && (
        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
          {note}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ children, status }) {
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "5px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 900,
        ...getReviewStatusStyle(status),
      }}
    >
      {children}
    </span>
  );
}

function EmptyRow({ colSpan, message }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ color: "#64748b", fontWeight: 700 }}>
        {message}
      </td>
    </tr>
  );
}

export default function AdvancedAccountingIntelligencePage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();

  const [startDate, setStartDate] = useState(daysAgoText(29));
  const [endDate, setEndDate] = useState(todayText());
  const [branchMode, setBranchMode] = useState("selected");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canUseAllStores = useMemo(() => {
    const role = String(user?.role || "").toLowerCase();
    return role === "admin" || role === "manager";
  }, [user]);

  const intelligence = data?.intelligence || null;
  const scope = intelligence?.scope || {};
  const summary = intelligence?.executive_summary || {};
  const audit = intelligence?.audit || {};
  const ledger = intelligence?.management_ledger || {};
  const pnl = intelligence?.profit_and_loss || {};
  const stockAdjustments = intelligence?.stock_adjustments || intelligence?.stock?.stock_adjustments || {};
  const stockTransfers = intelligence?.stock_transfers || intelligence?.stock?.stock_transfers || {};
  const sms = intelligence?.sms || {};
  const returns = intelligence?.returns || {};
  const auditControls = intelligence?.audit_controls || {};
  const systemControls = intelligence?.system_controls || {};
  const reviewSummary = intelligence?.review_summary || {};

  const displayStoreCode =
    scope.selected_branch_code || branchCode || user?.selected_branch?.branch_code || "STORE";
  const displayStoreName =
    scope.selected_branch_name || branchName || user?.selected_branch?.branch_name || "Selected Store";
  const displayStoreLocation =
    branchLocation || user?.branch_location || user?.selected_branch?.branch_location || "";

  async function loadIntelligence() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const params = {
        start_date: startDate,
        end_date: endDate,
      };

      if (branchMode === "all" && canUseAllStores) {
        params.branch_id = "all";
      }

      const response = await axiosClient.get("/accounting-intelligence/overview", {
        params,
      });

      setData(response.data);
      setNotice(response.data.message || "Accounting intelligence loaded.");
    } catch (error) {
      setError(getFriendlyError(error, "Failed to load accounting intelligence."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIntelligence();
    // Load once when page opens. Use Run Analysis after changing filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Advanced Accounting Intelligence</h1>
          <p>
            High-level audit, ledger, profit, debt, stock, SMS, system-control and branch intelligence for{" "}
            <strong>
              {displayStoreCode} - {displayStoreName}
            </strong>
          </p>
        </div>

        <button type="button" onClick={loadIntelligence} disabled={loading}>
          {loading ? "Loading..." : "Refresh Intelligence"}
        </button>
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
        Scope: {displayStoreCode} — {displayStoreName}
        {displayStoreLocation ? ` - ${displayStoreLocation}` : ""}
        <br />
        <small>
          This page now reviews sales, debts, expenses, purchases, returns, stock adjustments, stock transfers, SMS logs, backup/restore activity, maintenance activity, audit unlocks and sign-off controls.
        </small>
      </div>

      {notice && <div className="success-box">{notice}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Control Panel</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <div>
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>

          <div>
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>

          <div>
            <label>Scope</label>
            <select
              value={branchMode}
              onChange={(event) => setBranchMode(event.target.value)}
            >
              <option value="selected">Selected store</option>
              {canUseAllStores && <option value="all">All stores</option>}
            </select>
          </div>

          <div>
            <label>&nbsp;</label>
            <button type="button" onClick={loadIntelligence} disabled={loading}>
              Run Analysis
            </button>
          </div>
        </div>
      </div>

      {!intelligence ? (
        <div className="section-card">
          <p>{loading ? "Loading intelligence..." : "No intelligence loaded yet."}</p>
        </div>
      ) : (
        <>
          <div className="section-card">
            <h2>Executive Intelligence</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
              }}
            >
              <SummaryCard
                title="Audit Score"
                value={`${summary.audit_score || 0}/100`}
                note={summary.audit_status || "needs_review"}
                tone={
                  Number(summary.audit_score || 0) < 45
                    ? "danger"
                    : Number(summary.audit_score || 0) < 70
                    ? "warning"
                    : "normal"
                }
              />
              <SummaryCard title="Sales" value={formatMoney(summary.total_sales)} />
              <SummaryCard title="Paid" value={formatMoney(summary.total_paid)} />
              <SummaryCard
                title="Balance"
                value={formatMoney(summary.total_balance)}
                tone={Number(summary.total_balance || 0) > 0 ? "warning" : "normal"}
              />
              <SummaryCard title="Expenses" value={formatMoney(summary.total_expenses)} />
              <SummaryCard
                title="Net Before Stock Cost"
                value={formatMoney(summary.estimated_net_before_stock_cost)}
                note="Management estimate only"
              />
              <SummaryCard
                title="Debt Balance"
                value={formatMoney(summary.total_debt_balance)}
                tone={Number(summary.total_debt_balance || 0) > 0 ? "warning" : "normal"}
              />
              <SummaryCard
                title="Low Stock"
                value={formatNumber(summary.low_stock_count)}
                tone={Number(summary.low_stock_count || 0) > 0 ? "warning" : "normal"}
              />
              <SummaryCard
                title="Stock Adjustments"
                value={formatNumber(summary.stock_adjustment_count)}
                note="Manual stock movements"
                tone={Number(summary.stock_adjustment_count || 0) > 0 ? "warning" : "normal"}
              />
              <SummaryCard
                title="Stock Transfers"
                value={formatNumber(summary.stock_transfer_count)}
                note="Between stores"
              />
              <SummaryCard
                title="Failed SMS"
                value={formatNumber(summary.failed_sms_count)}
                tone={Number(summary.failed_sms_count || 0) > 0 ? "warning" : "normal"}
              />
              <SummaryCard
                title="System Events"
                value={formatNumber(summary.sensitive_system_event_count)}
                note="Restore / clear-data events"
                tone={Number(summary.sensitive_system_event_count || 0) > 0 ? "danger" : "normal"}
              />
            </div>
          </div>

          <div className="section-card">
            <h2>Audit Review Checklist</h2>
            <p style={{ color: "#64748b", fontWeight: 700 }}>
              {reviewSummary.stock_movement_ledger_note ||
                "Stock Movement Ledger is protected by reviewing its source records: sales, purchases, returns, stock adjustments and stock transfers."}
            </p>

            <table>
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Status</th>
                  <th>Count</th>
                  <th>Audit Note</th>
                </tr>
              </thead>
              <tbody>
                {(reviewSummary.checklist || []).length === 0 ? (
                  <EmptyRow colSpan={4} message="No review checklist returned from backend." />
                ) : (
                  reviewSummary.checklist.map((item) => (
                    <tr key={item.key || item.label}>
                      <td><strong>{item.label}</strong></td>
                      <td><StatusBadge status={item.status}>{formatStatus(item.status)}</StatusBadge></td>
                      <td>{formatNumber(item.count)}</td>
                      <td>{item.note || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="section-card">
            <h2>Profit and Loss Intelligence</h2>
            <table>
              <tbody>
                <tr><th>Gross Sales</th><td>{formatMoney(pnl.gross_sales)}</td></tr>
                <tr><th>Discounts</th><td>{formatMoney(pnl.discounts)}</td></tr>
                <tr><th>Net Sales</th><td>{formatMoney(pnl.net_sales)}</td></tr>
                <tr><th>Operating Expenses</th><td>{formatMoney(pnl.operating_expenses)}</td></tr>
                <tr><th>Purchases Cost Signal</th><td>{formatMoney(pnl.purchases_cost_signal)}</td></tr>
                <tr><th>Estimated Net Before Stock Cost</th><td>{formatMoney(pnl.estimated_net_before_stock_cost)}</td></tr>
                <tr><th>Conservative Cash Position</th><td>{formatMoney(pnl.conservative_cash_position)}</td></tr>
              </tbody>
            </table>
            <p>{pnl.warning}</p>
          </div>

          <div className="section-card">
            <h2>Management Ledger</h2>
            <p>{ledger.note}</p>

            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.rows || []).length === 0 ? (
                  <EmptyRow colSpan={6} message="No management ledger rows returned." />
                ) : (
                  (ledger.rows || []).map((row) => (
                    <tr key={row.account_code}>
                      <td>{row.account_code}</td>
                      <td>{row.account_name}</td>
                      <td>{row.account_type}</td>
                      <td>{formatMoney(row.debit)}</td>
                      <td>{formatMoney(row.credit)}</td>
                      <td>{row.explanation}</td>
                    </tr>
                  ))
                )}
                <tr>
                  <th colSpan="3">Totals</th>
                  <th>{formatMoney(ledger.totals?.debit)}</th>
                  <th>{formatMoney(ledger.totals?.credit)}</th>
                  <th>Difference: {formatMoney(ledger.totals?.difference)}</th>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="two-column">
            <div className="section-card">
              <h2>Debt Intelligence</h2>
              <p>Active debts: <strong>{formatNumber(intelligence.debts?.active_debt_count)}</strong></p>
              <p>Total debt balance: <strong>{formatMoney(intelligence.debts?.total_debt_balance)}</strong></p>
              <p>Debt payments collected: <strong>{formatMoney(intelligence.debts?.debt_payments)}</strong></p>

              <table>
                <thead>
                  <tr><th>Aging Bucket</th><th>Count</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {(intelligence.debts?.aging || []).length === 0 ? (
                    <EmptyRow colSpan={3} message="No debt aging rows found." />
                  ) : (
                    (intelligence.debts?.aging || []).map((row) => (
                      <tr key={row.bucket}>
                        <td>{row.bucket}</td>
                        <td>{row.count}</td>
                        <td>{formatMoney(row.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="section-card">
              <h2>Stock Intelligence</h2>
              <p>Products: <strong>{formatNumber(intelligence.stock?.product_count)}</strong></p>
              <p>Total quantity: <strong>{formatNumber(intelligence.stock?.total_quantity)}</strong></p>
              <p>Estimated stock cost value: <strong>{formatMoney(intelligence.stock?.estimated_stock_cost_value)}</strong></p>
              <p>Estimated retail value: <strong>{formatMoney(intelligence.stock?.estimated_stock_retail_value)}</strong></p>
              <p>Negative stock products: <strong>{formatNumber(intelligence.stock?.negative_stock_count)}</strong></p>

              <table>
                <thead>
                  <tr><th>Low Stock Item</th><th>Qty</th><th>Threshold</th></tr>
                </thead>
                <tbody>
                  {(intelligence.stock?.low_stock_items || []).length === 0 ? (
                    <EmptyRow colSpan={3} message="No low-stock rows found." />
                  ) : (
                    (intelligence.stock?.low_stock_items || []).slice(0, 10).map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.quantity}</td>
                        <td>{item.low_stock_threshold}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-column">
            <div className="section-card">
              <h2>Stock Adjustment Intelligence</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "10px",
                  marginBottom: "12px",
                }}
              >
                <SummaryCard title="Adjustments" value={formatNumber(stockAdjustments.adjustment_count)} />
                <SummaryCard title="Increases" value={formatNumber(stockAdjustments.increase_count)} />
                <SummaryCard title="Decreases" value={formatNumber(stockAdjustments.decrease_count)} tone={Number(stockAdjustments.decrease_count || 0) > 0 ? "warning" : "normal"} />
                <SummaryCard title="Set Stock" value={formatNumber(stockAdjustments.set_count)} tone={Number(stockAdjustments.set_count || 0) > 0 ? "warning" : "normal"} />
                <SummaryCard title="Damaged" value={formatNumber(stockAdjustments.damaged_count)} tone={Number(stockAdjustments.damaged_count || 0) > 0 ? "warning" : "normal"} />
                <SummaryCard title="Lost" value={formatNumber(stockAdjustments.lost_count)} tone={Number(stockAdjustments.lost_count || 0) > 0 ? "danger" : "normal"} />
              </div>

              <table>
                <thead>
                  <tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {(stockAdjustments.recent_adjustments || []).length === 0 ? (
                    <EmptyRow colSpan={5} message="No recent stock adjustment records found." />
                  ) : (
                    (stockAdjustments.recent_adjustments || []).map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.adjusted_at)}</td>
                        <td>{item.product_name || "-"}</td>
                        <td>{formatStatus(item.adjustment_type)}</td>
                        <td>{formatNumber(item.quantity)}</td>
                        <td>{item.reason || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="section-card">
              <h2>Stock Transfer Intelligence</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "10px",
                  marginBottom: "12px",
                }}
              >
                <SummaryCard title="Transfers" value={formatNumber(stockTransfers.transfer_count)} />
                <SummaryCard title="Out" value={formatNumber(stockTransfers.transfer_out_count)} />
                <SummaryCard title="In" value={formatNumber(stockTransfers.transfer_in_count)} />
                <SummaryCard title="Dispatched" value={formatNumber(stockTransfers.dispatched_count)} />
                <SummaryCard title="Received" value={formatNumber(stockTransfers.received_count)} />
                <SummaryCard title="Mismatch Items" value={formatNumber(stockTransfers.quantity_mismatch_count)} tone={Number(stockTransfers.quantity_mismatch_count || 0) > 0 ? "danger" : "normal"} />
              </div>

              <table>
                <thead>
                  <tr><th>Date</th><th>Reference</th><th>Status</th><th>Direction</th><th>From</th><th>To</th></tr>
                </thead>
                <tbody>
                  {(stockTransfers.recent_transfers || []).length === 0 ? (
                    <EmptyRow colSpan={6} message="No recent stock transfers found." />
                  ) : (
                    (stockTransfers.recent_transfers || []).map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>{item.reference || `Transfer #${item.id}`}</td>
                        <td>{formatStatus(item.status)}</td>
                        <td>{formatStatus(item.direction)}</td>
                        <td>{item.from_branch_id || "-"}</td>
                        <td>{item.to_branch_id || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-column">
            <div className="section-card">
              <h2>SMS Intelligence</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "10px",
                  marginBottom: "12px",
                }}
              >
                <SummaryCard title="SMS Total" value={formatNumber(sms.sms_count)} />
                <SummaryCard title="Sent" value={formatNumber(sms.sent_count)} />
                <SummaryCard title="Failed" value={formatNumber(sms.failed_count)} tone={Number(sms.failed_count || 0) > 0 ? "warning" : "normal"} />
                <SummaryCard title="Pending" value={formatNumber(sms.pending_count)} />
                <SummaryCard title="Success Rate" value={formatPercent(sms.success_rate)} />
              </div>

              <h3>SMS by Type</h3>
              <table>
                <thead><tr><th>Type</th><th>Count</th></tr></thead>
                <tbody>
                  {(sms.by_type || []).length === 0 ? (
                    <EmptyRow colSpan={2} message="No SMS type breakdown found." />
                  ) : (
                    (sms.by_type || []).map((row) => (
                      <tr key={row.sms_type}>
                        <td>{formatStatus(row.sms_type)}</td>
                        <td>{formatNumber(row.count)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <h3>Recent Failed SMS</h3>
              <table>
                <thead><tr><th>Date</th><th>Phone</th><th>Type</th><th>Error</th></tr></thead>
                <tbody>
                  {(sms.recent_failures || []).length === 0 ? (
                    <EmptyRow colSpan={4} message="No recent SMS failures found." />
                  ) : (
                    (sms.recent_failures || []).map((failure) => (
                      <tr key={failure.id}>
                        <td>{formatDateTime(failure.sent_at)}</td>
                        <td>{failure.recipient_phone || "-"}</td>
                        <td>{formatStatus(failure.sms_type)}</td>
                        <td>{failure.error_message || failure.status || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="section-card">
              <h2>Returns Intelligence</h2>
              <p>Return count: <strong>{formatNumber(returns.return_count)}</strong></p>
              <p>Total return quantity: <strong>{formatNumber(returns.total_return_quantity)}</strong></p>
              <p>Total return amount: <strong>{formatMoney(returns.total_return_amount)}</strong></p>

              <table>
                <thead><tr><th>Date</th><th>Product</th><th>Qty</th><th>Amount</th><th>Reason</th></tr></thead>
                <tbody>
                  {(returns.recent_returns || []).length === 0 ? (
                    <EmptyRow colSpan={5} message="No recent returns found." />
                  ) : (
                    (returns.recent_returns || []).map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.return_date)}</td>
                        <td>{item.product_name || "-"}</td>
                        <td>{formatNumber(item.quantity)}</td>
                        <td>{formatMoney(item.amount)}</td>
                        <td>{item.reason || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-column">
            <div className="section-card">
              <h2>Audit Control Intelligence</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "10px",
                }}
              >
                <SummaryCard title="Unlock Requests" value={formatNumber(auditControls.unlock_requests?.request_count)} />
                <SummaryCard title="Pending Unlocks" value={formatNumber(auditControls.unlock_requests?.pending_count)} tone={Number(auditControls.unlock_requests?.pending_count || 0) > 0 ? "warning" : "normal"} />
                <SummaryCard title="Approved Unlocks" value={formatNumber(auditControls.unlock_requests?.approved_count)} />
                <SummaryCard title="Sign-Off Records" value={formatNumber(auditControls.signoffs?.signoff_count)} />
                <SummaryCard title="Approved Sign-Offs" value={formatNumber(auditControls.signoffs?.approved_count)} />
                <SummaryCard title="Reapprovals" value={formatNumber(auditControls.reapprovals?.reapproval_count)} />
              </div>
            </div>

            <div className="section-card">
              <h2>Backup, Restore & Maintenance Intelligence</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "10px",
                  marginBottom: "12px",
                }}
              >
                <SummaryCard title="Activity" value={formatNumber(systemControls.activity_count)} />
                <SummaryCard title="Backups" value={formatNumber(systemControls.backup_download_count)} />
                <SummaryCard title="Restores" value={formatNumber(systemControls.restore_count)} tone={Number(systemControls.restore_count || 0) > 0 ? "danger" : "normal"} />
                <SummaryCard title="Clear Data" value={formatNumber(systemControls.clear_business_data_count)} tone={Number(systemControls.clear_business_data_count || 0) > 0 ? "danger" : "normal"} />
              </div>

              <table>
                <thead><tr><th>Date</th><th>Action</th><th>Details</th></tr></thead>
                <tbody>
                  {(systemControls.recent_sensitive_activity || []).length === 0 ? (
                    <EmptyRow colSpan={3} message="No recent sensitive system activity found." />
                  ) : (
                    (systemControls.recent_sensitive_activity || []).map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.created_at)}</td>
                        <td>{item.action || "-"}</td>
                        <td>{item.details || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section-card">
            <h2>Audit Flags</h2>
            <div
              style={{
                color: getScoreColor(audit.audit_score),
                fontWeight: 900,
                marginBottom: "12px",
              }}
            >
              Audit Status: {audit.audit_status} | Score: {audit.audit_score}/100
            </div>

            {(audit.flags || []).length === 0 ? (
              <p>No major audit flags found for this period.</p>
            ) : (
              <div style={{ display: "grid", gap: "10px" }}>
                {(audit.flags || []).map((flag, index) => (
                  <div
                    key={`${flag.category}-${flag.title}-${index}`}
                    style={{
                      borderRadius: "10px",
                      padding: "12px",
                      ...getSeverityStyle(flag.severity),
                    }}
                  >
                    <strong>
                      {flag.severity?.toUpperCase()} | {flag.category}: {flag.title}
                    </strong>
                    <p>{flag.detail}</p>
                    <p><strong>Action:</strong> {flag.recommended_action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="section-card">
            <h2>Recommendations</h2>
            <table>
              <thead>
                <tr><th>Priority</th><th>Recommendation</th><th>Action</th></tr>
              </thead>
              <tbody>
                {(intelligence.recommendations || []).length === 0 ? (
                  <EmptyRow colSpan={3} message="No recommendations returned." />
                ) : (
                  (intelligence.recommendations || []).map((item, index) => (
                    <tr key={`${item.title}-${index}`}>
                      <td><strong>{item.priority}</strong></td>
                      <td>{item.title}</td>
                      <td>{item.action}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {intelligence.branch_comparison?.length > 0 && (
            <div className="section-card">
              <h2>Two-Store Branch Comparison</h2>
              <table>
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Transactions</th>
                    <th>Sales</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Collection Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {intelligence.branch_comparison.map((branch) => (
                    <tr key={branch.branch_id}>
                      <td>{branch.branch_code} - {branch.branch_name}</td>
                      <td>{branch.transaction_count}</td>
                      <td>{formatMoney(branch.total_sales)}</td>
                      <td>{formatMoney(branch.total_paid)}</td>
                      <td>{formatMoney(branch.total_balance)}</td>
                      <td>{formatPercent(branch.collection_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
