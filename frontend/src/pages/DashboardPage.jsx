import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function DashboardPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function formatMoney(value) {
    return Number(value || 0).toLocaleString("en-GH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function isSaleVoided(sale) {
    return (
      Number(sale?.is_voided || 0) === 1 || sale?.sale_status === "cancelled"
    );
  }

  function isActiveCompletedSale(sale) {
    return !isSaleVoided(sale) && sale?.sale_status === "completed";
  }

  async function loadDashboard() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const [productsResponse, salesResponse, debtsResponse] =
        await Promise.all([
          axiosClient.get("/products"),
          axiosClient.get("/sales"),
          axiosClient.get("/debts/summary"),
        ]);

      setProducts(productsResponse.data.products || []);
      setSales(salesResponse.data.sales || []);
      setDebtSummary(debtsResponse.data.summary || debtsResponse.data || null);
      setMessage("Dashboard refreshed successfully.");
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const dashboardData = useMemo(() => {
    const activeSales = sales.filter(isActiveCompletedSale);
    const voidedSales = sales.filter(isSaleVoided);

    const lowStockProducts = products.filter(
      (product) =>
        Number(product.quantity || 0) <=
        Number(product.low_stock_threshold || 0)
    );

    const totalProducts = products.length;
    const lowStockCount = lowStockProducts.length;

    const totalBeforeDiscount = activeSales.reduce(
      (sum, sale) => sum + Number(sale.subtotal || 0),
      0
    );

    const totalDiscountAmount = activeSales.reduce(
      (sum, sale) => sum + Number(sale.discount_amount || 0),
      0
    );

    const totalSalesAmount = activeSales.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    );

    const totalAmountPaid = activeSales.reduce(
      (sum, sale) => sum + Number(sale.amount_paid || 0),
      0
    );

    const totalSalesBalance = activeSales.reduce(
      (sum, sale) => sum + Number(sale.balance || 0),
      0
    );

    const stockValue = products.reduce((sum, product) => {
      return (
        sum +
        Number(product.quantity || 0) * Number(product.selling_price || 0)
      );
    }, 0);

    const costValue = products.reduce((sum, product) => {
      return sum + Number(product.quantity || 0) * Number(product.cost_price || 0);
    }, 0);

    const outstandingDebts =
      debtSummary?.outstanding_debts ??
      debtSummary?.total_outstanding_balance ??
      debtSummary?.total_balance ??
      0;

    const activeDebtCount =
      debtSummary?.active_debt_count ??
      debtSummary?.unpaid_count ??
      debtSummary?.count ??
      0;

    return {
      activeSales,
      voidedSales,
      lowStockProducts,
      totalProducts,
      lowStockCount,
      totalBeforeDiscount,
      totalDiscountAmount,
      totalSalesAmount,
      totalAmountPaid,
      totalSalesBalance,
      stockValue,
      costValue,
      outstandingDebts,
      activeDebtCount,
    };
  }, [products, sales, debtSummary]);

  const recentSales = sales.slice(0, 8);

  const mainStats = [
    {
      title: "Total Sales",
      value: `GHS ${formatMoney(dashboardData.totalSalesAmount)}`,
      note: "Valid completed sales only",
      tone: "blue",
    },
    {
      title: "Amount Paid",
      value: `GHS ${formatMoney(dashboardData.totalAmountPaid)}`,
      note: "Money received from valid sales",
      tone: "green",
    },
    {
      title: "Outstanding Debts",
      value: `GHS ${formatMoney(dashboardData.outstandingDebts)}`,
      note: `${dashboardData.activeDebtCount} active debt record(s)`,
      tone: "orange",
    },
    {
      title: "Low Stock",
      value: dashboardData.lowStockCount,
      note: "Products needing attention",
      tone: "red",
    },
  ];

  const otherStats = [
    {
      title: "Total Products",
      value: dashboardData.totalProducts,
      note: "Products in stock list",
    },
    {
      title: "Valid Sales",
      value: dashboardData.activeSales.length,
      note: "Completed sales counted",
    },
    {
      title: "Voided Sales",
      value: dashboardData.voidedSales.length,
      note: "Not counted as income",
    },
    {
      title: "Before Discount",
      value: `GHS ${formatMoney(dashboardData.totalBeforeDiscount)}`,
      note: "Subtotal before discounts",
    },
    {
      title: "Total Discount",
      value: `GHS ${formatMoney(dashboardData.totalDiscountAmount)}`,
      note: "Discounts given",
    },
    {
      title: "Sales Balance",
      value: `GHS ${formatMoney(dashboardData.totalSalesBalance)}`,
      note: "Unpaid sales balance",
    },
    {
      title: "Stock Value",
      value: `GHS ${formatMoney(dashboardData.stockValue)}`,
      note: "Estimated selling value",
    },
    {
      title: "Cost Value",
      value: `GHS ${formatMoney(dashboardData.costValue)}`,
      note: "Estimated buying cost",
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>Dashboard</h1>
          <p style={styles.pageSubtitle}>
            Business overview excluding voided/cancelled sales
          </p>
        </div>

        <button type="button" onClick={loadDashboard} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div style={styles.mainStatsGrid}>
        {mainStats.map((stat) => (
          <div
            key={stat.title}
            style={{
              ...styles.mainStatCard,
              borderTop: `5px solid ${toneColors[stat.tone] || "#2563eb"}`,
            }}
          >
            <p style={styles.statTitle}>{stat.title}</p>
            <strong style={styles.mainStatValue}>{stat.value}</strong>
            <span style={styles.statNote}>{stat.note}</span>
          </div>
        ))}
      </div>

      <div style={styles.otherStatsGrid}>
        {otherStats.map((stat) => (
          <div key={stat.title} style={styles.smallStatCard}>
            <p style={styles.statTitle}>{stat.title}</p>
            <strong style={styles.smallStatValue}>{stat.value}</strong>
            <span style={styles.statNote}>{stat.note}</span>
          </div>
        ))}
      </div>

      <div style={styles.contentGrid}>
        <div style={styles.sectionCard}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Recent Sales</h2>
              <p style={styles.sectionSubtitle}>Latest sales records</p>
            </div>
          </div>

          {recentSales.length === 0 ? (
            <p>No sales recorded yet.</p>
          ) : (
            <div style={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Customer</th>
                    <th>Discount</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>

                <tbody>
                  {recentSales.map((sale) => {
                    const voided = isSaleVoided(sale);

                    return (
                      <tr key={sale.id}>
                        <td>
                          <strong>{sale.receipt_number}</strong>
                        </td>

                        <td>{sale.customer_name || "Walk-in Customer"}</td>

                        <td>GHS {formatMoney(sale.discount_amount)}</td>

                        <td>
                          <strong>GHS {formatMoney(sale.total)}</strong>
                        </td>

                        <td>
                          {voided ? (
                            <span style={styles.badgeDanger}>Voided</span>
                          ) : (
                            <span style={styles.badgeSuccess}>
                              {sale.sale_status || "completed"}
                            </span>
                          )}
                        </td>

                        <td>{formatDate(sale.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={styles.sectionCard}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Low Stock Products</h2>
              <p style={styles.sectionSubtitle}>Top products to restock</p>
            </div>
          </div>

          {dashboardData.lowStockProducts.length === 0 ? (
            <p>No low-stock products.</p>
          ) : (
            <div style={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Stock</th>
                    <th>Low Level</th>
                  </tr>
                </thead>

                <tbody>
                  {dashboardData.lowStockProducts.slice(0, 10).map((product) => (
                    <tr key={product.id}>
                      <td>
                        <strong>{product.name}</strong>
                        <br />
                        <small>{product.size || "-"}</small>
                      </td>

                      <td>{product.category || "-"}</td>

                      <td>
                        <span style={styles.badgeDanger}>
                          {product.quantity}
                        </span>
                      </td>

                      <td>{product.low_stock_threshold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const toneColors = {
  blue: "#2563eb",
  green: "#16a34a",
  orange: "#f97316",
  red: "#dc2626",
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "1500px",
    margin: "0 auto",
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "18px",
  },

  pageTitle: {
    margin: 0,
    fontSize: "32px",
    color: "#0f172a",
  },

  pageSubtitle: {
    margin: "6px 0 0",
    color: "#64748b",
  },

  mainStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "16px",
    marginBottom: "16px",
  },

  otherStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "14px",
    marginBottom: "20px",
  },

  mainStatCard: {
    background: "#ffffff",
    borderRadius: "18px",
    padding: "20px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
    border: "1px solid #e5e7eb",
    minHeight: "145px",
  },

  smallStatCard: {
    background: "#ffffff",
    borderRadius: "16px",
    padding: "16px",
    boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
    border: "1px solid #e5e7eb",
    minHeight: "120px",
  },

  statTitle: {
    margin: 0,
    color: "#64748b",
    fontSize: "14px",
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },

  mainStatValue: {
    display: "block",
    marginTop: "10px",
    color: "#0f172a",
    fontSize: "28px",
    lineHeight: 1.15,
  },

  smallStatValue: {
    display: "block",
    marginTop: "8px",
    color: "#0f172a",
    fontSize: "22px",
    lineHeight: 1.15,
  },

  statNote: {
    display: "block",
    marginTop: "8px",
    color: "#64748b",
    fontSize: "13px",
  },

  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.8fr)",
    gap: "20px",
    alignItems: "start",
  },

  sectionCard: {
    background: "#ffffff",
    borderRadius: "18px",
    padding: "20px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.08)",
    border: "1px solid #e5e7eb",
    minWidth: 0,
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "20px",
    color: "#0f172a",
  },

  sectionSubtitle: {
    margin: "4px 0 0",
    color: "#64748b",
    fontSize: "13px",
  },

  tableWrap: {
    width: "100%",
    overflowX: "auto",
  },

  badgeSuccess: {
    display: "inline-block",
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#166534",
    fontWeight: "800",
    fontSize: "12px",
    textTransform: "capitalize",
  },

  badgeDanger: {
    display: "inline-block",
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#fee2e2",
    color: "#991b1b",
    fontWeight: "800",
    fontSize: "12px",
    textTransform: "capitalize",
  },
};