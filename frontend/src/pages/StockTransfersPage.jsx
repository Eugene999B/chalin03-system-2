import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

function formatDate(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function cleanStatus(value) {
  return String(value || "").replaceAll("_", " ").toUpperCase();
}

function getBranchLabel(branch) {
  if (!branch) return "Unknown store";

  const code = branch.branch_code || branch.code || `#${branch.id}`;
  const name = branch.name || branch.branch_name || "Store";

  return `${code} — ${name}`;
}

function getProductLabel(product) {
  const parts = [
    product?.name,
    product?.category,
    product?.size,
    product?.barcode ? `Barcode: ${product.barcode}` : "",
  ].filter(Boolean);

  return parts.join(" • ");
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "dispatched", label: "Dispatched" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
];

const statusColors = {
  requested: "#92400e",
  approved: "#164777",
  dispatched: "#7c3aed",
  received: "#047857",
  cancelled: "#64748b",
  rejected: "#b91c1c",
};

export default function StockTransfersPage() {
  const { user, branchId, branchCode, branchName, canAccessAllBranches } =
    useAuth();

  const currentBranchId = Number(
    branchId || user?.branch_id || user?.default_branch_id || 0
  );

  const [branches, setBranches] = useState([]);
  const [transfers, setTransfers] = useState([]);

  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState(
    currentBranchId ? String(currentBranchId) : ""
  );

  const [fromBranchId, setFromBranchId] = useState(
    currentBranchId ? String(currentBranchId) : ""
  );
  const [toBranchId, setToBranchId] = useState("");

  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("");
  const [itemNote, setItemNote] = useState("");
  const [items, setItems] = useState([]);
  const [requestNote, setRequestNote] = useState("");

  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [actionNote, setActionNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState("");

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedProduct = useMemo(() => {
    return products.find(
      (product) => Number(product.id) === Number(selectedProductId)
    );
  }, [products, selectedProductId]);

  const currentStoreText =
    branchCode && branchName
      ? `${branchCode} — ${branchName}`
      : currentBranchId
      ? `Store ID ${currentBranchId}`
      : "No store selected";

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadTransfers();
  }, [statusFilter, branchFilter]);

  useEffect(() => {
    if (fromBranchId) {
      loadProducts();
    } else {
      setProducts([]);
    }
  }, [fromBranchId]);

  async function loadBranches() {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/stock-transfers/branches");
      const list = response.data?.branches || [];

      setBranches(list);

      if (!toBranchId && fromBranchId) {
        const firstOtherBranch = list.find(
          (branch) => Number(branch.id) !== Number(fromBranchId)
        );

        if (firstOtherBranch) {
          setToBranchId(String(firstOtherBranch.id));
        }
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to load stores for stock transfers."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadTransfers() {
    setLoading(true);
    setError("");

    try {
      const params = {
        status: statusFilter,
        limit: 80,
      };

      if (branchFilter) {
        params.branch_id = branchFilter;
      }

      const response = await axiosClient.get("/stock-transfers", { params });
      setTransfers(response.data?.transfers || []);
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load stock transfer history."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts() {
    setLoadingProducts(true);
    setError("");

    try {
      const response = await axiosClient.get("/stock-transfers/products", {
        params: {
          branch_id: fromBranchId,
          search: productSearch,
          limit: 80,
        },
      });

      setProducts(response.data?.products || []);
    } catch (err) {
      setProducts([]);
      setError(
        err.response?.data?.message ||
          "Failed to load products from the selected source store."
      );
    } finally {
      setLoadingProducts(false);
    }
  }

  async function loadTransferDetails(transferId) {
    setError("");

    try {
      const response = await axiosClient.get(`/stock-transfers/${transferId}`);
      setSelectedTransfer(response.data?.transfer || null);
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to load transfer details."
      );
    }
  }

  function addItem() {
    setNotice("");
    setError("");

    if (!selectedProduct) {
      setError("Please select a product.");
      return;
    }

    const quantity = Number(transferQuantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Please enter a valid quantity.");
      return;
    }

    const availableQuantity = Number(selectedProduct.quantity || 0);

    if (quantity > availableQuantity) {
      setError(
        `${selectedProduct.name} has only ${availableQuantity} in the source store.`
      );
      return;
    }

    const alreadyAdded = items.some(
      (item) => Number(item.source_product_id) === Number(selectedProduct.id)
    );

    if (alreadyAdded) {
      setError("This product is already in the transfer list.");
      return;
    }

    setItems((currentItems) => [
      ...currentItems,
      {
        source_product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        barcode: selectedProduct.barcode,
        category: selectedProduct.category,
        size: selectedProduct.size,
        available_quantity: availableQuantity,
        requested_quantity: quantity,
        item_note: itemNote.trim(),
      },
    ]);

    setSelectedProductId("");
    setTransferQuantity("");
    setItemNote("");
  }

  function removeItem(productId) {
    setItems((currentItems) =>
      currentItems.filter(
        (item) => Number(item.source_product_id) !== Number(productId)
      )
    );
  }

  async function createTransfer(event) {
    event.preventDefault();

    setSaving(true);
    setNotice("");
    setError("");

    try {
      if (!fromBranchId || !toBranchId) {
        throw new Error("Please select source and destination stores.");
      }

      if (Number(fromBranchId) === Number(toBranchId)) {
        throw new Error("Source and destination stores cannot be the same.");
      }

      if (items.length === 0) {
        throw new Error("Please add at least one product to transfer.");
      }

      const response = await axiosClient.post("/stock-transfers", {
        from_branch_id: Number(fromBranchId),
        to_branch_id: Number(toBranchId),
        request_note: requestNote,
        items: items.map((item) => ({
          source_product_id: item.source_product_id,
          requested_quantity: item.requested_quantity,
          item_note: item.item_note,
        })),
      });

      setNotice(
        response.data?.message || "Stock transfer request created successfully."
      );

      setItems([]);
      setRequestNote("");
      setSelectedTransfer(response.data?.transfer || null);

      await loadTransfers();
      await loadProducts();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to create stock transfer."
      );
    } finally {
      setSaving(false);
    }
  }

  async function downloadTransferPdf(transfer) {
    const transferId = transfer?.id;

    if (!transferId) {
      setError("Please select a transfer first.");
      return;
    }

    setActionLoading(`${transferId}-pdf`);
    setNotice("");
    setError("");

    try {
      const response = await axiosClient.get(`/stock-transfers/${transferId}/pdf`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: "application/pdf",
      });

      const url = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        transfer.transfer_number || `stock-transfer-${transferId}`
      }_transfer_note.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);

      setNotice("Transfer note PDF downloaded successfully.");
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to download transfer note PDF."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function runTransferAction(transferId, action) {
    setActionLoading(`${transferId}-${action}`);
    setNotice("");
    setError("");

    try {
      const noteKey =
        action === "approve"
          ? "approval_note"
          : action === "dispatch"
          ? "dispatch_note"
          : action === "receive"
          ? "receive_note"
          : action === "cancel"
          ? "cancel_note"
          : action === "reject"
          ? "reject_note"
          : "note";

      const response = await axiosClient.post(
        `/stock-transfers/${transferId}/${action}`,
        {
          [noteKey]: actionNote,
          note: actionNote,
        }
      );

      setNotice(response.data?.message || "Transfer updated successfully.");
      setActionNote("");
      setSelectedTransfer(response.data?.transfer || null);

      await loadTransfers();
      await loadProducts();
    } catch (err) {
      setError(
        err.response?.data?.message || "Failed to update the stock transfer."
      );
    } finally {
      setActionLoading("");
    }
  }

  function canApprove(transfer) {
    return String(transfer?.status) === "requested";
  }

  function canDispatch(transfer) {
    return String(transfer?.status) === "approved";
  }

  function canReceive(transfer) {
    return String(transfer?.status) === "dispatched";
  }

  function canCancel(transfer) {
    return ["requested", "approved"].includes(String(transfer?.status));
  }

  const styles = {
    page: {
      display: "grid",
      gap: "20px",
      color: "#07182c",
    },
    hero: {
      borderRadius: "24px",
      padding: "22px",
      background:
        "linear-gradient(135deg, #07182c 0%, #164777 58%, #0f172a 100%)",
      color: "#ffffff",
      boxShadow: "0 18px 45px rgba(15,23,42,0.18)",
    },
    heroTop: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: "12px",
      flexWrap: "wrap",
    },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      borderRadius: "999px",
      padding: "8px 12px",
      background: "rgba(224,186,40,0.16)",
      border: "1px solid rgba(224,186,40,0.35)",
      color: "#ffffff",
      fontWeight: "900",
      fontSize: "12px",
    },
    gridTwo: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
      gap: "16px",
    },
    card: {
      background: "#ffffff",
      borderRadius: "20px",
      border: "1px solid #dbe3ef",
      boxShadow: "0 12px 28px rgba(15,23,42,0.08)",
      padding: "18px",
      overflow: "hidden",
    },
    sectionTitle: {
      margin: "0 0 12px",
      fontSize: "18px",
      fontWeight: "950",
      color: "#07182c",
    },
    label: {
      display: "block",
      marginBottom: "6px",
      fontSize: "12px",
      fontWeight: "950",
      color: "#334155",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    },
    input: {
      width: "100%",
      boxSizing: "border-box",
      border: "1px solid #cbd5e1",
      borderRadius: "12px",
      padding: "11px 12px",
      fontSize: "14px",
      fontWeight: "800",
      outline: "none",
      color: "#07182c",
      background: "#ffffff",
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
      gap: "12px",
    },
    button: {
      border: "none",
      borderRadius: "12px",
      padding: "11px 14px",
      fontWeight: "950",
      cursor: "pointer",
      background: "#164777",
      color: "#ffffff",
    },
    goldButton: {
      border: "none",
      borderRadius: "12px",
      padding: "11px 14px",
      fontWeight: "950",
      cursor: "pointer",
      background: "#e0ba28",
      color: "#07182c",
    },
    dangerButton: {
      border: "none",
      borderRadius: "12px",
      padding: "9px 11px",
      fontWeight: "950",
      cursor: "pointer",
      background: "#b91c1c",
      color: "#ffffff",
    },
    smallButton: {
      border: "none",
      borderRadius: "10px",
      padding: "8px 10px",
      fontWeight: "900",
      cursor: "pointer",
      background: "#164777",
      color: "#ffffff",
      fontSize: "12px",
    },
    mutedButton: {
      border: "1px solid #cbd5e1",
      borderRadius: "10px",
      padding: "8px 10px",
      fontWeight: "900",
      cursor: "pointer",
      background: "#ffffff",
      color: "#164777",
      fontSize: "12px",
    },
    tableWrap: {
      width: "100%",
      overflowX: "auto",
      border: "1px solid #e2e8f0",
      borderRadius: "16px",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      minWidth: "850px",
    },
    th: {
      textAlign: "left",
      padding: "11px",
      background: "#f8fafc",
      borderBottom: "1px solid #e2e8f0",
      color: "#334155",
      fontSize: "12px",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
    },
    td: {
      padding: "11px",
      borderBottom: "1px solid #f1f5f9",
      verticalAlign: "top",
      fontSize: "13px",
      fontWeight: "750",
    },
    notice: {
      padding: "12px 14px",
      borderRadius: "14px",
      background: "#ecfdf5",
      border: "1px solid #bbf7d0",
      color: "#047857",
      fontWeight: "900",
      whiteSpace: "pre-wrap",
    },
    error: {
      padding: "12px 14px",
      borderRadius: "14px",
      background: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#b91c1c",
      fontWeight: "900",
      whiteSpace: "pre-wrap",
    },
    info: {
      padding: "12px 14px",
      borderRadius: "14px",
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      color: "#475569",
      fontWeight: "800",
      lineHeight: 1.5,
    },
  };

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroTop}>
          <div>
            <p
              style={{
                margin: 0,
                color: "#e0ba28",
                fontSize: "12px",
                fontWeight: "950",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Two-Store Control
            </p>

            <h1
              style={{
                margin: "6px 0 0",
                fontSize: "32px",
                fontWeight: "950",
                lineHeight: 1.08,
              }}
            >
              Stock Transfers
            </h1>

            <p
              style={{
                margin: "10px 0 0",
                maxWidth: "760px",
                color: "rgba(255,255,255,0.78)",
                lineHeight: 1.6,
                fontWeight: "750",
              }}
            >
              Move stock professionally between stores. The system records who
              requested, approved, dispatched and received the items, then keeps
              the full transfer history for audit.
            </p>
          </div>

          <span style={styles.badge}>🏬 Working Store: {currentStoreText}</span>
        </div>
      </section>

      {notice && <div style={styles.notice}>{notice}</div>}
      {error && <div style={styles.error}>{error}</div>}

      <section style={styles.gridTwo}>
        <form style={styles.card} onSubmit={createTransfer}>
          <h2 style={styles.sectionTitle}>Create Transfer Request</h2>

          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Source Store</label>
              <select
                value={fromBranchId}
                onChange={(event) => {
                  setFromBranchId(event.target.value);
                  setSelectedProductId("");
                  setItems([]);
                }}
                style={styles.input}
              >
                <option value="">Select source store</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {getBranchLabel(branch)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={styles.label}>Destination Store</label>
              <select
                value={toBranchId}
                onChange={(event) => setToBranchId(event.target.value)}
                style={styles.input}
              >
                <option value="">Select destination store</option>
                {branches.map((branch) => (
                  <option
                    key={branch.id}
                    value={branch.id}
                    disabled={Number(branch.id) === Number(fromBranchId)}
                  >
                    {getBranchLabel(branch)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: "12px" }}>
            <label style={styles.label}>Transfer Note</label>
            <textarea
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="Example: Send fast-moving filters to Store 2."
              style={{ ...styles.input, minHeight: "76px", resize: "vertical" }}
            />
          </div>

          <div
            style={{
              marginTop: "16px",
              padding: "14px",
              borderRadius: "16px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <h3 style={{ margin: "0 0 10px", fontWeight: "950" }}>
              Add Products
            </h3>

            <div style={styles.formGrid}>
              <div>
                <label style={styles.label}>Search Source Products</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Search name, barcode, category..."
                    style={styles.input}
                  />

                  <button
                    type="button"
                    onClick={loadProducts}
                    style={styles.smallButton}
                    disabled={loadingProducts || !fromBranchId}
                  >
                    {loadingProducts ? "..." : "Search"}
                  </button>
                </div>
              </div>

              <div>
                <label style={styles.label}>Product</label>
                <select
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                  style={styles.input}
                >
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {getProductLabel(product)} — Qty: {product.quantity}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={styles.label}>Quantity</label>
                <input
                  value={transferQuantity}
                  onChange={(event) => setTransferQuantity(event.target.value)}
                  type="number"
                  min="1"
                  placeholder="Quantity"
                  style={styles.input}
                />
              </div>
            </div>

            <div style={{ marginTop: "10px" }}>
              <label style={styles.label}>Item Note</label>
              <input
                value={itemNote}
                onChange={(event) => setItemNote(event.target.value)}
                placeholder="Optional item note"
                style={styles.input}
              />
            </div>

            {selectedProduct && (
              <p style={{ margin: "10px 0 0", color: "#475569" }}>
                Available in source store:{" "}
                <strong>{formatNumber(selectedProduct.quantity)}</strong>
              </p>
            )}

            <button
              type="button"
              onClick={addItem}
              style={{ ...styles.goldButton, marginTop: "12px" }}
            >
              Add Item to Transfer
            </button>
          </div>

          <div style={{ marginTop: "16px" }}>
            <h3 style={{ margin: "0 0 10px", fontWeight: "950" }}>
              Transfer Items
            </h3>

            {items.length === 0 ? (
              <div style={styles.info}>No items added yet.</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={{ ...styles.table, minWidth: "680px" }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Product</th>
                      <th style={styles.th}>Available</th>
                      <th style={styles.th}>Transfer Qty</th>
                      <th style={styles.th}>Note</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {items.map((item) => (
                      <tr key={item.source_product_id}>
                        <td style={styles.td}>
                          <strong>{item.product_name}</strong>
                          <br />
                          <span style={{ color: "#64748b" }}>
                            {[item.category, item.size, item.barcode]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {formatNumber(item.available_quantity)}
                        </td>
                        <td style={styles.td}>
                          {formatNumber(item.requested_quantity)}
                        </td>
                        <td style={styles.td}>{item.item_note || "—"}</td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            style={styles.dangerButton}
                            onClick={() => removeItem(item.source_product_id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <button
            type="submit"
            style={{ ...styles.button, marginTop: "16px", width: "100%" }}
            disabled={saving}
          >
            {saving ? "Creating Transfer..." : "Create Transfer Request"}
          </button>
        </form>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Transfer Detail</h2>

          {!selectedTransfer ? (
            <div style={styles.info}>
              Select a transfer from the history table to view full details and
              actions.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={styles.info}>
                <strong>{selectedTransfer.transfer_number}</strong>
                <br />
                {selectedTransfer.from_branch_code} —{" "}
                {selectedTransfer.from_branch_name} →{" "}
                {selectedTransfer.to_branch_code} —{" "}
                {selectedTransfer.to_branch_name}
                <br />
                Status:{" "}
                <strong
                  style={{
                    color: statusColors[selectedTransfer.status] || "#07182c",
                  }}
                >
                  {cleanStatus(selectedTransfer.status)}
                </strong>
                <br />
                Requested: {formatDate(selectedTransfer.requested_at)}
              </div>

              <textarea
                value={actionNote}
                onChange={(event) => setActionNote(event.target.value)}
                placeholder="Optional action note before approve, dispatch, receive, reject or cancel..."
                style={{
                  ...styles.input,
                  minHeight: "76px",
                  resize: "vertical",
                }}
              />

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={styles.mutedButton}
                  disabled={actionLoading === `${selectedTransfer.id}-pdf`}
                  onClick={() => downloadTransferPdf(selectedTransfer)}
                >
                  {actionLoading === `${selectedTransfer.id}-pdf`
                    ? "Downloading..."
                    : "Download Transfer Note PDF"}
                </button>

                {canApprove(selectedTransfer) && (
                  <button
                    type="button"
                    style={styles.smallButton}
                    disabled={actionLoading === `${selectedTransfer.id}-approve`}
                    onClick={() =>
                      runTransferAction(selectedTransfer.id, "approve")
                    }
                  >
                    Approve
                  </button>
                )}

                {canDispatch(selectedTransfer) && (
                  <button
                    type="button"
                    style={styles.smallButton}
                    disabled={
                      actionLoading === `${selectedTransfer.id}-dispatch`
                    }
                    onClick={() =>
                      runTransferAction(selectedTransfer.id, "dispatch")
                    }
                  >
                    Dispatch
                  </button>
                )}

                {canReceive(selectedTransfer) && (
                  <button
                    type="button"
                    style={styles.goldButton}
                    disabled={actionLoading === `${selectedTransfer.id}-receive`}
                    onClick={() =>
                      runTransferAction(selectedTransfer.id, "receive")
                    }
                  >
                    Receive
                  </button>
                )}

                {canCancel(selectedTransfer) && (
                  <>
                    <button
                      type="button"
                      style={styles.mutedButton}
                      disabled={
                        actionLoading === `${selectedTransfer.id}-cancel`
                      }
                      onClick={() =>
                        runTransferAction(selectedTransfer.id, "cancel")
                      }
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      style={styles.dangerButton}
                      disabled={
                        actionLoading === `${selectedTransfer.id}-reject`
                      }
                      onClick={() =>
                        runTransferAction(selectedTransfer.id, "reject")
                      }
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>

              <div style={styles.tableWrap}>
                <table style={{ ...styles.table, minWidth: "720px" }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Product</th>
                      <th style={styles.th}>Requested</th>
                      <th style={styles.th}>Dispatched</th>
                      <th style={styles.th}>Received</th>
                      <th style={styles.th}>Source Stock</th>
                      <th style={styles.th}>Destination Stock</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(selectedTransfer.items || []).map((item) => (
                      <tr key={item.id}>
                        <td style={styles.td}>
                          <strong>{item.product_name}</strong>
                          <br />
                          <span style={{ color: "#64748b" }}>
                            {[item.category, item.size, item.barcode]
                              .filter(Boolean)
                              .join(" • ") || "—"}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {formatNumber(item.requested_quantity)}
                        </td>
                        <td style={styles.td}>
                          {item.dispatched_quantity ?? "—"}
                        </td>
                        <td style={styles.td}>
                          {item.received_quantity ?? "—"}
                        </td>
                        <td style={styles.td}>
                          {item.source_quantity_before ?? "—"} →{" "}
                          {item.source_quantity_after ?? "—"}
                        </td>
                        <td style={styles.td}>
                          {item.destination_quantity_before ?? "—"} →{" "}
                          {item.destination_quantity_after ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <section style={styles.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            alignItems: "end",
            marginBottom: "14px",
          }}
        >
          <div>
            <h2 style={styles.sectionTitle}>Transfer History</h2>
            <p style={{ margin: 0, color: "#64748b", fontWeight: "750" }}>
              Track every stock movement between stores.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "10px",
              minWidth: "330px",
            }}
          >
            <div>
              <label style={styles.label}>Status</label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={styles.input}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={styles.label}>Store Filter</label>
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                style={styles.input}
              >
                {canAccessAllBranches && <option value="">All stores</option>}
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {getBranchLabel(branch)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={styles.info}>Loading stock transfers...</div>
        ) : transfers.length === 0 ? (
          <div style={styles.info}>No stock transfers found.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Transfer</th>
                  <th style={styles.th}>From</th>
                  <th style={styles.th}>To</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Items</th>
                  <th style={styles.th}>Requested By</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>

              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td style={styles.td}>
                      <strong>{transfer.transfer_number}</strong>
                    </td>
                    <td style={styles.td}>
                      {transfer.from_branch_code} —{" "}
                      {transfer.from_branch_name}
                    </td>
                    <td style={styles.td}>
                      {transfer.to_branch_code} — {transfer.to_branch_name}
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          display: "inline-flex",
                          borderRadius: "999px",
                          padding: "6px 10px",
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          color: statusColors[transfer.status] || "#07182c",
                          fontWeight: "950",
                          fontSize: "12px",
                        }}
                      >
                        {cleanStatus(transfer.status)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      {formatNumber(transfer.item_count)} item(s)
                      <br />
                      Qty: {formatNumber(transfer.total_requested_quantity)}
                    </td>
                    <td style={styles.td}>
                      {transfer.requested_by_name || "—"}
                    </td>
                    <td style={styles.td}>
                      {formatDate(transfer.requested_at)}
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        style={styles.smallButton}
                        onClick={() => loadTransferDetails(transfer.id)}
                      >
                        View / Action
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}