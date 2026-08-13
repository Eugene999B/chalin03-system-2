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
  const [format, setFormat] = useState("sticker");
  const [style, setStyle] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await axiosClient.get(
      "/inventory-traceability/identity-studio/units"
    );
    setUnits(response.data?.units || []);
  }, []);

  useEffect(() => {
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/identity-studio/print-selected",
        {
          unit_codes: unprinted.map((unit) => unit.unit_code),
          print_format: format,
          label_style: style,
        },
        { responseType: "blob" }
      );
      downloadBlob(
        response.data,
        `chalin03-all-unprinted-labels-${Date.now()}.pdf`
      );
      setNotice(
        `${unprinted.length} label${unprinted.length === 1 ? "" : "s"} downloaded. Attach them to the matching stock, then use the confirmation section below.`
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
      setBusy(false);
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
          disabled={!unprinted.length || busy}
          onClick={printAll}
        >
          {busy
            ? "Preparing All Labels…"
            : `Print All ${unprinted.length || ""} Unprinted IDs`}
        </button>
      </div>
    </section>
  );
}
