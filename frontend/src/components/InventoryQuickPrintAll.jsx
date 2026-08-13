import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
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

export default function InventoryQuickPrintAll({ productId, onPrinted }) {
  const [units, setUnits] = useState([]);
  const [maxSelection, setMaxSelection] = useState(500);
  const [format, setFormat] = useState("sticker");
  const [style, setStyle] = useState("standard");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmationCodes, setConfirmationCodes] = useState([]);
  const [voidCodes, setVoidCodes] = useState(() => new Set());
  const [physicalConfirmed, setPhysicalConfirmed] = useState(false);

  const load = useCallback(async () => {
    const response = await axiosClient.get(
      "/inventory-traceability/identity-studio/units"
    );
    setUnits(response.data?.units || []);
    setMaxSelection(Number(response.data?.max_selection || 500));
  }, []);

  useEffect(() => {
    setConfirmationCodes([]);
    setVoidCodes(new Set());
    setPhysicalConfirmed(false);
    load().catch((loadError) =>
      setError(apiMessage(loadError, "Unable to load unprinted IDs."))
    );
  }, [load, productId]);

  const unprinted = useMemo(
    () =>
      units.filter(
        (unit) =>
          Number(unit.product_id) === Number(productId) &&
          unit.status === "label_pending" &&
          !unit.requires_reprint
      ),
    [productId, units]
  );

  async function printAll() {
    if (!unprinted.length) return;
    const rows = unprinted.slice(0, maxSelection);
    setBusy("print");
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
      downloadBlob(
        response.data,
        `chalin03-all-unprinted-labels-${Date.now()}.pdf`
      );
      setConfirmationCodes(rows.map((unit) => unit.unit_code));
      setVoidCodes(new Set());
      setPhysicalConfirmed(false);
      setNotice(
        unprinted.length > rows.length
          ? `${rows.length} labels downloaded. ${unprinted.length - rows.length} remain for the next one-click print job.`
          : `${rows.length} label${rows.length === 1 ? "" : "s"} downloaded. Attach them to the matching stock, then confirm below.`
      );
      await load();
      await onPrinted?.();
    } catch (printError) {
      let message = "Unable to print all unprinted IDs.";
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

  function toggleVoid(code) {
    setVoidCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setPhysicalConfirmed(false);
  }

  async function confirmPrinted() {
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
          notes: `Quick Print confirmation: ${active.length} attached; ${voided.length} damaged/unused.`,
        }
      );
      setNotice(response.data?.message || "Printed labels confirmed.");
      setConfirmationCodes([]);
      setVoidCodes(new Set());
      setPhysicalConfirmed(false);
      await load();
      await onPrinted?.();
    } catch (confirmError) {
      setError(apiMessage(confirmError, "Unable to confirm the printed labels."));
    } finally {
      setBusy("");
    }
  }

  if (!productId) return null;

  return (
    <section className="simple-label-studio" style={{ marginBottom: "1rem" }}>
      <header className="simple-label-studio__header">
        <div>
          <p className="traceability-eyebrow">Quick Print</p>
          <h2>Print every unprinted ID for this product in one click.</h2>
          <p>
            Default: 50×30 mm Standard. Change the setting only when your printer or
            product needs another layout.
          </p>
        </div>
        <div className="simple-label-studio__count">
          <strong>{unprinted.length}</strong>
          <span>unprinted</span>
        </div>
      </header>

      {error ? (
        <div className="traceability-message traceability-message--error">{error}</div>
      ) : null}
      {notice ? (
        <div className="traceability-message traceability-message--success">{notice}</div>
      ) : null}

      <div className="simple-traceability-start__selector">
        <select value={format} onChange={(event) => setFormat(event.target.value)}>
          <option value="sticker">50×30 mm Sticker — Recommended</option>
          <option value="a4">A4 Sheet — 24 labels/page</option>
          <option value="thermal">58 mm Thermal</option>
          <option value="compact">40×25 mm Compact</option>
        </select>
        <select value={style} onChange={(event) => setStyle(event.target.value)}>
          <option value="standard">Standard — Recommended</option>
          <option value="compact">Simple</option>
          <option value="detailed">Detailed</option>
        </select>
        <button
          type="button"
          className="simple-label-studio__primary"
          disabled={!unprinted.length || Boolean(busy)}
          onClick={printAll}
        >
          {busy === "print"
            ? "Preparing All Labels…"
            : `Print All ${unprinted.length || ""} Unprinted IDs`}
        </button>
      </div>

      {confirmationCodes.length ? (
        <div className="simple-label-studio__confirm" style={{ marginTop: "1rem" }}>
          <div className="simple-label-studio__confirm-number">✓</div>
          <div>
            <h3>Confirm what you physically attached</h3>
            <p>
              Keep successful labels checked. Untick only a damaged or unused label;
              that exact ID will be voided instead of activated.
            </p>
            <div className="simple-label-studio__confirm-list">
              {confirmationCodes.map((code) => {
                const attached = !voidCodes.has(code);
                return (
                  <label key={code} className={!attached ? "is-void" : ""}>
                    <input
                      type="checkbox"
                      checked={attached}
                      onChange={() => toggleVoid(code)}
                    />
                    <span>
                      <strong>{code}</strong>
                      <small>
                        {attached
                          ? "Attached to physical stock"
                          : "Damaged / unused — void this ID"}
                      </small>
                    </span>
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
              <span>I physically checked the attached/unused choices above.</span>
            </label>
            <button
              type="button"
              className="simple-label-studio__primary"
              disabled={!physicalConfirmed || Boolean(busy)}
              onClick={confirmPrinted}
            >
              {busy === "confirm"
                ? "Confirming…"
                : `Confirm ${confirmationCodes.length - voidCodes.size} Attached · Void ${voidCodes.size}`}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
