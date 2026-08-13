import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import InventoryTraceabilitySetupPage from "./InventoryTraceabilitySetupPage";
import "../styles/inventoryTraceability.css";
import "../styles/inventoryLabelStudioSimple.css";

const NEW_STOCK_SOURCES = new Set(["purchase", "restock", "supplier_receiving"]);

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function sourceLabel(batch) {
  const source = String(batch?.source_type || "opening_reconciliation").toLowerCase();
  const reference = batch?.source_id ? ` #${batch.source_id}` : "";
  if (source === "purchase") return `Supplier purchase${reference}`;
  if (source === "restock") return `Restock received${reference}`;
  if (source === "supplier_receiving") return `Supplier receiving${reference}`;
  if (["transfer", "transfer_receipt", "stock_transfer"].includes(source)) {
    return `Store transfer${reference}`;
  }
  return "Existing / opening stock";
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

export default function InventoryAutomaticLabelsPage() {
  const [products, setProducts] = useState([]);
  const [units, setUnits] = useState([]);
  const [maxSelection, setMaxSelection] = useState(500);
  const [productId, setProductId] = useState("");
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("sticker");
  const [style, setStyle] = useState("standard");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [damageBatchId, setDamageBatchId] = useState(null);
  const [damagedCodes, setDamagedCodes] = useState(() => new Set());

  const loadWorkspace = useCallback(async () => {
    const [productResponse, unitResponse] = await Promise.all([
      axiosClient.get("/inventory-traceability/products"),
      axiosClient.get("/inventory-traceability/identity-studio/units"),
    ]);
    setProducts(productResponse.data?.products || []);
    setUnits(unitResponse.data?.units || []);
    setMaxSelection(Number(unitResponse.data?.max_selection || 500));
  }, []);

  const loadProduct = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const response = await axiosClient.get(`/inventory-traceability/products/${id}`);
    setDetail(response.data || null);
  }, []);

  const refresh = useCallback(async () => {
    await loadWorkspace();
    if (productId) await loadProduct(productId);
  }, [loadProduct, loadWorkspace, productId]);

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
        await loadWorkspace();
      } catch (loadError) {
        if (active) {
          setError(apiMessage(loadError, "Unable to load stock labels."));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadWorkspace]);

  useEffect(() => {
    setDamageBatchId(null);
    setDamagedCodes(new Set());
    if (!productId) {
      setDetail(null);
      return;
    }
    loadProduct(productId).catch((loadError) =>
      setError(apiMessage(loadError, "Unable to load this product's label jobs."))
    );
  }, [loadProduct, productId]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.name, product.size, product.category, product.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [products, search]);

  const totals = useMemo(() => {
    let print = 0;
    let confirm = 0;
    let active = 0;
    for (const unit of units) {
      if (unit.status === "active") active += 1;
      if (unit.status !== "label_pending") continue;
      if (Number(unit.unit_print_count || 0) > 0) confirm += 1;
      else if (Number(unit.legacy_batch_print_count || 0) === 0) print += 1;
    }
    return { print, confirm, active };
  }, [units]);

  const jobs = useMemo(() => {
    if (!productId || !detail) return [];
    const batches = new Map(
      (detail.label_batches || []).map((batch) => [Number(batch.id), batch])
    );
    const grouped = new Map();
    for (const unit of units) {
      if (Number(unit.product_id) !== Number(productId)) continue;
      const batchId = Number(unit.label_batch_id);
      if (!grouped.has(batchId)) grouped.set(batchId, []);
      grouped.get(batchId).push(unit);
    }

    return [...grouped.entries()]
      .map(([batchId, rows]) => {
        const batch = batches.get(batchId) || {
          id: batchId,
          source_type: "opening_reconciliation",
          created_at: rows[0]?.created_at,
        };
        const unprinted = rows.filter(
          (unit) =>
            unit.status === "label_pending" &&
            Number(unit.unit_print_count || 0) === 0 &&
            Number(unit.legacy_batch_print_count || 0) === 0
        );
        const awaiting = rows.filter(
          (unit) =>
            unit.status === "label_pending" &&
            Number(unit.unit_print_count || 0) > 0
        );
        const legacy = rows.filter(
          (unit) =>
            unit.status === "label_pending" &&
            Number(unit.unit_print_count || 0) === 0 &&
            Number(unit.legacy_batch_print_count || 0) > 0
        );
        return {
          batchId,
          batch,
          unprinted,
          awaiting,
          legacy,
          isNewStock: NEW_STOCK_SOURCES.has(
            String(batch.source_type || "").toLowerCase()
          ),
          createdAt: batch.created_at || rows[0]?.created_at,
        };
      })
      .filter((job) => job.unprinted.length || job.awaiting.length || job.legacy.length)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [detail, productId, units]);

  const newStockJobs = jobs.filter((job) => job.isNewStock);
  const olderJobs = jobs.filter((job) => !job.isNewStock);
  const selectedProduct = detail?.product || null;

  async function printJob(job) {
    const rows = job.unprinted.slice(0, maxSelection);
    if (!rows.length) return;
    setBusy(`print-${job.batchId}`);
    setError("");
    setNotice("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/print-selected",
        {
          unit_codes: rows.map((unit) => unit.unit_code),
          print_format: format,
          label_style: style,
        },
        { responseType: "blob" }
      );
      const safeName = String(selectedProduct?.name || "stock")
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "stock";
      downloadBlob(response.data, `${safeName}-${rows.length}-labels.pdf`);
      setNotice(
        job.unprinted.length > rows.length
          ? `${rows.length} labels downloaded for this stock arrival. ${job.unprinted.length - rows.length} remain; press Print again for the next set.`
          : `${rows.length} labels downloaded for this stock arrival only. Attach them, then use the confirmation button on the same card.`
      );
      await refresh();
    } catch (printError) {
      let message = "Unable to print these labels.";
      if (printError?.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await printError.response.data.text());
          message = payload.message || message;
        } catch {
          // Keep the beginner-friendly fallback.
        }
      } else {
        message = apiMessage(printError, message);
      }
      setError(message);
    } finally {
      setBusy("");
    }
  }

  async function confirmJob(job, damaged = new Set()) {
    const rows = job.awaiting.slice(0, maxSelection);
    if (!rows.length) return;
    const activeCodes = rows
      .map((unit) => unit.unit_code)
      .filter((code) => !damaged.has(code));
    const voidCodes = rows
      .map((unit) => unit.unit_code)
      .filter((code) => damaged.has(code));

    setBusy(`confirm-${job.batchId}`);
    setError("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/confirm-selected",
        {
          active_unit_codes: activeCodes,
          void_unit_codes: voidCodes,
          notes: `Beginner label confirmation: ${activeCodes.length} attached; ${voidCodes.length} damaged or unused.`,
        }
      );
      setNotice(
        response.data?.message ||
          `${activeCodes.length} labels confirmed attached; ${voidCodes.length} damaged labels voided.`
      );
      setDamageBatchId(null);
      setDamagedCodes(new Set());
      await refresh();
    } catch (confirmError) {
      setError(apiMessage(confirmError, "Unable to confirm these labels."));
    } finally {
      setBusy("");
    }
  }

  function toggleDamaged(code) {
    setDamagedCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function renderJob(job) {
    const printableNow = Math.min(job.unprinted.length, maxSelection);
    const confirmableNow = Math.min(job.awaiting.length, maxSelection);
    const damageRows = job.awaiting.slice(0, maxSelection);
    const isDamageOpen = Number(damageBatchId) === Number(job.batchId);

    return (
      <article className="beginner-label-job" key={job.batchId}>
        <div className="beginner-label-job__top">
          <div>
            <span className="beginner-label-job__source">{sourceLabel(job.batch)}</span>
            <h3>{selectedProduct?.name}{selectedProduct?.size ? ` — ${selectedProduct.size}` : ""}</h3>
            <p>{formatDate(job.createdAt)} · {job.batch?.batch_code || `Batch ${job.batchId}`}</p>
          </div>
        </div>

        <div className="beginner-label-job__counts">
          <div><span>Not printed yet</span><strong>{job.unprinted.length}</strong></div>
          <div><span>Printed — attach & confirm</span><strong>{job.awaiting.length}</strong></div>
          <div><span>Needs advanced review</span><strong>{job.legacy.length}</strong></div>
        </div>

        <div className="beginner-label-job__actions">
          {job.unprinted.length ? (
            <button
              type="button"
              className="beginner-label-primary"
              disabled={Boolean(busy)}
              onClick={() => printJob(job)}
            >
              {busy === `print-${job.batchId}`
                ? "Preparing Labels…"
                : job.unprinted.length > maxSelection
                  ? `Print Next ${printableNow} Labels`
                  : `Print ${printableNow} Label${printableNow === 1 ? "" : "s"}`}
            </button>
          ) : null}

          {job.awaiting.length ? (
            <>
              <button
                type="button"
                className="beginner-label-primary"
                disabled={Boolean(busy)}
                onClick={() => confirmJob(job)}
              >
                {busy === `confirm-${job.batchId}`
                  ? "Confirming…"
                  : job.awaiting.length > maxSelection
                    ? `Next ${confirmableNow} Are All Attached`
                    : `All ${confirmableNow} Attached`}
              </button>
              <button
                type="button"
                className="beginner-label-secondary"
                disabled={Boolean(busy)}
                onClick={() => {
                  setDamageBatchId(isDamageOpen ? null : job.batchId);
                  setDamagedCodes(new Set());
                }}
              >
                {isDamageOpen ? "Close Damaged List" : "Some Labels Damaged"}
              </button>
            </>
          ) : null}
        </div>

        {job.legacy.length ? (
          <p className="beginner-label-warning">
            {job.legacy.length} older ID{job.legacy.length === 1 ? " has" : "s have"} legacy print evidence. Use Advanced tools for a controlled reprint instead of printing them as new stock.
          </p>
        ) : null}

        {isDamageOpen ? (
          <div className="beginner-label-damage">
            <strong>Mark only damaged or unused labels</strong>
            <p>Everything left checked is treated as successfully attached.</p>
            <div className="beginner-label-damage__list">
              {damageRows.map((unit) => {
                const attached = !damagedCodes.has(unit.unit_code);
                return (
                  <label key={unit.unit_code}>
                    <input
                      type="checkbox"
                      checked={attached}
                      onChange={() => toggleDamaged(unit.unit_code)}
                    />
                    <span>{unit.unit_code} — {attached ? "Attached" : "Damaged / unused"}</span>
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              className="beginner-label-primary"
              disabled={Boolean(busy)}
              onClick={() => confirmJob(job, damagedCodes)}
            >
              Confirm {damageRows.length - damagedCodes.size} Attached · Void {damagedCodes.size}
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  if (loading) {
    return <div className="traceability-loading">Loading stock labels…</div>;
  }

  return (
    <div className="beginner-label-page">
      <section className="beginner-label-hero">
        <p className="traceability-eyebrow">Stock Labels</p>
        <h1>Print labels without managing IDs.</h1>
        <p>
          Chalin One creates IDs automatically when products are created, restocked or purchased.
          Here you only choose the product, print the exact stock arrival, attach the labels and confirm.
        </p>
        <div className="beginner-label-steps">
          <span><strong>1.</strong> Choose product</span>
          <span><strong>2.</strong> Print that stock arrival</span>
          <span><strong>3.</strong> Attach & confirm</span>
        </div>
      </section>

      {error ? <div className="beginner-label-message is-error">{error}</div> : null}
      {notice ? <div className="beginner-label-message is-success">{notice}</div> : null}

      <div className="beginner-label-summary">
        <div><span>Need printing</span><strong>{totals.print}</strong></div>
        <div><span>Printed — need confirmation</span><strong>{totals.confirm}</strong></div>
        <div><span>Labeled & ready</span><strong>{totals.active}</strong></div>
      </div>

      <section className="beginner-label-panel">
        <div>
          <h2>Choose product</h2>
          <p className="beginner-label-muted">Printing never changes another product or another stock arrival.</p>
        </div>
        <div className="beginner-label-selector">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product name, size or barcode…"
          />
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Select product…</option>
            {filteredProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}{product.size ? ` — ${product.size}` : ""} · Stock {number(product.quantity)} · Labels waiting {number(product.pending_identity_count)}
              </option>
            ))}
          </select>
        </div>

        {productId ? (
          <div className="beginner-label-settings">
            <label>
              Label size
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="sticker">50×30 mm — Recommended</option>
                <option value="a4">A4 sheet — 24/page</option>
                <option value="thermal">58 mm thermal</option>
                <option value="compact">40×25 mm compact</option>
              </select>
            </label>
            <label>
              Design
              <select value={style} onChange={(event) => setStyle(event.target.value)}>
                <option value="standard">Standard — Recommended</option>
                <option value="compact">Simple</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {productId ? (
        <>
          <section className="beginner-label-panel">
            <h2>New stock waiting for labels</h2>
            <p className="beginner-label-muted">
              Each card is one exact purchase/restock arrival. Printing one card never includes older unprinted items.
            </p>
            <div className="beginner-label-jobs">
              {newStockJobs.length
                ? newStockJobs.map(renderJob)
                : <div className="beginner-label-empty">No new purchase/restock labels are waiting for this product.</div>}
            </div>
          </section>

          <section className="beginner-label-panel">
            <h2>Older stock still waiting</h2>
            <p className="beginner-label-muted">
              Opening stock and older unfinished label jobs stay separate from new deliveries.
            </p>
            <div className="beginner-label-jobs">
              {olderJobs.length
                ? olderJobs.map(renderJob)
                : <div className="beginner-label-empty">No older label jobs are waiting.</div>}
            </div>
          </section>
        </>
      ) : (
        <div className="beginner-label-empty">Choose a product above to see its exact label jobs.</div>
      )}

      <details className="beginner-label-advanced">
        <summary>Advanced tools — reprints, exact-ID lookup, registers & policy</summary>
        <div>
          <p className="beginner-label-muted">
            Normal receiving and printing do not need this section. It preserves the full traceability controls for exceptional cases.
          </p>
          <InventoryTraceabilitySetupPage />
        </div>
      </details>
    </div>
  );
}
