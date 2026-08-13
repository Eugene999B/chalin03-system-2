import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import InventoryLabelStudio from "../components/InventoryLabelStudio";
import "../styles/inventoryTraceability.css";
import "../styles/inventoryLabelStudioSimple.css";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function automaticProductPrefix(product) {
  if (product?.inventory_product_code) return product.inventory_product_code;
  const id = Math.max(Number(product?.id || 0), 1);
  const suffix = id.toString(36).toUpperCase();
  const source = `${product?.name || ""}${product?.size || ""}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "PRD";
  const prefixLength = Math.max(3, 12 - suffix.length);
  let prefix = source.slice(0, prefixLength);
  if (prefix.length < 3) prefix = `${prefix}PRD`.slice(0, 3);
  return `${prefix}${suffix}`.slice(0, 12);
}

export default function InventoryTraceabilitySetupPage() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productDetail, setProductDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [studioVersion, setStudioVersion] = useState(0);
  const [advanced, setAdvanced] = useState({ risk_tier: "standard", traceability_state: "setup" });
  const [unitLookup, setUnitLookup] = useState("");
  const [unitResult, setUnitResult] = useState(null);

  const loadProducts = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/products");
    setProducts(response.data?.products || []);
  }, []);

  const loadProduct = useCallback(async (productId) => {
    if (!productId) {
      setProductDetail(null);
      return null;
    }
    const response = await axiosClient.get(`/inventory-traceability/products/${productId}`);
    setProductDetail(response.data);
    setAdvanced({
      risk_tier: response.data?.product?.inventory_risk_tier || "standard",
      traceability_state: response.data?.product?.inventory_traceability_state === "enforced" ? "enforced" : "setup",
    });
    return response.data;
  }, []);

  const refresh = useCallback(async (productId = selectedProductId) => {
    await loadProducts();
    if (productId) await loadProduct(productId);
    setStudioVersion((value) => value + 1);
  }, [loadProduct, loadProducts, selectedProductId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await loadProducts();
      } catch (loadError) {
        if (active) setError(apiMessage(loadError, "Unable to load products."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadProducts]);

  useEffect(() => {
    if (!selectedProductId) {
      setProductDetail(null);
      return;
    }
    loadProduct(selectedProductId).catch((loadError) =>
      setError(apiMessage(loadError, "Unable to load this product."))
    );
  }, [loadProduct, selectedProductId]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, product.size, product.category, product.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [products, search]);

  const product = productDetail?.product || null;
  const gap = Math.max(0, number(product?.identity_gap));
  const pending = number(product?.pending_identity_count);
  const active = number(product?.active_identity_count);
  const totalIds = number(product?.inventory_identity_count);
  const isSerialized = product?.inventory_tracking_mode === "serialized";
  const ready = Boolean(product?.ready_for_serialized_enforcement);

  async function createMissingIds(productId, quantity) {
    if (quantity <= 0) return null;
    return axiosClient.post(`/inventory-traceability/products/${productId}/label-batches`, {
      expected_quantity: quantity,
      source_type: "opening_reconciliation",
      notes: "Existing stock prepared through the simplified Chalin One product-ID workflow.",
    });
  }

  async function prepareCurrentStock() {
    if (!product) return;
    setBusy("prepare");
    setError("");
    setNotice("");
    try {
      let detail = productDetail;
      if (!isSerialized) {
        if (!isAdmin) {
          setError("A System Administrator must turn on exact-ID tracking for this product first.");
          return;
        }
        await axiosClient.put(`/inventory-traceability/products/${product.id}/config`, {
          tracking_mode: "serialized",
          traceability_state: "setup",
          product_code: automaticProductPrefix(product),
          risk_tier: product.inventory_risk_tier || "standard",
        });
        detail = await loadProduct(product.id);
      }

      const missing = Math.max(0, number(detail?.product?.identity_gap));
      if (missing > 0) {
        await createMissingIds(product.id, missing);
        setNotice(`Created ${missing} automatic ID${missing === 1 ? "" : "s"} for the current stock. Choose this product in Print Product IDs below.`);
      } else {
        setNotice("This product already has an ID record for every current stock unit. You can print labels below.");
      }
      await refresh(product.id);
    } catch (prepareError) {
      setError(apiMessage(prepareError, "Unable to prepare IDs for this product."));
    } finally {
      setBusy("");
    }
  }

  async function saveAdvanced(event) {
    event.preventDefault();
    if (!product || !isAdmin) return;
    setBusy("advanced");
    setError("");
    try {
      const response = await axiosClient.put(`/inventory-traceability/products/${product.id}/config`, {
        tracking_mode: isSerialized ? "serialized" : "quantity",
        traceability_state: isSerialized ? advanced.traceability_state : "off",
        product_code: isSerialized ? automaticProductPrefix(product) : "",
        risk_tier: advanced.risk_tier,
      });
      setNotice(response.data?.message || "Advanced settings saved.");
      await refresh(product.id);
    } catch (saveError) {
      setError(apiMessage(saveError, "Unable to save advanced traceability settings."));
    } finally {
      setBusy("");
    }
  }

  async function findUnit(event) {
    event.preventDefault();
    if (!unitLookup.trim()) return;
    setBusy("lookup");
    setError("");
    setUnitResult(null);
    try {
      const response = await axiosClient.post("/inventory-traceability/scan/verify", { value: unitLookup.trim() });
      setUnitResult(response.data);
    } catch (lookupError) {
      setError(apiMessage(lookupError, "That exact stock ID was not found."));
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="traceability-loading">Loading products…</div>;

  return (
    <div className="traceability-page">
      <section className="simple-traceability-start">
        <header className="simple-traceability-start__intro">
          <p className="traceability-eyebrow">Labels & Exact Product IDs</p>
          <h1>Start with the product you already created.</h1>
          <p>
            For existing stock: choose a product, let Chalin One create the missing IDs automatically, then print all labels or only specific IDs. Supplier deliveries belong in the Supplier Receiving tab.
          </p>
        </header>

        {error ? <div className="traceability-message traceability-message--error">{error}</div> : null}
        {notice ? <div className="traceability-message traceability-message--success">{notice}</div> : null}

        <section className="simple-traceability-start__product">
          <h2>1 · Choose your product</h2>
          <p>Search products you already created. You do not create the product again here.</p>
          <div className="simple-traceability-start__selector">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product name, size, category or barcode…" />
            <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
              <option value="">Select product…</option>
              {filteredProducts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.size ? ` — ${item.size}` : ""} · Qty {number(item.quantity)}
                </option>
              ))}
            </select>
          </div>

          {product ? (
            <>
              <div className="simple-traceability-start__stats">
                <div><span>Current stock</span><strong>{number(product.quantity)}</strong></div>
                <div><span>Total IDs created</span><strong>{totalIds}</strong></div>
                <div><span>Labels waiting</span><strong>{pending}</strong></div>
                <div><span>Active labeled IDs</span><strong>{active}</strong></div>
              </div>
              <div className="simple-traceability-start__action">
                <button type="button" disabled={busy === "prepare" || (!isAdmin && !isSerialized)} onClick={prepareCurrentStock}>
                  {busy === "prepare"
                    ? "Preparing IDs…"
                    : !isSerialized
                      ? `Prepare ${number(product.quantity)} IDs for Current Stock`
                      : gap > 0
                        ? `Create ${gap} Missing ID${gap === 1 ? "" : "s"}`
                        : "IDs Ready — Go to Print Product IDs"}
                </button>
              </div>
              <p style={{ marginTop: ".6rem" }}>
                Product prefix: <b>{isSerialized ? automaticProductPrefix(product) : "created automatically when you prepare IDs"}</b>. You never type individual product IDs yourself.
              </p>
            </>
          ) : null}
        </section>
      </section>

      <InventoryLabelStudio key={studioVersion} preferredProductId={selectedProductId || null} onChanged={() => refresh(selectedProductId)} />

      <details className="simple-traceability-advanced">
        <summary>Advanced settings & exact-ID lookup</summary>
        <p>Most daily label work does not need these controls.</p>
        {product ? (
          <form onSubmit={saveAdvanced} className="simple-traceability-advanced__grid">
            <label>
              Tracking
              <input readOnly value={isSerialized ? "Serialized — exact physical IDs" : "Quantity only"} />
            </label>
            <label>
              Automatic product prefix
              <input readOnly value={isSerialized ? automaticProductPrefix(product) : "Assigned when IDs are prepared"} />
            </label>
            <label>
              Risk tier
              <select disabled={!isAdmin} value={advanced.risk_tier} onChange={(event) => setAdvanced((current) => ({ ...current, risk_tier: event.target.value }))}>
                <option value="standard">Standard</option>
                <option value="elevated">Elevated</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Sales enforcement
              <select disabled={!isAdmin || !isSerialized} value={advanced.traceability_state} onChange={(event) => setAdvanced((current) => ({ ...current, traceability_state: event.target.value }))}>
                <option value="setup">Setup — prepare labels first</option>
                <option value="enforced" disabled={!ready && advanced.traceability_state !== "enforced"}>Enforced — exact ID required during sale</option>
              </select>
            </label>
            {isAdmin ? <button type="submit" className="simple-label-studio__primary" disabled={busy === "advanced"}>{busy === "advanced" ? "Saving…" : "Save Advanced Settings"}</button> : null}
          </form>
        ) : null}

        <form onSubmit={findUnit} className="simple-traceability-start__selector" style={{ marginTop: "1rem" }}>
          <input value={unitLookup} onChange={(event) => setUnitLookup(event.target.value)} placeholder="Enter or scan an exact ID to see its history…" />
          <button type="submit" className="simple-label-studio__primary" disabled={!unitLookup.trim() || busy === "lookup"}>{busy === "lookup" ? "Looking up…" : "Find ID"}</button>
        </form>
        {unitResult?.unit ? (
          <div className="traceability-message traceability-message--success" style={{ marginTop: ".7rem" }}>
            <strong>{unitResult.unit.unit_code}</strong> · {unitResult.unit.product_name} · {unitResult.unit.status}
          </div>
        ) : null}
      </details>
    </div>
  );
}
