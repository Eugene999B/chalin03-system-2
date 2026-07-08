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

  const [stockTransferSummary, setStockTransferSummary] = useState(null);
  const [stockAdjustmentSummary, setStockAdjustmentSummary] = useState(null);
  const [recentStockTransfers, setRecentStockTransfers] = useState([]);
  const [recentStockAdjustments, setRecentStockAdjustments] = useState([]);

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

      setStockTransferSummary(summaryRes.data.stock_transfer_summary || null);
      setStockAdjustmentSummary(
        summaryRes.data.stock_adjustment_summary || null
      );
      setRecentStockTransfers(summaryRes.data.recent_stock_transfers || []);
      setRecentStockAdjustments(summaryRes.data.recent_stock_adjustments || []);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>
            Sales, discount, profit, debts, stock adjustments and stock transfer
            reports for{" "}
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
          Sales summary, profit, debts, payment breakdown, top products,
          low-stock reports, stock adjustments and stock transfers are filtered
          to this selected store only.
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

        <div className="stat-card">
          <span>Transfers Out</span>
          <strong>
            {formatNumber(stockTransferSummary?.transfer_out_count)}
          </strong>
        </div>

        <div className="stat-card">
          <span>Transfers In</span>
          <strong>{formatNumber(stockTransferSummary?.transfer_in_count)}</strong>
        </div>

        <div className="stat-card">
          <span>Qty Transferred Out</span>
          <strong>
            {formatNumber(stockTransferSummary?.total_transfer_out_quantity)}
          </strong>
        </div>

        <div className="stat-card">
          <span>Qty Received In</span>
          <strong>
            {formatNumber(stockTransferSummary?.total_transfer_in_quantity)}
          </strong>
        </div>

        <div className="stat-card">
          <span>Stock Adjustments</span>
          <strong>
            {formatNumber(stockAdjustmentSummary?.total_adjustment_count)}
          </strong>
        </div>

        <div className="stat-card">
          <span>Damaged / Lost Records</span>
          <strong>
            {formatNumber(
              Number(stockAdjustmentSummary?.damaged_count || 0) +
                Number(stockAdjustmentSummary?.lost_count || 0)
            )}
          </strong>
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

      <div className="two-column reports-two-column">
        <div className="section-card">
          <h2>Stock Transfer Summary - {currentStoreCode}</h2>

          <table>
            <tbody>
              <tr>
                <th>Total Transfers</th>
                <td>
                  {formatNumber(stockTransferSummary?.total_transfer_count)}
                </td>
              </tr>
              <tr>
                <th>Requested</th>
                <td>{formatNumber(stockTransferSummary?.requested_count)}</td>
              </tr>
              <tr>
                <th>Approved</th>
                <td>{formatNumber(stockTransferSummary?.approved_count)}</td>
              </tr>
              <tr>
                <th>Dispatched</th>
                <td>{formatNumber(stockTransferSummary?.dispatched_count)}</td>
              </tr>
              <tr>
                <th>Received</th>
                <td>{formatNumber(stockTransferSummary?.received_count)}</td>
              </tr>
              <tr>
                <th>Cancelled</th>
                <td>{formatNumber(stockTransferSummary?.cancelled_count)}</td>
              </tr>
              <tr>
                <th>Rejected</th>
                <td>{formatNumber(stockTransferSummary?.rejected_count)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="section-card">
          <h2>Stock Adjustment Summary - {currentStoreCode}</h2>

          <table>
            <tbody>
              <tr>
                <th>Total Adjustments</th>
                <td>
                  {formatNumber(stockAdjustmentSummary?.total_adjustment_count)}
                </td>
              </tr>
              <tr>
                <th>Increase Records</th>
                <td>{formatNumber(stockAdjustmentSummary?.increase_count)}</td>
              </tr>
              <tr>
                <th>Decrease Records</th>
                <td>{formatNumber(stockAdjustmentSummary?.decrease_count)}</td>
              </tr>
              <tr>
                <th>Set Exact Stock Records</th>
                <td>{formatNumber(stockAdjustmentSummary?.set_count)}</td>
              </tr>
              <tr>
                <th>Total Qty Increased</th>
                <td>
                  {formatNumber(
                    stockAdjustmentSummary?.total_increased_quantity
                  )}
                </td>
              </tr>
              <tr>
                <th>Total Qty Decreased</th>
                <td>
                  {formatNumber(
                    stockAdjustmentSummary?.total_decreased_quantity
                  )}
                </td>
              </tr>
              <tr>
                <th>Damaged Records</th>
                <td>{formatNumber(stockAdjustmentSummary?.damaged_count)}</td>
              </tr>
              <tr>
                <th>Lost Records</th>
                <td>{formatNumber(stockAdjustmentSummary?.lost_count)}</td>
              </tr>
              <tr>
                <th>Physical Count Records</th>
                <td>
                  {formatNumber(stockAdjustmentSummary?.physical_count_count)}
                </td>
              </tr>
              <tr>
                <th>Wrong Entry Records</th>
                <td>{formatNumber(stockAdjustmentSummary?.wrong_entry_count)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-card">
        <h2>Recent Stock Transfers - {currentStoreCode}</h2>

        {recentStockTransfers.length === 0 ? (
          <p>No stock transfer records found for this filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Transfer</th>
                <th>Direction</th>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
                <th>Items</th>
                <th>Requested Qty</th>
                <th>Dispatched Qty</th>
                <th>Received Qty</th>
                <th>Date</th>
              </tr>
            </thead>

            <tbody>
              {recentStockTransfers.map((transfer) => (
                <tr key={transfer.id}>
                  <td>
                    <strong>{transfer.transfer_number}</strong>
                  </td>
                  <td>{getTransferDirection(transfer)}</td>
                  <td>
                    {transfer.from_branch_code} — {transfer.from_branch_name}
                  </td>
                  <td>
                    {transfer.to_branch_code} — {transfer.to_branch_name}
                  </td>
                  <td>{formatStatus(transfer.status)}</td>
                  <td>{formatNumber(transfer.item_count)}</td>
                  <td>{formatNumber(transfer.total_requested_quantity)}</td>
                  <td>{formatNumber(transfer.total_dispatched_quantity)}</td>
                  <td>{formatNumber(transfer.total_received_quantity)}</td>
                  <td>{formatDateTime(transfer.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-card">
        <h2>Recent Stock Adjustments - {currentStoreCode}</h2>

        {recentStockAdjustments.length === 0 ? (
          <p>No stock adjustment records found for this filter.</p>
        ) : (
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
        )}
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