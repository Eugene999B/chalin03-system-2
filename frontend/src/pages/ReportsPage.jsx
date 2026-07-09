import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ReportsPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();

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

  const [summary, setSummary] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState([]);
  const [lowStockProducts, setLowStockProducts] = useState([]);

  const [stockTransferSummary, setStockTransferSummary] = useState(null);
  const [stockAdjustmentSummary, setStockAdjustmentSummary] = useState(null);
  const [recentStockTransfers, setRecentStockTransfers] = useState([]);
  const [recentStockAdjustments, setRecentStockAdjustments] = useState([]);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadReports(customFilters = null) {
    setError("");
    setLoading(true);

    const filters = customFilters || {
      from,
      to,
    };

    try {
      const [summaryRes, lowStockRes] = await Promise.all([
        axiosClient.get("/reports/summary", {
          params: filters,
        }),
        axiosClient.get("/reports/low-stock"),
      ]);

      setSummary(summaryRes.data.summary);
      setTopProducts(summaryRes.data.top_products || []);
      setPaymentBreakdown(summaryRes.data.payment_breakdown || []);
      setLowStockProducts(lowStockRes.data.products || []);

      setStockTransferSummary(summaryRes.data.stock_transfer_summary || null);
      setStockAdjustmentSummary(
        summaryRes.data.stock_adjustment_summary || null
      );
      setRecentStockTransfers(summaryRes.data.recent_stock_transfers || []);
      setRecentStockAdjustments(summaryRes.data.recent_stock_adjustments || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports({
      from: "",
      to: "",
    });
    // Reload reports when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatCompactMoney(value) {
    const number = Number(value || 0);

    if (number >= 1000000) {
      return `GHS ${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
      return `GHS ${(number / 1000).toFixed(1)}K`;
    }

    return formatMoney(number);
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
    return String(value || "-").replaceAll("_", " ").toUpperCase();
  }

  function formatPaymentMethod(value) {
    const methods = {
      cash: "Cash",
      momo: "MoMo",
      bank: "Bank",
      credit: "Credit",
      mixed: "Mixed",
    };

    return methods[String(value || "").toLowerCase()] || value || "-";
  }

  function formatAdjustmentType(value) {
    const types = {
      increase: "Increase",
      decrease: "Decrease",
      set: "Set Stock",
    };

    return types[String(value || "").toLowerCase()] || value || "-";
  }

  function getTransferDirection(transfer) {
    if (Number(transfer?.from_branch_id) === Number(branchId)) {
      return "OUT";
    }

    if (Number(transfer?.to_branch_id) === Number(branchId)) {
      return "IN";
    }

    return "-";
  }

  function clearFilters() {
    setFrom("");
    setTo("");

    loadReports({
      from: "",
      to: "",
    });
  }

  const totalBeforeDiscount =
    summary?.total_before_discount ??
    summary?.total_subtotal_amount ??
    summary?.total_subtotal ??
    0;

  const totalDiscount =
    summary?.total_discount_amount ?? summary?.total_discount ?? 0;

  const managementScore = useMemo(() => {
    const netProfit = Number(summary?.net_profit || 0);
    const outstandingDebts = Number(summary?.outstanding_debts || 0);
    const lowStockCount = Number(summary?.low_stock_count || 0);
    const damagedLost =
      Number(stockAdjustmentSummary?.damaged_count || 0) +
      Number(stockAdjustmentSummary?.lost_count || 0);

    let score = 70;

    if (netProfit > 0) score += 15;
    if (netProfit < 0) score -= 18;
    if (outstandingDebts > 0) score -= Math.min(18, outstandingDebts / 1000);
    if (lowStockCount > 0) score -= Math.min(12, lowStockCount);
    if (damagedLost > 0) score -= Math.min(10, damagedLost * 2);

    const cleanScore = Math.max(0, Math.min(100, Math.round(score)));

    if (cleanScore >= 80) {
      return {
        value: cleanScore,
        label: "Healthy",
        note: "Store looks strong for this report period.",
      };
    }

    if (cleanScore >= 55) {
      return {
        value: cleanScore,
        label: "Watch",
        note: "Review debts, expenses, low stock and adjustments.",
      };
    }

    return {
      value: cleanScore,
      label: "Needs Attention",
      note: "Management should review this store carefully.",
    };
  }, [summary, stockAdjustmentSummary]);

  const moneyFlow = [
    {
      label: "Before Discount",
      value: totalBeforeDiscount,
      note: "Sales value before discounts",
    },
    {
      label: "Discount",
      value: totalDiscount,
      note: "Total discount given",
    },
    {
      label: "Total Sales",
      value: summary?.total_sales_amount,
      note: "Sales after discount",
    },
    {
      label: "Gross Profit",
      value: summary?.gross_profit,
      note: "Profit before expenses",
    },
    {
      label: "Expenses",
      value: summary?.total_expenses,
      note: "Store costs",
    },
    {
      label: "Net Profit",
      value: summary?.net_profit,
      note: "Final profit",
    },
  ];

  const cashPosition = [
    {
      label: "Amount Paid",
      value: summary?.total_amount_paid,
      note: "Money received on sales",
    },
    {
      label: "Sales Balance",
      value: summary?.total_sales_balance,
      note: "Unpaid balance on sales",
    },
    {
      label: "Outstanding Debts",
      value: summary?.outstanding_debts,
      note: "Debt balance still owed",
    },
  ];

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroPattern} />

        <div style={styles.heroContent}>
          <div>
            <p style={styles.eyebrow}>Management Report Room • {currentStoreCode}</p>

            <h1 style={styles.heroTitle}>Reports</h1>

            <p style={styles.heroSubtitle}>
              Review sales, discounts, profit, debts, stock adjustments,
              transfers, top products and low-stock risks for{" "}
              <strong>{currentStoreName}</strong>
              {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}.
              This page is designed as a boardroom-style management report.
            </p>
          </div>

          <div style={styles.scoreCard}>
            <span>📊</span>
            <div>
              <strong>{managementScore.value}%</strong>
              <small>{managementScore.label}</small>
            </div>
          </div>
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🏬</span>
        <div>
          <strong>
            Current selected store: {currentStoreCode} — {currentStoreName}
          </strong>
          {currentStoreLocation ? <p>{currentStoreLocation}</p> : null}
          <p>
            Sales summary, profit, debts, payment breakdown, top products,
            low-stock reports, stock adjustments and stock transfers are
            filtered to this selected store only.
          </p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <section style={styles.filterPanel}>
        <div>
          <p style={styles.eyebrowDark}>Report Period</p>
          <h2 style={styles.panelTitle}>Date Filter</h2>
          <p style={styles.panelSubtitle}>
            Use this filter to review a specific date range, or clear it to see
            all available report data.
          </p>
        </div>

        <div style={styles.filterGrid}>
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

          <div style={styles.filterActions}>
            <button type="button" onClick={() => loadReports()} disabled={loading}>
              {loading ? "Loading..." : "Apply Filter"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={clearFilters}
              disabled={loading}
            >
              Clear
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => loadReports()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>
      </section>

      <div style={styles.executiveGrid}>
        <section style={styles.healthPanel}>
          <div>
            <p style={styles.eyebrowDark}>Management Health</p>
            <h2>{managementScore.label}</h2>
            <p>{managementScore.note}</p>
          </div>

          <div style={styles.scoreRingWrap}>
            <div
              style={{
                ...styles.scoreRing,
                background: `conic-gradient(#e0ba28 0deg ${
                  managementScore.value * 3.6
                }deg, rgba(255,255,255,0.22) ${
                  managementScore.value * 3.6
                }deg 360deg)`,
              }}
            >
              <span>{managementScore.value}%</span>
            </div>
          </div>
        </section>

        <section style={styles.moneyFlowPanel}>
          <p style={styles.eyebrowDark}>Money Flow</p>
          <h2>Profit Pipeline</h2>

          <div style={styles.pipeline}>
            {moneyFlow.map((item) => (
              <div key={item.label} style={styles.pipelineStep}>
                <span>{item.label}</span>
                <strong>{formatMoney(item.value)}</strong>
                <small>{item.note}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div style={styles.kpiGrid}>
        {cashPosition.map((item) => (
          <KpiCard
            key={item.label}
            label={item.label}
            value={formatMoney(item.value)}
            note={item.note}
            icon={item.label === "Outstanding Debts" ? "⚠️" : "💵"}
          />
        ))}

        <KpiCard
          label="Low Stock Items"
          value={formatNumber(summary?.low_stock_count || lowStockProducts.length)}
          note="Products needing restock"
          icon="📦"
        />

        <KpiCard
          label="Transfers Out"
          value={formatNumber(stockTransferSummary?.transfer_out_count)}
          note="Transfer records leaving this store"
          icon="↗️"
        />

        <KpiCard
          label="Transfers In"
          value={formatNumber(stockTransferSummary?.transfer_in_count)}
          note="Transfer records entering this store"
          icon="↘️"
        />

        <KpiCard
          label="Stock Adjustments"
          value={formatNumber(stockAdjustmentSummary?.total_adjustment_count)}
          note="Manual stock correction records"
          icon="🛠️"
        />

        <KpiCard
          label="Damaged / Lost"
          value={formatNumber(
            Number(stockAdjustmentSummary?.damaged_count || 0) +
              Number(stockAdjustmentSummary?.lost_count || 0)
          )}
          note="Risk records requiring review"
          icon="🚨"
        />
      </div>

      <div style={styles.analysisGrid}>
        <section style={styles.panel}>
          <SectionTitle
            eyebrow="Sales Performance"
            title={`Top Products - ${currentStoreCode}`}
            count={topProducts.length}
          />

          {topProducts.length === 0 ? (
            <EmptyLine text={`No product sales found for ${currentStoreCode}.`} />
          ) : (
            <div style={styles.rankList}>
              {topProducts.map((product, index) => (
                <div key={product.product_id} style={styles.rankItem}>
                  <span style={styles.rankNumber}>{index + 1}</span>

                  <div>
                    <strong>{product.product_name}</strong>
                    <small>Qty sold: {formatNumber(product.quantity_sold)}</small>
                  </div>

                  <b>{formatMoney(product.revenue)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={styles.panel}>
          <SectionTitle
            eyebrow="Payment Intelligence"
            title={`Payment Breakdown - ${currentStoreCode}`}
            count={paymentBreakdown.length}
          />

          {paymentBreakdown.length === 0 ? (
            <EmptyLine text={`No payment records found for ${currentStoreCode}.`} />
          ) : (
            <div style={styles.paymentGrid}>
              {paymentBreakdown.map((payment) => (
                <div key={payment.payment_type} style={styles.paymentCard}>
                  <span>{formatPaymentMethod(payment.payment_type)}</span>
                  <strong>{formatMoney(payment.total)}</strong>
                  <small>{formatNumber(payment.count)} transaction(s)</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div style={styles.operationsGrid}>
        <section style={styles.panel}>
          <SectionTitle
            eyebrow="Stock Transfers"
            title={`Transfer Summary - ${currentStoreCode}`}
            count={stockTransferSummary?.total_transfer_count || 0}
          />

          <div style={styles.compactStatsGrid}>
            <MiniStat label="Total" value={stockTransferSummary?.total_transfer_count} />
            <MiniStat label="Requested" value={stockTransferSummary?.requested_count} />
            <MiniStat label="Approved" value={stockTransferSummary?.approved_count} />
            <MiniStat label="Dispatched" value={stockTransferSummary?.dispatched_count} />
            <MiniStat label="Received" value={stockTransferSummary?.received_count} />
            <MiniStat label="Cancelled" value={stockTransferSummary?.cancelled_count} />
            <MiniStat label="Rejected" value={stockTransferSummary?.rejected_count} />
            <MiniStat
              label="Qty Out"
              value={stockTransferSummary?.total_transfer_out_quantity}
            />
            <MiniStat
              label="Qty In"
              value={stockTransferSummary?.total_transfer_in_quantity}
            />
          </div>
        </section>

        <section style={styles.panel}>
          <SectionTitle
            eyebrow="Stock Adjustments"
            title={`Adjustment Summary - ${currentStoreCode}`}
            count={stockAdjustmentSummary?.total_adjustment_count || 0}
          />

          <div style={styles.compactStatsGrid}>
            <MiniStat label="Total" value={stockAdjustmentSummary?.total_adjustment_count} />
            <MiniStat label="Increase" value={stockAdjustmentSummary?.increase_count} />
            <MiniStat label="Decrease" value={stockAdjustmentSummary?.decrease_count} />
            <MiniStat label="Set Stock" value={stockAdjustmentSummary?.set_count} />
            <MiniStat
              label="Qty Increased"
              value={stockAdjustmentSummary?.total_increased_quantity}
            />
            <MiniStat
              label="Qty Decreased"
              value={stockAdjustmentSummary?.total_decreased_quantity}
            />
            <MiniStat label="Damaged" value={stockAdjustmentSummary?.damaged_count} />
            <MiniStat label="Lost" value={stockAdjustmentSummary?.lost_count} />
            <MiniStat
              label="Physical Count"
              value={stockAdjustmentSummary?.physical_count_count}
            />
            <MiniStat
              label="Wrong Entry"
              value={stockAdjustmentSummary?.wrong_entry_count}
            />
          </div>
        </section>
      </div>

      <section style={styles.tablePanel}>
        <SectionTitle
          eyebrow="Movement Watch"
          title={`Recent Stock Transfers - ${currentStoreCode}`}
          count={recentStockTransfers.length}
        />

        {recentStockTransfers.length === 0 ? (
          <EmptyLine text="No stock transfer records found for this filter." />
        ) : (
          <div style={styles.transferList}>
            {recentStockTransfers.map((transfer) => (
              <article key={transfer.id} style={styles.transferCard}>
                <div>
                  <div style={styles.recordTop}>
                    <strong>{transfer.transfer_number}</strong>
                    <StatusPill label={formatStatus(transfer.status)} />
                    <DirectionPill label={getTransferDirection(transfer)} />
                  </div>

                  <p>
                    From {transfer.from_branch_code} — {transfer.from_branch_name}
                    {" "}to {transfer.to_branch_code} — {transfer.to_branch_name}
                  </p>

                  <small>{formatDateTime(transfer.created_at)}</small>
                </div>

                <div style={styles.transferNumbers}>
                  <MiniStat label="Items" value={transfer.item_count} />
                  <MiniStat
                    label="Requested"
                    value={transfer.total_requested_quantity}
                  />
                  <MiniStat
                    label="Dispatched"
                    value={transfer.total_dispatched_quantity}
                  />
                  <MiniStat
                    label="Received"
                    value={transfer.total_received_quantity}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section style={styles.tablePanel}>
        <SectionTitle
          eyebrow="Adjustment Watch"
          title={`Recent Stock Adjustments - ${currentStoreCode}`}
          count={recentStockAdjustments.length}
        />

        {recentStockAdjustments.length === 0 ? (
          <EmptyLine text="No stock adjustment records found for this filter." />
        ) : (
          <div style={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Old</th>
                  <th>New</th>
                  <th>Reason</th>
                  <th>By</th>
                </tr>
              </thead>

              <tbody>
                {recentStockAdjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td>{formatDateTime(adjustment.adjusted_at)}</td>
                    <td>
                      <strong>{adjustment.product_name || "-"}</strong>
                      <br />
                      <small>
                        {[adjustment.category, adjustment.size, adjustment.barcode]
                          .filter(Boolean)
                          .join(" • ") || "-"}
                      </small>
                    </td>
                    <td>{formatAdjustmentType(adjustment.adjustment_type)}</td>
                    <td>{formatNumber(adjustment.quantity)}</td>
                    <td>{formatNumber(adjustment.old_quantity)}</td>
                    <td>{formatNumber(adjustment.new_quantity)}</td>
                    <td>{adjustment.reason || "-"}</td>
                    <td>{adjustment.adjusted_by_name || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={styles.lowStockPanel}>
        <SectionTitle
          eyebrow="Restock Risk"
          title={`Low Stock Report - ${currentStoreCode}`}
          count={lowStockProducts.length}
        />

        {lowStockProducts.length === 0 ? (
          <EmptyLine text={`No low-stock products at the moment for ${currentStoreCode}.`} />
        ) : (
          <div style={styles.lowStockGrid}>
            {lowStockProducts.map((product) => (
              <article key={product.id} style={styles.lowStockCard}>
                <div>
                  <strong>{product.name}</strong>
                  <p>{product.category || "-"} • {product.size || "-"}</p>
                </div>

                <div style={styles.lowStockNumbers}>
                  <span>Qty: {formatNumber(product.quantity)}</span>
                  <span>Low level: {formatNumber(product.low_stock_threshold)}</span>
                  <strong>{formatMoney(product.selling_price)}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, note, icon }) {
  return (
    <div style={styles.kpiCard}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, count }) {
  return (
    <div style={styles.sectionTitle}>
      <div>
        <p style={styles.eyebrowDark}>{eyebrow}</p>
        <h2>{title}</h2>
      </div>

      <span>{count} record(s)</span>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={styles.miniStat}>
      <span>{label}</span>
      <strong>{Number(value || 0).toLocaleString()}</strong>
    </div>
  );
}

function StatusPill({ label }) {
  return <span style={styles.statusPill}>{label}</span>;
}

function DirectionPill({ label }) {
  return (
    <span
      style={{
        ...styles.directionPill,
        ...(label === "OUT" ? styles.directionOut : {}),
      }}
    >
      {label}
    </span>
  );
}

function EmptyLine({ text }) {
  return <div style={styles.emptyLine}>{text}</div>;
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
      "linear-gradient(135deg, #111827 0%, #312e81 45%, #0f172a 100%)",
    color: "#ffffff",
    boxShadow: "0 24px 70px rgba(49, 46, 129, 0.22)",
  },

  heroPattern: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at top right, rgba(224, 186, 40, 0.28), transparent 34%), radial-gradient(circle at 18% 85%, rgba(99, 102, 241, 0.30), transparent 34%)",
  },

  heroContent: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "12px",
  },

  eyebrowDark: {
    margin: 0,
    color: "#4f46e5",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontSize: "11px",
  },

  heroTitle: {
    margin: "7px 0 0",
    fontSize: "clamp(30px, 4vw, 52px)",
    lineHeight: 1.03,
    fontWeight: "950",
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "860px",
    color: "rgba(255,255,255,0.78)",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  scoreCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    minWidth: "205px",
    padding: "15px",
    borderRadius: "22px",
    background: "rgba(255, 255, 255, 0.12)",
    border: "1px solid rgba(255,255,255,0.18)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
  },

  filterPanel: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "end",
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    marginBottom: "18px",
  },

  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },

  filterActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },

  panelTitle: {
    margin: "4px 0 0",
    color: "#0f172a",
    fontSize: "22px",
    fontWeight: "950",
  },

  panelSubtitle: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  executiveGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 0.45fr) minmax(0, 1fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  healthPanel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap",
    borderRadius: "26px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #312e81 0%, #1e1b4b 58%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 20px 50px rgba(49, 46, 129, 0.22)",
  },

  scoreRingWrap: {
    width: "118px",
    height: "118px",
    display: "grid",
    placeItems: "center",
  },

  scoreRing: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    color: "#ffffff",
    fontWeight: "950",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
  },

  moneyFlowPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "20px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  pipeline: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },

  pipelineStep: {
    padding: "12px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
    marginBottom: "18px",
  },

  kpiCard: {
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

  analysisGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  operationsGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  panel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
  },

  sectionTitle: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "14px",
  },

  rankList: {
    display: "grid",
    gap: "10px",
  },

  rankItem: {
    display: "grid",
    gridTemplateColumns: "42px minmax(0, 1fr) auto",
    gap: "12px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  rankNumber: {
    width: "34px",
    height: "34px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    background: "#312e81",
    color: "#ffffff",
    fontWeight: "950",
  },

  paymentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
  },

  paymentCard: {
    padding: "14px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  compactStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "10px",
  },

  miniStat: {
    padding: "10px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  tablePanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
    minWidth: 0,
    marginBottom: "18px",
  },

  transferList: {
    display: "grid",
    gap: "12px",
  },

  transferCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.7fr)",
    gap: "14px",
    padding: "14px",
    borderRadius: "20px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  transferNumbers: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
  },

  recordTop: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  statusPill: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#eef2ff",
    color: "#3730a3",
    fontSize: "11px",
    fontWeight: "950",
  },

  directionPill: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "5px 8px",
    background: "#dcfce7",
    color: "#166534",
    fontSize: "11px",
    fontWeight: "950",
  },

  directionOut: {
    background: "#fee2e2",
    color: "#991b1b",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  lowStockPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    padding: "18px",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.08)",
  },

  lowStockGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "12px",
  },

  lowStockCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    padding: "14px",
    borderRadius: "20px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
  },

  lowStockNumbers: {
    display: "grid",
    gap: "4px",
    textAlign: "right",
  },

  emptyLine: {
    padding: "18px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
    fontWeight: "800",
    textAlign: "center",
  },
};
