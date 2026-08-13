import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import InventoryLabelStudio from "../components/InventoryLabelStudio";
import "../styles/inventoryTraceability.css";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusLabel(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function IdentityPill({ status, children }) {
  return (
    <span className={`traceability-pill traceability-pill--${status || "neutral"}`}>
      {children}
    </span>
  );
}

export default function InventoryTraceabilityPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  const [products, setProducts] = useState([]);
  const [overview, setOverview] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [productDetail, setProductDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [config, setConfig] = useState({
    tracking_mode: "quantity",
    traceability_state: "off",
    product_code: "",
    risk_tier: "standard",
  });
  const [batchForm, setBatchForm] = useState({
    expected_quantity: 1,
    notes: "",
  });
  const [unitLookup, setUnitLookup] = useState("");
  const [unitResult, setUnitResult] = useState(null);

  const loadOverview = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/overview");
    setOverview(response.data);
  }, []);

  const loadProducts = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/products");
    setProducts(response.data?.products || []);
  }, []);

  const loadProduct = useCallback(async (productId) => {
    if (!productId) {
      setProductDetail(null);
      return;
    }
    const response = await axiosClient.get(`/inventory-traceability/products/${productId}`);
    const detail = response.data;
    setProductDetail(detail);
    setConfig({
      tracking_mode: detail.product?.inventory_tracking_mode || "quantity",
      traceability_state: detail.product?.inventory_traceability_state || "off",
      product_code: detail.product?.inventory_product_code || "",
      risk_tier: detail.product?.inventory_risk_tier || "standard",
    });
    const gap = Math.max(0, number(detail.product?.identity_gap));
    setBatchForm((current) => ({
      ...current,
      expected_quantity: gap > 0 ? gap : 1,
    }));
  }, []);

  const refreshAll = useCallback(async (productId = selectedProductId) => {
    await Promise.all([loadOverview(), loadProducts()]);
    if (productId) await loadProduct(productId);
  }, [loadOverview, loadProduct, loadProducts, selectedProductId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadOverview(), loadProducts()]);
      } catch (loadError) {
        if (active) setError(apiMessage(loadError, "Unable to load Inventory Traceability."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadOverview, loadProducts]);

  useEffect(() => {
    if (!selectedProductId) return;
    loadProduct(selectedProductId).catch((loadError) =>
      setError(apiMessage(loadError, "Unable to load product traceability."))
    );
  }, [loadProduct, selectedProductId]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [
        product.name,
        product.size,
        product.category,
        product.barcode,
        product.inventory_product_code,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [products, search]);

  const metrics = useMemo(() => {
    const rows = overview?.units || [];
    const count = (status) => number(rows.find((row) => row.status === status)?.unit_count);
    return {
      serializedProducts: products.filter(
        (product) => product.inventory_tracking_mode === "serialized"
      ).length,
      active: count("active"),
      pending: count("label_pending"),
      missing: count("missing"),
    };
  }, [overview, products]);

  const canEnableSerializedEnforcement =
    config.tracking_mode === "serialized" &&
    (Boolean(productDetail?.product?.ready_for_serialized_enforcement) ||
      config.traceability_state === "enforced");

  async function saveConfiguration(event) {
    event.preventDefault();
    if (!selectedProductId || !isAdmin) return;
    setBusy("config");
    setError("");
    setNotice("");
    try {
      const payload = {
        ...config,
        traceability_state:
          config.tracking_mode === "quantity"
            ? "off"
            : config.tracking_mode === "serialized"
              ? config.traceability_state
              : "setup",
      };
      const response = await axiosClient.put(
        `/inventory-traceability/products/${selectedProductId}/config`,
        payload
      );
      setNotice(response.data?.message || "Tracking policy saved.");
      await refreshAll(selectedProductId);
    } catch (saveError) {
      setError(apiMessage(saveError, "Unable to save traceability configuration."));
    } finally {
      setBusy("");
    }
  }

  async function createReconciliationBatch(event) {
    event.preventDefault();
    if (!selectedProductId) return;
    setBusy("batch");
    setError("");
    setNotice("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/products/${selectedProductId}/label-batches`,
        {
          expected_quantity: Number(batchForm.expected_quantity),
          source_type: "opening_reconciliation",
          notes: batchForm.notes,
        }
      );
      setNotice(
        response.data?.message ||
          "Exact stock-unit IDs generated. Select the specific IDs you want to print in the Label Studio."
      );
      setBatchForm((current) => ({ ...current, notes: "" }));
      await refreshAll(selectedProductId);
    } catch (batchError) {
      setError(apiMessage(batchError, "Unable to generate controlled stock IDs."));
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
      const response = await axiosClient.post("/inventory-traceability/scan/verify", {
        value: unitLookup.trim(),
      });
      setUnitResult(response.data);
    } catch (lookupError) {
      setError(apiMessage(lookupError, "Stock-unit ID was not found."));
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div className="traceability-loading">Loading Inventory Control & Traceability…</div>;
  }

  return (
    <div className="traceability-page">
      <header className="traceability-hero">
        <div>
          <p className="traceability-eyebrow">CHALIN ONE Trial · Inventory Loss Prevention</p>
          <h1>Inventory Control & Traceability</h1>
          <p>
            Give high-risk stock an exact physical ID, print only the labels you choose,
            confirm what was really attached, and follow every unit through its lifecycle.
          </p>
        </div>
        <IdentityPill status="setup">Controlled Chalin One trial</IdentityPill>
      </header>

      <div className="traceability-safety-banner">
        <strong>Exact-ID protection is active for enforced serialized products.</strong>{" "}
        Quantity-only restock, stock adjustment, legacy sale edit/void, false supplier provenance,
        wrong-store transfer actions and unauthorized custody verification are blocked by the traceability controls.
      </div>

      {error ? <div className="traceability-message traceability-message--error">{error}</div> : null}
      {notice ? <div className="traceability-message traceability-message--success">{notice}</div> : null}

      <section className="traceability-metrics" aria-label="Traceability summary">
        <article><span>Serialized products</span><strong>{metrics.serializedProducts}</strong></article>
        <article><span>Active exact IDs</span><strong>{metrics.active}</strong></article>
        <article><span>Pending labels</span><strong>{metrics.pending}</strong></article>
        <article className={metrics.missing ? "traceability-metric-danger" : ""}>
          <span>Missing IDs</span><strong>{metrics.missing}</strong>
        </article>
      </section>

      <section className="traceability-flow" aria-label="Inventory identity workflow">
        {[
          ["1", "Configure", "Choose serialized tracking, risk and product code."],
          ["2", "Generate IDs", "Existing stock here; supplier stock through Serialized Receiving."],
          ["3", "Select exact IDs", "Tick only the products and physical IDs you actually need."],
          ["4", "Design & print", "Choose size, style, preview and download the selected labels."],
          ["5", "Physically confirm", "Activate attached labels; void only damaged or unused selected labels."],
        ].map(([step, title, description]) => (
          <article key={step}>
            <strong>{step}</strong>
            <div><b>{title}</b><span>{description}</span></div>
          </article>
        ))}
      </section>

      <InventoryLabelStudio onChanged={() => refreshAll(selectedProductId)} />

      <div className="traceability-workspace-grid">
        <section className="traceability-card traceability-product-list">
          <div className="traceability-card-head">
            <div>
              <p className="traceability-eyebrow">Product Setup</p>
              <h2>Choose a product</h2>
              <p>Serialized tracking is opt-in. Existing quantity-only products stay unchanged until configured.</p>
            </div>
            <input
              className="traceability-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product, code, category…"
            />
          </div>
          <div className="traceability-product-rows">
            {filteredProducts.map((product) => (
              <button
                type="button"
                key={product.id}
                className={`traceability-product-row ${Number(selectedProductId) === Number(product.id) ? "is-selected" : ""}`}
                onClick={() => setSelectedProductId(product.id)}
              >
                <span className="traceability-product-main">
                  <strong>{product.name}</strong>
                  <small>{product.size || product.category || "No size/category"}</small>
                </span>
                <span className="traceability-product-meta">
                  <IdentityPill status={product.inventory_tracking_mode}>
                    {statusLabel(product.inventory_tracking_mode)}
                  </IdentityPill>
                  <small>Qty {number(product.quantity)} · Active IDs {number(product.active_identity_count)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="traceability-card traceability-detail-card">
          {!productDetail?.product ? (
            <div className="traceability-empty">
              <strong>Select a product to configure it</strong>
              <p>Use the product list on the left. The Label Studio above can select exact IDs across many products at once.</p>
            </div>
          ) : (
            <>
              <div className="traceability-card-head">
                <div>
                  <p className="traceability-eyebrow">Selected Product</p>
                  <h2>{productDetail.product.name}</h2>
                  <p>{productDetail.product.size || productDetail.product.category || ""}</p>
                </div>
                <IdentityPill status={productDetail.product.inventory_risk_tier}>
                  {statusLabel(productDetail.product.inventory_risk_tier)} risk
                </IdentityPill>
              </div>

              <div className="traceability-reconciliation">
                <div><span>System quantity</span><strong>{number(productDetail.product.quantity)}</strong></div>
                <div><span>Active IDs</span><strong>{number(productDetail.product.active_identity_count)}</strong></div>
                <div><span>Pending labels</span><strong>{number(productDetail.product.pending_identity_count)}</strong></div>
                <div className={number(productDetail.product.identity_gap) !== 0 ? "is-gap" : ""}>
                  <span>Identity gap</span><strong>{number(productDetail.product.identity_gap)}</strong>
                </div>
              </div>

              {isAdmin ? (
                <form onSubmit={saveConfiguration} className="traceability-form-block">
                  <div className="traceability-form-title">
                    <h3>1 · Tracking policy</h3>
                    <p>Only a System Administrator can change the tracking level or enable exact-ID Sales enforcement.</p>
                  </div>
                  <div className="traceability-form-grid">
                    <label>
                      Tracking level
                      <select
                        value={config.tracking_mode}
                        onChange={(event) => {
                          const nextMode = event.target.value;
                          setConfig((current) => ({
                            ...current,
                            tracking_mode: nextMode,
                            traceability_state:
                              nextMode === "quantity"
                                ? "off"
                                : nextMode === "serialized" && current.traceability_state === "enforced"
                                  ? "enforced"
                                  : "setup",
                          }));
                        }}
                      >
                        <option value="quantity">Quantity only</option>
                        <option value="batch">Batch tracked (foundation)</option>
                        <option value="serialized">Serialized — exact physical IDs</option>
                      </select>
                    </label>
                    <label>
                      Risk tier
                      <select
                        value={config.risk_tier}
                        onChange={(event) =>
                          setConfig((current) => ({ ...current, risk_tier: event.target.value }))
                        }
                      >
                        <option value="standard">Standard</option>
                        <option value="elevated">Elevated</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label>
                      Product code
                      <input
                        value={config.product_code}
                        disabled={config.tracking_mode === "quantity"}
                        onChange={(event) =>
                          setConfig((current) => ({
                            ...current,
                            product_code: event.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, "")
                              .slice(0, 12),
                          }))
                        }
                        placeholder="SO4L"
                      />
                    </label>
                    <label>
                      Rollout state
                      <select
                        value={
                          config.tracking_mode === "quantity"
                            ? "off"
                            : config.tracking_mode === "serialized"
                              ? config.traceability_state
                              : "setup"
                        }
                        disabled={config.tracking_mode !== "serialized"}
                        onChange={(event) =>
                          setConfig((current) => ({
                            ...current,
                            traceability_state: event.target.value,
                          }))
                        }
                      >
                        <option value="off">Off — quantity tracking</option>
                        <option value="setup">Setup — prepare labels/history</option>
                        <option value="enforced" disabled={!canEnableSerializedEnforcement}>
                          Enforced — exact IDs required at checkout
                        </option>
                      </select>
                      <small>
                        {config.tracking_mode === "serialized"
                          ? canEnableSerializedEnforcement
                            ? "Physical IDs reconcile with stock. Enforcement can be enabled deliberately."
                            : "Enforcement unlocks only when active physical IDs reconcile with system stock and no pending setup gap remains."
                          : "Exact-ID enforcement applies only to serialized products."}
                      </small>
                    </label>
                  </div>
                  <button type="submit" disabled={busy === "config"}>
                    {busy === "config" ? "Saving…" : "Save Tracking Policy"}
                  </button>
                </form>
              ) : null}

              {productDetail.product.inventory_tracking_mode === "serialized" &&
              productDetail.product.inventory_traceability_state !== "off" ? (
                <form onSubmit={createReconciliationBatch} className="traceability-form-block">
                  <div className="traceability-form-title">
                    <h3>2 · Generate IDs for existing stock</h3>
                    <p>
                      Use this only for physical stock already on hand during reconciliation. New supplier stock must come through
                      <strong> Serialized Receiving</strong>, which binds the IDs to the exact purchase line automatically.
                    </p>
                  </div>
                  <div className="traceability-form-grid">
                    <label>
                      IDs to generate
                      <input
                        type="number"
                        min="1"
                        max="2000"
                        value={batchForm.expected_quantity}
                        onChange={(event) =>
                          setBatchForm((current) => ({ ...current, expected_quantity: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Source
                      <input value="Existing stock reconciliation" disabled />
                    </label>
                  </div>
                  <label>
                    Reconciliation notes
                    <textarea
                      rows="2"
                      value={batchForm.notes}
                      onChange={(event) =>
                        setBatchForm((current) => ({ ...current, notes: event.target.value }))
                      }
                      placeholder="Physical count / shelf / opening-stock context…"
                    />
                  </label>
                  <button type="submit" disabled={busy === "batch"}>
                    {busy === "batch" ? "Generating exact IDs…" : "Generate Controlled IDs"}
                  </button>
                </form>
              ) : null}

              <div className="traceability-form-block">
                <div className="traceability-form-title">
                  <h3>Controlled batches</h3>
                  <p>Batches create the stock IDs; printing and partial selection now happen in the Label Studio above.</p>
                </div>
                {(productDetail.label_batches || []).length ? (
                  <div className="traceability-batches">
                    {productDetail.label_batches.map((batch) => (
                      <div key={batch.id} className="traceability-batch-summary">
                        <span>
                          <strong>{batch.batch_code}</strong>
                          <small>{statusLabel(batch.source_type)} · {statusLabel(batch.status)}</small>
                        </span>
                        <span>
                          <strong>{number(batch.activated_quantity)}/{number(batch.generated_quantity)}</strong>
                          <small>confirmed / generated · {number(batch.voided_quantity)} voided</small>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="traceability-muted">No controlled batches yet.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="traceability-lookup-card">
        <div>
          <p className="traceability-eyebrow">Where is this exact item?</p>
          <h2>Find one physical stock unit</h2>
          <p>Enter the human-readable unit ID or scan its signed QR code to see current status and chain of custody.</p>
        </div>
        <form onSubmit={findUnit} className="traceability-inline-form">
          <input
            value={unitLookup}
            onChange={(event) => setUnitLookup(event.target.value.toUpperCase())}
            placeholder="SO4L-K7M4Q9XD"
            aria-label="Inventory unit ID"
          />
          <button type="submit" disabled={busy === "lookup"}>
            {busy === "lookup" ? "Searching…" : "Find Exact Item"}
          </button>
        </form>
        {unitResult?.unit ? (
          <div className="traceability-unit-result">
            <div className="traceability-unit-summary">
              <div><span>Unit ID</span><strong>{unitResult.unit.unit_code}</strong></div>
              <div><span>Product</span><strong>{unitResult.unit.product_name}</strong></div>
              <div><span>Status</span><strong>{statusLabel(unitResult.unit.status)}</strong></div>
              <div><span>Store</span><strong>{unitResult.unit.current_branch_name}</strong></div>
              <div><span>Batch</span><strong>{unitResult.unit.batch_code}</strong></div>
              <div>
                <span>Last verified</span>
                <strong>
                  {unitResult.unit.last_verified_at
                    ? new Date(unitResult.unit.last_verified_at).toLocaleString()
                    : "Not yet"}
                </strong>
              </div>
            </div>
            <h3>Chain of custody / event history</h3>
            <ol className="traceability-timeline">
              {(unitResult.events || []).map((event) => (
                <li key={event.id}>
                  <strong>{statusLabel(event.event_type)}</strong>
                  <span>{event.branch_name || "Store"} · {event.actor_name || "System"}</span>
                  <small>{event.created_at ? new Date(event.created_at).toLocaleString() : ""}</small>
                  {event.reason ? <p>{event.reason}</p> : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    </div>
  );
}
