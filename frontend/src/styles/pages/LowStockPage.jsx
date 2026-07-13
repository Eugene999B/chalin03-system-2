import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function LowStockPage() {
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

  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState({
    count: 0,
    out_of_stock_count: 0,
    low_stock_count: 0,
    estimated_restock_cost: 0,
  });

  const [loading, setLoading] = useState(false);
  const [sendingAllSms, setSendingAllSms] = useState(false);
  const [sendingProductSmsId, setSendingProductSmsId] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatStockStatus(value) {
    if (value === "out_of_stock") return "Out of Stock";
    if (value === "low_stock") return "Low Stock";
    return "OK";
  }

  function getProductStoreCode(product) {
    return product?.branch_code || product?.store_code || currentStoreCode;
  }

  function getFriendlyApiError(error, fallbackMessage) {
    return error?.response?.data?.message || fallbackMessage;
  }

  async function loadLowStockProducts() {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/products/low-stock");

      setProducts(response.data.products || []);
      setSummary({
        count: response.data.count || 0,
        out_of_stock_count: response.data.out_of_stock_count || 0,
        low_stock_count: response.data.low_stock_count || 0,
        estimated_restock_cost: response.data.estimated_restock_cost || 0,
      });
    } catch (error) {
      setError(
        getFriendlyApiError(error, "Failed to load low stock products.")
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendProductLowStockSms(product) {
    setMessage("");
    setError("");

    if (!product?.id) {
      setError("Product information is missing.");
      return;
    }

    setSendingProductSmsId(product.id);

    try {
      const response = await axiosClient.post(
        `/sms/low-stock/product/${product.id}`
      );

      setMessage(
        response.data.message || "Low stock SMS alert sent successfully."
      );
    } catch (error) {
      setError(
        getFriendlyApiError(error, "Failed to send low stock SMS alert.")
      );
    } finally {
      setSendingProductSmsId(null);
    }
  }

  async function sendAllLowStockSms() {
    setMessage("");
    setError("");

    if (products.length === 0) {
      setError("No low stock products found to send SMS alert.");
      return;
    }

    setSendingAllSms(true);

    try {
      const response = await axiosClient.post("/sms/low-stock/all");

      setMessage(
        response.data.message || "All low stock SMS alert sent successfully."
      );
    } catch (error) {
      setError(
        getFriendlyApiError(error, "Failed to send all low stock SMS alerts.")
      );
    } finally {
      setSendingAllSms(false);
    }
  }

  useEffect(() => {
    loadLowStockProducts();
    // Reload low-stock products when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Low Stock / Restock List</h1>
          <p>
            See products that are low or out of stock for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={loadLowStockProducts}>
            Refresh
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={sendAllLowStockSms}
            disabled={sendingAllSms || products.length === 0}
          >
            {sendingAllSms ? "Sending SMS..." : "Send All SMS Alerts"}
          </button>
        </div>
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
          Low-stock products, out-of-stock products, estimated restock cost and
          SMS alerts are filtered to this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid">
        <div className="stat-card">
          <span>{currentStoreCode} Total Low Stock Items</span>
          <strong>{summary.count}</strong>
        </div>

        <div className="stat-card">
          <span>Out of Stock</span>
          <strong>{summary.out_of_stock_count}</strong>
        </div>

        <div className="stat-card">
          <span>Low Stock</span>
          <strong>{summary.low_stock_count}</strong>
        </div>

        <div className="stat-card">
          <span>Estimated Restock Cost</span>
          <strong>{formatMoney(summary.estimated_restock_cost)}</strong>
        </div>
      </div>

      <div className="section-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "12px",
          }}
        >
          <h2 style={{ margin: 0 }}>Restock List - {currentStoreCode}</h2>

          <button
            type="button"
            className="secondary-button"
            onClick={sendAllLowStockSms}
            disabled={sendingAllSms || products.length === 0}
          >
            {sendingAllSms ? "Sending SMS..." : "Send All SMS Alerts"}
          </button>
        </div>

        {loading ? (
          <p>Loading low stock products for {currentStoreCode}...</p>
        ) : products.length === 0 ? (
          <p>No low stock products found for {currentStoreCode}.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th>Product</th>
                <th>Category</th>
                <th>Current Qty</th>
                <th>Low Stock Level</th>
                <th>Status</th>
                <th>Suggested Buy Qty</th>
                <th>Cost Price</th>
                <th>Estimated Cost</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{getProductStoreCode(product)}</td>

                  <td>
                    <strong>{product.name}</strong>
                    <br />
                    <small>
                      {product.size || "-"}{" "}
                      {product.barcode ? `| ${product.barcode}` : ""}
                    </small>
                  </td>

                  <td>{product.category || "-"}</td>
                  <td>{Number(product.quantity || 0)}</td>
                  <td>{Number(product.low_stock_threshold || 0)}</td>
                  <td>{formatStockStatus(product.stock_status)}</td>
                  <td>{Number(product.suggested_restock_quantity || 0)}</td>
                  <td>{formatMoney(product.cost_price)}</td>
                  <td>{formatMoney(product.estimated_restock_cost)}</td>

                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => sendProductLowStockSms(product)}
                      disabled={sendingProductSmsId === product.id}
                    >
                      {sendingProductSmsId === product.id
                        ? "Sending..."
                        : "Send SMS Alert"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}