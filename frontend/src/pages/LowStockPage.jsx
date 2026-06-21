import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

export default function LowStockPage() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState({
    count: 0,
    out_of_stock_count: 0,
    low_stock_count: 0,
    estimated_restock_cost: 0,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatStockStatus(value) {
    if (value === "out_of_stock") return "Out of Stock";
    if (value === "low_stock") return "Low Stock";
    return "OK";
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
        error.response?.data?.message || "Failed to load low stock products."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLowStockProducts();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Low Stock / Restock List</h1>
          <p>See products that are low or out of stock</p>
        </div>

        <button type="button" onClick={loadLowStockProducts}>
          Refresh
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid">
        <div className="stat-card">
          <span>Total Low Stock Items</span>
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
        <h2>Restock List</h2>

        {loading ? (
          <p>Loading low stock products...</p>
        ) : products.length === 0 ? (
          <p>No low stock products found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Current Qty</th>
                <th>Low Stock Level</th>
                <th>Status</th>
                <th>Suggested Buy Qty</th>
                <th>Cost Price</th>
                <th>Estimated Cost</th>
              </tr>
            </thead>

            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    <br />
                    <small>
                      {product.size || "-"} {product.barcode ? `| ${product.barcode}` : ""}
                    </small>
                  </td>

                  <td>{product.category || "-"}</td>
                  <td>{Number(product.quantity || 0)}</td>
                  <td>{Number(product.low_stock_threshold || 0)}</td>
                  <td>{formatStockStatus(product.stock_status)}</td>
                  <td>{Number(product.suggested_restock_quantity || 0)}</td>
                  <td>{formatMoney(product.cost_price)}</td>
                  <td>{formatMoney(product.estimated_restock_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}