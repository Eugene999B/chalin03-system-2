import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function AuditAccountingPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [isMobile, setIsMobile] = useState(false);

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-GB");
  }

  function getSaleDate(sale) {
    return new Date(sale?.created_at || sale?.sale_date || sale?.date);
  }

  function isSaleVoided(sale) {
    return (
      Number(sale?.is_voided || 0) === 1 ||
      String(sale?.sale_status || "").toLowerCase() === "cancelled" ||
      String(sale?.sale_status || "").toLowerCase() === "voided"
    );
  }

  function isCompletedSale(sale) {
    const status = String(sale?.sale_status || "completed").toLowerCase();
    return !isSaleVoided(sale) && status === "completed";
  }

  function isSameDay(dateA, dateB) {
    return (
      dateA.getFullYear() === dateB.getFullYear() &&
      dateA.getMonth() === dateB.getMonth() &&
      dateA.getDate() === dateB.getDate()
    );
  }

  async function loadAuditData() {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const [productsResponse, salesResponse, debtsResponse, expensesResponse] =
        await Promise.all([
          axiosClient.get("/products"),
          axiosClient.get("/sales"),
          axiosClient.get("/debts/summary"),
          axiosClient.get("/expenses"),
        ]);

      setProducts(productsResponse.data.products || []);
      setSales(salesResponse.data.sales || []);
      setDebtSummary(debtsResponse.data.summary || debtsResponse.data || null);
      setExpenses(expensesResponse.data.expenses || []);

      setMessage("Audit and accounting review refreshed successfully.");
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load audit and accounting data."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuditData();
  }, []);

  useEffect(() => {
    function checkScreenSize() {
      setIsMobile(window.innerWidth <= 760);
    }

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);

    return () => {
      window.removeEventListener("resize", checkScreenSize);
    };
  }, []);

  const auditData = useMemo(() => {
    const today = new Date();

    const completedSales = sales.filter(isCompletedSale);
    const voidedSales = sales.filter(isSaleVoided);

    const todaySales = completedSales.filter((sale) => {
      const saleDate = getSaleDate(sale);
      return !Number.isNaN(saleDate.getTime()) && isSameDay(saleDate, today);
    });

    const totalSales = completedSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const cashCollected = completedSales.reduce(
      (sum, sale) => sum + Number(sale.amount_paid || 0),
      0
    );

    const totalDiscounts = completedSales.reduce(
      (sum, sale) => sum + Number(sale.discount_amount || 0),
      0
    );

    const salesBalances = completedSales.reduce(
      (sum, sale) => sum + Number(sale.balance || 0),
      0
    );

    const todaySalesTotal = todaySales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );

    const fuelExpenses = expenses
      .filter((expense) =>
        String(expense.category || "").toLowerCase().includes("fuel")
      )
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const transportExpenses = expenses
      .filter((expense) =>
        String(expense.category || "").toLowerCase().includes("transport")
      )
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const salaryExpenses = expenses
      .filter((expense) =>
        String(expense.category || "").toLowerCase().includes("salary")
      )
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    const outstandingDebts =
      debtSummary?.outstanding_balance ??
      debtSummary?.outstanding_debts ??
      debtSummary?.total_outstanding_balance ??
      debtSummary?.total_balance ??
      0;

    const unpaidDebtCount =
      debtSummary?.unpaid_count ??
      debtSummary?.active_debt_count ??
      debtSummary?.count ??
      0;

    const overdueDebtCount = debtSummary?.overdue_count ?? 0;

    const lowStockProducts = products.filter(
      (product) =>
        Number(product.quantity || 0) <=
        Number(product.low_stock_threshold || 0)
    );

    const stockValue = products.reduce((sum, product) => {
      return (
        sum +
        Number(product.quantity || 0) * Number(product.selling_price || 0)
      );
    }, 0);

    const stockCostValue = products.reduce((sum, product) => {
      return (
        sum + Number(product.quantity || 0) * Number(product.cost_price || 0)
      );
    }, 0);

    const grossProfitEstimate = Math.max(totalSales - stockCostValue, 0);
    const netCashPosition = cashCollected - totalExpenses;
    const auditDifference = Math.max(Number(outstandingDebts || 0) - salesBalances, 0);

    const categoryTotals = expenses.reduce((result, expense) => {
      const category = expense.category || "Other";
      result[category] = Number(result[category] || 0) + Number(expense.amount || 0);
      return result;
    }, {});

    const topExpenseCategories = Object.entries(categoryTotals)
      .map(([category, amount]) => ({
        category,
        amount,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    const auditFlags = [];

    if (products.length === 0) {
      auditFlags.push({
        tone: "red",
        title: "No products found",
        detail:
          "The system cannot properly calculate stock value until products are added.",
      });
    }

    if (completedSales.length === 0) {
      auditFlags.push({
        tone: "orange",
        title: "No completed sales found",
        detail:
          "No completed sales are available for accounting review. Sales records should be entered daily.",
      });
    }

    if (voidedSales.length > 0) {
      auditFlags.push({
        tone: "red",
        title: "Voided or cancelled sales detected",
        detail: `${voidedSales.length} voided/cancelled sale(s) should be reviewed by the boss or auditor.`,
      });
    }

    if (Number(outstandingDebts || 0) > 0) {
      auditFlags.push({
        tone: overdueDebtCount > 0 ? "red" : "orange",
        title: "Outstanding customer debts",
        detail: `${formatMoney(
          outstandingDebts
        )} is still unpaid. Debt follow-up and reconciliation are needed.`,
      });
    }

    if (lowStockProducts.length > 0) {
      auditFlags.push({
        tone: "orange",
        title: "Low stock affects business continuity",
        detail: `${lowStockProducts.length} product(s) are at or below low stock level.`,
      });
    }

    if (totalDiscounts > 0) {
      auditFlags.push({
        tone: "blue",
        title: "Discounts given",
        detail: `${formatMoney(
          totalDiscounts
        )} total discount has been recorded. Auditor should confirm discounts were approved.`,
      });
    }

    if (totalExpenses > cashCollected && totalExpenses > 0) {
      auditFlags.push({
        tone: "red",
        title: "Expenses are higher than cash collected",
        detail:
          "The system shows expenses greater than cash collected. Review expense entries and daily closing.",
      });
    }

    if (fuelExpenses > 0) {
      auditFlags.push({
        tone: "blue",
        title: "Fuel expenses recorded",
        detail: `${formatMoney(
          fuelExpenses
        )} fuel cost recorded. This can be reviewed separately from other expenses.`,
      });
    }

    if (auditFlags.length === 0) {
      auditFlags.push({
        tone: "green",
        title: "No major audit issue detected",
        detail:
          "The system currently shows no major warning from sales, debts, stock and expenses.",
      });
    }

    const accountingChecklist = [
      {
        title: "Sales checked",
        status: completedSales.length > 0,
        note: `${completedSales.length} completed sale(s) found.`,
      },
      {
        title: "Cash collected checked",
        status: cashCollected >= 0,
        note: `${formatMoney(cashCollected)} recorded as amount paid.`,
      },
      {
        title: "Debts checked",
        status: Number(outstandingDebts || 0) <= 0,
        note:
          Number(outstandingDebts || 0) > 0
            ? `${formatMoney(outstandingDebts)} still outstanding.`
            : "No outstanding debt detected.",
      },
      {
        title: "Expenses checked",
        status: expenses.length > 0,
        note:
          expenses.length > 0
            ? `${expenses.length} expense record(s) found.`
            : "No expenses recorded yet.",
      },
      {
        title: "Stock checked",
        status: lowStockProducts.length === 0,
        note:
          lowStockProducts.length > 0
            ? `${lowStockProducts.length} low-stock product(s) found.`
            : "Stock level looks healthy.",
      },
      {
        title: "Voided sales checked",
        status: voidedSales.length === 0,
        note:
          voidedSales.length > 0
            ? `${voidedSales.length} voided/cancelled sale(s) need review.`
            : "No voided/cancelled sales detected.",
      },
    ];

    const riskScore = Math.min(
      100,
      Math.round(
        auditFlags.filter((flag) => flag.tone === "red").length * 25 +
          auditFlags.filter((flag) => flag.tone === "orange").length * 15 +
          auditFlags.filter((flag) => flag.tone === "blue").length * 5
      )
    );

    const auditScore = Math.max(0, 100 - riskScore);

    let auditStatus = "Needs Review";

    if (auditScore >= 85) {
      auditStatus = "Clean";
    } else if (auditScore >= 65) {
      auditStatus = "Acceptable";
    } else if (auditScore >= 45) {
      auditStatus = "Watch Closely";
    }

    return {
      completedSales,
      voidedSales,
      todaySales,
      totalSales,
      cashCollected,
      totalDiscounts,
      salesBalances,
      todaySalesTotal,
      totalExpenses,
      fuelExpenses,
      transportExpenses,
      salaryExpenses,
      outstandingDebts,
      unpaidDebtCount,
      overdueDebtCount,
      lowStockProducts,
      stockValue,
      stockCostValue,
      grossProfitEstimate,
      netCashPosition,
      auditDifference,
      topExpenseCategories,
      auditFlags,
      accountingChecklist,
      auditScore,
      auditStatus,
    };
  }, [products, sales, expenses, debtSummary]);

  function buildPrintableReport() {
    const flagsHtml = auditData.auditFlags
      .map(
        (flag) => `
          <li>
            <strong>${flag.title}</strong><br />
            ${flag.detail}
          </li>
        `
      )
      .join("");

    const checklistHtml = auditData.accountingChecklist
      .map(
        (item) => `
          <tr>
            <td>${item.title}</td>
            <td>${item.status ? "Passed" : "Needs Review"}</td>
            <td>${item.note}</td>
          </tr>
        `
      )
      .join("");

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Audit & Accounting Review</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              color: #111827;
              padding: 24px;
              line-height: 1.5;
            }

            h1 {
              margin-bottom: 4px;
              color: #07182c;
            }

            .muted {
              color: #64748b;
            }

            .grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin: 18px 0;
            }

            .box {
              border: 1px solid #dbe3ef;
              border-radius: 12px;
              padding: 12px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 12px;
            }

            th, td {
              border: 1px solid #dbe3ef;
              padding: 8px;
              text-align: left;
              font-size: 13px;
            }

            th {
              background: #f1f5f9;
            }

            li {
              margin-bottom: 10px;
            }
          </style>
        </head>

        <body>
          <h1>Chalin 03 Company Limited</h1>
          <p class="muted">Audit & Accounting Intelligence Review</p>
          <p><strong>Generated:</strong> ${formatDateTime(new Date())}</p>

          <div class="grid">
            <div class="box"><strong>Audit Score:</strong><br />${auditData.auditScore}% - ${auditData.auditStatus}</div>
            <div class="box"><strong>Total Sales:</strong><br />${formatMoney(auditData.totalSales)}</div>
            <div class="box"><strong>Cash Collected:</strong><br />${formatMoney(auditData.cashCollected)}</div>
            <div class="box"><strong>Outstanding Debts:</strong><br />${formatMoney(auditData.outstandingDebts)}</div>
            <div class="box"><strong>Total Expenses:</strong><br />${formatMoney(auditData.totalExpenses)}</div>
            <div class="box"><strong>Fuel Expenses:</strong><br />${formatMoney(auditData.fuelExpenses)}</div>
            <div class="box"><strong>Discounts:</strong><br />${formatMoney(auditData.totalDiscounts)}</div>
            <div class="box"><strong>Stock Value:</strong><br />${formatMoney(auditData.stockValue)}</div>
          </div>

          <h2>Audit Warnings</h2>
          <ul>${flagsHtml}</ul>

          <h2>Accounting Checklist</h2>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>

            <tbody>
              ${checklistHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;
  }

  function printAuditReport() {
    const printWindow = window.open("", "_blank", "width=900,height=700");

    if (!printWindow) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintableReport());
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 300);
  }

  async function copyAuditSummary() {
    const summary = `CHALIN 03 AUDIT & ACCOUNTING SUMMARY

Generated: ${formatDateTime(new Date())}

Audit Score: ${auditData.auditScore}% - ${auditData.auditStatus}
Total Sales: ${formatMoney(auditData.totalSales)}
Cash Collected: ${formatMoney(auditData.cashCollected)}
Outstanding Debts: ${formatMoney(auditData.outstandingDebts)}
Total Expenses: ${formatMoney(auditData.totalExpenses)}
Fuel Expenses: ${formatMoney(auditData.fuelExpenses)}
Discounts Given: ${formatMoney(auditData.totalDiscounts)}
Stock Value: ${formatMoney(auditData.stockValue)}
Voided Sales: ${auditData.voidedSales.length}
Low Stock Products: ${auditData.lowStockProducts.length}

Main Audit Notes:
${auditData.auditFlags.map((flag) => `- ${flag.title}: ${flag.detail}`).join("\n")}`;

    try {
      await navigator.clipboard.writeText(summary);
      setMessage("Audit summary copied successfully.");
    } catch {
      setError("Could not copy summary. Your browser may have blocked it.");
    }
  }

  const oneColumn = isMobile ? styles.oneColumn : {};
  const mobilePage = isMobile ? styles.pageMobile : {};

  return (
    <div style={{ ...styles.page, ...mobilePage }}>
      <div style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Audit Intelligence</p>
          <h1 style={styles.title}>Audit & Accounting Center</h1>
          <p style={styles.subtitle}>
            Built-in business review for sales, cash, debts, expenses, fuel,
            stock, discounts and audit warnings.
          </p>
        </div>

        <div style={styles.heroActions}>
          <button type="button" onClick={loadAuditData} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Review"}
          </button>

          <button type="button" className="secondary-button" onClick={printAuditReport}>
            Print Audit Report
          </button>

          <button type="button" className="secondary-button" onClick={copyAuditSummary}>
            Copy Summary
          </button>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={{ ...styles.scoreGrid, ...oneColumn }}>
        <div style={styles.scoreCard}>
          <div
            style={{
              ...styles.scoreRing,
              background: `conic-gradient(#e0ba28 0deg ${
                auditData.auditScore * 3.6
              }deg, #e2e8f0 ${auditData.auditScore * 3.6}deg 360deg)`,
            }}
          >
            <div style={styles.scoreInner}>
              <strong>{auditData.auditScore}%</strong>
              <span>{auditData.auditStatus}</span>
            </div>
          </div>

          <div>
            <h2>Audit Health Score</h2>
            <p>
              This score is based on red flags from sales, debt, stock, expenses,
              discounts and voided sales.
            </p>
          </div>
        </div>

        <div style={styles.accountingCard}>
          <h2>Accounting Snapshot</h2>

          <div style={styles.accountingRows}>
            <AccountingRow label="Sales Revenue" value={formatMoney(auditData.totalSales)} />
            <AccountingRow label="Cash Collected" value={formatMoney(auditData.cashCollected)} />
            <AccountingRow label="Outstanding Debts" value={formatMoney(auditData.outstandingDebts)} />
            <AccountingRow label="Total Expenses" value={formatMoney(auditData.totalExpenses)} />
            <AccountingRow label="Net Cash Position" value={formatMoney(auditData.netCashPosition)} />
          </div>
        </div>
      </div>

      <div style={{ ...styles.cardsGrid, ...oneColumn }}>
        <MetricCard title="Today’s Sales" value={formatMoney(auditData.todaySalesTotal)} note={`${auditData.todaySales.length} sale(s) today`} icon="⚡" />
        <MetricCard title="Total Sales" value={formatMoney(auditData.totalSales)} note={`${auditData.completedSales.length} completed sale(s)`} icon="📈" />
        <MetricCard title="Cash Collected" value={formatMoney(auditData.cashCollected)} note="Amount paid by customers" icon="💰" />
        <MetricCard title="Outstanding Debts" value={formatMoney(auditData.outstandingDebts)} note={`${auditData.unpaidDebtCount} active debt record(s)`} icon="📞" />
        <MetricCard title="Total Expenses" value={formatMoney(auditData.totalExpenses)} note={`${expenses.length} expense record(s)`} icon="📉" />
        <MetricCard title="Fuel Expenses" value={formatMoney(auditData.fuelExpenses)} note="Fuel category total" icon="⛽" />
        <MetricCard title="Discounts Given" value={formatMoney(auditData.totalDiscounts)} note="Needs approval review" icon="🏷️" />
        <MetricCard title="Stock Value" value={formatMoney(auditData.stockValue)} note={`${products.length} product(s)`} icon="📦" />
      </div>

      <div style={{ ...styles.twoColumn, ...oneColumn }}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2>Audit Warnings</h2>
              <p>Important issues auditors or bosses should review.</p>
            </div>
          </div>

          <div style={styles.warningList}>
            {auditData.auditFlags.map((flag, index) => (
              <div
                key={`${flag.title}-${index}`}
                style={{
                  ...styles.warningItem,
                  ...warningTones[flag.tone],
                }}
              >
                <strong>{flag.title}</strong>
                <span>{flag.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2>Accounting Checklist</h2>
              <p>Quick checklist before presenting records.</p>
            </div>
          </div>

          <div style={styles.checkList}>
            {auditData.accountingChecklist.map((item) => (
              <div key={item.title} style={styles.checkItem}>
                <span
                  style={{
                    ...styles.checkIcon,
                    background: item.status ? "#dcfce7" : "#ffedd5",
                    color: item.status ? "#166534" : "#9a3412",
                  }}
                >
                  {item.status ? "✓" : "!"}
                </span>

                <div>
                  <strong>{item.title}</strong>
                  <p>{item.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ...styles.twoColumn, ...oneColumn }}>
        <div style={styles.panel}>
          <h2>Top Expense Categories</h2>
          <p style={styles.panelText}>
            This helps the accountant see where money is going.
          </p>

          {auditData.topExpenseCategories.length === 0 ? (
            <div style={styles.emptyState}>No expenses recorded yet.</div>
          ) : (
            <div style={styles.expenseList}>
              {auditData.topExpenseCategories.map((item) => (
                <div key={item.category} style={styles.expenseItem}>
                  <strong>{item.category}</strong>
                  <span>{formatMoney(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={styles.panelDark}>
          <h2>Auditor / Accountant Note</h2>
          <p>
            This page does not replace a professional accountant, but it makes
            review easier by showing totals, warnings, debt exposure, expense
            pressure, stock risk and discount activity in one place.
          </p>

          <div style={styles.darkRows}>
            <div>
              <span>Voided Sales</span>
              <strong>{auditData.voidedSales.length}</strong>
            </div>

            <div>
              <span>Low Stock Items</span>
              <strong>{auditData.lowStockProducts.length}</strong>
            </div>

            <div>
              <span>Transport Expenses</span>
              <strong>{formatMoney(auditData.transportExpenses)}</strong>
            </div>

            <div>
              <span>Salary Expenses</span>
              <strong>{formatMoney(auditData.salaryExpenses)}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, note, icon }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTop}>
        <span>{icon}</span>
      </div>

      <p>{title}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function AccountingRow({ label, value }) {
  return (
    <div style={styles.accountingRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const warningTones = {
  green: {
    background: "#ecfdf3",
    borderColor: "#bbf7d0",
    color: "#14532d",
  },
  blue: {
    background: "#eff6ff",
    borderColor: "#bfdbfe",
    color: "#1e3a8a",
  },
  orange: {
    background: "#fff7ed",
    borderColor: "#fed7aa",
    color: "#9a3412",
  },
  red: {
    background: "#fef2f2",
    borderColor: "#fecaca",
    color: "#991b1b",
  },
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1680px",
    margin: "0 auto",
    paddingBottom: "40px",
  },

  pageMobile: {
    paddingBottom: "28px",
  },

  oneColumn: {
    gridTemplateColumns: "1fr",
  },

  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "18px",
    flexWrap: "wrap",
    alignItems: "flex-start",
    marginBottom: "18px",
    padding: "24px",
    borderRadius: "26px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 55%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 22px 55px rgba(7, 24, 44, 0.24)",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontSize: "12px",
    fontWeight: "950",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },

  title: {
    margin: "6px 0 0",
    fontSize: "clamp(28px, 4vw, 44px)",
    fontWeight: "950",
    lineHeight: 1.05,
  },

  subtitle: {
    margin: "10px 0 0",
    color: "rgba(255,255,255,0.76)",
    maxWidth: "760px",
    lineHeight: 1.6,
  },

  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },

  scoreGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.9fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  scoreCard: {
    display: "grid",
    gridTemplateColumns: "180px minmax(0, 1fr)",
    gap: "18px",
    alignItems: "center",
    padding: "20px",
    borderRadius: "24px",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,251,235,0.96))",
    border: "1px solid rgba(224, 186, 40, 0.38)",
    boxShadow: "0 18px 45px rgba(15, 23, 42, 0.09)",
  },

  scoreRing: {
    width: "170px",
    height: "170px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
  },

  scoreInner: {
    width: "112px",
    height: "112px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
  },

  accountingCard: {
    padding: "20px",
    borderRadius: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  },

  accountingRows: {
    display: "grid",
    gap: "10px",
    marginTop: "12px",
  },

  accountingRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
    marginBottom: "18px",
  },

  metricCard: {
    padding: "18px",
    borderRadius: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 16px 36px rgba(15,23,42,0.07)",
  },

  metricTop: {
    width: "44px",
    height: "44px",
    borderRadius: "14px",
    background: "#fef3c7",
    display: "grid",
    placeItems: "center",
    fontSize: "23px",
  },

  twoColumn: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 1fr)",
    gap: "18px",
    marginBottom: "18px",
  },

  panel: {
    background: "#ffffff",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
    minWidth: 0,
  },

  panelHeader: {
    marginBottom: "14px",
  },

  panelText: {
    color: "#64748b",
    lineHeight: 1.6,
  },

  warningList: {
    display: "grid",
    gap: "10px",
  },

  warningItem: {
    display: "grid",
    gap: "5px",
    padding: "13px",
    borderRadius: "16px",
    border: "1px solid",
  },

  checkList: {
    display: "grid",
    gap: "11px",
  },

  checkItem: {
    display: "flex",
    gap: "11px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  checkIcon: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontWeight: "950",
    flexShrink: 0,
  },

  expenseList: {
    display: "grid",
    gap: "10px",
  },

  expenseItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: "14px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap",
  },

  panelDark: {
    borderRadius: "22px",
    padding: "20px",
    background:
      "linear-gradient(135deg, #07182c 0%, #0d2f55 60%, #111827 100%)",
    color: "#ffffff",
    boxShadow: "0 18px 40px rgba(7, 24, 44, 0.22)",
  },

  darkRows: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    marginTop: "14px",
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