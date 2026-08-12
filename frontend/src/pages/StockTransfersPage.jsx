import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import InventoryTransferIdentityPanel from "../components/InventoryTransferIdentityPanel";

function MobilePageFix() {
  return (
    <style>{`
      @media (max-width: 820px) {
        .boss-mobile-fix {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow-x: hidden !important;
          padding: 10px !important;
          margin: 0 !important;
        }

        .boss-mobile-fix,
        .boss-mobile-fix * {
          box-sizing: border-box !important;
        }

        .boss-mobile-fix * {
          max-width: 100% !important;
        }

        .boss-mobile-fix section,
        .boss-mobile-fix article,
        .boss-mobile-fix form,
        .boss-mobile-fix header,
        .boss-mobile-fix main,
        .boss-mobile-fix aside {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="display: grid"],
        .boss-mobile-fix [style*="grid-template-columns"] {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        .boss-mobile-fix [style*="display: flex"] {
          flex-wrap: wrap !important;
        }

        .boss-mobile-fix [style*="justify-content: space-between"] {
          justify-content: flex-start !important;
        }

        .boss-mobile-fix [style*="align-items: center"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width:"],
        .boss-mobile-fix [style*="min-width"],
        .boss-mobile-fix [style*="max-width"] {
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="width: 420"],
        .boss-mobile-fix [style*="width: 360"],
        .boss-mobile-fix [style*="width: 340"],
        .boss-mobile-fix [style*="width: 320"],
        .boss-mobile-fix [style*="width: 300"],
        .boss-mobile-fix [style*="width: 280"],
        .boss-mobile-fix [style*="width: 260"],
        .boss-mobile-fix [style*="width: 240"],
        .boss-mobile-fix [style*="min-width: 420"],
        .boss-mobile-fix [style*="min-width: 360"],
        .boss-mobile-fix [style*="min-width: 340"],
        .boss-mobile-fix [style*="min-width: 320"],
        .boss-mobile-fix [style*="min-width: 300"],
        .boss-mobile-fix [style*="min-width: 280"],
        .boss-mobile-fix [style*="min-width: 260"],
        .boss-mobile-fix [style*="min-width: 240"] {
          width: 100% !important;
          min-width: 0 !important;
        }

        .boss-mobile-fix [style*="padding: 34"],
        .boss-mobile-fix [style*="padding: 32"],
        .boss-mobile-fix [style*="padding: 30"],
        .boss-mobile-fix [style*="padding: 28"],
        .boss-mobile-fix [style*="padding: 26"],
        .boss-mobile-fix [style*="padding: 24"],
        .boss-mobile-fix [style*="padding: 22"],
        .boss-mobile-fix [style*="padding: 20"] {
          padding: 16px !important;
        }

        .boss-mobile-fix [style*="border-radius: 40"],
        .boss-mobile-fix [style*="border-radius: 36"],
        .boss-mobile-fix [style*="border-radius: 34"],
        .boss-mobile-fix [style*="border-radius: 32"],
        .boss-mobile-fix [style*="border-radius: 30"],
        .boss-mobile-fix [style*="border-radius: 28"] {
          border-radius: 22px !important;
        }

        .boss-mobile-fix h1,
        .boss-mobile-fix [style*="font-size: 56"],
        .boss-mobile-fix [style*="font-size: 54"],
        .boss-mobile-fix [style*="font-size: 52"],
        .boss-mobile-fix [style*="font-size: 50"],
        .boss-mobile-fix [style*="font-size: 48"],
        .boss-mobile-fix [style*="font-size: 46"],
        .boss-mobile-fix [style*="font-size: 44"],
        .boss-mobile-fix [style*="font-size: 42"],
        .boss-mobile-fix [style*="font-size: 40"] {
          font-size: 31px !important;
          line-height: 1.06 !important;
          letter-spacing: -0.04em !important;
        }

        .boss-mobile-fix h2,
        .boss-mobile-fix [style*="font-size: 32"],
        .boss-mobile-fix [style*="font-size: 30"],
        .boss-mobile-fix [style*="font-size: 28"] {
          font-size: 21px !important;
          line-height: 1.15 !important;
        }

        .boss-mobile-fix h3,
        .boss-mobile-fix [style*="font-size: 24"],
        .boss-mobile-fix [style*="font-size: 22"] {
          font-size: 18px !important;
          line-height: 1.2 !important;
        }

        .boss-mobile-fix p,
        .boss-mobile-fix span,
        .boss-mobile-fix small,
        .boss-mobile-fix strong,
        .boss-mobile-fix label,
        .boss-mobile-fix td,
        .boss-mobile-fix th {
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }

        .boss-mobile-fix input,
        .boss-mobile-fix select,
        .boss-mobile-fix textarea {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          font-size: 16px !important;
        }

        .boss-mobile-fix button {
          max-width: 100% !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        .boss-mobile-fix table {
          width: 100% !important;
          min-width: 760px !important;
        }

        .boss-mobile-fix [style*="overflow-x: auto"],
        .boss-mobile-fix [style*="overflow: auto"],
        .boss-mobile-fix [style*="overflowX"] {
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }

        .boss-mobile-fix [style*="position: absolute"] {
          pointer-events: none !important;
        }
      }

      @media (max-width: 480px) {
        .boss-mobile-fix {
          padding: 8px !important;
        }

        .boss-mobile-fix [style*="gap: 24"],
        .boss-mobile-fix [style*="gap: 22"],
        .boss-mobile-fix [style*="gap: 20"],
        .boss-mobile-fix [style*="gap: 18"] {
          gap: 12px !important;
        }

        .boss-mobile-fix [style*="padding: 18"],
        .boss-mobile-fix [style*="padding: 16"] {
          padding: 13px !important;
        }

        .boss-mobile-fix h1 {
          font-size: 29px !important;
        }

        .boss-mobile-fix table {
          min-width: 720px !important;
        }
      }
    `}</style>
  );
}


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
  const {
    user,
    branchId,
    branchCode,
    branchName,
    branchLocation,
    canAccessAllBranches,
  } = useAuth();

  const currentBranchId = Number(
    branchId || user?.branch_id || user?.default_branch_id || 0
  );

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

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
  const [transferIdentityPolicy, setTransferIdentityPolicy] = useState("none");

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

  const transferDashboard = useMemo(() => {
    const requested = transfers.filter(
      (transfer) => String(transfer.status) === "requested"
    ).length;

    const approved = transfers.filter(
      (transfer) => String(transfer.status) === "approved"
    ).length;

    const dispatched = transfers.filter(
      (transfer) => String(transfer.status) === "dispatched"
    ).length;

    const received = transfers.filter(
      (transfer) => String(transfer.status) === "received"
    ).length;

    const cancelledRejected = transfers.filter((transfer) =>
      ["cancelled", "rejected"].includes(String(transfer.status))
    ).length;

    const totalRequestedQuantity = transfers.reduce(
      (sum, transfer) => sum + Number(transfer.total_requested_quantity || 0),
      0
    );

    return {
      requested,
      approved,
      dispatched,
      received,
      cancelledRejected,
      totalRequestedQuantity,
    };
  }, [transfers]);

  const transferCartTotalQuantity = items.reduce(
    (sum, item) => sum + Number(item.requested_quantity || 0),
    0
  );

  useEffect(() => {
    if (currentBranchId) {
      setFromBranchId(String(currentBranchId));
      setBranchFilter(String(currentBranchId));
    }
  }, [currentBranchId]);

  useEffect(() => {
    loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTransfers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, branchFilter]);

  useEffect(() => {
    if (fromBranchId) {
      loadProducts();
    } else {
      setProducts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (Number(selectedTransfer?.id) !== Number(transferId)) {
      setTransferIdentityPolicy("loading");
    }

    try {
      const response = await axiosClient.get(`/stock-transfers/${transferId}`);
      setSelectedTransfer(response.data?.transfer || null);
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  async function handleSerializedTransferCompleted({ message, result }) {
    setNotice(message || "Serialized stock transfer updated successfully.");
    setError("");
    setActionNote("");

    if (result?.status && selectedTransfer) {
      setSelectedTransfer((current) =>
        current && Number(current.id) === Number(result.transfer_id)
          ? { ...current, status: result.status }
          : current
      );
    }

    await Promise.all([loadTransfers(), loadProducts()]);
    if (selectedTransfer?.id) {
      await loadTransferDetails(selectedTransfer.id);
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

  return (
    <div className="boss-mobile-fix" style={styles.page}>
      <MobilePageFix />
      <section style={styles.hero}>
        <div style={styles.routeLine} />

        <div style={styles.heroTop}>
          <div>
            <p style={styles.eyebrow}>Logistics Yard • Two-Store Stock Movement</p>

            <h1 style={styles.heroTitle}>Stock Transfers</h1>

            <p style={styles.heroSubtitle}>
              Move stock professionally between stores. The system records the
              full journey from request to approval, dispatch and receiving for
              audit review.
            </p>
          </div>

          <span style={styles.workingStoreBadge}>
            🏬 Working Store: {currentStoreText}
          </span>
        </div>

        <div style={styles.heroMetrics}>
          <HeroMetric label="Requested :" value={transferDashboard.requested} />
          <HeroMetric label="Approved : " value={transferDashboard.approved} />
          <HeroMetric label="Dispatched :" value={transferDashboard.dispatched} />
          <HeroMetric label="Received : " value={transferDashboard.received} />
        </div>
      </section>

      <div style={styles.storeNotice}>
        <span style={styles.noticeIcon}>🚚</span>
        <div>
          <strong>{currentStoreText}</strong>
          {currentStoreLocation ? <p>{currentStoreLocation}</p> : null}
          <p>
            Transfer requests, approval, dispatch, receiving, PDFs and history
            are controlled here. Dispatch reduces source stock. Receive increases
            destination stock.
          </p>
        </div>
      </div>

      {notice && <div style={styles.notice}>{notice}</div>}
      {error && <div style={styles.error}>{error}</div>}

      <section style={styles.commandStrip}>
        <CommandCard
          icon="📦"
          title="Cart Items"
          value={items.length}
          note={`${formatNumber(transferCartTotalQuantity)} total quantity`}
        />
        <CommandCard
          icon="🛣️"
          title="Total Qty in List"
          value={formatNumber(transferDashboard.totalRequestedQuantity)}
          note="Requested quantity in loaded transfers"
        />
        <CommandCard
          icon="⚠️"
          title="Cancelled / Rejected"
          value={transferDashboard.cancelledRejected}
          note="Transfers that need review"
        />
        <CommandCard
          icon="🏬"
          title="Stores"
          value={branches.length}
          note="Available transfer locations"
        />
      </section>

      <section style={styles.flowPanel}>
        <p style={styles.eyebrowDark}>Transfer Journey</p>
        <div style={styles.flowSteps}>
          <FlowStep number="1" title="Request" note="Create transfer request" />
          <FlowStep number="2" title="Approve" note="Manager approves movement" />
          <FlowStep number="3" title="Dispatch" note="Source stock reduces" />
          <FlowStep number="4" title="Receive" note="Destination stock increases" />
        </div>
      </section>

      <section style={styles.mainGrid}>
        <form style={styles.transferBuilder} onSubmit={createTransfer}>
          <div style={styles.panelHeader}>
            <div>
              <p style={styles.eyebrowDark}>Transfer Builder</p>
              <h2 style={styles.sectionTitle}>Create Transfer Request</h2>
              <p style={styles.panelText}>
                Build a professional transfer request by selecting source store,
                destination store and products to move.
              </p>
            </div>
          </div>

          <div style={styles.storeRouteGrid}>
            <div style={styles.routeBox}>
              <span>From</span>
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

            <div style={styles.routeArrow}>→</div>

            <div style={styles.routeBox}>
              <span>To</span>
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

          <div style={styles.fieldBlock}>
            <label style={styles.label}>Transfer Note</label>
            <textarea
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="Example: Send fast-moving filters to Store 2."
              style={{ ...styles.input, minHeight: "76px", resize: "vertical" }}
            />
          </div>

          <div style={styles.productDock}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrowDark}>Product Loading Dock</p>
                <h3>Add Products</h3>
              </div>

              <span style={styles.qtyBadge}>
                Cart Qty: {formatNumber(transferCartTotalQuantity)}
              </span>
            </div>

            <div style={styles.productGrid}>
              <div>
                <label style={styles.label}>Search Source Products</label>
                <div style={styles.searchRow}>
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

            <div style={styles.fieldBlock}>
              <label style={styles.label}>Item Note</label>
              <input
                value={itemNote}
                onChange={(event) => setItemNote(event.target.value)}
                placeholder="Optional item note"
                style={styles.input}
              />
            </div>

            {selectedProduct && (
              <div style={styles.availableBox}>
                Available in source store:{" "}
                <strong>{formatNumber(selectedProduct.quantity)}</strong>
              </div>
            )}

            <button
              type="button"
              onClick={addItem}
              style={styles.goldButton}
            >
              Add Item to Transfer
            </button>
          </div>

          <div style={styles.transferCart}>
            <div style={styles.panelHeader}>
              <div>
                <p style={styles.eyebrowDark}>Transfer Cart</p>
                <h3>Items Ready for Request</h3>
              </div>
              <span style={styles.qtyBadge}>{items.length} item(s)</span>
            </div>

            {items.length === 0 ? (
              <div style={styles.info}>No items added yet.</div>
            ) : (
              <div style={styles.itemList}>
                {items.map((item) => (
                  <article key={item.source_product_id} style={styles.itemCard}>
                    <div>
                      <strong>{item.product_name}</strong>
                      <p>
                        {[item.category, item.size, item.barcode]
                          .filter(Boolean)
                          .join(" • ") || "—"}
                      </p>
                      {item.item_note ? <small>{item.item_note}</small> : null}
                    </div>

                    <div style={styles.itemNumbers}>
                      <span>Available: {formatNumber(item.available_quantity)}</span>
                      <strong>Move: {formatNumber(item.requested_quantity)}</strong>
                    </div>

                    <button
                      type="button"
                      style={styles.dangerButton}
                      onClick={() => removeItem(item.source_product_id)}
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            style={styles.submitButton}
            disabled={saving}
          >
            {saving ? "Creating Transfer..." : "Create Transfer Request"}
          </button>
        </form>

        <aside style={styles.actionDock}>
          <div style={styles.panelHeader}>
            <div>
              <p style={styles.eyebrowDark}>Action Dock</p>
              <h2 style={styles.sectionTitle}>Transfer Detail</h2>
              <p style={styles.panelText}>
                Open a transfer to approve, dispatch, receive, cancel, reject or
                download the transfer note.
              </p>
            </div>
          </div>

          {!selectedTransfer ? (
            <div style={styles.emptyDetail}>
              <span>🚛</span>
              <strong>No transfer selected</strong>
              <p>Select a transfer from history to view details and actions.</p>
            </div>
          ) : (
            <div style={styles.detailStack}>
              <div style={styles.transferPassport}>
                <span style={styles.statusPill(selectedTransfer.status)}>
                  {cleanStatus(selectedTransfer.status)}
                </span>

                <h3>{selectedTransfer.transfer_number}</h3>

                <p>
                  {selectedTransfer.from_branch_code} —{" "}
                  {selectedTransfer.from_branch_name}
                  <br />
                  <strong>→</strong>
                  <br />
                  {selectedTransfer.to_branch_code} —{" "}
                  {selectedTransfer.to_branch_name}
                </p>

                <small>Requested: {formatDate(selectedTransfer.requested_at)}</small>
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

              <div style={styles.actionButtons}>
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

                {(canDispatch(selectedTransfer) || canReceive(selectedTransfer)) &&
                  transferIdentityPolicy === "loading" && (
                    <div style={styles.info}>
                      Checking physical-ID transfer policy…
                    </div>
                  )}

                {canDispatch(selectedTransfer) &&
                  transferIdentityPolicy === "quantity" && (
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

                {canReceive(selectedTransfer) &&
                  transferIdentityPolicy === "quantity" && (
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

              <InventoryTransferIdentityPanel
                transfer={selectedTransfer}
                actionNote={actionNote}
                disabled={Boolean(actionLoading)}
                onPolicyChange={setTransferIdentityPolicy}
                onCompleted={handleSerializedTransferCompleted}
              />

              <div style={styles.detailItemList}>
                {(selectedTransfer.items || []).map((item) => (
                  <article key={item.id} style={styles.detailItem}>
                    <strong>{item.product_name}</strong>
                    <p>
                      {[item.category, item.size, item.barcode]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </p>

                    <div style={styles.detailNumbers}>
                      <MiniStat
                        label="Requested"
                        value={item.requested_quantity}
                      />
                      <MiniStat
                        label="Dispatched"
                        value={item.dispatched_quantity ?? "—"}
                      />
                      <MiniStat
                        label="Received"
                        value={item.received_quantity ?? "—"}
                      />
                      <MiniStat
                        label="Source"
                        value={`${item.source_quantity_before ?? "—"} → ${
                          item.source_quantity_after ?? "—"
                        }`}
                        raw
                      />
                      <MiniStat
                        label="Destination"
                        value={`${item.destination_quantity_before ?? "—"} → ${
                          item.destination_quantity_after ?? "—"
                        }`}
                        raw
                      />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </aside>
      </section>

      <section style={styles.historyPanel}>
        <div style={styles.historyHeader}>
          <div>
            <p style={styles.eyebrowDark}>Transfer History</p>
            <h2 style={styles.sectionTitle}>Movement Board</h2>
            <p style={styles.panelText}>
              Track every stock movement between stores and open any transfer
              for action.
            </p>
          </div>

          <div style={styles.filtersGrid}>
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
          <div style={styles.transferList}>
            {transfers.map((transfer) => (
              <article key={transfer.id} style={styles.transferCard}>
                <div style={styles.transferCardTop}>
                  <div>
                    <div style={styles.transferTitleRow}>
                      <strong>{transfer.transfer_number}</strong>
                      <span style={styles.statusPill(transfer.status)}>
                        {cleanStatus(transfer.status)}
                      </span>
                    </div>

                    <p>
                      {transfer.from_branch_code} — {transfer.from_branch_name}
                      {" "}→ {transfer.to_branch_code} —{" "}
                      {transfer.to_branch_name}
                    </p>

                    <small>
                      Requested by {transfer.requested_by_name || "—"} •{" "}
                      {formatDate(transfer.requested_at)}
                    </small>
                  </div>

                  <button
                    type="button"
                    style={styles.smallButton}
                    onClick={() => loadTransferDetails(transfer.id)}
                  >
                    View / Action
                  </button>
                </div>

                <div style={styles.transferStats}>
                  <MiniStat label="Items" value={transfer.item_count} />
                  <MiniStat
                    label="Requested Qty"
                    value={transfer.total_requested_quantity}
                  />
                  <MiniStat
                    label="Transfer ID"
                    value={`#${transfer.id}`}
                    raw
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HeroMetric({ label, value }) {
  return (
    <div style={styles.heroMetric}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function CommandCard({ icon, title, value, note }) {
  return (
    <div style={styles.commandCard}>
      <span>{icon}</span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function FlowStep({ number, title, note }) {
  return (
    <div style={styles.flowStep}>
      <span>{number}</span>
      <strong>{title}</strong>
      <small>{note}</small>
    </div>
  );
}

function MiniStat({ label, value, raw }) {
  return (
    <div style={styles.miniStat}>
      <span>{label}</span>
      <strong>{raw ? value : formatNumber(value)}</strong>
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "1720px",
    margin: "0 auto",
    display: "grid",
    gap: "18px",
    color: "#07182c",
    paddingBottom: "44px",
  },

  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "30px",
    padding: "28px",
    background:
      "linear-gradient(135deg, #0f172a 0%, #164777 42%, #312e81 100%)",
    color: "#ffffff",
    boxShadow: "0 26px 70px rgba(22, 71, 119, 0.22)",
  },

  routeLine: {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(circle at 12% 85%, rgba(224,186,40,0.26), transparent 30%), radial-gradient(circle at 88% 10%, rgba(96,165,250,0.28), transparent 34%)",
  },

  heroTop: {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "14px",
    flexWrap: "wrap",
  },

  eyebrow: {
    margin: 0,
    color: "#e0ba28",
    fontSize: "12px",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  eyebrowDark: {
    margin: 0,
    color: "#164777",
    fontSize: "11px",
    fontWeight: "950",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  heroTitle: {
    margin: "6px 0 0",
    fontSize: "clamp(30px, 4vw, 52px)",
    fontWeight: "950",
    lineHeight: 1.05,
  },

  heroSubtitle: {
    margin: "10px 0 0",
    maxWidth: "820px",
    color: "rgba(255,255,255,0.78)",
    lineHeight: 1.65,
    fontWeight: "750",
  },

  workingStoreBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    borderRadius: "999px",
    padding: "10px 13px",
    background: "rgba(224,186,40,0.16)",
    border: "1px solid rgba(224,186,40,0.35)",
    color: "#ffffff",
    fontWeight: "950",
    fontSize: "12px",
  },

  heroMetrics: {
    position: "relative",
    zIndex: 2,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
    marginTop: "22px",
  },

  heroMetric: {
    padding: "14px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.16)",
  },

  storeNotice: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "14px 16px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #eff6ff, #ffffff)",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  noticeIcon: {
    fontSize: "22px",
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

  commandStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
  },

  commandCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "#ffffff",
    borderRadius: "22px",
    border: "1px solid #dbe3ef",
    boxShadow: "0 14px 34px rgba(15,23,42,0.07)",
    padding: "16px",
    minWidth: 0,
  },

  flowPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    border: "1px solid #dbe3ef",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    padding: "18px",
  },

  flowSteps: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "12px",
    marginTop: "12px",
  },

  flowStep: {
    display: "grid",
    gap: "4px",
    padding: "14px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(340px, 0.8fr)",
    gap: "18px",
    alignItems: "start",
  },

  transferBuilder: {
    background: "#ffffff",
    borderRadius: "26px",
    border: "1px solid #dbe3ef",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    padding: "20px",
    overflow: "hidden",
    minWidth: 0,
  },

  actionDock: {
    position: "sticky",
    top: "18px",
    background: "#ffffff",
    borderRadius: "26px",
    border: "1px solid #dbe3ef",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    padding: "20px",
    overflow: "hidden",
    minWidth: 0,
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "14px",
  },

  sectionTitle: {
    margin: "4px 0 0",
    fontSize: "22px",
    fontWeight: "950",
    color: "#07182c",
  },

  panelText: {
    margin: "6px 0 0",
    color: "#64748b",
    fontWeight: "750",
    lineHeight: 1.5,
  },

  storeRouteGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    gap: "12px",
    alignItems: "center",
    marginBottom: "14px",
  },

  routeBox: {
    padding: "14px",
    borderRadius: "20px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  routeArrow: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    background: "#164777",
    color: "#ffffff",
    fontWeight: "950",
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

  fieldBlock: {
    marginTop: "12px",
  },

  productDock: {
    marginTop: "16px",
    padding: "16px",
    borderRadius: "22px",
    background: "linear-gradient(135deg, #f8fafc, #ffffff)",
    border: "1px solid #e2e8f0",
  },

  qtyBadge: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "7px 10px",
    background: "#fef3c7",
    color: "#92400e",
    fontWeight: "950",
    fontSize: "12px",
  },

  productGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 130px",
    gap: "12px",
    alignItems: "end",
  },

  searchRow: {
    display: "flex",
    gap: "8px",
  },

  buttonBase: {
    border: "none",
    borderRadius: "12px",
    padding: "11px 14px",
    fontWeight: "950",
    cursor: "pointer",
  },

  smallButton: {
    border: "none",
    borderRadius: "12px",
    padding: "10px 12px",
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

  mutedButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "9px 11px",
    fontWeight: "950",
    cursor: "pointer",
    background: "#ffffff",
    color: "#164777",
  },

  availableBox: {
    marginTop: "10px",
    marginBottom: "10px",
    padding: "11px",
    borderRadius: "16px",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    fontWeight: "850",
  },

  transferCart: {
    marginTop: "16px",
  },

  info: {
    padding: "14px",
    borderRadius: "16px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
    fontWeight: "850",
    lineHeight: 1.5,
  },

  itemList: {
    display: "grid",
    gap: "10px",
  },

  itemCard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: "12px",
    alignItems: "center",
    padding: "13px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  itemNumbers: {
    display: "grid",
    gap: "4px",
    textAlign: "right",
  },

  submitButton: {
    width: "100%",
    marginTop: "16px",
    border: "none",
    borderRadius: "16px",
    padding: "14px 16px",
    background: "#164777",
    color: "#ffffff",
    fontWeight: "950",
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(22, 71, 119, 0.22)",
  },

  emptyDetail: {
    minHeight: "260px",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: "26px",
    borderRadius: "20px",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    color: "#64748b",
  },

  detailStack: {
    display: "grid",
    gap: "12px",
  },

  transferPassport: {
    padding: "16px",
    borderRadius: "22px",
    background:
      "linear-gradient(135deg, #07182c 0%, #164777 55%, #0f172a 100%)",
    color: "#ffffff",
  },

  actionButtons: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },

  detailItemList: {
    display: "grid",
    gap: "10px",
    maxHeight: "440px",
    overflowY: "auto",
    paddingRight: "4px",
  },

  detailItem: {
    padding: "13px",
    borderRadius: "18px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  detailNumbers: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))",
    gap: "8px",
    marginTop: "10px",
  },

  miniStat: {
    padding: "9px",
    borderRadius: "13px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    minWidth: 0,
  },

  historyPanel: {
    background: "#ffffff",
    borderRadius: "26px",
    border: "1px solid #dbe3ef",
    boxShadow: "0 18px 45px rgba(15,23,42,0.08)",
    padding: "20px",
    minWidth: 0,
  },

  historyHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-end",
    flexWrap: "wrap",
    marginBottom: "14px",
  },

  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
    minWidth: "330px",
  },

  transferList: {
    display: "grid",
    gap: "12px",
  },

  transferCard: {
    borderRadius: "20px",
    border: "1px solid #e2e8f0",
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
    padding: "15px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
  },

  transferCardTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  transferTitleRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
  },

  transferStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "8px",
    marginTop: "12px",
  },

  statusPill: (status) => ({
    display: "inline-flex",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: statusColors[status] || "#07182c",
    fontWeight: "950",
    fontSize: "12px",
  }),
};
