import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

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

export default function InventoryLabelStudio({ onChanged }) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [units, setUnits] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("printable");
  const [selected, setSelected] = useState(() => new Set());
  const [format, setFormat] = useState("a4");
  const [style, setStyle] = useState("standard");
  const [reason, setReason] = useState("");
  const [confirmationCodes, setConfirmationCodes] = useState([]);
  const [voidCodes, setVoidCodes] = useState(() => new Set());
  const [physicalConfirmed, setPhysicalConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadStudio = useCallback(async () => {
    const response = await axiosClient.get("/inventory-traceability/identity-studio/units");
    setUnits(response.data?.units || []);
    setProducts(response.data?.products || []);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await loadStudio();
      } catch (loadError) {
        if (active) setError(apiMessage(loadError, "Unable to load the Label Studio."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadStudio]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return units.filter((unit) => {
      if (productFilter !== "all" && Number(unit.product_id) !== Number(productFilter)) return false;
      if (statusFilter === "printable" && !["label_pending", "active"].includes(unit.status)) return false;
      if (statusFilter === "unprinted" && (unit.status !== "label_pending" || unit.requires_reprint)) return false;
      if (!["all", "printable", "unprinted"].includes(statusFilter) && unit.status !== statusFilter) return false;
      if (!query) return true;
      return [unit.unit_code, unit.product_name, unit.inventory_product_code, unit.batch_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [productFilter, search, statusFilter, units]);

  const selectedRows = useMemo(
    () => units.filter((unit) => selected.has(unit.unit_code)),
    [selected, units]
  );
  const reprintCount = selectedRows.filter((unit) => unit.requires_reprint).length;
  const selectedProductCount = new Set(selectedRows.map((unit) => unit.product_id)).size;
  const labelsPerPage = format === "a4" ? 24 : 1;
  const pageCount = selectedRows.length ? Math.ceil(selectedRows.length / labelsPerPage) : 0;

  function toggle(unitCode) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(unitCode)) next.delete(unitCode);
      else next.add(unitCode);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      filtered
        .filter((unit) => ["label_pending", "active"].includes(unit.status))
        .slice(0, 500)
        .forEach((unit) => next.add(unit.unit_code));
      return next;
    });
  }

  function selectFirst(count) {
    setSelected((current) => {
      const next = new Set(current);
      filtered
        .filter((unit) => ["label_pending", "active"].includes(unit.status))
        .slice(0, count)
        .forEach((unit) => next.add(unit.unit_code));
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setConfirmationCodes([]);
    setVoidCodes(new Set());
    setPhysicalConfirmed(false);
  }

  async function printSelected() {
    if (!selectedRows.length) return;
    setBusy("print");
    setError("");
    setNotice("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/print-selected",
        {
          unit_codes: selectedRows.map((unit) => unit.unit_code),
          print_format: format,
          label_style: style,
          reason: reason.trim(),
        },
        { responseType: "blob" }
      );
      const fileName = safeFileName(
        response.headers?.["content-disposition"],
        `selected-stock-labels-${Date.now()}.pdf`
      );
      downloadBlob(response.data, fileName);
      const pendingCodes = selectedRows
        .filter((unit) => unit.status === "label_pending")
        .map((unit) => unit.unit_code);
      setConfirmationCodes(pendingCodes);
      setVoidCodes(new Set());
      setPhysicalConfirmed(false);
      setReason("");
      setNotice(
        `Prepared ${selectedRows.length} selected label(s). ${pendingCodes.length ? "Confirm physical attachment below; unselected IDs remain untouched." : "This was a controlled replacement-label print."}`
      );
      await loadStudio();
      if (onChanged) await onChanged();
    } catch (printError) {
      let message = "Unable to print the selected labels.";
      if (printError?.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await printError.response.data.text());
          message = parsed.message || message;
        } catch {
          // Keep the safe fallback.
        }
      } else {
        message = apiMessage(printError, message);
      }
      setError(message);
    } finally {
      setBusy("");
    }
  }

  async function exportSelected() {
    if (!selectedRows.length) return;
    setBusy("export");
    setError("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/export-selected",
        { unit_codes: selectedRows.map((unit) => unit.unit_code) },
        { responseType: "blob" }
      );
      downloadBlob(
        response.data,
        safeFileName(response.headers?.["content-disposition"], `selected-stock-ids-${Date.now()}.csv`)
      );
      setNotice(`Downloaded ${selectedRows.length} selected IDs as a human-readable CSV list.`);
    } catch (exportError) {
      setError(apiMessage(exportError, "Unable to download the selected ID list."));
    } finally {
      setBusy("");
    }
  }

  function toggleVoid(unitCode) {
    setVoidCodes((current) => {
      const next = new Set(current);
      if (next.has(unitCode)) next.delete(unitCode);
      else next.add(unitCode);
      return next;
    });
    setPhysicalConfirmed(false);
  }

  async function confirmSelected() {
    if (!confirmationCodes.length || !physicalConfirmed) return;
    const active = confirmationCodes.filter((code) => !voidCodes.has(code));
    const voided = confirmationCodes.filter((code) => voidCodes.has(code));
    setBusy("confirm");
    setError("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/confirm-selected",
        {
          active_unit_codes: active,
          void_unit_codes: voided,
          notes: `Label Studio physical confirmation: ${active.length} attached; ${voided.length} damaged/unused.`,
        }
      );
      setNotice(response.data?.message || "Selected physical labels confirmed.");
      clearSelection();
      await loadStudio();
      if (onChanged) await onChanged();
    } catch (confirmError) {
      setError(apiMessage(confirmError, "Unable to confirm selected physical labels."));
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <section className="identity-studio identity-studio--loading">Loading Inventory Identity & Label Studio…</section>;
  }

  return (
    <section className="identity-studio">
      <div className="identity-studio__hero">
        <div>
          <p className="traceability-eyebrow">Inventory Identity & Label Studio</p>
          <h2>Choose the exact IDs. Choose the label. Print only what you need.</h2>
          <p>
            Select physical stock IDs across products and batches, preview the layout, download only the chosen labels,
            or export the chosen IDs as CSV. Every printed ID receives its own audit evidence.
          </p>
        </div>
        <div className="identity-studio__selection-summary">
          <strong>{selectedRows.length}</strong>
          <span>IDs selected</span>
          <small>{selectedProductCount} product{selectedProductCount === 1 ? "" : "s"}</small>
        </div>
      </div>

      {error ? <div className="traceability-message traceability-message--error">{error}</div> : null}
      {notice ? <div className="traceability-message traceability-message--success">{notice}</div> : null}

      <div className="identity-studio__toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search exact ID, product, product code, batch…"
        />
        <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
          <option value="all">All serialized products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} {product.size ? `— ${product.size}` : ""}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="printable">Printable IDs</option>
          <option value="unprinted">Never printed</option>
          <option value="label_pending">Pending labels</option>
          <option value="active">Active IDs</option>
          <option value="all">All statuses</option>
        </select>
      </div>

      <div className="identity-studio__quick-actions">
        <button type="button" onClick={selectVisible}>Select All Filtered</button>
        <button type="button" onClick={() => selectFirst(10)}>Select First 10</button>
        <button type="button" onClick={() => selectFirst(24)}>Select First 24</button>
        <button type="button" onClick={clearSelection}>Clear Selection</button>
        <span>{filtered.length} IDs shown · maximum 500 per controlled action</span>
      </div>

      <div className="identity-studio__grid">
        <div className="identity-studio__unit-list">
          {filtered.map((unit) => {
            const printable = ["label_pending", "active"].includes(unit.status);
            return (
              <label key={unit.id} className={`identity-studio__unit ${selected.has(unit.unit_code) ? "is-selected" : ""} ${!printable ? "is-disabled" : ""}`}>
                <input
                  type="checkbox"
                  disabled={!printable}
                  checked={selected.has(unit.unit_code)}
                  onChange={() => toggle(unit.unit_code)}
                />
                <span className="identity-studio__unit-main">
                  <strong>{unit.unit_code}</strong>
                  <small>{unit.product_name}{unit.product_size ? ` · ${unit.product_size}` : ""}</small>
                </span>
                <span className="identity-studio__unit-meta">
                  <b>{statusLabel(unit.status)}</b>
                  <small>{unit.batch_code}</small>
                  <small>{unit.requires_reprint ? "Controlled reprint" : "Never printed"}</small>
                </span>
              </label>
            );
          })}
          {!filtered.length ? <div className="traceability-empty">No stock IDs match these filters.</div> : null}
        </div>

        <aside className="identity-studio__designer">
          <p className="traceability-eyebrow">Label Designer</p>
          <h3>Format & appearance</h3>
          <label>
            Physical format
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              <option value="a4">A4 sheet — 24 labels/page</option>
              <option value="thermal">58mm thermal — one/page</option>
              <option value="sticker">50×30mm sticker</option>
              <option value="compact">40×25mm compact</option>
            </select>
          </label>
          <label>
            Label style
            <select value={style} onChange={(event) => setStyle(event.target.value)}>
              <option value="compact">Compact — QR + exact ID + product</option>
              <option value="standard">Standard — QR + ID + product/code</option>
              <option value="detailed">Detailed — product + batch + store + status</option>
            </select>
          </label>

          <div className={`identity-studio__preview identity-studio__preview--${style}`}>
            <div className="identity-studio__fake-qr" aria-hidden="true">▦</div>
            <div>
              <small>CHALIN 03</small>
              <strong>{selectedRows[0]?.unit_code || "SO4L-K7M4Q9XD"}</strong>
              <span>{selectedRows[0]?.product_name || "Selected product"}</span>
              {style !== "compact" ? <small>Code {selectedRows[0]?.inventory_product_code || "SO4L"}</small> : null}
              {style === "detailed" ? <small>{selectedRows[0]?.batch_code || "Batch"} · {selectedRows[0]?.branch_code || "STORE"}</small> : null}
            </div>
          </div>

          <div className="identity-studio__print-summary">
            <span><strong>{selectedRows.length}</strong> labels</span>
            <span><strong>{pageCount}</strong> page{pageCount === 1 ? "" : "s"}</span>
            <span className={reprintCount ? "is-warning" : ""}><strong>{reprintCount}</strong> reprint{reprintCount === 1 ? "" : "s"}</span>
          </div>

          {reprintCount ? (
            <label>
              Reprint reason {isAdmin ? "(required)" : "(Administrator only)"}
              <textarea
                rows="3"
                disabled={!isAdmin}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Printer jam, damaged label, unreadable print…"
              />
            </label>
          ) : null}

          <button
            type="button"
            className="identity-studio__primary"
            disabled={
              !selectedRows.length ||
              selectedRows.length > 500 ||
              busy === "print" ||
              (reprintCount > 0 && (!isAdmin || reason.trim().length < 8))
            }
            onClick={printSelected}
          >
            {busy === "print" ? "Preparing selected PDF…" : "Download Selected Labels PDF"}
          </button>
          <button
            type="button"
            className="traceability-secondary"
            disabled={!selectedRows.length || busy === "export"}
            onClick={exportSelected}
          >
            {busy === "export" ? "Preparing ID list…" : "Download Selected IDs (CSV)"}
          </button>
          <p className="identity-studio__security-note">
            QR signatures are generated only inside the controlled PDF. CSV exports never contain signed QR payloads.
          </p>
        </aside>
      </div>

      {confirmationCodes.length ? (
        <div className="identity-studio__confirmation">
          <div>
            <p className="traceability-eyebrow">Physical Confirmation</p>
            <h3>Confirm only the labels you just printed</h3>
            <p>Keep checked IDs as physically attached. Uncheck damaged or unused labels to void only those IDs. Other pending IDs are untouched.</p>
          </div>
          <div className="identity-studio__confirmation-grid">
            {confirmationCodes.map((code) => {
              const attached = !voidCodes.has(code);
              return (
                <label key={code} className={!attached ? "is-void" : ""}>
                  <input type="checkbox" checked={attached} onChange={() => toggleVoid(code)} />
                  <span><strong>{code}</strong><small>{attached ? "Attached to physical stock" : "Void — damaged/unused"}</small></span>
                </label>
              );
            })}
          </div>
          <label className="traceability-confirmation">
            <input
              type="checkbox"
              checked={physicalConfirmed}
              onChange={(event) => setPhysicalConfirmed(event.target.checked)}
            />
            <span>I physically checked these selected labels. No unselected stock ID will be activated or voided by this confirmation.</span>
          </label>
          <button
            type="button"
            className="identity-studio__primary"
            disabled={!physicalConfirmed || busy === "confirm"}
            onClick={confirmSelected}
          >
            {busy === "confirm" ? "Confirming selected IDs…" : `Confirm ${confirmationCodes.length - voidCodes.size} Attached · Void ${voidCodes.size}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
