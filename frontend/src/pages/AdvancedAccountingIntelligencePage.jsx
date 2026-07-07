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

  if (cleanSeverity === "danger") {
    return {
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#991b1b",
    };
  }

  if (cleanSeverity === "warning") {
    return {
      background: "#fffbeb",
      border: "1px solid #fde68a",
      color: "#92400e",
    };
  }

  return {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
  };
}

function SummaryCard({ title, value, note, tone = "normal" }) {
  const toneColor =
    tone === "danger" ? "#991b1b" : tone === "warning" ? "#92400e" : "#0f172a";

  return (
    <div
      style={{
        border: "1px solid #d8e0ea",
        borderRadius: "10px",
        padding: "13px",
        background: "#ffffff",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 800, color: "#64748b" }}>
        {title}
      </div>
      <div
        style={{
          fontSize: "22px",
          fontWeight: 900,
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

export default function AdvancedAccountingIntelligencePage() {
  const { user, branchCode, branchName } = useAuth();

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
  const summary = intelligence?.executive_summary || {};
  const audit = intelligence?.audit || {};
  const ledger = intelligence?.management_ledger || {};
  const pnl = intelligence?.profit_and_loss || {};

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
      setError(
        getFriendlyError(error, "Failed to load accounting intelligence.")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIntelligence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Advanced Accounting Intelligence</h1>
          <p>
            High-level audit, ledger, profit, debt, stock, and branch intelligence
            for{" "}
            <strong>
              {intelligence?.scope?.selected_branch_code ||
                branchCode ||
                "STORE"}{" "}
              -{" "}
              {intelligence?.scope?.selected_branch_name ||
                branchName ||
                "Selected Store"}
            </strong>
          </p>
        </div>

        <button type="button" onClick={loadIntelligence} disabled={loading}>
          {loading ? "Loading..." : "Refresh Intelligence"}
        </button>
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
              <SummaryCard
                title="Expenses"
                value={formatMoney(summary.total_expenses)}
              />
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
                value={summary.low_stock_count || 0}
                tone={Number(summary.low_stock_count || 0) > 0 ? "warning" : "normal"}
              />
            </div>
          </div>

          <div className="section-card">
            <h2>Profit and Loss Intelligence</h2>
            <table>
              <tbody>
                <tr>
                  <th>Gross Sales</th>
                  <td>{formatMoney(pnl.gross_sales)}</td>
                </tr>
                <tr>
                  <th>Discounts</th>
                  <td>{formatMoney(pnl.discounts)}</td>
                </tr>
                <tr>
                  <th>Net Sales</th>
                  <td>{formatMoney(pnl.net_sales)}</td>
                </tr>
                <tr>
                  <th>Operating Expenses</th>
                  <td>{formatMoney(pnl.operating_expenses)}</td>
                </tr>
                <tr>
                  <th>Purchases Cost Signal</th>
                  <td>{formatMoney(pnl.purchases_cost_signal)}</td>
                </tr>
                <tr>
                  <th>Estimated Net Before Stock Cost</th>
                  <td>{formatMoney(pnl.estimated_net_before_stock_cost)}</td>
                </tr>
                <tr>
                  <th>Conservative Cash Position</th>
                  <td>{formatMoney(pnl.conservative_cash_position)}</td>
                </tr>
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
                {(ledger.rows || []).map((row) => (
                  <tr key={row.account_code}>
                    <td>{row.account_code}</td>
                    <td>{row.account_name}</td>
                    <td>{row.account_type}</td>
                    <td>{formatMoney(row.debit)}</td>
                    <td>{formatMoney(row.credit)}</td>
                    <td>{row.explanation}</td>
                  </tr>
                ))}
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
              <p>
                Active debts: <strong>{intelligence.debts?.active_debt_count || 0}</strong>
              </p>
              <p>
                Total debt balance:{" "}
                <strong>{formatMoney(intelligence.debts?.total_debt_balance)}</strong>
              </p>
              <p>
                Debt payments collected:{" "}
                <strong>{formatMoney(intelligence.debts?.debt_payments)}</strong>
              </p>

              <table>
                <thead>
                  <tr>
                    <th>Aging Bucket</th>
                    <th>Count</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(intelligence.debts?.aging || []).map((row) => (
                    <tr key={row.bucket}>
                      <td>{row.bucket}</td>
                      <td>{row.count}</td>
                      <td>{formatMoney(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="section-card">
              <h2>Stock Intelligence</h2>
              <p>
                Products: <strong>{intelligence.stock?.product_count || 0}</strong>
              </p>
              <p>
                Total quantity:{" "}
                <strong>{Number(intelligence.stock?.total_quantity || 0)}</strong>
              </p>
              <p>
                Estimated stock cost value:{" "}
                <strong>
                  {formatMoney(intelligence.stock?.estimated_stock_cost_value)}
                </strong>
              </p>
              <p>
                Estimated retail value:{" "}
                <strong>
                  {formatMoney(intelligence.stock?.estimated_stock_retail_value)}
                </strong>
              </p>
              <p>
                Negative stock products:{" "}
                <strong>{intelligence.stock?.negative_stock_count || 0}</strong>
              </p>

              <table>
                <thead>
                  <tr>
                    <th>Low Stock Item</th>
                    <th>Qty</th>
                    <th>Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {(intelligence.stock?.low_stock_items || []).slice(0, 10).map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>{item.low_stock_threshold}</td>
                    </tr>
                  ))}
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
                      {flag.severity?.toUpperCase()} | {flag.category}:{" "}
                      {flag.title}
                    </strong>
                    <p>{flag.detail}</p>
                    <p>
                      <strong>Action:</strong> {flag.recommended_action}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="section-card">
            <h2>Recommendations</h2>
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Recommendation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(intelligence.recommendations || []).map((item, index) => (
                  <tr key={`${item.title}-${index}`}>
                    <td>
                      <strong>{item.priority}</strong>
                    </td>
                    <td>{item.title}</td>
                    <td>{item.action}</td>
                  </tr>
                ))}
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
                      <td>
                        {branch.branch_code} - {branch.branch_name}
                      </td>
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
