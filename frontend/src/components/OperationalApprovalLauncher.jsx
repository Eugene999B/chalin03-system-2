import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";

const USER_KEY = "chalin03_user";
const TOKEN_KEY = "chalin03_token";

function parseStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function formatMoney(value) {
  return `GHS ${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function paymentLabel(value) {
  const labels = {
    cash: "Cash",
    momo: "MoMo",
    bank: "Bank",
    credit: "Credit",
    mixed: "Mixed",
  };
  return labels[String(value || "").toLowerCase()] || value || "-";
}

function kindLabel(value) {
  const labels = {
    return_refund: "Customer Refund",
    sale_edit: "Completed Sale Edit",
    sale_void: "Void Completed Sale",
  };
  return labels[value] || value || "Protected Action";
}

function executionLabel(request) {
  if (request.execution_status === "executed") return "Executed";
  if (request.execution_status === "executing") return "Executing";
  if (request.execution_status === "failed") return "Execution Failed";
  if (request.execution_status === "rejected") return "Rejected";
  if (request.status === "rejected") return "Rejected";
  return "Waiting for Admin";
}

function statusClass(request) {
  if (request.execution_status === "executed") return "approval-status-success";
  if (request.execution_status === "failed") return "approval-status-danger";
  if (request.execution_status === "executing") return "approval-status-info";
  if (request.status === "rejected" || request.execution_status === "rejected") {
    return "approval-status-danger";
  }
  return "approval-status-pending";
}

function emptySaleForm() {
  return {
    sale_id: "",
    customer_name: "",
    customer_phone: "",
    customer_location: "",
    payment_type: "cash",
    discount_amount: "0",
    amount_tendered: "0",
    payment_allocations: { cash: "", momo: "", bank: "", other: "" },
    edit_reason: "",
    items: [],
  };
}

function normalizeSaleItems(items) {
  return (items || []).map((item) => ({
    product_id: String(item.product_id || ""),
    product_name: item.product_name || "",
    quantity: String(item.quantity || 1),
    unit_price: String(item.unit_price ?? ""),
  }));
}

export default function OperationalApprovalLauncher() {
  const [identity, setIdentity] = useState(() => ({
    user: parseStoredUser(),
    token: localStorage.getItem(TOKEN_KEY),
    path: window.location.pathname,
  }));
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("requests");
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({});
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [saleMode, setSaleMode] = useState("edit");
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const [voidReason, setVoidReason] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewDecision, setReviewDecision] = useState("approve");
  const [reviewPassword, setReviewPassword] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const user = identity.user;
  const role = String(user?.role || "").toLowerCase();
  const workspaceCode = String(
    user?.workspace_code || user?.active_workspace?.code || "spare_parts"
  ).toLowerCase();
  const visible = Boolean(
    identity.token &&
      ["admin", "manager"].includes(role) &&
      workspaceCode === "spare_parts" &&
      !identity.path.startsWith("/login")
  );
  const isAdmin = role === "admin";

  const pendingCount = useMemo(
    () =>
      requests.filter(
        (request) =>
          request.execution_status === "pending" ||
          request.execution_status === "failed"
      ).length,
    [requests]
  );

  useEffect(() => {
    const syncIdentity = () => {
      setIdentity({
        user: parseStoredUser(),
        token: localStorage.getItem(TOKEN_KEY),
        path: window.location.pathname,
      });
    };

    const interval = window.setInterval(syncIdentity, 3000);
    window.addEventListener("storage", syncIdentity);
    window.addEventListener("popstate", syncIdentity);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", syncIdentity);
      window.removeEventListener("popstate", syncIdentity);
    };
  }, []);

  useEffect(() => {
    if (!visible) return undefined;

    loadRequests(true);
    const interval = window.setInterval(() => loadRequests(true), 45000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, user?.branch_id, role]);

  async function loadRequests(silent = false) {
    if (!visible) return;
    if (!silent) setLoading(true);

    try {
      const response = await axiosClient.get(
        "/audit-unlock-requests/operational"
      );
      setRequests(response.data.requests || []);
      setSummary(response.data.summary || {});
      if (!silent) setError("");
    } catch (requestError) {
      if (!silent) {
        setError(
          requestError.response?.data?.message ||
            "Failed to load protected approval requests."
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadSales() {
    setLoading(true);
    setError("");
    try {
      const [salesResponse, productsResponse] = await Promise.all([
        axiosClient.get("/sales", {
          params: { search: "", product_search: "", from: "", to: "" },
        }),
        axiosClient.get("/products"),
      ]);
      setSales(
        (salesResponse.data.sales || []).filter(
          (sale) =>
            Number(sale.is_voided || 0) !== 1 &&
            !["voided", "cancelled"].includes(
              String(sale.sale_status || "").toLowerCase()
            )
        )
      );
      setProducts(productsResponse.data.products || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to load sales for a correction request."
      );
    } finally {
      setLoading(false);
    }
  }

  function showCentre(nextTab = "requests") {
    setOpen(true);
    setTab(nextTab);
    setMessage("");
    setError("");
    loadRequests();
    if (nextTab === "new") loadSales();
  }

  function closeCentre() {
    if (saving) return;
    setOpen(false);
    setReviewTarget(null);
    setReviewPassword("");
    setReviewNote("");
  }

  async function selectSale(saleIdValue) {
    const saleId = Number(saleIdValue);
    setSaleForm((current) => ({ ...current, sale_id: saleIdValue }));
    setSelectedSale(null);
    setError("");
    if (!saleId) return;

    setLoading(true);
    try {
      const response = await axiosClient.get(`/sales/${saleId}`);
      const sale = response.data.sale || {};
      setSelectedSale(sale);
      setSaleForm({
        sale_id: String(saleId),
        customer_name: sale.customer_name || "",
        customer_phone: sale.customer_phone || "",
        customer_location: sale.customer_location || "",
        payment_type: sale.payment_type || "cash",
        discount_amount: String(sale.discount_amount || 0),
        amount_tendered: String(
          sale.amount_tendered ?? sale.amount_paid ?? sale.total ?? 0
        ),
        payment_allocations: {
          cash: String(response.data.payment_allocations?.cash || ""),
          momo: String(response.data.payment_allocations?.momo || ""),
          bank: String(response.data.payment_allocations?.bank || ""),
          other: String(response.data.payment_allocations?.other || ""),
        },
        edit_reason: "",
        items: normalizeSaleItems(response.data.items),
      });
      setVoidReason("");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to load the selected sale."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateItem(index, field, value) {
    setSaleForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function chooseProduct(index, productIdValue) {
    const product = products.find(
      (entry) => Number(entry.id) === Number(productIdValue)
    );
    setSaleForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              product_id: productIdValue,
              product_name: product?.name || "",
              unit_price: product
                ? String(product.selling_price ?? item.unit_price ?? "")
                : "",
            }
          : item
      ),
    }));
  }

  function addItem() {
    setSaleForm((current) => ({
      ...current,
      items: [
        ...current.items,
        { product_id: "", product_name: "", quantity: "1", unit_price: "" },
      ],
    }));
  }

  function removeItem(index) {
    setSaleForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function submitSaleRequest(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    const saleId = Number(saleForm.sale_id);
    if (!saleId || !selectedSale) {
      setError("Select the completed sale first.");
      return;
    }

    if (saleMode === "void") {
      if (!voidReason.trim()) {
        setError("Enter the exact business reason for voiding this sale.");
        return;
      }

      const confirmed = window.confirm(
        `Send a request to void ${selectedSale.receipt_number}? The sale will remain unchanged until an administrator approves it.`
      );
      if (!confirmed) return;

      setSaving(true);
      try {
        const response = await axiosClient.post(
          `/audit-unlock-requests/operational/sale-void/${saleId}`,
          { reason: voidReason.trim() }
        );
        setMessage(response.data.message || "Sale-void request sent.");
        setVoidReason("");
        await loadRequests(true);
        setTab("requests");
      } catch (requestError) {
        setError(
          requestError.response?.data?.message ||
            "Failed to send the sale-void request."
        );
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!saleForm.edit_reason.trim()) {
      setError("Enter the exact reason for editing the completed sale.");
      return;
    }
    if (!saleForm.items.length) {
      setError("The proposed sale must contain at least one product.");
      return;
    }

    const badItem = saleForm.items.find(
      (item) =>
        !Number(item.product_id) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) <= 0
    );
    if (badItem) {
      setError("Every proposed item requires a product and positive whole quantity.");
      return;
    }

    const splitTotal = Object.values(saleForm.payment_allocations || {}).reduce(
      (sum, value) => sum + Math.max(Number(value || 0), 0),
      0
    );
    const paidNow = ["cash", "momo", "bank"].includes(saleForm.payment_type)
      ? Number(saleForm.amount_tendered || 0)
      : splitTotal;

    const confirmed = window.confirm(
      `Send the proposed changes to ${selectedSale.receipt_number} for administrator approval? The current sale will not change yet.`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const response = await axiosClient.post(
        `/audit-unlock-requests/operational/sale-edit/${saleId}`,
        {
          customer_name: saleForm.customer_name,
          customer_phone: saleForm.customer_phone,
          customer_location: saleForm.customer_location,
          payment_type: saleForm.payment_type,
          discount_amount: Number(saleForm.discount_amount || 0),
          amount_tendered: paidNow,
          amount_paid: paidNow,
          payment_allocations: saleForm.payment_allocations,
          edit_reason: saleForm.edit_reason.trim(),
          items: saleForm.items.map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity),
            unit_price:
              item.unit_price === "" ? undefined : Number(item.unit_price),
          })),
        }
      );
      setMessage(response.data.message || "Sale-edit request sent.");
      setSaleForm(emptySaleForm());
      setSelectedSale(null);
      await loadRequests(true);
      setTab("requests");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to send the sale-edit request."
      );
    } finally {
      setSaving(false);
    }
  }

  function openReview(request, decision) {
    setReviewTarget(request);
    setReviewDecision(decision);
    setReviewPassword("");
    setReviewNote(
      decision === "approve"
        ? "Reviewed the amount, reason, original record and proposed action. Approved."
        : ""
    );
    setMessage("");
    setError("");
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!reviewTarget || !reviewPassword) {
      setError("Enter your own administrator password.");
      return;
    }
    if (!reviewNote.trim()) {
      setError(
        reviewDecision === "approve"
          ? "Enter an approval note."
          : "Enter the rejection reason."
      );
      return;
    }

    const confirmed = window.confirm(
      reviewDecision === "approve"
        ? `Approve and execute ${reviewTarget.request_code}?`
        : `Reject ${reviewTarget.request_code} without changing any business record?`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const response = await axiosClient.post(
        `/audit-unlock-requests/operational/${reviewTarget.id}/${reviewDecision}`,
        {
          password: reviewPassword,
          review_note: reviewNote.trim(),
        }
      );
      setMessage(response.data.message || "Request reviewed successfully.");
      setReviewTarget(null);
      setReviewPassword("");
      setReviewNote("");
      await loadRequests(true);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to review the protected request."
      );
      await loadRequests(true);
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      <style>{`
        .approval-launcher-button {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2450;
          border: 1px solid #7c5d00;
          border-radius: 999px;
          background: linear-gradient(135deg, #f3cf4f, #d9a90e);
          color: #07182c;
          box-shadow: 0 18px 48px rgba(7, 24, 44, .30);
          padding: 12px 17px;
          font-weight: 950;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 9px;
        }
        .approval-launcher-count {
          min-width: 24px;
          height: 24px;
          border-radius: 999px;
          background: #b91c1c;
          color: white;
          display: grid;
          place-items: center;
          font-size: 12px;
        }
        .approval-overlay {
          position: fixed;
          inset: 0;
          z-index: 4200;
          background: rgba(2, 6, 23, .74);
          backdrop-filter: blur(8px);
          padding: 20px;
          display: grid;
          place-items: center;
        }
        .approval-modal {
          width: min(1120px, 100%);
          max-height: 92dvh;
          overflow: hidden;
          background: #f8fafc;
          border-radius: 26px;
          box-shadow: 0 34px 100px rgba(0,0,0,.42);
          display: grid;
          grid-template-rows: auto auto minmax(0,1fr);
        }
        .approval-header {
          padding: 19px 21px;
          color: white;
          background: linear-gradient(135deg, #07182c, #0d2f55 62%, #111827);
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: flex-start;
        }
        .approval-header h2 { margin: 4px 0 0; font-size: 25px; }
        .approval-header p { margin: 7px 0 0; color: rgba(255,255,255,.74); }
        .approval-close {
          border: 1px solid rgba(255,255,255,.25);
          background: rgba(255,255,255,.10);
          color: white;
          border-radius: 13px;
          padding: 9px 12px;
          font-weight: 900;
          cursor: pointer;
        }
        .approval-tabs {
          padding: 11px 15px;
          background: white;
          border-bottom: 1px solid #dbe3ef;
          display: flex;
          gap: 9px;
          flex-wrap: wrap;
        }
        .approval-tabs button {
          border: 1px solid #dbe3ef;
          background: white;
          color: #0f2745;
          border-radius: 999px;
          padding: 9px 13px;
          font-weight: 900;
          cursor: pointer;
        }
        .approval-tabs button.active {
          background: #07182c;
          color: white;
          border-color: #07182c;
        }
        .approval-body { overflow: auto; padding: 17px; }
        .approval-alert { padding: 11px 13px; border-radius: 13px; margin-bottom: 12px; font-weight: 800; }
        .approval-success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
        .approval-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
        .approval-summary-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(135px,1fr)); gap: 10px; margin-bottom: 14px; }
        .approval-summary-card { background: white; border: 1px solid #dbe3ef; border-radius: 15px; padding: 12px; }
        .approval-summary-card span { display:block; color:#64748b; font-size:12px; font-weight:800; }
        .approval-summary-card strong { display:block; margin-top:5px; font-size:20px; color:#07182c; }
        .approval-list { display:grid; gap:11px; }
        .approval-card { background:white; border:1px solid #dbe3ef; border-radius:17px; padding:14px; box-shadow:0 10px 24px rgba(15,23,42,.06); }
        .approval-card-top { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .approval-card h3 { margin:0; color:#07182c; }
        .approval-card p { margin:7px 0 0; line-height:1.5; color:#334155; overflow-wrap:anywhere; }
        .approval-meta { margin-top:9px; color:#64748b; font-size:12px; font-weight:750; }
        .approval-status { display:inline-flex; align-items:center; border-radius:999px; padding:6px 10px; font-size:11px; font-weight:950; height:max-content; }
        .approval-status-pending { background:#fef3c7; color:#92400e; }
        .approval-status-success { background:#dcfce7; color:#166534; }
        .approval-status-danger { background:#fee2e2; color:#991b1b; }
        .approval-status-info { background:#dbeafe; color:#1d4ed8; }
        .approval-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
        .approval-actions button, .approval-primary, .approval-secondary, .approval-danger {
          border-radius:12px; padding:9px 12px; font-weight:900; cursor:pointer;
        }
        .approval-primary { border:1px solid #07182c; background:#07182c; color:white; }
        .approval-secondary { border:1px solid #cbd5e1; background:white; color:#07182c; }
        .approval-danger { border:1px solid #b91c1c; background:#b91c1c; color:white; }
        .approval-form-card { background:white; border:1px solid #dbe3ef; border-radius:18px; padding:15px; }
        .approval-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; }
        .approval-form-card label { display:block; font-weight:850; color:#0f2745; }
        .approval-form-card input, .approval-form-card select, .approval-form-card textarea {
          width:100%; margin-top:5px; border:1px solid #cbd5e1; border-radius:11px; padding:10px; font:inherit; background:white;
        }
        .approval-items { display:grid; gap:10px; margin-top:14px; }
        .approval-item { display:grid; grid-template-columns:minmax(180px,1fr) 100px 135px auto; gap:9px; align-items:end; padding:10px; border:1px solid #e2e8f0; border-radius:13px; background:#f8fafc; }
        .approval-review-overlay { position:fixed; inset:0; z-index:4300; display:grid; place-items:center; background:rgba(2,6,23,.68); padding:18px; }
        .approval-review-modal { width:min(620px,100%); max-height:90dvh; overflow:auto; background:white; border-radius:22px; padding:18px; box-shadow:0 30px 90px rgba(0,0,0,.4); }
        @media (max-width: 720px) {
          .approval-launcher-button { right:10px; bottom:10px; padding:10px 13px; }
          .approval-overlay { padding:0; align-items:end; }
          .approval-modal { max-height:96dvh; border-radius:22px 22px 0 0; }
          .approval-header { padding:15px; }
          .approval-body { padding:11px; }
          .approval-item { grid-template-columns:1fr; }
          .approval-actions { display:grid; grid-template-columns:1fr; }
          .approval-actions button { width:100%; }
        }
      `}</style>

      <button
        type="button"
        className="approval-launcher-button"
        onClick={() => showCentre("requests")}
        title="Open protected admin approvals"
      >
        <span>🔐 Approval Centre</span>
        {pendingCount > 0 ? (
          <span className="approval-launcher-count">{pendingCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="approval-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCentre();
        }}>
          <section className="approval-modal">
            <header className="approval-header">
              <div>
                <small style={{ color: "#f3cf4f", fontWeight: 950 }}>
                  CHALIN 03 PROTECTED WORKFLOW
                </small>
                <h2>Admin Approval Centre</h2>
                <p>
                  Managers submit sensitive actions. Any authorized administrator
                  can review and execute them from their own account.
                </p>
              </div>
              <button type="button" className="approval-close" onClick={closeCentre}>
                ✕ Close
              </button>
            </header>

            <nav className="approval-tabs">
              <button
                type="button"
                className={tab === "requests" ? "active" : ""}
                onClick={() => {
                  setTab("requests");
                  loadRequests();
                }}
              >
                Requests {pendingCount ? `(${pendingCount})` : ""}
              </button>
              <button
                type="button"
                className={tab === "new" ? "active" : ""}
                onClick={() => {
                  setTab("new");
                  loadSales();
                }}
              >
                New Sale Edit / Void Request
              </button>
            </nav>

            <div className="approval-body">
              {message ? <div className="approval-alert approval-success">{message}</div> : null}
              {error ? <div className="approval-alert approval-error">{error}</div> : null}

              {tab === "requests" ? (
                <>
                  <div className="approval-summary-grid">
                    <div className="approval-summary-card"><span>Visible Requests</span><strong>{summary.total || requests.length}</strong></div>
                    <div className="approval-summary-card"><span>Waiting</span><strong>{summary.pending || 0}</strong></div>
                    <div className="approval-summary-card"><span>Executed</span><strong>{summary.executed || 0}</strong></div>
                    <div className="approval-summary-card"><span>Failed</span><strong>{summary.failed || 0}</strong></div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 11 }}>
                    <button type="button" className="approval-secondary" onClick={() => loadRequests()} disabled={loading}>
                      {loading ? "Refreshing…" : "Refresh Requests"}
                    </button>
                  </div>

                  {requests.length === 0 ? (
                    <div className="approval-form-card">
                      No protected operational requests are available for this account.
                    </div>
                  ) : (
                    <div className="approval-list">
                      {requests.map((request) => (
                        <article className="approval-card" key={request.id}>
                          <div className="approval-card-top">
                            <div>
                              <h3>{kindLabel(request.approval_kind)} · {request.request_code}</h3>
                              <div className="approval-meta">
                                {request.branch_code || "STORE"} — {request.branch_name || "Selected Store"} · {formatDateTime(request.created_at)}
                              </div>
                            </div>
                            <span className={`approval-status ${statusClass(request)}`}>
                              {executionLabel(request)}
                            </span>
                          </div>

                          <p><strong>Requested by:</strong> {request.requested_by_name || request.requested_by_username || "-"}</p>
                          <p><strong>Amount / value:</strong> {formatMoney(request.approval_amount)}</p>
                          <p><strong>Details:</strong> {request.reason || request.requested_action}</p>
                          {request.review_notes ? <p><strong>Admin note:</strong> {request.review_notes}</p> : null}
                          {request.execution_error ? <p style={{ color: "#991b1b" }}><strong>Execution error:</strong> {request.execution_error}</p> : null}

                          {isAdmin && ["pending", "failed"].includes(request.execution_status) ? (
                            <div className="approval-actions">
                              <button type="button" className="approval-primary" onClick={() => openReview(request, "approve")}>
                                {request.execution_status === "failed" ? "Review and Retry" : "Approve and Execute"}
                              </button>
                              <button type="button" className="approval-danger" onClick={() => openReview(request, "reject")}>
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <form className="approval-form-card" onSubmit={submitSaleRequest}>
                  <h3 style={{ marginTop: 0 }}>Request a Completed-Sale Correction</h3>
                  <p style={{ color: "#64748b", lineHeight: 1.5 }}>
                    This prepares the exact change for an administrator. The current
                    receipt, stock, debt and accounting records remain untouched until approval.
                  </p>

                  <div className="approval-grid">
                    <label>
                      Action
                      <select value={saleMode} onChange={(event) => setSaleMode(event.target.value)}>
                        <option value="edit">Edit completed sale</option>
                        <option value="void">Void completed sale</option>
                      </select>
                    </label>
                    <label>
                      Completed sale
                      <select value={saleForm.sale_id} onChange={(event) => selectSale(event.target.value)} required>
                        <option value="">Select receipt</option>
                        {sales.map((sale) => (
                          <option key={sale.id} value={sale.id}>
                            {sale.receipt_number} — {sale.customer_name || "Walk-in"} — {formatMoney(sale.total)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {selectedSale ? (
                    <div className="approval-alert" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", marginTop: 12 }}>
                      Current receipt: <strong>{selectedSale.receipt_number}</strong> · {paymentLabel(selectedSale.payment_type)} · {formatMoney(selectedSale.total)}
                    </div>
                  ) : null}

                  {saleMode === "void" ? (
                    <label style={{ marginTop: 13 }}>
                      Exact void reason
                      <textarea rows="4" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Explain why this completed sale must be cancelled" required />
                    </label>
                  ) : (
                    <>
                      <div className="approval-grid" style={{ marginTop: 13 }}>
                        <label>Customer name<input value={saleForm.customer_name} onChange={(event) => setSaleForm((current) => ({ ...current, customer_name: event.target.value }))} /></label>
                        <label>Customer phone<input value={saleForm.customer_phone} onChange={(event) => setSaleForm((current) => ({ ...current, customer_phone: event.target.value }))} /></label>
                        <label>Payment type<select value={saleForm.payment_type} onChange={(event) => setSaleForm((current) => ({ ...current, payment_type: event.target.value }))}>{["cash","momo","bank","credit","mixed"].map((method) => <option key={method} value={method}>{paymentLabel(method)}</option>)}</select></label>
                        <label>Discount<input type="number" min="0" step="0.01" value={saleForm.discount_amount} onChange={(event) => setSaleForm((current) => ({ ...current, discount_amount: event.target.value }))} /></label>
                        {["cash","momo","bank"].includes(saleForm.payment_type) ? (
                          <label>Amount tendered<input type="number" min="0" step="0.01" value={saleForm.amount_tendered} onChange={(event) => setSaleForm((current) => ({ ...current, amount_tendered: event.target.value }))} /></label>
                        ) : null}
                        <label>Correction reason<input value={saleForm.edit_reason} onChange={(event) => setSaleForm((current) => ({ ...current, edit_reason: event.target.value }))} placeholder="Required" required /></label>
                      </div>

                      {!["cash","momo","bank"].includes(saleForm.payment_type) ? (
                        <div className="approval-grid" style={{ marginTop: 12 }}>
                          {["cash","momo","bank","other"].map((channel) => (
                            <label key={channel}>{channel.toUpperCase()} paid<input type="number" min="0" step="0.01" value={saleForm.payment_allocations[channel]} onChange={(event) => setSaleForm((current) => ({ ...current, payment_allocations: { ...current.payment_allocations, [channel]: event.target.value } }))} /></label>
                          ))}
                        </div>
                      ) : null}

                      <div className="approval-items">
                        <strong>Proposed items</strong>
                        {saleForm.items.map((item, index) => (
                          <div className="approval-item" key={`${item.product_id}-${index}`}>
                            <label>Product<select value={item.product_id} onChange={(event) => chooseProduct(index, event.target.value)} required><option value="">Select product</option>{item.product_id && !products.some((product) => Number(product.id) === Number(item.product_id)) ? <option value={item.product_id}>{item.product_name}</option> : null}{products.filter((product) => Number(product.is_active ?? 1) === 1).map((product) => <option key={product.id} value={product.id}>{product.name} — Stock {Number(product.quantity || 0)}</option>)}</select></label>
                            <label>Qty<input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required /></label>
                            <label>Unit price<input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => updateItem(index, "unit_price", event.target.value)} /></label>
                            <button type="button" className="approval-danger" onClick={() => removeItem(index)} disabled={saleForm.items.length === 1}>Remove</button>
                          </div>
                        ))}
                        <button type="button" className="approval-secondary" onClick={addItem}>Add Product</button>
                      </div>
                    </>
                  )}

                  <div className="approval-actions" style={{ marginTop: 16 }}>
                    <button type="submit" className="approval-primary" disabled={saving || loading}>
                      {saving ? "Sending…" : saleMode === "void" ? "Send Void Request" : "Send Sale Edit for Approval"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {reviewTarget ? (
        <div className="approval-review-overlay">
          <form className="approval-review-modal" onSubmit={submitReview}>
            <h2 style={{ marginTop: 0 }}>
              {reviewDecision === "approve" ? "Approve and Execute" : "Reject Request"}
            </h2>
            <p><strong>{reviewTarget.request_code}</strong> · {kindLabel(reviewTarget.approval_kind)} · {formatMoney(reviewTarget.approval_amount)}</p>
            <div className="approval-alert" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#334155" }}>
              {reviewTarget.reason}
            </div>
            <label style={{ display: "block", fontWeight: 850 }}>
              {reviewDecision === "approve" ? "Approval note" : "Rejection reason"}
              <textarea style={{ width: "100%", marginTop: 5, padding: 10, borderRadius: 11, border: "1px solid #cbd5e1" }} rows="4" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} required />
            </label>
            <label style={{ display: "block", fontWeight: 850, marginTop: 12 }}>
              Your administrator password
              <input style={{ width: "100%", marginTop: 5, padding: 10, borderRadius: 11, border: "1px solid #cbd5e1" }} type="password" value={reviewPassword} onChange={(event) => setReviewPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            <p style={{ color: "#64748b", fontSize: 12 }}>
              Your password is verified on this device for this decision and is never saved in the approval request.
            </p>
            <div className="approval-actions">
              <button type="submit" className={reviewDecision === "approve" ? "approval-primary" : "approval-danger"} disabled={saving}>
                {saving ? "Processing…" : reviewDecision === "approve" ? "Approve and Execute Now" : "Reject Without Changes"}
              </button>
              <button type="button" className="approval-secondary" onClick={() => setReviewTarget(null)} disabled={saving}>Cancel</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
