import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/inventoryLabelStudio.css";

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

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function zipStore(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const directoryParts = [];
  let offset = 0;

  entries.forEach(([name, text]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const checksum = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    localParts.push(local);

    const directory = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    directoryParts.push(directory);
    offset += local.length;
  });

  const directory = concatBytes(directoryParts);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return new Blob([...localParts, directory, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function columnName(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function makeInventoryWorkbook(rows) {
  const headers = [
    "Exact Unit ID", "Product", "Product Code", "Batch", "Store", "Status",
    "Per-ID Print Count", "Last Printed", "Created At",
  ];
  const values = [headers, ...rows.map((unit) => [
    unit.unit_code,
    unit.product_name,
    unit.inventory_product_code || "",
    unit.batch_code || "",
    [unit.branch_code, unit.branch_name].filter(Boolean).join(" — "),
    unit.status,
    Number(unit.unit_print_count || 0),
    unit.last_printed_at || "",
    unit.created_at || "",
  ])];
  const sheetRows = values.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:I${Math.max(values.length, 1)}"/>
</worksheet>`;

  return zipStore([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory ID Register" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", worksheet],
  ]);
}

const FORMAT_OPTIONS = [
  { value: "sticker", title: "50×30 mm Sticker", note: "Recommended for most products", badge: "Recommended" },
  { value: "a4", title: "A4 Sheet", note: "24 labels per office-printer page" },
  { value: "thermal", title: "58 mm Thermal", note: "One label per thermal page" },
  { value: "compact", title: "40×25 mm Compact", note: "For smaller products" },
];

const STYLE_OPTIONS = [
  { value: "standard", title: "Standard", note: "QR + ID + product + product code", badge: "Recommended" },
  { value: "compact", title: "Simple", note: "QR + large ID + product" },
  { value: "detailed", title: "Detailed", note: "Adds batch, store and status" },
];

export default function InventoryLabelStudio({ onChanged, preferredProductId = null }) {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [units, setUnits] = useState([]);
  const [products, setProducts] = useState([]);
  const [maxSelection, setMaxSelection] = useState(2000);
  const [productFilter, setProductFilter] = useState("");
  const [printMode, setPrintMode] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [format, setFormat] = useState("sticker");
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
    setMaxSelection(Number(response.data?.max_selection || 2000));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        await loadStudio();
      } catch (loadError) {
        if (active) setError(apiMessage(loadError, "Unable to load product IDs."));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadStudio]);

  useEffect(() => {
    if (!preferredProductId) return;
    setProductFilter(String(preferredProductId));
    setPrintMode("");
    setSelected(new Set());
  }, [preferredProductId]);

  const chosenProduct = useMemo(
    () => products.find((product) => Number(product.id) === Number(productFilter)) || null,
    [productFilter, products]
  );

  const productUnits = useMemo(
    () => units.filter((unit) => Number(unit.product_id) === Number(productFilter)),
    [productFilter, units]
  );

  const unprintedUnits = useMemo(
    () => productUnits.filter((unit) => unit.status === "label_pending" && !unit.requires_reprint),
    [productUnits]
  );

  const specificUnits = useMemo(() => {
    const query = search.trim().toLowerCase();
    return productUnits.filter((unit) => {
      if (!["label_pending", "active"].includes(unit.status)) return false;
      if (!query) return true;
      return [unit.unit_code, unit.product_name, unit.batch_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [productUnits, search]);

  const selectedRows = useMemo(
    () => units.filter((unit) => selected.has(unit.unit_code)),
    [selected, units]
  );
  const reprintCount = selectedRows.filter((unit) => unit.requires_reprint).length;
  const labelsPerPage = format === "a4" ? 24 : 1;
  const pageCount = selectedRows.length ? Math.ceil(selectedRows.length / labelsPerPage) : 0;

  function chooseProduct(value) {
    setProductFilter(value);
    setPrintMode("");
    setSelected(new Set());
    setSearch("");
    setReason("");
  }

  function chooseAllUnprinted() {
    const rows = unprintedUnits.slice(0, maxSelection);
    setPrintMode("all");
    setSelected(new Set(rows.map((unit) => unit.unit_code)));
    if (unprintedUnits.length > maxSelection) {
      setNotice(`This product has ${unprintedUnits.length} unprinted IDs. This print job selected the first ${maxSelection}; print the remainder as a second job.`);
    } else {
      setNotice(`${rows.length} unprinted ID${rows.length === 1 ? "" : "s"} selected for ${chosenProduct?.name || "this product"}.`);
    }
  }

  function chooseSpecific() {
    setPrintMode("specific");
    setSelected(new Set());
    setNotice("Choose only the exact IDs you want below. Previously printed IDs are clearly marked as controlled reprints.");
  }

  function toggle(unitCode) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(unitCode)) next.delete(unitCode);
      else if (next.size < maxSelection) next.add(unitCode);
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
      downloadBlob(
        response.data,
        safeFileName(response.headers?.["content-disposition"], `chalin03-product-labels-${Date.now()}.pdf`)
      );
      const pendingCodes = selectedRows
        .filter((unit) => unit.status === "label_pending")
        .map((unit) => unit.unit_code);
      setConfirmationCodes(pendingCodes);
      setVoidCodes(new Set());
      setPhysicalConfirmed(false);
      setReason("");
      setNotice(
        `Downloaded ${selectedRows.length} print-ready label${selectedRows.length === 1 ? "" : "s"}. ${pendingCodes.length ? "After attaching them, complete Step 4 below." : "This was a controlled replacement-label print."}`
      );
      await loadStudio();
      if (onChanged) await onChanged();
    } catch (printError) {
      let message = "Unable to prepare the selected labels.";
      if (printError?.response?.data instanceof Blob) {
        try {
          const parsed = JSON.parse(await printError.response.data.text());
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

  async function downloadCsv() {
    if (!selectedRows.length) return;
    setBusy("csv");
    setError("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/export-selected",
        { unit_codes: selectedRows.map((unit) => unit.unit_code) },
        { responseType: "blob" }
      );
      downloadBlob(
        response.data,
        safeFileName(response.headers?.["content-disposition"], `chalin03-inventory-id-register-${Date.now()}.csv`)
      );
      setNotice(`Downloaded ${selectedRows.length} selected IDs as CSV.`);
    } catch (exportError) {
      setError(apiMessage(exportError, "Unable to download the CSV register."));
    } finally {
      setBusy("");
    }
  }

  function downloadExcel() {
    if (!selectedRows.length) return;
    const workbook = makeInventoryWorkbook(selectedRows);
    downloadBlob(workbook, `chalin03-inventory-id-register-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setNotice(`Downloaded ${selectedRows.length} selected IDs as an Excel register.`);
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
          notes: `Simple Label Studio confirmation: ${active.length} attached; ${voided.length} damaged/unused.`,
        }
      );
      setNotice(response.data?.message || "Physical labels confirmed.");
      clearSelection();
      await loadStudio();
      if (onChanged) await onChanged();
    } catch (confirmError) {
      setError(apiMessage(confirmError, "Unable to confirm the physical labels."));
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <section className="simple-label-studio simple-label-studio--loading">Loading product IDs…</section>;
  }

  return (
    <section className="simple-label-studio">
      <header className="simple-label-studio__header">
        <div>
          <p className="traceability-eyebrow">Print Product IDs</p>
          <h2>Choose a product, choose what to print, then download.</h2>
          <p>No technical setup is required here. The system already generated the exact IDs; you only decide which labels you need.</p>
        </div>
        <div className="simple-label-studio__count"><strong>{selectedRows.length}</strong><span>selected</span></div>
      </header>

      {error ? <div className="traceability-message traceability-message--error">{error}</div> : null}
      {notice ? <div className="traceability-message traceability-message--success">{notice}</div> : null}

      <div className="simple-label-studio__steps">
        <article className="simple-label-studio__step">
          <span>1</span>
          <div className="simple-label-studio__step-body">
            <h3>Choose the product</h3>
            <select value={productFilter} onChange={(event) => chooseProduct(event.target.value)}>
              <option value="">Select a product with generated IDs…</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}{product.size ? ` — ${product.size}` : ""} · {product.pending_count} waiting · {product.active_count} active
                </option>
              ))}
            </select>
            {chosenProduct ? (
              <div className="simple-label-studio__product-summary">
                <span><b>{chosenProduct.unit_count}</b> total IDs</span>
                <span><b>{unprintedUnits.length}</b> need first label</span>
                <span><b>{chosenProduct.active_count}</b> active</span>
              </div>
            ) : null}
          </div>
        </article>

        <article className={`simple-label-studio__step ${!chosenProduct ? "is-disabled" : ""}`}>
          <span>2</span>
          <div className="simple-label-studio__step-body">
            <h3>What do you want to print?</h3>
            <div className="simple-label-studio__choice-grid">
              <button type="button" className={printMode === "all" ? "is-selected" : ""} disabled={!chosenProduct || !unprintedUnits.length} onClick={chooseAllUnprinted}>
                <strong>Print All IDs Needing Labels</strong>
                <small>{unprintedUnits.length ? `${unprintedUnits.length} unprinted ID${unprintedUnits.length === 1 ? "" : "s"}` : "No unprinted IDs"}</small>
                <em>Recommended — avoids accidental duplicate labels</em>
              </button>
              <button type="button" className={printMode === "specific" ? "is-selected" : ""} disabled={!chosenProduct} onClick={chooseSpecific}>
                <strong>Choose Specific IDs</strong>
                <small>Tick only the exact IDs you want</small>
                <em>Also used for controlled reprints</em>
              </button>
            </div>

            {printMode === "specific" ? (
              <div className="simple-label-studio__specific">
                <div className="simple-label-studio__specific-tools">
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search exact ID or batch…" />
                  <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
                <div className="simple-label-studio__id-list">
                  {specificUnits.map((unit) => (
                    <label key={unit.id} className={selected.has(unit.unit_code) ? "is-selected" : ""}>
                      <input type="checkbox" checked={selected.has(unit.unit_code)} onChange={() => toggle(unit.unit_code)} />
                      <span><strong>{unit.unit_code}</strong><small>{unit.batch_code}</small></span>
                      <b className={unit.requires_reprint ? "is-reprint" : ""}>{unit.requires_reprint ? "Reprint" : "New label"}</b>
                    </label>
                  ))}
                  {!specificUnits.length ? <p className="traceability-empty">No printable IDs found for this product.</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className={`simple-label-studio__step ${!selectedRows.length ? "is-disabled" : ""}`}>
          <span>3</span>
          <div className="simple-label-studio__step-body">
            <h3>Choose label size and look</h3>
            <p className="simple-label-studio__hint">Recommended default: <b>50×30 mm Sticker + Standard</b>.</p>
            <div className="simple-label-studio__option-title">Label size</div>
            <div className="simple-label-studio__option-grid">
              {FORMAT_OPTIONS.map((option) => (
                <button type="button" key={option.value} className={format === option.value ? "is-selected" : ""} onClick={() => setFormat(option.value)}>
                  <strong>{option.title}</strong><small>{option.note}</small>{option.badge ? <em>{option.badge}</em> : null}
                </button>
              ))}
            </div>
            <div className="simple-label-studio__option-title">Label design</div>
            <div className="simple-label-studio__option-grid simple-label-studio__option-grid--three">
              {STYLE_OPTIONS.map((option) => (
                <button type="button" key={option.value} className={style === option.value ? "is-selected" : ""} onClick={() => setStyle(option.value)}>
                  <strong>{option.title}</strong><small>{option.note}</small>{option.badge ? <em>{option.badge}</em> : null}
                </button>
              ))}
            </div>

            <div className="simple-label-studio__preview-row">
              <div className={`simple-label-studio__preview simple-label-studio__preview--${style}`}>
                <div className="simple-label-studio__fake-qr">▦</div>
                <div>
                  <small>CHALIN 03</small>
                  <strong>{selectedRows[0]?.unit_code || "PRODUCT-7K9M2Q4X"}</strong>
                  <span>{selectedRows[0]?.product_name || chosenProduct?.name || "Selected product"}</span>
                  {style !== "compact" ? <small>Code {selectedRows[0]?.inventory_product_code || chosenProduct?.product_code || "AUTO"}</small> : null}
                  {style === "detailed" ? <small>{selectedRows[0]?.batch_code || "Batch"} · {selectedRows[0]?.branch_code || "STORE"}</small> : null}
                </div>
              </div>
              <div className="simple-label-studio__job-summary">
                <span><b>{selectedRows.length}</b> labels</span>
                <span><b>{pageCount}</b> page{pageCount === 1 ? "" : "s"}</span>
                <span className={reprintCount ? "is-warning" : ""}><b>{reprintCount}</b> controlled reprint{reprintCount === 1 ? "" : "s"}</span>
              </div>
            </div>

            {reprintCount ? (
              <label className="simple-label-studio__reason">
                Reprint reason {isAdmin ? "(required)" : "(Administrator only)"}
                <textarea rows="3" disabled={!isAdmin} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: damaged label during fitting" />
              </label>
            ) : null}

            <div className="simple-label-studio__downloads">
              <button
                type="button"
                className="simple-label-studio__primary"
                disabled={!selectedRows.length || busy === "print" || (reprintCount > 0 && (!isAdmin || reason.trim().length < 8))}
                onClick={printSelected}
              >
                {busy === "print" ? "Preparing PDF…" : "Print / Download Labels PDF"}
              </button>
              <div className="simple-label-studio__registers">
                <button type="button" disabled={!selectedRows.length} onClick={downloadExcel}>Excel ID Register (.xlsx)</button>
                <button type="button" disabled={!selectedRows.length || busy === "csv"} onClick={downloadCsv}>{busy === "csv" ? "Preparing CSV…" : "CSV ID Register (.csv)"}</button>
              </div>
              <p>Labels PDF contains the signed QR. Excel and CSV registers contain only the human-readable IDs and audit fields.</p>
            </div>
          </div>
        </article>
      </div>

      {confirmationCodes.length ? (
        <article className="simple-label-studio__confirm">
          <div className="simple-label-studio__confirm-number">4</div>
          <div>
            <h3>Confirm the labels after you attach them</h3>
            <p>Every label you just printed is checked as attached. Untick only labels that were damaged or not used.</p>
            <div className="simple-label-studio__confirm-list">
              {confirmationCodes.map((code) => {
                const attached = !voidCodes.has(code);
                return (
                  <label key={code} className={!attached ? "is-void" : ""}>
                    <input type="checkbox" checked={attached} onChange={() => toggleVoid(code)} />
                    <span><strong>{code}</strong><small>{attached ? "Attached to product" : "Damaged / unused — void this ID"}</small></span>
                  </label>
                );
              })}
            </div>
            <label className="traceability-confirmation">
              <input type="checkbox" checked={physicalConfirmed} onChange={(event) => setPhysicalConfirmed(event.target.checked)} />
              <span>I physically checked these labels and the attached/unused choices above are correct.</span>
            </label>
            <button type="button" className="simple-label-studio__primary" disabled={!physicalConfirmed || busy === "confirm"} onClick={confirmSelected}>
              {busy === "confirm" ? "Confirming…" : `Confirm ${confirmationCodes.length - voidCodes.size} Attached · Void ${voidCodes.size}`}
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}
