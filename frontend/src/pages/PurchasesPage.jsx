import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const today = new Date().toISOString().slice(0, 10);

const emptySupplierForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
};

const emptyPurchaseForm = {
  supplier_id: "",
  invoice_number: "",
  purchase_date: today,
  amount_paid: "",
  notes: "",
};

export default function PurchasesPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);

  const [summary, setSummary] = useState({
    total_purchases: 0,
    total_paid: 0,
    total_balance: 0,
    purchase_count: 0,
  });

  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);

  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [items, setItems] = useState([]);

  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [selectedPurchaseItems, setSelectedPurchaseItems] = useState([]);
  const [selectedPurchasePayments, setSelectedPurchasePayments] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [paymentPurchase, setPaymentPurchase] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleDateString();
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  }

  function formatPaymentStatus(value) {
    const statuses = {
      unpaid: "Unpaid",
      partial: "Partial",
      paid: "Paid",
    };

    return statuses[String(value || "").toLowerCase()] || value || "-";
  }

  function formatPaymentMethod(value) {
    const methods = {
      cash: "Cash",
      momo: "MoMo",
      bank: "Bank",
      mixed: "Mixed",
      other: "Other",
    };

    return methods[String(value || "").toLowerCase()] || value || "-";
  }

  const purchaseTotal = items.reduce((sum, item) => {
    return sum + Number(item.line_total || 0);
  }, 0);

  const purchaseBalance = Math.max(
    purchaseTotal - Number(purchaseForm.amount_paid || 0),
    0
  );

  async function loadProducts() {
    const response = await axiosClient.get("/products");
    setProducts(response.data.products || []);
  }

  async function loadSuppliers() {
    const response = await axiosClient.get("/purchases/suppliers");
    setSuppliers(response.data.suppliers || []);
  }

  async function loadPurchases(customFilters = null) {
    const filters = customFilters || {
      search,
      from,
      to,
    };

    const response = await axiosClient.get("/purchases", {
      params: filters,
    });

    setPurchases(response.data.purchases || []);
    setSummary(response.data.summary || {});
  }

  async function loadPageData() {
    setError("");
    setMessage("");

    try {
      await Promise.all([loadProducts(), loadSuppliers(), loadPurchases()]);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load purchases. Make sure you are admin or manager."
      );
    }
  }

  useEffect(() => {
    loadPageData();
  }, []);

  function handleSupplierChange(event) {
    setSupplierForm({
      ...supplierForm,
      [event.target.name]: event.target.value,
    });
  }

  function handlePurchaseChange(event) {
    setPurchaseForm({
      ...purchaseForm,
      [event.target.name]: event.target.value,
    });
  }

  async function createSupplier(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    try {
      const response = await axiosClient.post(
        "/purchases/suppliers",
        supplierForm
      );

      setMessage(response.data.message);
      setSupplierForm(emptySupplierForm);
      await loadSuppliers();
    } catch (error) {
      setError(error.response?.data?.message || "Failed to create supplier.");
    }
  }

  function addItemToPurchase() {
    setMessage("");
    setError("");

    const product = products.find(
      (productItem) => Number(productItem.id) === Number(selectedProductId)
    );

    if (!product) {
      setError("Please select a product.");
      return;
    }

    const cleanQuantity = Number(quantity);
    const cleanCostPrice = Number(costPrice);

    if (!Number.isInteger(cleanQuantity) || cleanQuantity <= 0) {
      setError("Quantity must be a whole number greater than zero.");
      return;
    }

    if (cleanCostPrice < 0 || Number.isNaN(cleanCostPrice)) {
      setError("Cost price must be valid.");
      return;
    }

    const existingItem = items.find(
      (item) => Number(item.product_id) === Number(product.id)
    );

    if (existingItem) {
      setError("This product is already in the purchase list.");
      return;
    }

    const lineTotal = cleanQuantity * cleanCostPrice;

    setItems([
      ...items,
      {
        product_id: product.id,
        product_name: product.name,
        quantity: cleanQuantity,
        cost_price: cleanCostPrice,
        line_total: lineTotal,
      },
    ]);

    setSelectedProductId("");
    setQuantity("");
    setCostPrice("");
  }

  function removeItem(productId) {
    setItems(
      items.filter((item) => Number(item.product_id) !== Number(productId))
    );
  }

  async function recordPurchase(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (items.length === 0) {
      setError("Please add at least one product to the purchase.");
      return;
    }

    if (Number(purchaseForm.amount_paid || 0) > purchaseTotal) {
      setError("Amount paid cannot be greater than purchase total.");
      return;
    }

    try {
      const response = await axiosClient.post("/purchases", {
        ...purchaseForm,
        supplier_id: purchaseForm.supplier_id || null,
        amount_paid: Number(purchaseForm.amount_paid || 0),
        items,
      });

      setMessage(response.data.message);
      setPurchaseForm(emptyPurchaseForm);
      setItems([]);

      await Promise.all([loadProducts(), loadPurchases()]);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to record purchase.");
    }
  }

  async function viewPurchase(purchaseId) {
    setMessage("");
    setError("");
    setDetailsLoading(true);

    try {
      const response = await axiosClient.get(`/purchases/${purchaseId}`);

      setSelectedPurchase(response.data.purchase);
      setSelectedPurchaseItems(response.data.items || []);
      setSelectedPurchasePayments(response.data.payments || []);
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to load purchase details."
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  function closePurchaseDetails() {
    setSelectedPurchase(null);
    setSelectedPurchaseItems([]);
    setSelectedPurchasePayments([]);
  }

  function openPaymentModal(purchase) {
    setMessage("");
    setError("");

    const balance = Number(purchase.balance || 0);

    if (balance <= 0) {
      setMessage("This purchase is already fully paid.");
      return;
    }

    setPaymentPurchase(purchase);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentNotes("");
  }

  function closePaymentModal() {
    setPaymentPurchase(null);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentNotes("");
    setPaymentLoading(false);
  }

  async function payPurchaseBalance(event) {
    event.preventDefault();

    if (!paymentPurchase) return;

    setMessage("");
    setError("");

    const amount = Number(paymentAmount || 0);
    const balance = Number(paymentPurchase.balance || 0);

    if (Number.isNaN(amount) || amount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }

    if (amount > balance) {
      setError(
        `Payment cannot be greater than the balance of ${formatMoney(balance)}.`
      );
      return;
    }

    setPaymentLoading(true);

    try {
      const response = await axiosClient.patch(
        `/purchases/${paymentPurchase.id}/pay`,
        {
          amount,
          payment_method: paymentMethod,
          notes: paymentNotes,
        }
      );

      setMessage(response.data.message || "Purchase payment recorded.");
      closePaymentModal();

      await loadPurchases();
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to record purchase payment."
      );
    } finally {
      setPaymentLoading(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setFrom("");
    setTo("");

    loadPurchases({
      search: "",
      from: "",
      to: "",
    });
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Purchases.</p>
          </div>
        </div>

        <div className="error-box">
          Only admin and manager accounts can record purchases.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Purchases</h1>
          <p>
            Record stock purchases, pay supplier balances and view purchase
            details
          </p>
        </div>

        <button type="button" onClick={loadPageData}>
          Refresh
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid purchase-summary-grid">
        <div className="stat-card">
          <span>Total Purchases</span>
          <strong>{formatMoney(summary.total_purchases)}</strong>
        </div>

        <div className="stat-card">
          <span>Amount Paid</span>
          <strong>{formatMoney(summary.total_paid)}</strong>
        </div>

        <div className="stat-card">
          <span>Purchase Balance</span>
          <strong>{formatMoney(summary.total_balance)}</strong>
        </div>

        <div className="stat-card">
          <span>Purchase Count</span>
          <strong>{summary.purchase_count || 0}</strong>
        </div>
      </div>

      <div className="two-column purchases-grid">
        <form className="section-card" onSubmit={createSupplier}>
          <h2>Add Supplier</h2>

          <label>Supplier Name</label>
          <input
            name="name"
            value={supplierForm.name}
            onChange={handleSupplierChange}
            placeholder="Example: Kofi Auto Parts"
          />

          <label>Contact Person</label>
          <input
            name="contact_person"
            value={supplierForm.contact_person}
            onChange={handleSupplierChange}
            placeholder="Example: Mr Kofi"
          />

          <label>Phone</label>
          <input
            name="phone"
            value={supplierForm.phone}
            onChange={handleSupplierChange}
            placeholder="Example: 0240000000"
          />

          <label>Email</label>
          <input
            name="email"
            value={supplierForm.email}
            onChange={handleSupplierChange}
            placeholder="Optional"
          />

          <label>Address</label>
          <textarea
            name="address"
            value={supplierForm.address}
            onChange={handleSupplierChange}
            placeholder="Supplier location"
          />

          <button type="submit">Save Supplier</button>
        </form>

        <form className="section-card" onSubmit={recordPurchase}>
          <h2>Record Purchase</h2>

          <div className="form-grid-2">
            <div>
              <label>Supplier</label>
              <select
                name="supplier_id"
                value={purchaseForm.supplier_id}
                onChange={handlePurchaseChange}
              >
                <option value="">No supplier selected</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Invoice Number</label>
              <input
                name="invoice_number"
                value={purchaseForm.invoice_number}
                onChange={handlePurchaseChange}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div>
              <label>Purchase Date</label>
              <input
                type="date"
                name="purchase_date"
                value={purchaseForm.purchase_date}
                onChange={handlePurchaseChange}
              />
            </div>

            <div>
              <label>Amount Paid</label>
              <input
                type="number"
                name="amount_paid"
                value={purchaseForm.amount_paid}
                onChange={handlePurchaseChange}
                placeholder="Example: 200"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          <div className="purchase-item-box">
            <h3>Add Product to Purchase</h3>

            <div className="form-grid-3">
              <div>
                <label>Product</label>
                <select
                  value={selectedProductId}
                  onChange={(event) => {
                    const productId = event.target.value;
                    setSelectedProductId(productId);

                    const product = products.find(
                      (item) => Number(item.id) === Number(productId)
                    );

                    if (product) {
                      setCostPrice(product.cost_price || "");
                    }
                  }}
                >
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} — Stock: {product.quantity}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Quantity Bought</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="Example: 10"
                  min="1"
                />
              </div>

              <div>
                <label>Cost Price</label>
                <input
                  type="number"
                  value={costPrice}
                  onChange={(event) => setCostPrice(event.target.value)}
                  placeholder="Example: 120"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <button type="button" onClick={addItemToPurchase}>
              Add Item
            </button>
          </div>

          {items.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Cost Price</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {items.map((item) => (
                  <tr key={item.product_id}>
                    <td>{item.product_name}</td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.cost_price)}</td>
                    <td>{formatMoney(item.line_total)}</td>
                    <td>
                      <button
                        type="button"
                        className="small-danger"
                        onClick={() => removeItem(item.product_id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="purchase-total-box">
            <p>
              <span>Total:</span>
              <strong>{formatMoney(purchaseTotal)}</strong>
            </p>

            <p>
              <span>Balance:</span>
              <strong>{formatMoney(purchaseBalance)}</strong>
            </p>
          </div>

          <label>Notes</label>
          <textarea
            name="notes"
            value={purchaseForm.notes}
            onChange={handlePurchaseChange}
            placeholder="Optional notes about this purchase"
          />

          <button type="submit">Save Purchase and Update Stock</button>
        </form>
      </div>

      <div className="section-card">
        <h2>Filter Purchases</h2>

        <div className="filter-grid">
          <div>
            <label>Search</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice, supplier or staff"
            />
          </div>

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
            <button type="button" onClick={() => loadPurchases()}>
              Apply
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

      <div className="section-card">
        <h2>Purchase Records</h2>

        {detailsLoading && <div className="success-box">Loading details...</div>}

        {purchases.length === 0 ? (
          <p>No purchases recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Invoice</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Recorded By</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {purchases.map((purchase) => {
                const balance = Number(purchase.balance || 0);

                return (
                  <tr key={purchase.id}>
                    <td>{formatDate(purchase.purchase_date)}</td>
                    <td>{purchase.supplier_name || "-"}</td>
                    <td>{purchase.invoice_number || "-"}</td>
                    <td>{formatMoney(purchase.total_amount)}</td>
                    <td>{formatMoney(purchase.amount_paid)}</td>
                    <td>{formatMoney(purchase.balance)}</td>
                    <td>{formatPaymentStatus(purchase.payment_status)}</td>
                    <td>{purchase.created_by_name || "-"}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          onClick={() => viewPurchase(purchase.id)}
                        >
                          View
                        </button>

                        {balance > 0 && (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => openPaymentModal(purchase)}
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedPurchase && (
        <div className="modal-backdrop">
          <div className="receipt-modal">
            <div className="modal-header">
              <div>
                <h2>Purchase Details</h2>
                <p>
                  Invoice:{" "}
                  <strong>{selectedPurchase.invoice_number || "-"}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closePurchaseDetails}
              >
                Close
              </button>
            </div>

            <div className="receipt-preview">
              <div className="receipt-info-grid">
                <p>
                  <strong>Supplier:</strong>{" "}
                  {selectedPurchase.supplier_name || "-"}
                </p>

                <p>
                  <strong>Supplier Phone:</strong>{" "}
                  {selectedPurchase.supplier_phone || "-"}
                </p>

                <p>
                  <strong>Invoice Number:</strong>{" "}
                  {selectedPurchase.invoice_number || "-"}
                </p>

                <p>
                  <strong>Purchase Date:</strong>{" "}
                  {formatDate(selectedPurchase.purchase_date)}
                </p>

                <p>
                  <strong>Total Amount:</strong>{" "}
                  {formatMoney(selectedPurchase.total_amount)}
                </p>

                <p>
                  <strong>Amount Paid:</strong>{" "}
                  {formatMoney(selectedPurchase.amount_paid)}
                </p>

                <p>
                  <strong>Balance:</strong>{" "}
                  {formatMoney(selectedPurchase.balance)}
                </p>

                <p>
                  <strong>Payment Status:</strong>{" "}
                  {formatPaymentStatus(selectedPurchase.payment_status)}
                </p>

                <p>
                  <strong>Recorded By:</strong>{" "}
                  {selectedPurchase.created_by_name || "-"}
                </p>

                <p>
                  <strong>Created At:</strong>{" "}
                  {formatDateTime(selectedPurchase.created_at)}
                </p>
              </div>

              {selectedPurchase.notes && (
                <div className="warning-box">
                  <strong>Notes:</strong> {selectedPurchase.notes}
                </div>
              )}

              <h3>Items Bought</h3>

              {selectedPurchaseItems.length === 0 ? (
                <p>No items found for this purchase.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Cost Price</th>
                      <th>Line Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {selectedPurchaseItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{formatMoney(item.cost_price)}</td>
                        <td>{formatMoney(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3>Payment History</h3>

              {selectedPurchasePayments.length === 0 ? (
                <p>No payment history found for this purchase.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Paid By</th>
                      <th>Notes</th>
                    </tr>
                  </thead>

                  <tbody>
                    {selectedPurchasePayments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{formatDateTime(payment.paid_at)}</td>
                        <td>{formatMoney(payment.amount)}</td>
                        <td>{formatPaymentMethod(payment.payment_method)}</td>
                        <td>{payment.paid_by_name || "-"}</td>
                        <td>{payment.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="receipt-totals">
                <p>
                  <span>Total Amount</span>
                  <strong>{formatMoney(selectedPurchase.total_amount)}</strong>
                </p>

                <p>
                  <span>Amount Paid</span>
                  <strong>{formatMoney(selectedPurchase.amount_paid)}</strong>
                </p>

                <p className="receipt-grand-total">
                  <span>Balance</span>
                  <strong>{formatMoney(selectedPurchase.balance)}</strong>
                </p>
              </div>
            </div>

            <div className="modal-actions">
              {Number(selectedPurchase.balance || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    closePurchaseDetails();
                    openPaymentModal(selectedPurchase);
                  }}
                >
                  Pay Balance
                </button>
              )}

              <button
                type="button"
                className="secondary-button"
                onClick={closePurchaseDetails}
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentPurchase && (
        <div className="modal-backdrop">
          <div className="receipt-modal">
            <div className="modal-header">
              <div>
                <h2>Pay Purchase Balance</h2>
                <p>
                  Invoice:{" "}
                  <strong>{paymentPurchase.invoice_number || "-"}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closePaymentModal}
              >
                Close
              </button>
            </div>

            <form className="receipt-preview" onSubmit={payPurchaseBalance}>
              <div className="receipt-info-grid">
                <p>
                  <strong>Supplier:</strong>{" "}
                  {paymentPurchase.supplier_name || "-"}
                </p>

                <p>
                  <strong>Total Amount:</strong>{" "}
                  {formatMoney(paymentPurchase.total_amount)}
                </p>

                <p>
                  <strong>Already Paid:</strong>{" "}
                  {formatMoney(paymentPurchase.amount_paid)}
                </p>

                <p>
                  <strong>Current Balance:</strong>{" "}
                  {formatMoney(paymentPurchase.balance)}
                </p>
              </div>

              <label>Payment Amount</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                placeholder={`Maximum ${formatMoney(paymentPurchase.balance)}`}
              />

              <label>Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="momo">MoMo</option>
                <option value="bank">Bank</option>
                <option value="mixed">Mixed</option>
                <option value="other">Other</option>
              </select>

              <label>Payment Notes</label>
              <textarea
                value={paymentNotes}
                onChange={(event) => setPaymentNotes(event.target.value)}
                placeholder="Optional note about this payment"
              />

              <div className="receipt-totals">
                <p>
                  <span>Balance Before Payment</span>
                  <strong>{formatMoney(paymentPurchase.balance)}</strong>
                </p>

                <p className="receipt-grand-total">
                  <span>Balance After Payment</span>
                  <strong>
                    {formatMoney(
                      Math.max(
                        Number(paymentPurchase.balance || 0) -
                          Number(paymentAmount || 0),
                        0
                      )
                    )}
                  </strong>
                </p>
              </div>

              <div className="modal-actions">
                <button type="submit" disabled={paymentLoading}>
                  {paymentLoading ? "Saving..." : "Save Payment"}
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closePaymentModal}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}