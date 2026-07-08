import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const emptyForm = {
  name: "",
  size: "",
  category: "",
  cost_price: "",
  selling_price: "",
  quantity: "",
  low_stock_threshold: 5,
  barcode: "",
  image_url: "",
};

export default function ProductsPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();

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

  const canAddOrEdit = role === "admin" || role === "manager";
  const canDelete = role === "admin";

  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);

  const [stockProduct, setStockProduct] = useState(null);
  const [stockAdjustmentType, setStockAdjustmentType] = useState("increase");
  const [stockAdjustmentQuantity, setStockAdjustmentQuantity] = useState("");
  const [stockAdjustmentReason, setStockAdjustmentReason] = useState("");
  const [stockAdjustments, setStockAdjustments] = useState([]);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockSaving, setStockSaving] = useState(false);

  const [recentAdjustments, setRecentAdjustments] = useState([]);
  const [recentAdjustmentsLoading, setRecentAdjustmentsLoading] =
    useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  }

  function formatAdjustmentType(value) {
    const types = {
      increase: "Increase",
      decrease: "Decrease",
      set: "Set Stock",
    };

    return types[String(value || "").toLowerCase()] || value || "-";
  }

  function calculateExpectedStock() {
    if (!stockProduct) return 0;

    const currentStock = Number(stockProduct.quantity || 0);
    const adjustmentQuantity = Number(stockAdjustmentQuantity || 0);

    if (Number.isNaN(adjustmentQuantity)) {
      return currentStock;
    }

    if (stockAdjustmentType === "increase") {
      return currentStock + adjustmentQuantity;
    }

    if (stockAdjustmentType === "decrease") {
      return Math.max(currentStock - adjustmentQuantity, 0);
    }

    if (stockAdjustmentType === "set") {
      return Math.max(adjustmentQuantity, 0);
    }

    return currentStock;
  }

  async function loadProducts() {
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.get("/products", {
        params: {
          search,
        },
      });

      setProducts(response.data.products || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load products.");
    }
  }

  async function loadRecentStockAdjustments() {
    if (!canAddOrEdit) {
      setRecentAdjustments([]);
      return;
    }

    setRecentAdjustmentsLoading(true);

    try {
      const response = await axiosClient.get(
        "/products/stock-adjustments/recent",
        {
          params: {
            limit: 50,
          },
        }
      );

      setRecentAdjustments(response.data.adjustments || []);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load recent stock adjustment records."
      );
    } finally {
      setRecentAdjustmentsLoading(false);
    }
  }

  async function refreshPageData() {
    await loadProducts();

    if (canAddOrEdit) {
      await loadRecentStockAdjustments();
    }
  }

  useEffect(() => {
    refreshPageData();
    // Reload products and recent stock adjustments when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function handleChange(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  function startEdit(product) {
    setMessage("");
    setError("");

    setIsEditing(true);
    setEditingProductId(product.id);

    setForm({
      name: product.name || "",
      size: product.size || "",
      category: product.category || "",
      cost_price: product.cost_price || "",
      selling_price: product.selling_price || "",
      quantity: product.quantity || "",
      low_stock_threshold: product.low_stock_threshold || 5,
      barcode: product.barcode || "",
      image_url: product.image_url || "",
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditingProductId(null);
    setForm(emptyForm);
    setMessage("");
    setError("");
  }

  async function deleteProduct(productId, productName) {
    const confirmed = window.confirm(
      `Are you sure you want to delete/disable "${productName}"?`
    );

    if (!confirmed) return;

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.delete(`/products/${productId}`);

      setMessage(response.data.message || "Product deleted successfully.");
      await refreshPageData();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to delete product.");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    const productData = {
      ...form,
      cost_price: Number(form.cost_price),
      selling_price: Number(form.selling_price),
      quantity: Number(form.quantity),
      low_stock_threshold: Number(form.low_stock_threshold),
    };

    try {
      if (isEditing) {
        await axiosClient.put(`/products/${editingProductId}`, productData);

        setMessage("Product updated successfully.");
      } else {
        await axiosClient.post("/products", productData);

        setMessage("Product added successfully.");
      }

      setForm(emptyForm);
      setIsEditing(false);
      setEditingProductId(null);
      await refreshPageData();
    } catch (error) {
      setError(
        error.response?.data?.message ||
          (isEditing ? "Failed to update product." : "Failed to add product.")
      );
    }
  }

  async function openStockAdjustment(product) {
    setMessage("");
    setError("");
    setStockProduct(product);
    setStockAdjustmentType("increase");
    setStockAdjustmentQuantity("");
    setStockAdjustmentReason("");
    setStockAdjustments([]);
    setStockHistoryLoading(true);

    try {
      const response = await axiosClient.get(
        `/products/${product.id}/stock-adjustments`
      );

      setStockAdjustments(response.data.adjustments || []);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load stock history.");
    } finally {
      setStockHistoryLoading(false);
    }
  }

  function closeStockAdjustment() {
    setStockProduct(null);
    setStockAdjustmentType("increase");
    setStockAdjustmentQuantity("");
    setStockAdjustmentReason("");
    setStockAdjustments([]);
    setStockHistoryLoading(false);
    setStockSaving(false);
  }

  async function saveStockAdjustment(event) {
    event.preventDefault();

    if (!stockProduct) return;

    setMessage("");
    setError("");

    const quantity = Number(stockAdjustmentQuantity);

    if (!Number.isInteger(quantity) || quantity < 0) {
      setError("Quantity must be a whole number and cannot be negative.");
      return;
    }

    if (stockAdjustmentType !== "set" && quantity <= 0) {
      setError("Increase or decrease quantity must be greater than zero.");
      return;
    }

    if (!stockAdjustmentReason.trim()) {
      setError("Reason is required for stock adjustment.");
      return;
    }

    if (
      stockAdjustmentType === "decrease" &&
      quantity > Number(stockProduct.quantity || 0)
    ) {
      setError("You cannot reduce stock below zero.");
      return;
    }

    setStockSaving(true);

    try {
      const response = await axiosClient.patch(
        `/products/${stockProduct.id}/stock-adjustment`,
        {
          adjustment_type: stockAdjustmentType,
          quantity,
          reason: stockAdjustmentReason,
        }
      );

      setMessage(response.data.message || "Stock adjusted successfully.");

      const updatedProduct = response.data.product;

      setStockProduct(updatedProduct);
      setStockAdjustmentQuantity("");
      setStockAdjustmentReason("");

      const historyResponse = await axiosClient.get(
        `/products/${stockProduct.id}/stock-adjustments`
      );

      setStockAdjustments(historyResponse.data.adjustments || []);

      await refreshPageData();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to adjust stock.");
    } finally {
      setStockSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p>
            Add, edit, adjust and manage spare parts stock for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <button type="button" onClick={refreshPageData}>
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
          Product list, stock adjustments, low-stock warnings and barcode checks
          are filtered to this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="two-column">
        {canAddOrEdit ? (
          <form className="section-card" onSubmit={handleSubmit}>
            <h2>{isEditing ? "Edit Product" : "Add Product"}</h2>

            <div className="warning-box">
              You are working in {currentStoreCode} — {currentStoreName}. This
              product will belong to this selected store only.
            </div>

            {isEditing && (
              <div className="warning-box">
                You are editing an existing product. Click Cancel Edit if this
                was a mistake.
              </div>
            )}

            <label>Product Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
            />

            <label>Excavator Type</label>
            <input
              name="size"
              value={form.size}
              onChange={handleChange}
              placeholder="Example: CAT 320, CAT 330, Komatsu PC200"
            />

            <label>Category</label>
            <input
              name="category"
              value={form.category}
              onChange={handleChange}
            />

            <label>Cost Price</label>
            <input
              name="cost_price"
              type="number"
              min="0"
              step="0.01"
              value={form.cost_price}
              onChange={handleChange}
              required
            />

            <label>Selling Price</label>
            <input
              name="selling_price"
              type="number"
              min="0"
              step="0.01"
              value={form.selling_price}
              onChange={handleChange}
              required
            />

            <label>Quantity</label>
            <input
              name="quantity"
              type="number"
              min="0"
              value={form.quantity}
              onChange={handleChange}
              required
            />

            <label>Low Stock Level</label>
            <input
              name="low_stock_threshold"
              type="number"
              min="0"
              value={form.low_stock_threshold}
              onChange={handleChange}
            />

            <label>Barcode</label>
            <input name="barcode" value={form.barcode} onChange={handleChange} />

            <label>Image URL</label>
            <input
              name="image_url"
              value={form.image_url}
              onChange={handleChange}
            />

            <div className="form-actions">
              <button type="submit">
                {isEditing ? "Update Product" : "Save Product"}
              </button>

              {isEditing && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cancelEdit}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="section-card">
            <h2>Products</h2>
            <p>
              You can view products, but only an admin or manager can add, edit
              or adjust products.
            </p>
          </div>
        )}

        <div className="section-card">
          <div className="table-header">
            <h2>Product List - {currentStoreCode}</h2>

            <div className="inline-search">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search product or excavator type"
              />

              <button type="button" onClick={loadProducts}>
                Search
              </button>
            </div>
          </div>

          {products.length === 0 ? (
            <p>No products found for {currentStoreCode} — {currentStoreName}.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Excavator Type</th>
                  <th>Category</th>
                  <th>Stock</th>
                  <th>Cost</th>
                  <th>Selling</th>
                  {(canAddOrEdit || canDelete) && <th>Action</th>}
                </tr>
              </thead>

              <tbody>
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className={
                      Number(product.quantity) <=
                      Number(product.low_stock_threshold)
                        ? "low-stock-row"
                        : ""
                    }
                  >
                    <td>
                      <strong>{product.name}</strong>
                      {product.barcode && (
                        <>
                          <br />
                          <small>Barcode: {product.barcode}</small>
                        </>
                      )}
                    </td>

                    <td>{product.size || "-"}</td>
                    <td>{product.category || "-"}</td>

                    <td>
                      <strong>{product.quantity}</strong>
                      <br />
                      <small>Low: {product.low_stock_threshold}</small>
                    </td>

                    <td>{formatMoney(product.cost_price)}</td>
                    <td>{formatMoney(product.selling_price)}</td>

                    {(canAddOrEdit || canDelete) && (
                      <td>
                        <div className="table-actions">
                          {canAddOrEdit && (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => startEdit(product)}
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => openStockAdjustment(product)}
                              >
                                Adjust Stock
                              </button>
                            </>
                          )}

                          {canDelete && (
                            <button
                              type="button"
                              className="small-danger"
                              onClick={() =>
                                deleteProduct(product.id, product.name)
                              }
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {canAddOrEdit && (
        <div className="section-card" style={{ marginTop: "18px" }}>
          <div className="table-header">
            <div>
              <h2>Recent Stock Adjustment Records - {currentStoreCode}</h2>
              <p style={{ margin: 0, color: "#64748b", fontWeight: "700" }}>
                Shows the latest damaged, lost, physical count, wrong entry and
                manual stock corrections for this selected store.
              </p>
            </div>

            <button type="button" onClick={loadRecentStockAdjustments}>
              Refresh Records
            </button>
          </div>

          {recentAdjustmentsLoading ? (
            <p>Loading recent stock adjustment records...</p>
          ) : recentAdjustments.length === 0 ? (
            <p>No recent stock adjustment records found for this store.</p>
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
                {recentAdjustments.map((adjustment) => (
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
                    <td>{adjustment.quantity}</td>
                    <td>{adjustment.old_quantity}</td>
                    <td>{adjustment.new_quantity}</td>
                    <td>{adjustment.reason}</td>
                    <td>{adjustment.adjusted_by_name || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {stockProduct && (
        <div className="modal-backdrop">
          <div className="receipt-modal">
            <div className="modal-header">
              <div>
                <h2>Stock Adjustment - {currentStoreCode}</h2>
                <p>
                  Product: <strong>{stockProduct.name}</strong>
                  <br />
                  Store: <strong>{currentStoreName}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeStockAdjustment}
              >
                Close
              </button>
            </div>

            <form className="receipt-preview" onSubmit={saveStockAdjustment}>
              <div className="receipt-info-grid">
                <p>
                  <strong>Current Stock:</strong> {stockProduct.quantity}
                </p>

                <p>
                  <strong>Low Stock Level:</strong>{" "}
                  {stockProduct.low_stock_threshold}
                </p>

                <p>
                  <strong>Expected New Stock:</strong> {calculateExpectedStock()}
                </p>

                <p>
                  <strong>Category:</strong> {stockProduct.category || "-"}
                </p>
              </div>

              <label>Adjustment Type</label>
              <select
                value={stockAdjustmentType}
                onChange={(event) => setStockAdjustmentType(event.target.value)}
              >
                <option value="increase">Increase Stock</option>
                <option value="decrease">Decrease Stock</option>
                <option value="set">Set Exact Stock</option>
              </select>

              <label>
                {stockAdjustmentType === "set"
                  ? "New Exact Quantity"
                  : "Adjustment Quantity"}
              </label>
              <input
                type="number"
                min={stockAdjustmentType === "set" ? "0" : "1"}
                value={stockAdjustmentQuantity}
                onChange={(event) =>
                  setStockAdjustmentQuantity(event.target.value)
                }
                placeholder={
                  stockAdjustmentType === "set" ? "Example: 50" : "Example: 5"
                }
              />

              <label>Reason</label>
              <textarea
                value={stockAdjustmentReason}
                onChange={(event) =>
                  setStockAdjustmentReason(event.target.value)
                }
                placeholder="Example: Physical stock count correction, damaged item, lost item, wrong entry"
              />

              <div className="modal-actions">
                <button type="submit" disabled={stockSaving}>
                  {stockSaving ? "Saving..." : "Save Adjustment"}
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeStockAdjustment}
                >
                  Cancel
                </button>
              </div>
            </form>

            <div className="receipt-preview">
              <h3>Stock Adjustment History</h3>

              {stockHistoryLoading ? (
                <p>Loading stock history...</p>
              ) : stockAdjustments.length === 0 ? (
                <p>No stock adjustments recorded for this product.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Qty</th>
                      <th>Old</th>
                      <th>New</th>
                      <th>Reason</th>
                      <th>By</th>
                    </tr>
                  </thead>

                  <tbody>
                    {stockAdjustments.map((adjustment) => (
                      <tr key={adjustment.id}>
                        <td>{formatDateTime(adjustment.adjusted_at)}</td>
                        <td>
                          {formatAdjustmentType(adjustment.adjustment_type)}
                        </td>
                        <td>{adjustment.quantity}</td>
                        <td>{adjustment.old_quantity}</td>
                        <td>{adjustment.new_quantity}</td>
                        <td>{adjustment.reason}</td>
                        <td>{adjustment.adjusted_by_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}