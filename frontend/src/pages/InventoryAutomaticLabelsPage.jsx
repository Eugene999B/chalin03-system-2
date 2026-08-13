import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import InventoryLabelStudio from "../components/InventoryLabelStudio";
import InventoryQuickPrintAll from "../components/InventoryQuickPrintAll";
import "../styles/inventoryTraceability.css";
import "../styles/inventoryLabelStudioSimple.css";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function InventoryAutomaticLabelsPage() {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState("");
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [studioVersion, setStudioVersion] = useState(0);
  const [policy, setPolicy] = useState({ risk_tier: "standard", traceability_state: "setup" });
  const [lookup, setLookup] = useState("");
  const [lookupResult, setLookupResult] = useState(null);

  const loadProducts = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/products");
    setProducts(response.data?.products || []);
  }, []);

  const loadProduct = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const response = await axiosClient.get(`/inventory-traceability/products/${id}`);
    setDetail(response.data);
    setPolicy({
      risk_tier: response.data?.product?.inventory_risk_tier || "standard",
      traceability_state: response.data?.product?.inventory_traceability_state === "enforced" ? "enforced" : "setup",
    });
  }, []);

  const refresh = useCallback(async () => {
    await loadProducts();
    if (productId) await loadProduct(productId);
    setStudioVersion((value) => value + 1);
  }, [loadProduct, loadProducts, productId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const sync = await axiosClient.post(
          "/inventory-traceability/sale-scan/sync-automatic-identities"
        );
        if (!active) return;
        if (Number(sync.data?.automatic_ids_created || 0) > 0) {
          setNotice(sync.data.message);
        }
        await loadProducts();
      } catch (loadError) {
        if (active) setError(apiMessage(loadError, "Unable to load automatic product IDs."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadProducts]);

  useEffect(() => {
    if (!productId) {
      setDetail(null);
      return;
    }
    loadProduct(productId).catch((loadError) =>
      setError(apiMessage(loadError, "Unable to load this product."))
    );
  }, [loadProduct, productId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, product.size, product.category, product.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [products, search]);

  const product = detail?.product || null;
  const ready = Boolean(product?.ready_for_serialized_enforcement);

  async function savePolicy(event) {
    event.preventDefault();
    if (!isAdmin || !product) return;
    setBusy("policy");
    setError("");
    try {
      const response = await axiosClient.put(
        `/inventory-traceability/products/${product.id}/config`,
        {
          tracking_mode: "serialized",
          traceability_state: policy.traceability_state,
          product_code: product.inventory_product_code,
          risk_tier: policy.risk_tier,
        }
      );
      setNotice(response.data?.message || "Advanced policy saved.");
      await refresh();
    } catch (saveError) {
      setError(apiMessage(saveError, "Unable to save advanced policy."));
    } finally {
      setBusy("");
    }
  }

  async function findId(event) {
    event.preventDefault();
    if (!lookup.trim()) return;
    setBusy("lookup");
    setError("");
    setLookupResult(null);
    try {
      const response = await axiosClient.post("/inventory-traceability/scan/verify", {
        value: lookup.trim(),
      });
      setLookupResult(response.data);
    } catch (lookupError) {
      setError(apiMessage(lookupError, "That exact stock ID was not found."));
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div className="traceability-loading">Checking automatic IDs for current stock…</div>;
  }

  return (
    <div className="traceability-page">
      <section className="simple-traceability-start">
        <header className="simple-traceability-start__intro">
          <p className="traceability-eyebrow">Automatic IDs & Labels</p>
          <h1>IDs follow your stock automatically.</h1>
          <p>
            Create 20 items and Chalin One creates 20 internal IDs. Restock 7 and it creates
            7 new IDs. Record a supplier purchase and the received quantity gets new IDs in
            the same transaction. You do not prepare IDs here anymore.
          </p>
        </header>

        <div className="traceability-safety-banner">
          <strong>New stock = new ID.</strong>{" "}
          A sold ID stays with that physical item forever. The same ID comes back only when
          that exact sold item is genuinely returned.
        </div>

        {error ? <div className="traceability-message traceability-message--error">{error}</div> : null}
        {notice ? <div className="traceability-message traceability-message--success">{notice}</div> : null}

        <section className="simple-traceability-start__product">
          <h2>Choose a product</h2>
          <p>Then use the one-click Print All button below. Nothing needs to be generated manually.</p>
          <div className="simple-traceability-start__selector">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product name, size, category or barcode…"
            />
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Select product…</option>
              {filtered.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}{item.size ? ` — ${item.size}` : ""} · Qty {number(item.quantity)}
                </option>
              ))}
            </select>
          </div>

          {product ? (
            <div className="simple-traceability-start__stats">
              <div><span>Current stock</span><strong>{number(product.quantity)}</strong></div>
              <div><span>Stock IDs</span><strong>{number(product.inventory_identity_count)}</strong></div>
              <div><span>Waiting for labels</span><strong>{number(product.pending_identity_count)}</strong></div>
              <div><span>Active labeled IDs</span><strong>{number(product.active_identity_count)}</strong></div>
            </div>
          ) : null}
        </section>
      </section>

      <InventoryQuickPrintAll productId={productId || null} onPrinted={refresh} />

      {productId ? (
        <details className="simple-traceability-advanced">
          <summary>Choose specific IDs, reprints & ID registers</summary>
          <p>Use this only when you do not want the normal one-click Print All action.</p>
          <InventoryLabelStudio
            key={studioVersion}
            preferredProductId={productId}
            onChanged={refresh}
          />
        </details>
      ) : null}

      <details className="simple-traceability-advanced">
        <summary>Advanced policy & exact-ID lookup</summary>
        <p>Daily printing and sales do not normally need these controls.</p>

        {product ? (
          <form className="simple-traceability-advanced__grid" onSubmit={savePolicy}>
            <label>
              Tracking
              <input readOnly value="Automatic exact physical IDs" />
            </label>
            <label>
              Automatic product prefix
              <input readOnly value={product.inventory_product_code || "—"} />
            </label>
            <label>
              Risk tier
              <select
                disabled={!isAdmin}
                value={policy.risk_tier}
                onChange={(event) => setPolicy((current) => ({ ...current, risk_tier: event.target.value }))}
              >
                <option value="standard">Standard</option>
                <option value="elevated">Elevated</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label>
              Sales policy
              <select
                disabled={!isAdmin}
                value={policy.traceability_state}
                onChange={(event) => setPolicy((current) => ({ ...current, traceability_state: event.target.value }))}
              >
                <option value="setup">Automatic — unprinted IDs may be assigned by Manual Sale</option>
                <option value="enforced" disabled={!ready && policy.traceability_state !== "enforced"}>
                  Enforced — exact physical ID required at checkout
                </option>
              </select>
            </label>
            {isAdmin ? (
              <button type="submit" className="simple-label-studio__primary" disabled={busy === "policy"}>
                {busy === "policy" ? "Saving…" : "Save Advanced Policy"}
              </button>
            ) : null}
          </form>
        ) : null}

        <form onSubmit={findId} className="simple-traceability-start__selector" style={{ marginTop: "1rem" }}>
          <input
            value={lookup}
            onChange={(event) => setLookup(event.target.value)}
            placeholder="Scan or enter exact ID to see its history…"
          />
          <button type="submit" className="simple-label-studio__primary" disabled={!lookup.trim() || busy === "lookup"}>
            {busy === "lookup" ? "Looking up…" : "Find ID"}
          </button>
        </form>
        {lookupResult?.unit ? (
          <div className="traceability-message traceability-message--success" style={{ marginTop: ".7rem" }}>
            <strong>{lookupResult.unit.unit_code}</strong> · {lookupResult.unit.product_name} · {lookupResult.unit.status}
          </div>
        ) : null}
      </details>
    </div>
  );
}
