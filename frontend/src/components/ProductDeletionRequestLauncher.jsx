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

function normalizePath() {
  return String(window.location.pathname || "").toLowerCase();
}

function isProductsPath(path) {
  return path === "/products" || path.startsWith("/products/");
}

function hideLegacyDirectDeleteButtons(shouldHide) {
  const root = document.querySelector(".boss-mobile-fix");
  if (!root) return;

  root.querySelectorAll("button").forEach((button) => {
    const isLegacyProductDelete = button.textContent?.trim() === "Delete";
    if (!isLegacyProductDelete) return;

    if (shouldHide) {
      button.dataset.productDeleteApprovalHidden = "true";
      button.style.setProperty("display", "none", "important");
      button.setAttribute("aria-hidden", "true");
    } else if (button.dataset.productDeleteApprovalHidden === "true") {
      delete button.dataset.productDeleteApprovalHidden;
      button.style.removeProperty("display");
      button.removeAttribute("aria-hidden");
    }
  });
}

export default function ProductDeletionRequestLauncher() {
  const [identity, setIdentity] = useState(() => ({
    user: parseStoredUser(),
    token: localStorage.getItem(TOKEN_KEY),
    path: normalizePath(),
  }));
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const user = identity.user;
  const role = String(user?.role || "").toLowerCase();
  const workspaceCode = String(
    user?.workspace_code || user?.active_workspace?.code || "spare_parts"
  ).toLowerCase();
  const isSystemAdministrator = Boolean(
    user?.is_original_system_administrator
  );

  const visible = Boolean(
    identity.token &&
      isProductsPath(identity.path) &&
      ["admin", "manager"].includes(role) &&
      workspaceCode === "spare_parts" &&
      !isSystemAdministrator
  );

  const selectedProduct = useMemo(
    () => products.find((product) => Number(product.id) === Number(productId)),
    [products, productId]
  );

  useEffect(() => {
    const syncIdentity = () => {
      setIdentity({
        user: parseStoredUser(),
        token: localStorage.getItem(TOKEN_KEY),
        path: normalizePath(),
      });
    };

    const interval = window.setInterval(syncIdentity, 2000);
    window.addEventListener("storage", syncIdentity);
    window.addEventListener("popstate", syncIdentity);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", syncIdentity);
      window.removeEventListener("popstate", syncIdentity);
    };
  }, []);

  useEffect(() => {
    hideLegacyDirectDeleteButtons(visible);

    if (!visible) return undefined;

    const observer = new MutationObserver(() => {
      hideLegacyDirectDeleteButtons(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      hideLegacyDirectDeleteButtons(false);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setOpen(false);
      setProducts([]);
      setProductId("");
      setReason("");
    }
  }, [visible]);

  async function loadProducts() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/products");
      setProducts(response.data.products || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to load products for deletion request."
      );
    } finally {
      setLoading(false);
    }
  }

  async function openRequest() {
    setOpen(true);
    setMessage("");
    setError("");
    setProductId("");
    setReason("");
    await loadProducts();
  }

  function closeRequest() {
    if (saving) return;
    setOpen(false);
    setError("");
  }

  async function submitRequest(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!selectedProduct) {
      setError("Select the exact product you want the System Administrator to review.");
      return;
    }

    if (reason.trim().length < 8) {
      setError("Enter a clear deletion reason of at least 8 characters.");
      return;
    }

    const confirmed = window.confirm(
      `HIGH SECURITY ACTION\n\nRequest deletion of \"${selectedProduct.name}\"?\n\n` +
        `The product will NOT be removed now. The original System Administrator must approve the request, ` +
        `and the boss will receive a security alert immediately.`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const response = await axiosClient.post(
        `/audit-unlock-requests/operational/product-delete/${selectedProduct.id}`,
        { reason: reason.trim() }
      );

      const requestCode = response.data?.request?.request_code;
      setMessage(
        `${response.data.message || "Deletion request sent."}${
          requestCode ? ` Reference: ${requestCode}.` : ""
        }`
      );
      setReason("");
      setProductId("");
      await loadProducts();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to send the product deletion request."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        onClick={openRequest}
        style={styles.launchButton}
        aria-label="Request product deletion"
      >
        <span style={styles.launchIcon}>🛡️</span>
        <span>
          <strong>Request Product Deletion</strong>
          <small>System Admin approval required</small>
        </span>
      </button>

      {open && (
        <div style={styles.backdrop} role="presentation">
          <section style={styles.modal} role="dialog" aria-modal="true">
            <header style={styles.header}>
              <div>
                <p style={styles.eyebrow}>HIGH SECURITY INVENTORY ACTION</p>
                <h2 style={styles.title}>Request Product Deletion</h2>
                <p style={styles.subtitle}>
                  Managers and ordinary administrators cannot delete products directly.
                  This request goes to the original System Administrator and immediately
                  creates security evidence and a boss alert.
                </p>
              </div>
              <button type="button" onClick={closeRequest} style={styles.closeButton}>
                Close
              </button>
            </header>

            <div style={styles.warning}>
              <strong>⚠️ No product is removed when you submit this form.</strong>
              <span>
                Only the original System Administrator can approve and archive the product.
                The approval expires after 24 hours, and any product change invalidates the request.
              </span>
            </div>

            {message && <div style={styles.success}>{message}</div>}
            {error && <div style={styles.error}>{error}</div>}

            <form onSubmit={submitRequest} style={styles.form}>
              <label style={styles.label}>
                Product
                <select
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  disabled={loading || saving}
                  required
                  style={styles.input}
                >
                  <option value="">
                    {loading ? "Loading products..." : "Select product"}
                  </option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} — Qty {Number(product.quantity || 0)}
                      {product.barcode ? ` — ${product.barcode}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {selectedProduct && (
                <div style={styles.productCard}>
                  <strong>{selectedProduct.name}</strong>
                  <span>
                    Stock: {Number(selectedProduct.quantity || 0)} • Category:{" "}
                    {selectedProduct.category || "-"} • Barcode:{" "}
                    {selectedProduct.barcode || "-"}
                  </span>
                </div>
              )}

              <label style={styles.label}>
                Exact reason for deletion
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Example: Duplicate master product created in error; verified correct record is Product ID ..."
                  rows={5}
                  maxLength={1000}
                  disabled={saving}
                  required
                  style={{ ...styles.input, resize: "vertical" }}
                />
                <small style={styles.helpText}>
                  Be specific. The reason is preserved in the permanent audit evidence.
                </small>
              </label>

              <div style={styles.actions}>
                <button type="submit" disabled={saving || loading} style={styles.dangerButton}>
                  {saving ? "Sending Secure Request..." : "Send Deletion Request"}
                </button>
                <button type="button" onClick={closeRequest} disabled={saving} style={styles.secondaryButton}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

const styles = {
  launchButton: {
    position: "fixed",
    right: "18px",
    bottom: "92px",
    zIndex: 1600,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    border: "1px solid #fecaca",
    borderRadius: "18px",
    padding: "11px 14px",
    background: "linear-gradient(135deg, #7f1d1d, #b91c1c)",
    color: "#ffffff",
    boxShadow: "0 18px 45px rgba(127, 29, 29, 0.3)",
    cursor: "pointer",
    textAlign: "left",
  },
  launchIcon: { fontSize: "22px" },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 4000,
    display: "grid",
    placeItems: "center",
    padding: "18px",
    background: "rgba(2, 6, 23, 0.72)",
    overflowY: "auto",
  },
  modal: {
    width: "min(720px, 100%)",
    maxHeight: "92vh",
    overflowY: "auto",
    borderRadius: "24px",
    padding: "22px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 30px 90px rgba(2, 6, 23, 0.35)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    marginBottom: "16px",
  },
  eyebrow: {
    margin: 0,
    color: "#b91c1c",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.08em",
  },
  title: { margin: "4px 0", color: "#0f172a", fontSize: "25px" },
  subtitle: { margin: 0, color: "#64748b", lineHeight: 1.55, fontSize: "14px" },
  closeButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    background: "#ffffff",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  warning: {
    display: "grid",
    gap: "5px",
    padding: "13px 14px",
    marginBottom: "14px",
    borderRadius: "16px",
    background: "#fff7ed",
    border: "1px solid #fdba74",
    color: "#9a3412",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  success: {
    padding: "12px 14px",
    marginBottom: "12px",
    borderRadius: "14px",
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#065f46",
    fontWeight: 700,
  },
  error: {
    padding: "12px 14px",
    marginBottom: "12px",
    borderRadius: "14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    fontWeight: 700,
  },
  form: { display: "grid", gap: "14px" },
  label: { display: "grid", gap: "7px", color: "#0f172a", fontWeight: 800 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "13px",
    padding: "11px 12px",
    font: "inherit",
    color: "#0f172a",
    background: "#ffffff",
  },
  productCard: {
    display: "grid",
    gap: "5px",
    padding: "12px 14px",
    borderRadius: "15px",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: "13px",
  },
  helpText: { color: "#64748b", fontWeight: 600, lineHeight: 1.45 },
  actions: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px" },
  dangerButton: {
    border: "none",
    borderRadius: "13px",
    padding: "11px 14px",
    background: "#b91c1c",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "13px",
    padding: "11px 14px",
    background: "#ffffff",
    color: "#0f172a",
    fontWeight: 900,
    cursor: "pointer",
  },
};
