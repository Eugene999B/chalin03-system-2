import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import MultiItemReturnPanel from "../components/MultiItemReturnPanel";
import InventoryReturnUnitScanner from "../components/InventoryReturnUnitScanner";
import "./ReturnsPage.css";

const EMPTY_FORM = {
  product_id: "",
  quantity: "",
  reason: "",
  return_type: "stock_only",
  refund_amount: "0",
  refund_method: "none",
  refund_reference: "",
};

export default function ReturnsPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const currentStoreCode =
    branchCode || user?.branch_code || user?.selected_branch?.branch_code ||
    user?.selected_branch?.code || "STORE";
  const currentStoreName =
    branchName || user?.branch_name || user?.selected_branch?.branch_name ||
    user?.selected_branch?.name || "Selected Store";
  const currentStoreLocation =
    branchLocation || user?.branch_location ||
    user?.selected_branch?.branch_location || user?.selected_branch?.location || "";

  const [sales, setSales] = useState([]);
  const [selectedSaleId, setSelectedSaleId] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleItems, setSaleItems] = useState([]);
  const [returnsList, setReturnsList] = useState([]);
  const [summary, setSummary] = useState({
    return_count: 0,
    total_quantity_returned: 0,
    total_refunded: 0,
  });
  const [saleSearch, setSaleSearch] = useState("");
  const [returnSearch, setReturnSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [returnUnitIds, setReturnUnitIds] = useState([]);

  const selectedReturnItem = useMemo(
    () => saleItems.find((item) => Number(item.product_id) === Number(form.product_id)),
    [saleItems, form.product_id]
  );
  const estimatedReturnAmount =
    Number(selectedReturnItem?.unit_price || 0) * Number(form.quantity || 0);
  const serializedReturnRequired = Boolean(
    selectedReturnItem?.serialized_return_requires_unit_ids ||
      (selectedReturnItem?.inventory_tracking_mode === "serialized" &&
        selectedReturnItem?.inventory_traceability_state === "enforced")
  );

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function getRecordStoreCode(record) {
    return record?.branch_code || record?.store_code || currentStoreCode;
  }

  function getRecordStoreName(record) {
    return record?.branch_name || record?.store_name || currentStoreName;
  }

  function apiMessage(requestError, fallback) {
    return requestError?.response?.data?.message || fallback;
  }

  async function loadSales() {
    const response = await axiosClient.get("/returns/sales", {
      params: { search: saleSearch },
    });
    setSales(response.data.sales || []);
  }

  async function loadReturns() {
    const response = await axiosClient.get("/returns", {
      params: { search: returnSearch, from, to },
    });
    setReturnsList(response.data.returns || []);
    setSummary(response.data.summary || {});
  }

  async function loadPageData() {
    setError("");
    try {
      await Promise.all([loadSales(), loadReturns()]);
    } catch (requestError) {
      setError(
        apiMessage(
          requestError,
          "Failed to load returns. Make sure you are admin or manager."
        )
      );
    }
  }

  async function loadSaleItems(saleId) {
    setMessage("");
    setError("");
    if (!saleId) {
      setSelectedSale(null);
      setSaleItems([]);
      setReturnUnitIds([]);
      return;
    }

    try {
      const response = await axiosClient.get(`/returns/sales/${saleId}/items`);
      setSelectedSale({
        ...(response.data.sale || {}),
        branch_code:
          response.data.sale?.branch_code || response.data.sale?.store_code || currentStoreCode,
        branch_name:
          response.data.sale?.branch_name || response.data.sale?.store_name || currentStoreName,
        branch_location:
          response.data.sale?.branch_location || response.data.sale?.store_location || currentStoreLocation,
      });
      setSaleItems(response.data.items || []);
      setForm(EMPTY_FORM);
      setReturnUnitIds([]);
    } catch (requestError) {
      setError(apiMessage(requestError, "Failed to load sale items."));
    }
  }

  useEffect(() => {
    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function handleSaleSelect(event) {
    const saleId = event.target.value;
    setSelectedSaleId(saleId);
    setReturnUnitIds([]);
    loadSaleItems(saleId);
  }

  function handleFormChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (name === "product_id") {
      setReturnUnitIds([]);
    }
    if (name === "quantity") {
      const nextQuantity = Number(value || 0);
      setReturnUnitIds((current) =>
        Number.isInteger(nextQuantity) && nextQuantity >= 0
          ? current.slice(0, nextQuantity)
          : []
      );
    }
  }

  async function recordReturn(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!selectedSaleId || !form.product_id) {
      setError("Select the sale and returned product first.");
      return;
    }
    if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }
    if (!form.reason.trim()) {
      setError("Enter the reason for the return.");
      return;
    }
    if (
      serializedReturnRequired &&
      returnUnitIds.length !== Number(form.quantity)
    ) {
      setError(
        `${selectedReturnItem?.product_name || "This serialized product"} requires exactly ${Number(form.quantity)} verified returned physical unit ID${Number(form.quantity) === 1 ? "" : "s"}.`
      );
      return;
    }

    const isRefund = form.return_type === "refund";
    if (isRefund) {
      const refundAmount = Number(form.refund_amount || 0);
      if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        setError("Enter the actual amount to refund to the customer.");
        return;
      }
      if (refundAmount - estimatedReturnAmount > 0.009) {
        setError(`Refund cannot exceed ${formatMoney(estimatedReturnAmount)}.`);
        return;
      }
      if (!["cash", "momo", "bank", "other"].includes(form.refund_method)) {
        setError("Choose the exact channel that will be used for the refund.");
        return;
      }
      if (
        ["momo", "bank", "other"].includes(form.refund_method) &&
        !form.refund_reference.trim()
      ) {
        setError("Enter the transaction or reference number for this refund.");
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        sale_id: Number(selectedSaleId),
        product_id: Number(form.product_id),
        quantity: Number(form.quantity),
        reason: form.reason.trim(),
        return_type: isRefund ? "refund" : "stock_only",
        refund_amount: isRefund ? Number(form.refund_amount || 0) : 0,
        refund_method: isRefund ? form.refund_method : "none",
        refund_reference: isRefund ? form.refund_reference.trim() : "",
      };
      if (serializedReturnRequired) {
        payload.unit_ids = returnUnitIds;
      }

      const response = isRefund
        ? await axiosClient.post(
            "/audit-unlock-requests/operational/return-refund",
            payload
          )
        : await axiosClient.post("/returns", payload);

      const successMessage =
        response.data.message || "Return processed successfully.";
      setForm(EMPTY_FORM);
      setReturnUnitIds([]);

      if (isRefund) {
        await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);
      } else {
        await Promise.all([
          loadSaleItems(selectedSaleId),
          loadReturns(),
          loadSales(),
        ]);
      }
      // loadSaleItems intentionally clears stale messages when changing receipts.
      // Restore this completed action's server message after the refresh so the
      // operator keeps the quarantine/refund confirmation they need to see.
      setMessage(successMessage);
    } catch (requestError) {
      setError(apiMessage(requestError, "Failed to process the return."));
    } finally {
      setSaving(false);
    }
  }

  async function handleMultiReturnResult(result) {
    setError(result?.error || "");

    if (!result?.pendingApproval) {
      await Promise.all([
        loadSaleItems(selectedSaleId),
        loadReturns(),
        loadSales(),
      ]);
    } else {
      await Promise.all([loadSaleItems(selectedSaleId), loadSales()]);
    }
    setMessage(result?.message || "");
  }

  if (!["admin", "manager"].includes(role)) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Returns for {currentStoreCode} — {currentStoreName}.
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
            Record stock-only returns immediately or send financial refunds to
            the Admin Approval Centre for <strong>{currentStoreCode} — {currentStoreName}</strong>.
          </p>
        </div>
        <button type="button" onClick={loadPageData}>Refresh</button>
      </div>

      <div style={{
        marginBottom: 18,
        padding: 14,
        borderRadius: 14,
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        color: "#1e3a8a",
        fontWeight: 800,
      }}>
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Refund requests do not change stock, cash, debt or the original sale
          until an administrator approves from their own account.
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
          <span>{currentStoreCode} Executed Refunds</span>
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
              placeholder="Receipt, customer or phone"
            />
            <button type="button" onClick={loadSales}>Search</button>
          </div>

          <label>Select Sale</label>
          <select value={selectedSaleId} onChange={handleSaleSelect}>
            <option value="">Select receipt</option>
            {sales.map((sale) => (
              <option key={sale.id} value={sale.id}>
                {getRecordStoreCode(sale)} — {sale.receipt_number} — {sale.customer_name || "Walk-in"} — {formatMoney(sale.total)}
              </option>
            ))}
          </select>

          {selectedSale && (
            <div className="selected-sale-box">
              <h3>Selected Sale</h3>
              <p><strong>Store:</strong> {getRecordStoreCode(selectedSale)} — {getRecordStoreName(selectedSale)}</p>
              <p><strong>Receipt:</strong> {selectedSale.receipt_number}</p>
              <p><strong>Customer:</strong> {selectedSale.customer_name || "Walk-in Customer"}</p>
              <p><strong>Phone:</strong> {selectedSale.customer_phone || "-"}</p>
              <p><strong>Total:</strong> {formatMoney(selectedSale.total)}</p>
              <p><strong>Date:</strong> {new Date(selectedSale.created_at).toLocaleString()}</p>
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
          <summary>Single Item Return — exact-ID returns / fallback</summary>
          <form className="returns-single-form" onSubmit={recordReturn}>
            <h2>Record Return - {currentStoreCode}</h2>
            <div className="warning-box">
              Stock-only returns save immediately. A financial refund is sent to
              all authorized administrators and executes only after one approves it.
            </div>

            <label>Returned Product</label>
            <select name="product_id" value={form.product_id} onChange={handleFormChange}>
              <option value="">Select product from sale</option>
              {saleItems.map((item) => (
                <option
                  key={item.product_id}
                  value={item.product_id}
                  disabled={Number(item.remaining_quantity) <= 0}
                >
                  {item.product_name} — Sold: {item.quantity_sold} — Returned: {item.returned_quantity} — Remaining: {item.remaining_quantity}
                </option>
              ))}
            </select>

            <label>Quantity Returned</label>
            <input
              type="number"
              name="quantity"
              value={form.quantity}
              onChange={handleFormChange}
              min="1"
            />

            {serializedReturnRequired && selectedReturnItem ? (
              <div style={{ marginTop: 10, marginBottom: 12 }}>
                <InventoryReturnUnitScanner
                  saleId={selectedSaleId}
                  product={selectedReturnItem}
                  requiredCount={Number(form.quantity || 0)}
                  selectedUnitCodes={returnUnitIds}
                  onChange={setReturnUnitIds}
                  disabled={saving}
                />
                <div className="warning-box" style={{ marginTop: 10 }}>
                  Returned serialized units are quarantined first. They increase physical inventory but do not become sellable until an authorized inspection clears each exact ID.
                </div>
              </div>
            ) : null}

            <label>Reason</label>
            <textarea
              name="reason"
              value={form.reason}
              onChange={handleFormChange}
              placeholder="Wrong size, damaged, customer changed mind..."
            />

            <div className="returns-control-grid">
              <label>
                Return Outcome
                <select name="return_type" value={form.return_type} onChange={handleFormChange}>
                  <option value="stock_only">Stock only — no money returned</option>
                  <option value="refund">Financial refund — admin approval</option>
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
                </>
              )}
            </div>

            <div className="return-amount-box">
              <span>Maximum amount for selected quantity</span>
              <strong>{formatMoney(estimatedReturnAmount)}</strong>
            </div>

            <button type="submit" disabled={saving}>
              {saving
                ? "Processing..."
                : form.return_type === "refund"
                ? "Send Refund for Admin Approval"
                : "Save Stock-Only Return"}
            </button>
          </form>
        </details>
      </div>

      {saleItems.length > 0 && (
        <div className="section-card">
          <h2>Items in Selected Sale - {currentStoreCode}</h2>
          <div className="returns-table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>Sold</th><th>Returned</th><th>Remaining</th><th>Unit Price</th></tr>
              </thead>
              <tbody>
                {saleItems.map((item) => (
                  <tr key={item.product_id} className={Number(item.remaining_quantity) <= 0 ? "returned-row" : ""}>
                    <td><strong>{item.product_name}</strong></td>
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
          <div><label>Search</label><input value={returnSearch} onChange={(event) => setReturnSearch(event.target.value)} placeholder="Receipt, customer, product or reason" /></div>
          <div><label>From Date</label><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div><label>To Date</label><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <div className="filter-actions">
            <button type="button" onClick={loadReturns}>Apply</button>
            <button type="button" className="secondary-button" onClick={() => {
              setReturnSearch("");
              setFrom("");
              setTo("");
              window.setTimeout(() => loadReturns(), 0);
            }}>Clear</button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Executed Return Records - {currentStoreCode}</h2>
        {returnsList.length === 0 ? (
          <p>No executed returns recorded yet for {currentStoreCode}.</p>
        ) : (
          <div className="returns-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Store</th><th>Receipt</th><th>Customer</th>
                  <th>Product</th><th>Quantity</th><th>Outcome</th><th>Refund</th>
                  <th>Recorded / Approved</th><th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {returnsList.map((returnItem) => (
                  <tr key={returnItem.id}>
                    <td>{new Date(returnItem.returned_at).toLocaleString()}</td>
                    <td>{getRecordStoreCode(returnItem)}</td>
                    <td>{returnItem.receipt_number || "-"}</td>
                    <td>{returnItem.customer_name || "Walk-in"}<br /><small>{returnItem.customer_phone || "-"}</small></td>
                    <td><strong>{returnItem.product_name || "-"}</strong></td>
                    <td>{returnItem.quantity}</td>
                    <td>{String(returnItem.return_type || "stock_only").replaceAll("_", " ")}</td>
                    <td><strong>{formatMoney(returnItem.refund_amount)}</strong><br /><small>{String(returnItem.refund_method || "none").toUpperCase()} {returnItem.refund_reference ? `· ${returnItem.refund_reference}` : ""}</small></td>
                    <td>{returnItem.returned_by_name || "System"}<br /><small>Approved: {returnItem.approved_by_name || "Not required"}</small></td>
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
