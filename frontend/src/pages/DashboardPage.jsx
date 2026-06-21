import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function DashboardPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return Number(value || 0).toFixed(2);
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
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const activeSales = sales.filter(isActiveCompletedSale);
  const voidedSales = sales.filter(isSaleVoided);

  const lowStockProducts = products.filter(
    (product) =>
      Number(product.quantity) <= Number(product.low_stock_threshold)
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

  const recentSales = sales.slice(0, 8);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Business overview excluding voided/cancelled sales</p>
        </div>

        <button type="button" onClick={loadDashboard}>
          Refresh
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="dashboard-grid">
        <div className="stat-card">
          <h3>Total Products</h3>
          <strong>{totalProducts}</strong>
          <p>Active products in stock list</p>
        </div>

        <div className="stat-card">
          <h3>Low Stock</h3>
          <strong>{lowStockCount}</strong>
          <p>Products at or below low-stock level</p>
        </div>

        <div className="stat-card">
          <h3>Valid Sales</h3>
          <strong>{activeSales.length}</strong>
          <p>Completed sales only</p>
        </div>

        <div className="stat-card">
          <h3>Voided Sales</h3>
          <strong>{voidedSales.length}</strong>
          <p>Not counted as income</p>
        </div>

        <div className="stat-card">
          <h3>Before Discount</h3>
          <strong>GHS {formatMoney(totalBeforeDiscount)}</strong>
          <p>Subtotal before discounts</p>
        </div>

        <div className="stat-card">
          <h3>Total Discount</h3>
          <strong>GHS {formatMoney(totalDiscountAmount)}</strong>
          <p>Discount given on valid sales</p>
        </div>

        <div className="stat-card">
          <h3>Total Sales</h3>
          <strong>GHS {formatMoney(totalSalesAmount)}</strong>
          <p>After discount, voided sales excluded</p>
        </div>

        <div className="stat-card">
          <h3>Amount Paid</h3>
          <strong>GHS {formatMoney(totalAmountPaid)}</strong>
          <p>Cash received from valid sales</p>
        </div>

        <div className="stat-card">
          <h3>Sales Balance</h3>
          <strong>GHS {formatMoney(totalSalesBalance)}</strong>
          <p>Unpaid balance from valid sales</p>
        </div>

        <div className="stat-card">
          <h3>Outstanding Debts</h3>
          <strong>GHS {formatMoney(outstandingDebts)}</strong>
          <p>{activeDebtCount} active debt record(s)</p>
        </div>
      </div>

      <div className="two-column">
        <div className="section-card">
          <h2>Recent Sales</h2>

          {recentSales.length === 0 ? (
            <p>No sales recorded yet.</p>
          ) : (
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

                      <td>GHS {formatMoney(sale.total)}</td>

                      <td>
                        {voided ? (
                          <span className="danger-text">Voided</span>
                        ) : (
                          sale.sale_status || "completed"
                        )}
                      </td>

                      <td>{new Date(sale.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="section-card">
          <h2>Low Stock Products</h2>

          {lowStockProducts.length === 0 ? (
            <p>No low-stock products.</p>
          ) : (
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
                {lowStockProducts.slice(0, 10).map((product) => (
                  <tr key={product.id} className="low-stock-row">
                    <td>
                      <strong>{product.name}</strong>
                      <br />
                      <small>{product.size || "-"}</small>
                    </td>

                    <td>{product.category || "-"}</td>
                    <td>{product.quantity}</td>
                    <td>{product.low_stock_threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}