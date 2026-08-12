import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
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

function safeFileName(headerValue, fallback) {
  const match = String(headerValue || "").match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [batchDetail, setBatchDetail] = useState(null);
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
    source_type: "opening_reconciliation",
    notes: "",
  });
  const [printFormat, setPrintFormat] = useState("a4");
  const [reprintReason, setReprintReason] = useState("");
  const [voidCodes, setVoidCodes] = useState(() => new Set());
  const [physicalConfirmation, setPhysicalConfirmation] = useState(false);
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

  const canEnableSerializedEnforcement =
    config.tracking_mode === "serialized" &&
    (Boolean(productDetail?.product?.ready_for_serialized_enforcement) ||
      config.traceability_state === "enforced");

  const metrics = useMemo(() => {
    const unitRows = overview?.units || [];
    const count = (status) =>
      number(unitRows.find((row) => row.status === status)?.unit_count);
    return {
      serializedProducts: products.filter(
        (product) => product.inventory_tracking_mode === "serialized"
      ).length,
      active: count("active"),
      pending: count("label_pending"),
      missing: count("missing"),
    };
  }, [overview, products]);

  async function saveConfiguration(event) {
    event.preventDefault();
    if (!selectedProductId || !isAdmin) return;
    setError("");
    setNotice("");
    setBusy("config");
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
      setNotice(response.data?.message || "Traceability configuration saved.");
      await refreshAll(selectedProductId);
    } catch (saveError) {
      setError(apiMessage(saveError, "Unable to save traceability configuration."));
    } finally {
      setBusy("");
    }
  }

  async function createBatch(event) {
    event.preventDefault();
    if (!selectedProductId) return;
    setError("");
    setNotice("");
    setBusy("batch");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/products/${selectedProductId}/label-batches`,
        {
          ...batchForm,
          expected_quantity: Number(batchForm.expected_quantity),
        }
      );
      setNotice(response.data?.message || "Label batch generated.");
      await refreshAll(selectedProductId);
      if (response.data?.batch?.id) await openBatch(response.data.batch.id);
    } catch (batchError) {
      setError(apiMessage(batchError, "Unable to generate label batch."));
    } finally {
      setBusy("");
    }
  }

  async function openBatch(batchId) {
    setError("");
    setBusy("open-batch");
    try {
      const response = await axiosClient.get(`/inventory-traceability/label-batches/${batchId}`);
      setBatchDetail(response.data);
      setVoidCodes(new Set());
      setPhysicalConfirmation(false);
      setReprintReason("");
    } catch (batchError) {
      setError(apiMessage(batchError, "Unable to load label batch."));
    } finally {
      setBusy("");
    }
  }

  async function printBatch() {
    if (!batchDetail?.batch?.id) return;
    const isReprint = number(batchDetail.batch.print_event_count) > 0;
    setError("");
    setNotice("");
    setBusy("print");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/label-batches/${batchDetail.batch.id}/print`,
        {
          print_format: printFormat,
          reason: isReprint ? reprintReason : "Initial controlled label print",
        },
        { responseType: "blob" }
      );
      const fileName = safeFileName(
        response.headers?.["content-disposition"],
        `${batchDetail.batch.batch_code}-${printFormat}-labels.pdf`
      );
      downloadBlob(response.data, fileName);
      setNotice(
        isReprint
          ? "Controlled reprint recorded and PDF prepared."
          : "Initial label print recorded and PDF prepared."
      );
      await openBatch(batchDetail.batch.id);
      await loadProduct(selectedProductId);
    } catch (printError) {
      let message = "Unable to print controlled labels.";
      const data = printError?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          message = parsed.message || message;
        } catch {
          // Keep safe fallback.
        }
      } else {
        message = apiMessage(printError, message);
      }
      setError(message);
    } finally {
      setBusy("");
    }
  }

  function toggleAttached(unitCode) {
    setVoidCodes((current) => {
      const next = new Set(current);
      if (next.has(unitCode)) next.delete(unitCode);
      else next.add(unitCode);
      return next;
    });
    setPhysicalConfirmation(false);
  }

  async function activateBatch() {
    if (!batchDetail?.batch?.id || !physicalConfirmation) return;
    const units = batchDetail.units || [];
    const activeUnitCodes = units
      .filter((unit) => !voidCodes.has(unit.unit_code))
      .map((unit) => unit.unit_code);
    const voidUnitCodes = units
      .filter((unit) => voidCodes.has(unit.unit_code))
      .map((unit) => unit.unit_code);

    setError("");
    setNotice("");
    setBusy("activate");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/label-batches/${batchDetail.batch.id}/activate`,
        {
          active_unit_codes: activeUnitCodes,
          void_unit_codes: voidUnitCodes,
          notes: `Physical attachment verification: ${activeUnitCodes.length} attached; ${voidUnitCodes.length} unused/damaged labels voided.`,
        }
      );
      setNotice(response.data?.message || "Physical identities confirmed.");
      setBatchDetail(null);
      await refreshAll(selectedProductId);
    } catch (activateError) {
      setError(apiMessage(activateError, "Unable to activate physical labels."));
    } finally {
      setBusy("");
    }
  }

  async function findUnit(event) {
    event.preventDefault();
    if (!unitLookup.trim()) return;
    setError("");
    setBusy("lookup");
    setUnitResult(null);
    try {
      const response = await axiosClient.post("/inventory-traceability/scan/verify", {
        value: unitLookup.trim(),
      });
      setUnitResult(response.data);
    } catch (lookupError) {
      setError(apiMessage(lookupError, "Inventory identity was not found."));
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
          <p className="traceability-eyebrow">Inventory Loss Prevention</p>
          <h1>Inventory Control & Traceability</h1>
          <p>
            Prepare exact physical identities for high-risk stock, control label printing,
            verify attachment and investigate where a specific item was last known to be.
          </p>
        </div>
        <IdentityPill status="setup">Feature-branch setup only</IdentityPill>
      </header>

      <div className="traceability-safety-banner">
        <strong>Feature-branch Sales enforcement is active for enforced serialized products.</strong>{" "}
        Exact physical IDs are required at checkout on this development branch. Production remains
        unchanged until this draft feature is explicitly reviewed, released and deployed.
      </div>

      {error ? <div className="traceability-message traceability-message--error">{error}</div> : null}
      {notice ? <div className="traceability-message traceability-message--success">{notice}</div> : null}

      <section className="traceability-metrics" aria-label="Traceability summary">
        <article><span>Serialized products</span><strong>{metrics.serializedProducts}</strong></article>
        <article><span>Active identities</span><strong>{metrics.active}</strong></article>
        <article><span>Pending labels</span><strong>{metrics.pending}</strong></article>
        <article className={metrics.missing ? "traceability-metric-danger" : ""}><span>Missing identities</span><strong>{metrics.missing}</strong></article>
      </section>

      <section className="traceability-lookup-card">
        <div>
          <p className="traceability-eyebrow">Where is this item?</p>
          <h2>Find one exact physical unit</h2>
          <p>Enter the printed unit ID now. QR camera scanning will use this same verification path later.</p>
        </div>
        <form onSubmit={findUnit} className="traceability-inline-form">
          <input
            value={unitLookup}
            onChange={(event) => setUnitLookup(event.target.value.toUpperCase())}
            placeholder="SO4L-K7M4Q9XD"
            aria-label="Inventory unit ID"
          />
          <button type="submit" disabled={busy === "lookup"}>
            {busy === "lookup" ? "Searching…" : "Find Item"}
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
              <div><span>Last verified</span><strong>{unitResult.unit.last_verified_at ? new Date(unitResult.unit.last_verified_at).toLocaleString() : "Not yet"}</strong></div>
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

      <div className="traceability-workspace-grid">
        <section className="traceability-card traceability-product-list">
          <div className="traceability-card-head">
            <div>
              <p className="traceability-eyebrow">Products</p>
              <h2>Choose what needs stronger control</h2>
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
                  <IdentityPill status={product.inventory_tracking_mode}>{statusLabel(product.inventory_tracking_mode)}</IdentityPill>
                  <small>Qty {number(product.quantity)} · Active IDs {number(product.active_identity_count)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="traceability-card traceability-detail-card">
          {!productDetail?.product ? (
            <div className="traceability-empty">
              <strong>Select a product</strong>
              <p>Choose a product on the left to configure its tracking and physical identities.</p>
            </div>
          ) : (
            <>
              <div className="traceability-card-head">
                <div>
                  <p className="traceability-eyebrow">Selected product</p>
                  <h2>{productDetail.product.name}</h2>
                  <p>{productDetail.product.size || productDetail.product.category || ""}</p>
                </div>
                <IdentityPill status={productDetail.product.inventory_risk_tier}>
                  {statusLabel(productDetail.product.inventory_risk_tier)} risk
                </IdentityPill>
              </div>

              <div className="traceability-reconciliation">
                <div><span>System quantity</span><strong>{number(productDetail.product.quantity)}</strong></div>
                <div><span>Active physical IDs</span><strong>{number(productDetail.product.active_identity_count)}</strong></div>
                <div><span>Pending labels</span><strong>{number(productDetail.product.pending_identity_count)}</strong></div>
                <div className={number(productDetail.product.identity_gap) !== 0 ? "is-gap" : ""}>
                  <span>Identity gap</span><strong>{number(productDetail.product.identity_gap)}</strong>
                </div>
              </div>

              {isAdmin ? (
                <form onSubmit={saveConfiguration} className="traceability-form-block">
                  <div className="traceability-form-title">
                    <h3>Tracking policy</h3>
                    <p>Only System Admin can change the product tracking policy.</p>
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
                        <option value="serialized">Serialized — exact unit IDs</option>
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
                            product_code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
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
                        <option value="setup">Setup — labels/history, no exact-ID checkout</option>
                        <option
                          value="enforced"
                          disabled={!canEnableSerializedEnforcement}
                        >
                          Enforced — exact IDs required
                        </option>
                      </select>
                      <small>
                        {config.tracking_mode === "serialized"
                          ? canEnableSerializedEnforcement
                            ? "Identity reconciliation is complete. System Admin may enable exact-ID Sales enforcement."
                            : "Enforcement unlocks only when active physical IDs exactly match system stock and no labels remain pending."
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
                <form onSubmit={createBatch} className="traceability-form-block">
                  <div className="traceability-form-title">
                    <h3>Create physical label batch</h3>
                    <p>Generated IDs remain unusable until labels are printed, attached and verified.</p>
                  </div>
                  <div className="traceability-form-grid">
                    <label>
                      Labels to generate
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
                      <select
                        value={batchForm.source_type}
                        onChange={(event) =>
                          setBatchForm((current) => ({ ...current, source_type: event.target.value }))
                        }
                      >
                        <option value="opening_reconciliation">Existing stock reconciliation</option>
                        <option value="purchase">Purchase / supplier delivery</option>
                        <option value="restock">Restock</option>
                        <option value="transfer_receipt">Transfer received</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Notes
                    <textarea
                      rows="2"
                      value={batchForm.notes}
                      onChange={(event) =>
                        setBatchForm((current) => ({ ...current, notes: event.target.value }))
                      }
                      placeholder="Physical delivery/count context…"
                    />
                  </label>
                  <button type="submit" disabled={busy === "batch"}>
                    {busy === "batch" ? "Generating…" : "Generate Controlled IDs"}
                  </button>
                </form>
              ) : null}

              <div className="traceability-form-block">
                <div className="traceability-form-title">
                  <h3>Label batches</h3>
                  <p>Open a batch to print, verify attached labels and void unusable identities.</p>
                </div>
                {(productDetail.label_batches || []).length ? (
                  <div className="traceability-batches">
                    {productDetail.label_batches.map((batch) => (
                      <button type="button" key={batch.id} onClick={() => openBatch(batch.id)}>
                        <span><strong>{batch.batch_code}</strong><small>{statusLabel(batch.status)}</small></span>
                        <span><strong>{number(batch.activated_quantity)}/{number(batch.generated_quantity)}</strong><small>active / generated · prints {number(batch.print_event_count)}</small></span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="traceability-muted">No label batches yet.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {batchDetail?.batch ? (
        <section className="traceability-card traceability-batch-panel">
          <div className="traceability-card-head">
            <div>
              <p className="traceability-eyebrow">Physical label verification</p>
              <h2>{batchDetail.batch.batch_code}</h2>
              <p>{batchDetail.batch.product_name} · {number(batchDetail.batch.generated_quantity)} generated identities</p>
            </div>
            <button type="button" className="traceability-secondary" onClick={() => setBatchDetail(null)}>
              Close
            </button>
          </div>

          {batchDetail.batch.status !== "activated" ? (
            <>
              <div className="traceability-print-controls">
                <label>
                  Print format
                  <select value={printFormat} onChange={(event) => setPrintFormat(event.target.value)}>
                    <option value="a4">A4 sheet — many labels</option>
                    <option value="thermal">58mm thermal</option>
                    <option value="sticker">50×30mm sticker</option>
                  </select>
                </label>
                {number(batchDetail.batch.print_event_count) > 0 ? (
                  <label className="traceability-grow">
                    Reprint reason {isAdmin ? "(required)" : "(System Admin only)"}
                    <input
                      value={reprintReason}
                      disabled={!isAdmin}
                      onChange={(event) => setReprintReason(event.target.value)}
                      placeholder="Printer jam, damaged labels, unreadable print…"
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={printBatch}
                  disabled={
                    busy === "print" ||
                    (number(batchDetail.batch.print_event_count) > 0 &&
                      (!isAdmin || reprintReason.trim().length < 8))
                  }
                >
                  {busy === "print"
                    ? "Preparing PDF…"
                    : number(batchDetail.batch.print_event_count) > 0
                    ? "Admin Reprint"
                    : "Print Labels"}
                </button>
              </div>

              <div className="traceability-attachment-head">
                <div>
                  <h3>Confirm each physical label</h3>
                  <p>Uncheck any number that was not attached, was damaged, or does not correspond to a real physical unit. It will be permanently voided.</p>
                </div>
                <div>
                  <strong>{(batchDetail.units || []).length - voidCodes.size} attached</strong>
                  <span>{voidCodes.size} to void</span>
                </div>
              </div>

              <div className="traceability-unit-grid">
                {(batchDetail.units || []).map((unit) => {
                  const attached = !voidCodes.has(unit.unit_code);
                  return (
                    <label key={unit.id} className={!attached ? "is-void" : ""}>
                      <input
                        type="checkbox"
                        checked={attached}
                        disabled={unit.status !== "label_pending"}
                        onChange={() => toggleAttached(unit.unit_code)}
                      />
                      <span><strong>{unit.unit_code}</strong><small>{attached ? "Physically attached" : "VOID — not attached"}</small></span>
                    </label>
                  );
                })}
              </div>

              <label className="traceability-confirmation">
                <input
                  type="checkbox"
                  checked={physicalConfirmation}
                  onChange={(event) => setPhysicalConfirmation(event.target.checked)}
                />
                <span>
                  I physically verified this batch. Every checked ID is attached to one real product unit, and every unchecked ID should be permanently voided.
                </span>
              </label>
              <button
                type="button"
                className="traceability-danger-action"
                disabled={
                  !physicalConfirmation ||
                  busy === "activate" ||
                  number(batchDetail.batch.print_event_count) <= 0
                }
                onClick={activateBatch}
              >
                {busy === "activate" ? "Confirming…" : "Finalize Physical Attachment"}
              </button>
              <p className="traceability-muted">
                Managers who generated or printed the batch cannot verify their own work. System Administrator may override when necessary; the override is audited.
              </p>
            </>
          ) : (
            <div className="traceability-complete">
              <strong>Batch finalized</strong>
              <p>{number(batchDetail.batch.activated_quantity)} active identities · {number(batchDetail.batch.voided_quantity)} voided identities.</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
