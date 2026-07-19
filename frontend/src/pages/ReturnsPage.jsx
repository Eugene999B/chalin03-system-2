import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import MultiItemReturnPanel from "../components/MultiItemReturnPanel";
import "./ReturnsPage.css";

export default function ReturnsPage() {
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
    return_type: "stock_only",
    refund_amount: "0",
    refund_method: "none",
    refund_reference: "",
    approver_username: "",
    approver_password: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function getRecordStoreCode(record) {
    return record?.branch_code || record?.store_code || currentStoreCode;
  }

  function getRecordStoreName(record) {
    return record?.branch_name || record?.store_name || currentStoreName;
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

      setSelectedSale({
        ...(response.data.sale || {}),
        branch_code:
          response.data.sale?.branch_code ||
          response.data.sale?.store_code ||
          currentStoreCode,
        branch_name:
          response.data.sale?.branch_name ||
          response.data.sale?.store_name ||
          currentStoreName,
        branch_location:
          response.data.sale?.branch_location ||
          response.data.sale?.store_location ||
          currentStoreLocation,
      });
      setSaleItems(response.data.items || []);
      setForm({
        product_id: "",
        quantity: "",
        reason: "",
        return_type: "stock_only",
        refund_amount: "0",
        refund_method: "none",
        refund_reference: "",
        approver_username: "",
        approver_password: "",
      });
    } catch (error) {
      setError(error.response?.data?.message || "Failed to load sale items.");
    }
  }

  useEffect(() => {
    loadPageData();
    // Reload returns and sale search when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

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

    if (form.return_type === "refund") {
      const refundAmount = Number(form.refund_amount || 0);
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        setError("Enter the actual amount refunded to the customer.");
        return;
      }
      if (refundAmount - estimatedReturnAmount > 0.009) {
        setError(`Refund cannot exceed ${formatMoney(estimatedReturnAmount)} for the returned quantity.`);
        return;
      }
      if (!["cash", "momo", "bank", "other"].includes(form.refund_method)) {
        setError("Choose the exact payment channel used for the refund.");
        return;
      }
      if (["momo", "bank", "other"].includes(form.refund_method) && !form.refund_reference.trim()) {
        setError("Enter the transaction/reference number for this refund.");
        return;
      }
      if (!form.approver_username.trim() || !form.approver_password) {
        setError("A different manager or administrator must enter their username and password to approve the refund.");
        return;
      }
    }

    try {
      const response = await axiosClient.post("/returns", {
        sale_id: Number(selectedSaleId),
        product_id: Number(form.product_id),
        quantity: Number(form.quantity),
        reason: form.reason,
        return_type: form.return_type,
        refund_amount: form.return_type === "refund" ? Number(form.refund_amount || 0) : 0,
        refund_method: form.return_type === "refund" ? form.refund_method : "none",
        refund_reference: form.return_type === "refund" ? form.refund_reference : "",
        approver_username: form.return_type === "refund" ? form.approver_username : "",
        approver_password: form.return_type === "refund" ? form.approver_password : "",
      });

      setMessage(response.data.message);

      setForm({
        product_id: "",
        quantity: "",
        reason: "",
        return_type: "stock_only",
        refund_amount: "0",
        refund_method: "none",
        refund_reference: "",
        approver_username: "",
        approver_password: "",
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

  async function handleMultiReturnResult(result) {
    setMessage(result?.message || "");
    setError(result?.error || "");

    await Promise.all([
      loadSaleItems(selectedSaleId),
      loadReturns(),
      loadSales(),
    ]);
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
            <p>
              You are not allowed to open Returns for {currentStoreCode} —{" "}
              {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin and manager accounts can record returned items.
        </div>
      </div>
    );
  }

  return (
    <div className="returns-security-page">
      <div className="page-header">
        <div>
          <h1>Returns</h1>
          <p>
            Record returned items and increase stock automatically for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <button onClick={loadPageData}>Refresh</button>
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
          Sale search, returned items, stock increase and return records are
          filtered to this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid returns-summary-grid">
        <div className="stat-card">
          <span>{currentStoreCode} Total Return Records</span>
          <strong>{summary.return_count || 0}</strong>
        </div>

        <div className="stat-card">
          <span>{currentStoreCode} Total Quantity Returned</span>
          <strong>{summary.total_quantity_returned || 0}</strong>
        </div>

        <div className="stat-card">
          <span>{currentStoreCode} Approved Refunds</span>
          <strong>{formatMoney(summary.total_refunded || 0)}</strong>
        </div>
      </div>

      <div className="two-column returns-grid">
        <div className="section-card">
          <h2>Find Sale - {currentStoreCode}</h2>

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
                {getRecordStoreCode(sale)} — {sale.receipt_number} —{" "}
                {sale.customer_name || "Walk-in"} — {formatMoney(sale.total)}
              </option>
            ))}
          </select>

          {selectedSale && (
            <div className="selected-sale-box">
              <h3>Selected Sale</h3>
              <p>
                <strong>Store:</strong> {getRecordStoreCode(selectedSale)} —{" "}
                {getRecordStoreName(selectedSale)}
              </p>
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

        <MultiItemReturnPanel
          saleId={selectedSaleId}
          saleItems={saleItems}
          storeCode={currentStoreCode}
          storeName={currentStoreName}
          onResult={handleMultiReturnResult}
        />

        <details className="section-card returns-single-fallback">
          <summary>
            Single Item Return — optional fallback
          </summary>

          <form
            className="returns-single-form"
            onSubmit={recordReturn}
          >
          <h2>Record Return - {currentStoreCode}</h2>

          <div className="warning-box">
            This return increases stock only for {currentStoreCode} — {currentStoreName}. Any money given back must be recorded using the exact refund channel and approved by a different manager or administrator.
          </div>

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

          <div className="returns-control-grid">
            <label>
              Return Outcome
              <select name="return_type" value={form.return_type} onChange={handleFormChange}>
                <option value="stock_only">Stock only — no money returned</option>
                <option value="refund">Financial refund</option>
              </select>
            </label>

            {form.return_type === "refund" && (
              <>
                <label>
                  Actual Refund Amount
                  <input
                    type="number"
                    name="refund_amount"
                    value={form.refund_amount}
                    onChange={handleFormChange}
                    min="0.01"
                    max={estimatedReturnAmount || undefined}
                    step="0.01"
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Refund Channel
                  <select name="refund_method" value={form.refund_method} onChange={handleFormChange}>
                    <option value="none">Select refund channel</option>
                    <option value="cash">Cash</option>
                    <option value="momo">Mobile Money</option>
                    <option value="bank">Bank</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Refund Reference
                  <input
                    name="refund_reference"
                    value={form.refund_reference}
                    onChange={handleFormChange}
                    placeholder="MoMo, bank or written reference"
                  />
                </label>
                <label>
                  Independent Approver Username
                  <input
                    name="approver_username"
                    value={form.approver_username}
                    onChange={handleFormChange}
                    autoComplete="off"
                    placeholder="Different manager/admin username"
                  />
                </label>
                <label>
                  Independent Approver Password
                  <input
                    type="password"
                    name="approver_password"
                    value={form.approver_password}
                    onChange={handleFormChange}
                    autoComplete="new-password"
                    placeholder="Approver enters password privately"
                  />
                </label>
              </>
            )}
          </div>

          <div className="return-amount-box">
            <span>Estimated return amount</span>
            <strong>{formatMoney(estimatedReturnAmount)}</strong>
          </div>

          <button type="submit">Save Protected Return</button>
          </form>
        </details>
      </div>

      {saleItems.length > 0 && (
        <div className="section-card">
          <h2>Items in Selected Sale - {currentStoreCode}</h2>

          <div className="returns-table-wrap">
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
        </div>
      )}

      <div className="section-card">
        <h2>Filter Return Records - {currentStoreCode}</h2>

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
                window.setTimeout(() => loadReturns(), 0);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Return Records - {currentStoreCode}</h2>

        {returnsList.length === 0 ? (
          <p>No returns recorded yet for {currentStoreCode}.</p>
        ) : (
          <div className="returns-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Store</th>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Outcome</th>
                <th>Refund</th>
                <th>Recorded / Approved</th>
                <th>Reason</th>
              </tr>
            </thead>

            <tbody>
              {returnsList.map((returnItem) => (
                <tr key={returnItem.id}>
                  <td>{new Date(returnItem.returned_at).toLocaleString()}</td>
                  <td>{getRecordStoreCode(returnItem)}</td>
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
                  <td>{String(returnItem.return_type || "stock_only").replaceAll("_", " ")}</td>
                  <td>
                    <strong>{formatMoney(returnItem.refund_amount)}</strong>
                    <br />
                    <small>{String(returnItem.refund_method || "none").toUpperCase()} {returnItem.refund_reference ? `· ${returnItem.refund_reference}` : ""}</small>
                  </td>
                  <td>
                    {returnItem.returned_by_name || "System"}
                    <br />
                    <small>Approved: {returnItem.approved_by_name || "Not required"}</small>
                  </td>
                  <td>{returnItem.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}