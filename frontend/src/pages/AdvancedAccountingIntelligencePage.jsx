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

  if (
    cleanSeverity === "success" ||
    cleanSeverity === "green" ||
    cleanSeverity === "clean"
  ) {
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
    return role === "admin" || role === "manager" || role === "auditor";
  }, [user]);

  const intelligence = data?.intelligence || null;
  const scope = intelligence?.scope || {};
  const summary = intelligence?.executive_summary || {};
  const audit = intelligence?.audit || {};
  const ledger = intelligence?.management_ledger || {};
  const pnl = intelligence?.profit_and_loss || {};
  const stockAdjustments =
    intelligence?.stock_adjustments || intelligence?.stock?.stock_adjustments || {};
  const stockTransfers =
    intelligence?.stock_transfers || intelligence?.stock?.stock_transfers || {};
  const sms = intelligence?.sms || {};
  const returns = intelligence?.returns || {};
  const auditControls = intelligence?.audit_controls || {};
  const systemControls = intelligence?.system_controls || {};
  const reviewSummary = intelligence?.review_summary || {};

  const displayStoreCode =
    scope.selected_branch_code ||
    branchCode ||
    user?.selected_branch?.branch_code ||
    "STORE";

  const displayStoreName =
    scope.selected_branch_name ||
    branchName ||
    user?.selected_branch?.branch_name ||
    "Selected Store";

  const displayStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    "";

  const moneyCards = [
    {
      title: "Sales",
      value: formatMoney(summary.total_sales),
      note: "Total sales for selected period",
      icon: "📈",
    },
    {
      title: "Paid",
      value: formatMoney(summary.total_paid),
      note: "Collected money",
      icon: "💰",
    },
    {
      title: "Refunds",
      value: formatMoney(summary.total_refunds),
      note: "Executed returns/refunds reduce net sales",
      icon: "↩️",
      tone: Number(summary.total_refunds || 0) > 0 ? "warning" : "normal",
    },
    {
      title: "Balance",
      value: formatMoney(summary.total_balance),
      note: "Unpaid sales balance",
      icon: "🧾",
      tone: Number(summary.total_balance || 0) > 0 ? "warning" : "normal",
    },
    {
      title: "Expenses",
      value: formatMoney(summary.total_expenses),
      note: "Operating cost signal",
      icon: "📉",
    },
    {
      title: "Debt Balance",
      value: formatMoney(summary.total_debt_balance),
      note: "Customer debt exposure",
      icon: "💳",
      tone: Number(summary.total_debt_balance || 0) > 0 ? "warning" : "normal",
    },
    {
      title: "Net After Refunds Before Stock Cost",
      value: formatMoney(summary.estimated_net_before_stock_cost),
      note: "Sales less discounts, refunds and operating expenses",
      icon: "🧮",
    },
  ];

  const controlCards = [
    {
      title: "Low Stock",
      value: formatNumber(summary.low_stock_count),
      note: "Restock pressure",
      icon: "📦",
      tone: Number(summary.low_stock_count || 0) > 0 ? "warning" : "normal",
    },
    {
      title: "Stock Adjustments",
      value: formatNumber(summary.stock_adjustment_count),
      note: "Manual stock movements",
      icon: "🛠️",
      tone:
        Number(summary.stock_adjustment_count || 0) > 0 ? "warning" : "normal",
    },
    {
      title: "Stock Transfers",
      value: formatNumber(summary.stock_transfer_count),
      note: "Store-to-store movement",
      icon: "🚚",
    },
    {
      title: "Failed SMS",
      value: formatNumber(summary.failed_sms_count),
      note: "Communication risk",
      icon: "📩",
      tone: Number(summary.failed_sms_count || 0) > 0 ? "warning" : "normal",
    },
    {
      title: "System Events",
      value: formatNumber(summary.sensitive_system_event_count),
      note: "Restore / clear-data events",
      icon: "🛡️",
      tone:
        Number(summary.sensitive_system_event_count || 0) > 0
          ? "danger"
          : "normal",
    },
  ];

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

      const response = await axiosClient.get(
        "/accounting-intelligence/overview",
        {
          params,
        }
      );

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
    // Load once when page opens. Use Run Analysis after changing filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="advanced-mobile-safe" style={styles.page}>
      <style>{`
        @media (max-width: 760px) {
          .advanced-mobile-safe {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            overflow-x: hidden !important;
            padding-bottom: 28px !important;
            box-sizing: border-box !important;
          }

          .advanced-mobile-safe *,
          .advanced-mobile-safe *::before,
          .advanced-mobile-safe *::after {
            box-sizing: border-box !important;
          }

          .advanced-mobile-safe section,
          .advanced-mobile-safe div {
            max-width: 100% !important;
          }

          .advanced-mobile-safe [style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }

          .advanced-mobile-safe [style*="min-width"] {
            min-width: 0 !important;
          }

          .advanced-mobile-safe [style*="display: flex"] {
            flex-direction: column !important;
            align-items: stretch !important;
          }

          .advanced-mobile-safe [style*="justify-content: space-between"] {
            justify-content: flex-start !important;
          }

          .advanced-mobile-safe [style*="padding: 28px"] {
            padding: 18px !important;
          }

          .advanced-mobile-safe [style*="padding: 20px"] {
            padding: 15px !important;
          }

          .advanced-mobile-safe [style*="padding: 18px"] {
            padding: 14px !important;
          }

          .advanced-mobile-safe [style*="border-radius: 30px"],
          .advanced-mobile-safe [style*="border-radius: 26px"],
          .advanced-mobile-safe [style*="border-radius: 22px"] {
            border-radius: 18px !important;
          }

          .advanced-mobile-safe h1 {
            font-size: 30px !important;
            line-height: 1.05 !important;
            overflow-wrap: anywhere !important;
          }

          .advanced-mobile-safe h2 {
            font-size: 21px !important;
            line-height: 1.15 !important;
            overflow-wrap: anywhere !important;
          }

          .advanced-mobile-safe h3,
          .advanced-mobile-safe p,
          .advanced-mobile-safe span,
          .advanced-mobile-safe strong,
          .advanced-mobile-safe small,
          .advanced-mobile-safe td,
          .advanced-mobile-safe th {
            overflow-wrap: anywhere !important;
          }

          .advanced-mobile-safe input,
          .advanced-mobile-safe select,
          .advanced-mobile-safe button {
            width: 100% !important;
            max-width: 100% !important;
            min-height: 44px !important;
            font-size: 16px !important;
          }

          .advanced-mobile-safe button {
            white-space: normal !important;
          }

          .advanced-mobile-safe table {
            min-width: 760px !important;
            width: max-content !important;
            font-size: 12px !important;
          }

          .advanced-mobile-safe th,
          .advanced-mobile-safe td {
            padding: 10px 9px !important;
            white-space: nowrap !important;
          }

          .advanced-mobile-safe [style*="overflow-x: auto"] {
            width: 100% !important;
            max-width: 100% !important;
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
          }

          .advanced-mobile-safe [style*="width: 280px"],
          .advanced-mobile-safe [style*="width: 220px"] {
            width: 110px !important;
            height: 110px !important;
            opacity: 0.38 !important;
          }

          .advanced-mobile-safe [style*="width: 122px"] {
            width: 100% !important;
            height: auto !important;
            justify-items: start !important;
          }

          .advanced-mobile-safe [style*="width: 112px"] {
            width: 86px !important;
            height: 86px !important;
          }

          .advanced-mobile-safe [style*="width: 46px"] {
            width: 40px !important;
            height: 40px !important;
          }
        }
      `}</style>
      <section style={styles.hero}>
        <div style={styles.orbitOne} />
        <div style={styles.orbitTwo} />

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>
              Finance Observatory • {displayStoreCode}
            </p>

            <h1 style={styles.heroTitle}>Advanced Accounting Intelligence</h1>

            <p style={styles.heroSubtitle}>
              High-level audit, ledger, profit, debt, stock, SMS,
              system-control and branch intelligence for{" "}
              <strong>
                {displayStoreCode} - {displayStoreName}
              </strong>
              . This page is designed like a management intelligence observatory.
            </p>
          </div>

          <div style={styles.auditRadar}>
            <span>Audit Score</span>
            <strong>{summary.audit_score || 0}/100</strong>
            <small>{summary.audit_status || "needs_review"}</small>
          </div>
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🔭</span>
        <div>
          <strong>
            Scope: {displayStoreCode} — {displayStoreName}
          </strong>
          {displayStoreLocation ? <p>{displayStoreLocation}</p> : null}
          <p>
            This page reviews sales, debts, expenses, purchases, returns, stock
            adjustments, stock transfers, SMS logs, backup/restore activity,
            maintenance activity, audit unlocks and sign-off controls.
          </p>
        </div>
      </div>

      {notice && <div className="success-box">{notice}</div>}
      {error && <div className="error-box">{error}</div>}

      <section style={styles.controlPanel}>
        <div>
          <p style={styles.eyebrowDark}>Analysis Console</p>
          <h2 style={styles.panelTitle}>Control Panel</h2>
          <p style={styles.panelText}>
            Select the date range and scope, then run the intelligence analysis.
          </p>
        </div>

        <div style={styles.controlGrid}>
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
              {loading ? "Analyzing..." : "Run Analysis"}
            </button>
          </div>
        </div>
      </section>

      {!intelligence ? (
        <section style={styles.emptyPanel}>
          <span>🧠</span>
          <h2>{loading ? "Loading intelligence..." : "No intelligence loaded yet."}</h2>
          <p>
            Run analysis to load accounting intelligence for the selected store
            and date range.
          </p>
        </section>
      ) : (
        <>
          <section style={styles.executivePanel}>
            <div>
              <p style={styles.eyebrowDark}>Executive Intelligence</p>
              <h2 style={styles.panelTitle}>Financial Command Snapshot</h2>
              <p style={styles.panelText}>
                The most important money, debt, stock, SMS and system-risk
                signals for management.
              </p>
            </div>

            <div style={styles.scoreCircleWrap}>
              <div
                style={{
                  ...styles.scoreCircle,
                  background: `conic-gradient(${getScoreColor(
                    Number(summary.audit_score || 0)
                  )} 0deg ${Number(summary.audit_score || 0) * 3.6}deg, #e2e8f0 ${
                    Number(summary.audit_score || 0) * 3.6
                  }deg 360deg)`,
                }}
              >
                <span>{summary.audit_score || 0}</span>
              </div>
            </div>
          </section>

          <div style={styles.cardGrid}>
            {moneyCards.map((card) => (
              <IntelligenceCard key={card.title} {...card} />
            ))}
          </div>

          <div style={styles.controlCardGrid}>
            {controlCards.map((card) => (
              <IntelligenceCard key={card.title} {...card} />
            ))}
          </div>

          <section style={styles.panel}>
            <SectionHeader
              eyebrow="Audit Review"
              title="Audit Review Checklist"
              note={
                reviewSummary.stock_movement_ledger_note ||
                "Stock Movement Ledger is protected by reviewing its source records: sales, purchases, returns, stock adjustments and stock transfers."
              }
            />

            <div style={styles.tableWrap}>
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
                    <EmptyRow
                      colSpan={4}
                      message="No review checklist returned from backend."
                    />
                  ) : (
                    reviewSummary.checklist.map((item) => (
                      <tr key={item.key || item.label}>
                        <td>
                          <strong>{item.label}</strong>
                        </td>
                        <td>
                          <StatusBadge status={item.status}>
                            {formatStatus(item.status)}
                          </StatusBadge>
                        </td>
                        <td>{formatNumber(item.count)}</td>
                        <td>{item.note || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={styles.dualGrid}>
            <div style={styles.panel}>
              <SectionHeader
                eyebrow="P&L Intelligence"
                title="Profit and Loss Intelligence"
                note={pnl.warning}
              />

              <InfoRows
                rows={[
                  ["Gross Sales", formatMoney(pnl.gross_sales)],
                  ["Discounts", formatMoney(pnl.discounts)],
                  ["Net Sales", formatMoney(pnl.net_sales)],
                  ["Operating Expenses", formatMoney(pnl.operating_expenses)],
                  [
                    "Purchases Cost Signal",
                    formatMoney(pnl.purchases_cost_signal),
                  ],
                  [
                    "Estimated Net Before Stock Cost",
                    formatMoney(pnl.estimated_net_before_stock_cost),
                  ],
                  [
                    "Conservative Cash Position",
                    formatMoney(pnl.conservative_cash_position),
                  ],
                ]}
              />
            </div>

            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Management Ledger"
                title="Ledger Balance"
                note={ledger.note}
              />

              <div style={styles.tableWrap}>
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
                      <EmptyRow
                        colSpan={6}
                        message="No management ledger rows returned."
                      />
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
            </div>
          </section>

          <section style={styles.dualGrid}>
            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Debt Radar"
                title="Debt Intelligence"
                note="Customer balance and payment collection signals."
              />

              <div style={styles.miniGrid}>
                <MiniCard
                  title="Active Debts"
                  value={formatNumber(intelligence.debts?.active_debt_count)}
                />
                <MiniCard
                  title="Debt Balance"
                  value={formatMoney(intelligence.debts?.total_debt_balance)}
                  warning={Number(intelligence.debts?.total_debt_balance || 0) > 0}
                />
                <MiniCard
                  title="Payments"
                  value={formatMoney(intelligence.debts?.debt_payments)}
                />
              </div>

              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Aging Bucket</th>
                      <th>Count</th>
                      <th>Total</th>
                    </tr>
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
            </div>

            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Stock Radar"
                title="Stock Intelligence"
                note="Stock quantity, value and low-stock risk."
              />

              <div style={styles.miniGrid}>
                <MiniCard
                  title="Products"
                  value={formatNumber(intelligence.stock?.product_count)}
                />
                <MiniCard
                  title="Total Quantity"
                  value={formatNumber(intelligence.stock?.total_quantity)}
                />
                <MiniCard
                  title="Cost Value"
                  value={formatMoney(intelligence.stock?.estimated_stock_cost_value)}
                />
                <MiniCard
                  title="Retail Value"
                  value={formatMoney(intelligence.stock?.estimated_stock_retail_value)}
                />
                <MiniCard
                  title="Negative Stock"
                  value={formatNumber(intelligence.stock?.negative_stock_count)}
                  danger={Number(intelligence.stock?.negative_stock_count || 0) > 0}
                />
              </div>

              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Low Stock Item</th>
                      <th>Qty</th>
                      <th>Threshold</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(intelligence.stock?.low_stock_items || []).length === 0 ? (
                      <EmptyRow colSpan={3} message="No low-stock rows found." />
                    ) : (
                      (intelligence.stock?.low_stock_items || [])
                        .slice(0, 10)
                        .map((item) => (
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
          </section>

          <section style={styles.dualGrid}>
            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Stock Correction"
                title="Stock Adjustment Intelligence"
                note="Manual stock correction and damage/loss monitoring."
              />

              <div style={styles.miniGrid}>
                <MiniCard
                  title="Adjustments"
                  value={formatNumber(stockAdjustments.adjustment_count)}
                />
                <MiniCard
                  title="Increases"
                  value={formatNumber(stockAdjustments.increase_count)}
                />
                <MiniCard
                  title="Decreases"
                  value={formatNumber(stockAdjustments.decrease_count)}
                  warning={Number(stockAdjustments.decrease_count || 0) > 0}
                />
                <MiniCard
                  title="Set Stock"
                  value={formatNumber(stockAdjustments.set_count)}
                  warning={Number(stockAdjustments.set_count || 0) > 0}
                />
                <MiniCard
                  title="Damaged"
                  value={formatNumber(stockAdjustments.damaged_count)}
                  warning={Number(stockAdjustments.damaged_count || 0) > 0}
                />
                <MiniCard
                  title="Lost"
                  value={formatNumber(stockAdjustments.lost_count)}
                  danger={Number(stockAdjustments.lost_count || 0) > 0}
                />
              </div>

              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Reason</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(stockAdjustments.recent_adjustments || []).length === 0 ? (
                      <EmptyRow
                        colSpan={5}
                        message="No recent stock adjustment records found."
                      />
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
            </div>

            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Transfer Control"
                title="Stock Transfer Intelligence"
                note="Store-to-store transfer movement and mismatch monitoring."
              />

              <div style={styles.miniGrid}>
                <MiniCard
                  title="Transfers"
                  value={formatNumber(stockTransfers.transfer_count)}
                />
                <MiniCard title="Out" value={formatNumber(stockTransfers.transfer_out_count)} />
                <MiniCard title="In" value={formatNumber(stockTransfers.transfer_in_count)} />
                <MiniCard
                  title="Dispatched"
                  value={formatNumber(stockTransfers.dispatched_count)}
                />
                <MiniCard
                  title="Received"
                  value={formatNumber(stockTransfers.received_count)}
                />
                <MiniCard
                  title="Mismatch Items"
                  value={formatNumber(stockTransfers.quantity_mismatch_count)}
                  danger={Number(stockTransfers.quantity_mismatch_count || 0) > 0}
                />
              </div>

              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reference</th>
                      <th>Status</th>
                      <th>Direction</th>
                      <th>From</th>
                      <th>To</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(stockTransfers.recent_transfers || []).length === 0 ? (
                      <EmptyRow
                        colSpan={6}
                        message="No recent stock transfers found."
                      />
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
          </section>

          <section style={styles.dualGrid}>
            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Communications"
                title="SMS Intelligence"
                note="Message delivery and failed SMS monitoring."
              />

              <div style={styles.miniGrid}>
                <MiniCard title="SMS Total" value={formatNumber(sms.sms_count)} />
                <MiniCard title="Sent" value={formatNumber(sms.sent_count)} />
                <MiniCard
                  title="Failed"
                  value={formatNumber(sms.failed_count)}
                  warning={Number(sms.failed_count || 0) > 0}
                />
                <MiniCard title="Pending" value={formatNumber(sms.pending_count)} />
                <MiniCard title="Success Rate" value={formatPercent(sms.success_rate)} />
              </div>

              <h3>SMS by Type</h3>
              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Count</th>
                    </tr>
                  </thead>
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
              </div>

              <h3>Recent Failed SMS</h3>
              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Phone</th>
                      <th>Type</th>
                      <th>Error</th>
                    </tr>
                  </thead>
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
            </div>

            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Returns"
                title="Returns Intelligence"
                note="Returned item quantity, amount and reasons."
              />

              <div style={styles.miniGrid}>
                <MiniCard title="Return Count" value={formatNumber(returns.return_count)} />
                <MiniCard
                  title="Return Qty"
                  value={formatNumber(returns.total_return_quantity)}
                />
                <MiniCard
                  title="Return Amount"
                  value={formatMoney(returns.total_return_amount)}
                  warning={Number(returns.total_return_amount || 0) > 0}
                />
              </div>

              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Amount</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
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
          </section>

          <section style={styles.dualGrid}>
            <div style={styles.panel}>
              <SectionHeader
                eyebrow="Audit Locks"
                title="Audit Control Intelligence"
                note="Unlock requests, sign-offs and reapproval records."
              />

              <div style={styles.miniGrid}>
                <MiniCard
                  title="Unlock Requests"
                  value={formatNumber(
                    auditControls.unlock_requests?.request_count
                  )}
                />
                <MiniCard
                  title="Pending Unlocks"
                  value={formatNumber(
                    auditControls.unlock_requests?.pending_count
                  )}
                  warning={
                    Number(auditControls.unlock_requests?.pending_count || 0) > 0
                  }
                />
                <MiniCard
                  title="Approved Unlocks"
                  value={formatNumber(
                    auditControls.unlock_requests?.approved_count
                  )}
                />
                <MiniCard
                  title="Sign-Off Records"
                  value={formatNumber(auditControls.signoffs?.signoff_count)}
                />
                <MiniCard
                  title="Approved Sign-Offs"
                  value={formatNumber(auditControls.signoffs?.approved_count)}
                />
                <MiniCard
                  title="Reapprovals"
                  value={formatNumber(
                    auditControls.reapprovals?.reapproval_count
                  )}
                />
              </div>
            </div>

            <div style={styles.panel}>
              <SectionHeader
                eyebrow="System Controls"
                title="Backup, Restore & Maintenance Intelligence"
                note="Sensitive system actions that management must review."
              />

              <div style={styles.miniGrid}>
                <MiniCard
                  title="Activity"
                  value={formatNumber(systemControls.activity_count)}
                />
                <MiniCard
                  title="Backups"
                  value={formatNumber(systemControls.backup_download_count)}
                />
                <MiniCard
                  title="Restores"
                  value={formatNumber(systemControls.restore_count)}
                  danger={Number(systemControls.restore_count || 0) > 0}
                />
                <MiniCard
                  title="Clear Data"
                  value={formatNumber(
                    systemControls.clear_business_data_count
                  )}
                  danger={
                    Number(systemControls.clear_business_data_count || 0) > 0
                  }
                />
              </div>

              <div style={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Details</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(systemControls.recent_sensitive_activity || []).length ===
                    0 ? (
                      <EmptyRow
                        colSpan={3}
                        message="No recent sensitive system activity found."
                      />
                    ) : (
                      (systemControls.recent_sensitive_activity || []).map(
                        (item) => (
                          <tr key={item.id}>
                            <td>{formatDateTime(item.created_at)}</td>
                            <td>{item.action || "-"}</td>
                            <td>{item.details || "-"}</td>
                          </tr>
                        )
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section style={styles.panel}>
            <SectionHeader
              eyebrow="Audit Flags"
              title="Risk Flags"
              note={`Audit Status: ${audit.audit_status || "-"} | Score: ${
                audit.audit_score || 0
              }/100`}
            />

            {(audit.flags || []).length === 0 ? (
              <div style={styles.emptyState}>No major audit flags found for this period.</div>
            ) : (
              <div style={styles.flagGrid}>
                {(audit.flags || []).map((flag, index) => (
                  <div
                    key={`${flag.category}-${flag.title}-${index}`}
                    style={{
                      ...styles.flagCard,
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
          </section>

          <section style={styles.panel}>
            <SectionHeader
              eyebrow="Management Action"
              title="Recommendations"
              note="Recommended next steps from the accounting intelligence engine."
            />

            <div style={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Recommendation</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {(intelligence.recommendations || []).length === 0 ? (
                    <EmptyRow colSpan={3} message="No recommendations returned." />
                  ) : (
                    (intelligence.recommendations || []).map((item, index) => (
                      <tr key={`${item.title}-${index}`}>
                        <td>
                          <strong>{item.priority}</strong>
                        </td>
                        <td>{item.title}</td>
                        <td>{item.action}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {intelligence.branch_comparison?.length > 0 && (
            <section style={styles.panel}>
              <SectionHeader
                eyebrow="Two-Store Comparison"
                title="Branch Comparison"
                note="Compare performance across branches when all-store scope is selected."
              />

              <div style={styles.tableWrap}>
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
            </section>
          )}
        </>
      )}
    </div>
  );
}

function IntelligenceCard({ title, value, note, icon, tone = "normal" }) {
  const toneStyle =
    tone === "danger"
      ? styles.dangerTone
      : tone === "warning"
      ? styles.warningTone
      : styles.normalTone;

  return (
    <div style={{ ...styles.intelligenceCard, ...toneStyle }}>
      <span style={styles.cardIcon}>{icon}</span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        {note ? <small>{note}</small> : null}
      </div>
    </div>
  );
}

function MiniCard({ title, value, warning, danger }) {
  return (
    <div
      style={{
        ...styles.miniCard,
        ...(danger ? styles.miniDanger : warning ? styles.miniWarning : {}),
      }}
    >
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionHeader({ eyebrow, title, note }) {
  return (
    <div style={styles.sectionHeader}>
      <div>
        <p style={styles.eyebrowDark}>{eyebrow}</p>
        <h2 style={styles.panelTitle}>{title}</h2>
        {note ? <p style={styles.panelText}>{note}</p> : null}
      </div>
    </div>
  );
}

function InfoRows({ rows }) {
  return (
    <div style={styles.infoRows}>
      {rows.map(([label, value]) => (
        <div key={label} style={styles.infoRow}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1720px",
    margin: "0 auto",
    paddingBottom: "44px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "30px",
    padding: "28px",
    marginBottom: "18px",
    background:
      "linear-gradient(135deg, #020617 0%, #1e1b4b 44%, #164e63 100%)",
    color: "#ffffff",
    boxShadow: "0 26px 70px rgba(30, 27, 75, 0.28)",
  },

  orbitOne: {
    position: "absolute",
    width: "280px",
    height: "280px",
    right: "-90px",
    top: "-90px",
    borderRadius: "50%",
    background: "rgba(34, 211, 238, 0.24)",
    filter: "blur(16px)",
  },

  orbitTwo: {
    position: "absolute",
    width: "220px",
    height: "220px",
    left: "35%",
    bottom: "-120px",
    borderRadius: "50%",
    background: "rgba(224, 186, 40, 0.28)",
    filter: "blur(18px)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },

  eyebrow: {
    margin: 0,
    color: "#67e8f9",
    fontSize: "12px",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.09em",
  },

  eyebrowDark: {
    margin: 0,
    color: "#0891b2",
    fontSize: "11px",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  heroTitle: {
    margin: "7px 0 0",
    fontSize: "clamp(30px, 4vw, 52px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "880px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  auditRadar: {
    minWidth: "180px",
    minHeight: "150px",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: "18px",
    borderRadius: "30px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #ecfeff, #ffffff)",
    border: "1px solid #a5f3fc",
    color: "#155e75",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  controlPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 0.55fr) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "end",
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    marginBottom: "18px",
  },

  controlGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelText: {
    margin: "6px 0 0",
    color: "#64748b",
    fontSize: "13px",
    fontWeight: "700",
    lineHeight: 1.55,
  },

  emptyPanel: {
    minHeight: "340px",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    background: "#ffffff",
    borderRadius: "26px",
    padding: "30px",
    border: "1px dashed #cbd5e1",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    color: "#64748b",
  },

  executivePanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap",
    background:
      "linear-gradient(135deg, rgba(236,254,255,0.98), rgba(255,255,255,0.98))",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid #a5f3fc",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    marginBottom: "18px",
  },

  scoreCircleWrap: {
    width: "122px",
    height: "122px",
    display: "grid",
    placeItems: "center",
  },

  scoreCircle: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontWeight: "950",
    color: "#0f172a",
    background: "#e2e8f0",
  },

  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "14px",
    marginBottom: "14px",
  },

  controlCardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  intelligenceCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "22px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.07)",
    minWidth: 0,
  },

  cardIcon: {
    width: "46px",
    height: "46px",
    borderRadius: "16px",
    display: "grid",
    placeItems: "center",
    background: "#ecfeff",
    color: "#155e75",
    fontSize: "21px",
    flexShrink: 0,
  },

  normalTone: {
    color: "#0f172a",
  },

  warningTone: {
    borderColor: "#fde68a",
    background: "linear-gradient(135deg, #fffbeb, #ffffff)",
    color: "#92400e",
  },

  dangerTone: {
    borderColor: "#fecaca",
    background: "linear-gradient(135deg, #fef2f2, #ffffff)",
    color: "#991b1b",
  },

  panel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
    marginBottom: "18px",
  },

  sectionHeader: {
    marginBottom: "14px",
  },

  dualGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "18px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  miniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "10px",
    marginBottom: "12px",
  },

  miniCard: {
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  miniWarning: {
    background: "#fffbeb",
    borderColor: "#fde68a",
    color: "#92400e",
  },

  miniDanger: {
    background: "#fef2f2",
    borderColor: "#fecaca",
    color: "#991b1b",
  },

  infoRows: {
    display: "grid",
    gap: "9px",
  },

  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  flagGrid: {
    display: "grid",
    gap: "10px",
  },

  flagCard: {
    borderRadius: "14px",
    padding: "12px",
  },

  emptyState: {
    padding: "18px",
    borderRadius: "16px",
    background: "#f8fafc",
    color: "#64748b",
    border: "1px dashed #cbd5e1",
    textAlign: "center",
    fontWeight: "800",
  },
};
