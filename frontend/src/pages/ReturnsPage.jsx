import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ReturnsPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [sales, setSales] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleItems, setSaleItems] = useState([]);

  const [returnsList, setReturnsList] = useState([]);
  const [summary, setSummary] = useState({
    return_count: 0,
    total_quantity_returned: 0,
  });

  const [saleSearch, setSaleSearch] = useState("");
  const [returnSearch, setReturnSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [form, setForm] = useState({
    product_id: "",
    quantity: "",
    reason: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  async function loadSales() {
    const response = await axiosClient.get("/returns/sales", {
      params: {
        search: saleSearch,
      },
    });

    setSales(response.data.sales || []);
  }

  async function loadReturns() {
    const response = await axiosClient.get("/returns", {
      params: {
        search: returnSearch,
        from,
        to,
      },
    });

    setReturnsList(response.data.returns || []);
    setSummary(response.data.summary || {});
  }

  async function loadPageData() {
    setError("");

    try {
      await Promise.all([loadSales(), loadReturns()]);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load returns. Make sure you are admin or manager."
      );
    }
  }

  async function loadSaleItems(saleId) {
    setMessage("");
    setError("");

    if (!saleId) {
      setSelectedSale(null);
      setSaleItems([]);
      return;
    }

    try {
      const response = await axiosClient.get(`/returns/sales/${saleId}/items`);

      setSelectedSale(response.data.sale);
      setSaleItems(response.data.items || []);
      setForm({
        product_id: "",
        quantity: "",
        reason: "",
      });
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load sale items.");
    }
  }

  useEffect(() => {
    loadPageData();
  }, []);

  function handleSaleSelect(event) {
    const saleId = event.target.value;
    setSelectedSaleId(saleId);
    loadSaleItems(saleId);
  }

  function handleFormChange(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  async function recordReturn(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!selectedSaleId) {
      setError("Please select a sale first.");
      return;
    }

    if (!form.product_id) {
      setError("Please select the returned product.");
      return;
    }

    if (!form.quantity || Number(form.quantity) <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    if (!form.reason) {
      setError("Please enter the reason for the return.");
      return;
    }

    try {
      const response = await axiosClient.post("/returns", {
        sale_id: Number(selectedSaleId),
        product_id: Number(form.product_id),
        quantity: Number(form.quantity),
        reason: form.reason,
      });

      setMessage(response.data.message);

      setForm({
        product_id: "",
        quantity: "",
        reason: "",
      });

      await Promise.all([
        loadSaleItems(selectedSaleId),
        loadReturns(),
        loadSales(),
      ]);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to record return.");
    }
  }

  const selectedReturnItem = saleItems.find(
    (item) => Number(item.product_id) === Number(form.product_id)
  );

  const estimatedReturnAmount =
    Number(selectedReturnItem?.unit_price || 0) * Number(form.quantity || 0);

  if (role !== "admin" && role !== "manager") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Returns.</p>
          </div>
        </div>

        <div className="error-box">
          Only admin and manager accounts can record returned items.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Returns</h1>
          <p>Record returned items and increase stock automatically</p>
        </div>

        <button onClick={loadPageData}>Refresh</button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid returns-summary-grid">
        <div className="stat-card">
          <span>Total Return Records</span>
          <strong>{summary.return_count || 0}</strong>
        </div>

        <div className="stat-card">
          <span>Total Quantity Returned</span>
          <strong>{summary.total_quantity_returned || 0}</strong>
        </div>
      </div>

      <div className="two-column returns-grid">
        <div className="section-card">
          <h2>Find Sale</h2>

          <label>Search Receipt / Customer / Phone</label>
          <div className="inline-search">
            <input
              value={saleSearch}
              onChange={(event) => setSaleSearch(event.target.value)}
              placeholder="Example: CHL or customer name"
            />
            <button type="button" onClick={loadSales}>
              Search
            </button>
          </div>

          <label>Select Sale</label>
          <select value={selectedSaleId} onChange={handleSaleSelect}>
            <option value="">Select receipt</option>

            {sales.map((sale) => (
              <option key={sale.id} value={sale.id}>
                {sale.receipt_number} — {sale.customer_name || "Walk-in"} —{" "}
                {formatMoney(sale.total)}
              </option>
            ))}
          </select>

          {selectedSale && (
            <div className="selected-sale-box">
              <h3>Selected Sale</h3>
              <p>
                <strong>Receipt:</strong> {selectedSale.receipt_number}
              </p>
              <p>
                <strong>Customer:</strong>{" "}
                {selectedSale.customer_name || "Walk-in Customer"}
              </p>
              <p>
                <strong>Phone:</strong> {selectedSale.customer_phone || "-"}
              </p>
              <p>
                <strong>Total:</strong> {formatMoney(selectedSale.total)}
              </p>
              <p>
                <strong>Date:</strong>{" "}
                {new Date(selectedSale.created_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        <form className="section-card" onSubmit={recordReturn}>
          <h2>Record Return</h2>

          <label>Returned Product</label>
          <select
            name="product_id"
            value={form.product_id}
            onChange={handleFormChange}
          >
            <option value="">Select product from sale</option>

            {saleItems.map((item) => (
              <option
                key={item.product_id}
                value={item.product_id}
                disabled={Number(item.remaining_quantity) <= 0}
              >
                {item.product_name} — Sold: {item.quantity_sold} — Returned:{" "}
                {item.returned_quantity} — Remaining: {item.remaining_quantity}
              </option>
            ))}
          </select>

          <label>Quantity Returned</label>
          <input
            type="number"
            name="quantity"
            value={form.quantity}
            onChange={handleFormChange}
            placeholder="Example: 1"
            min="1"
          />

          <label>Reason</label>
          <textarea
            name="reason"
            value={form.reason}
            onChange={handleFormChange}
            placeholder="Example: Wrong size / damaged / customer changed mind"
          />

          <div className="return-amount-box">
            <span>Estimated return amount</span>
            <strong>{formatMoney(estimatedReturnAmount)}</strong>
          </div>

          <button type="submit">Save Return and Increase Stock</button>
        </form>
      </div>

      {saleItems.length > 0 && (
        <div className="section-card">
          <h2>Items in Selected Sale</h2>

          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Sold</th>
                <th>Returned</th>
                <th>Remaining</th>
                <th>Unit Price</th>
              </tr>
            </thead>

            <tbody>
              {saleItems.map((item) => (
                <tr
                  key={item.product_id}
                  className={
                    Number(item.remaining_quantity) <= 0 ? "returned-row" : ""
                  }
                >
                  <td>
                    <strong>{item.product_name}</strong>
                  </td>
                  <td>{item.quantity_sold}</td>
                  <td>{item.returned_quantity}</td>
                  <td>{item.remaining_quantity}</td>
                  <td>{formatMoney(item.unit_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-card">
        <h2>Filter Return Records</h2>

        <div className="filter-grid">
          <div>
            <label>Search</label>
            <input
              value={returnSearch}
              onChange={(event) => setReturnSearch(event.target.value)}
              placeholder="Search receipt, customer, product or reason"
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
            <button type="button" onClick={loadReturns}>
              Apply
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setReturnSearch("");
                setFrom("");
                setTo("");
                setTimeout(loadReturns, 0);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Return Records</h2>

        {returnsList.length === 0 ? (
          <p>No returns recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Reason</th>
              </tr>
            </thead>

            <tbody>
              {returnsList.map((returnItem) => (
                <tr key={returnItem.id}>
                  <td>{new Date(returnItem.returned_at).toLocaleString()}</td>
                  <td>{returnItem.receipt_number || "-"}</td>
                  <td>
                    {returnItem.customer_name || "Walk-in"}
                    <br />
                    <small>{returnItem.customer_phone || "-"}</small>
                  </td>
                  <td>
                    <strong>{returnItem.product_name || "-"}</strong>
                  </td>
                  <td>{returnItem.quantity}</td>
                  <td>{returnItem.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}