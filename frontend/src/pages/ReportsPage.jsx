import { useEffect, useState } from "react";
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

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [error, setError] = useState("");

  async function loadReports(customFilters = null) {
    setError("");

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
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load reports.");
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>
            Sales, discount, profit, debts and stock reports for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <button type="button" onClick={() => loadReports()}>
          Refresh
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
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Sales summary, profit, debts, payment breakdown, top products and
          low-stock reports are filtered to this selected store only.
        </small>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Report Filter - {currentStoreCode}</h2>

        <div className="filter-grid">
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

          <div className="filter-actions">
            <button type="button" onClick={() => loadReports()}>
              Apply Filter
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={clearFilters}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="cards-grid reports-grid">
        <div className="stat-card">
          <span>{currentStoreCode} Before Discount</span>
          <strong>{formatMoney(totalBeforeDiscount)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Discount</span>
          <strong>{formatMoney(totalDiscount)}</strong>
        </div>

        <div className="stat-card">
          <span>Total Sales</span>
          <strong>{formatMoney(summary?.total_sales_amount)}</strong>
        </div>

        <div className="stat-card">
          <span>Gross Profit</span>
          <strong>{formatMoney(summary?.gross_profit)}</strong>
        </div>

        <div className="stat-card">
          <span>Expenses</span>
          <strong>{formatMoney(summary?.total_expenses)}</strong>
        </div>

        <div className="stat-card">
          <span>Net Profit</span>
          <strong>{formatMoney(summary?.net_profit)}</strong>
        </div>

        <div className="stat-card">
          <span>Amount Paid</span>
          <strong>{formatMoney(summary?.total_amount_paid)}</strong>
        </div>

        <div className="stat-card">
          <span>Sales Balance</span>
          <strong>{formatMoney(summary?.total_sales_balance)}</strong>
        </div>

        <div className="stat-card">
          <span>Outstanding Debts</span>
          <strong>{formatMoney(summary?.outstanding_debts)}</strong>
        </div>

        <div className="stat-card">
          <span>Low Stock Items</span>
          <strong>{summary?.low_stock_count || 0}</strong>
        </div>
      </div>

      <div className="two-column reports-two-column">
        <div className="section-card">
          <h2>Top Products - {currentStoreCode}</h2>

          {topProducts.length === 0 ? (
            <p>No product sales found for {currentStoreCode}.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty Sold</th>
                  <th>Line Revenue</th>
                </tr>
              </thead>

              <tbody>
                {topProducts.map((product) => (
                  <tr key={product.product_id}>
                    <td>{product.product_name}</td>
                    <td>{product.quantity_sold}</td>
                    <td>{formatMoney(product.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="section-card">
          <h2>Payment Breakdown - {currentStoreCode}</h2>

          {paymentBreakdown.length === 0 ? (
            <p>No payment records found for {currentStoreCode}.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Payment Type</th>
                  <th>Count</th>
                  <th>Total</th>
                </tr>
              </thead>

              <tbody>
                {paymentBreakdown.map((payment) => (
                  <tr key={payment.payment_type}>
                    <td>{payment.payment_type}</td>
                    <td>{payment.count}</td>
                    <td>{formatMoney(payment.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section-card">
        <h2>Low Stock Report - {currentStoreCode}</h2>

        {lowStockProducts.length === 0 ? (
          <p>No low-stock products at the moment for {currentStoreCode}.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Quantity</th>
                <th>Low Stock Level</th>
                <th>Selling Price</th>
              </tr>
            </thead>

            <tbody>
              {lowStockProducts.map((product) => (
                <tr key={product.id} className="low-stock-row">
                  <td>
                    <strong>{product.name}</strong>
                    <br />
                    <small>{product.size}</small>
                  </td>

                  <td>{product.category}</td>
                  <td>{product.quantity}</td>
                  <td>{product.low_stock_threshold}</td>
                  <td>{formatMoney(product.selling_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
