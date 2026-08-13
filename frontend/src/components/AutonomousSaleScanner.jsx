import { useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import CameraBarcodeReader from "./BarcodeCapturePanel";

const SALE_FORMATS = [
  "qr_code",
  "code_128",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
];

function clean(value) {
  return String(value || "").trim();
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function blockedMessage(data) {
  const name = data?.product?.name || "This item";
  const reason = String(data?.blocking_reason || "");
  if (reason === "wrong_store") return `${name} belongs to another store.`;
  if (reason === "already_sold") return `${name} was already sold.`;
  if (reason === "out_of_stock") return `${name} is out of stock.`;
  if (reason === "exact_id_required") {
    return `${name} needs its exact CHALIN label. Scan the item label, not the general product barcode.`;
  }
  if (reason.startsWith("status_")) {
    return `${name} cannot be sold because this exact item is ${reason
      .slice(7)
      .replaceAll("_", " ")}.`;
  }
  return `${name} is not ready for sale.`;
}

export default function AutonomousSaleScanner({
  onResolvedScan,
  disabled = false,
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanMode, setScanMode] = useState("single");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const queueRef = useRef(Promise.resolve());

  function identify(rawValue, source = "manual") {
    const raw = clean(rawValue);
    if (!raw || disabled) return Promise.resolve(false);

    const task = async () => {
      setBusy(true);
      setError("");
      setMessage("");
      try {
        const response = await axiosClient.post(
          "/inventory-traceability/sale-scan/verify",
          { value: raw }
        );
        const data = response.data || {};
        if (!data.product) {
          throw new Error("This scan did not identify a product.");
        }
        if (!data.sale_ready) throw new Error(blockedMessage(data));

        const accepted = await onResolvedScan?.(data);
        if (accepted === false) return false;

        setValue("");
        setMessage(
          `${data.product.name} captured automatically · GHS ${Number(
            data.product.selling_price || 0
          ).toFixed(2)}${
            data.unit?.unit_code ? ` · ${data.unit.unit_code}` : ""
          }.${source === "camera" && scanMode === "multi" ? " Scan the next item." : ""}`
        );
        navigator?.vibrate?.(50);
        return true;
      } catch (scanError) {
        setError(apiMessage(scanError, "Unable to identify this item."));
        navigator?.vibrate?.([70, 50, 70]);
        return false;
      } finally {
        setBusy(false);
      }
    };

    queueRef.current = queueRef.current.then(task, task);
    return queueRef.current;
  }

  return (
    <div style={styles.box}>
      <div style={styles.heading}>
        <div>
          <strong>Scan Item</strong>
          <p style={styles.help}>
            Scan a CHALIN label or product barcode. Verified items are captured and added to this same sale cart automatically.
          </p>
        </div>
        <span style={styles.badge}>Automatic add</span>
      </div>

      <div style={styles.modeBox}>
        <strong style={styles.modeTitle}>Camera scan mode</strong>
        <div style={styles.modeButtons}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setScanMode("single")}
            style={{
              ...styles.modeButton,
              ...(scanMode === "single" ? styles.modeButtonActive : {}),
            }}
          >
            Single Item
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setScanMode("multi")}
            style={{
              ...styles.modeButton,
              ...(scanMode === "multi" ? styles.modeButtonActive : {}),
            }}
          >
            Multiple Items
          </button>
        </div>
        <small style={styles.modeHelp}>
          {scanMode === "single"
            ? "Single Item closes the camera after one accepted item."
            : "Multiple Items keeps the camera open. Move each item away after capture, then present the next item."}
        </small>
      </div>

      <CameraBarcodeReader
        disabled={disabled}
        mode={scanMode}
        formats={SALE_FORMATS}
        title={scanMode === "single" ? "Single Item Camera" : "Multiple Item Camera"}
        help={
          scanMode === "single"
            ? "Point at one item. It is verified and added automatically, then the camera closes."
            : "Keep the camera open and scan items continuously. Each item is verified and added automatically."
        }
        onDetected={(raw) => identify(raw, "camera")}
      />

      <div style={styles.manualDivider}>
        <span>or use a USB/Bluetooth scanner or type the code</span>
      </div>

      <div style={styles.actions}>
        <input
          value={value}
          disabled={disabled || busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              identify(value, "manual");
            }
          }}
          placeholder="Scan or enter CHALIN ID / product barcode"
          autoComplete="off"
          autoCapitalize="characters"
          style={styles.input}
        />
        <button
          type="button"
          disabled={disabled || busy || !value.trim()}
          onClick={() => identify(value, "manual")}
          style={styles.addButton}
        >
          {busy ? "Checking…" : "Add Code"}
        </button>
      </div>

      {message ? <div style={styles.success}>{message}</div> : null}
      {error ? <div style={styles.error}>{error}</div> : null}
    </div>
  );
}

const styles = {
  box: {
    marginBottom: "14px",
    padding: "12px",
    border: "1px solid #bfdbfe",
    borderRadius: "14px",
    background: "#f8fbff",
  },
  heading: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  help: { margin: "3px 0 0", color: "#64748b", fontSize: "13px" },
  badge: {
    padding: "5px 9px",
    borderRadius: "999px",
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: "11px",
    fontWeight: 900,
  },
  modeBox: {
    display: "grid",
    gap: "7px",
    marginTop: "12px",
    padding: "10px",
    borderRadius: "12px",
    background: "#eef6ff",
  },
  modeTitle: { fontSize: "13px", color: "#0f172a" },
  modeButtons: { display: "flex", gap: "8px", flexWrap: "wrap" },
  modeButton: {
    minHeight: "42px",
    padding: "9px 13px",
    border: "1px solid #bfdbfe",
    borderRadius: "10px",
    background: "#fff",
    color: "#1e3a8a",
    fontWeight: 900,
    cursor: "pointer",
  },
  modeButtonActive: {
    background: "#07182c",
    borderColor: "#07182c",
    color: "#fff",
  },
  modeHelp: { color: "#475569", lineHeight: 1.45 },
  manualDivider: {
    display: "flex",
    alignItems: "center",
    marginTop: "12px",
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 700,
  },
  actions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "8px",
  },
  input: {
    flex: "1 1 220px",
    minWidth: 0,
    minHeight: "44px",
    padding: "10px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    font: "inherit",
  },
  addButton: {
    minHeight: "44px",
    padding: "10px 14px",
    border: 0,
    borderRadius: "10px",
    background: "#07182c",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
  },
  success: {
    marginTop: "8px",
    padding: "8px 10px",
    borderRadius: "9px",
    background: "#ecfdf5",
    color: "#166534",
    fontWeight: 700,
  },
  error: {
    marginTop: "8px",
    padding: "8px 10px",
    borderRadius: "9px",
    background: "#fff1f2",
    color: "#9f1239",
    fontWeight: 700,
  },
};
