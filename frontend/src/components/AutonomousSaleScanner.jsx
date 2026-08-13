import { useEffect, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";

const FORMATS = ["qr_code", "code_128", "ean_13", "ean_8", "upc_a", "upc_e"];

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
  if (reason === "exact_id_required") return `${name} needs its exact CHALIN label. Scan the item label, not the general product barcode.`;
  if (reason.startsWith("status_")) return `${name} cannot be sold because this exact item is ${reason.slice(7).replaceAll("_", " ")}.`;
  return `${name} is not ready for sale.`;
}

export default function AutonomousSaleScanner({ onResolvedScan, disabled = false }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const frameRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });

  function stopCamera() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    processingRef.current = false;
    setCameraOpen(false);
    setCameraStarting(false);
  }

  useEffect(() => stopCamera, []);

  async function identify(rawValue) {
    const raw = clean(rawValue);
    if (!raw || disabled || busy) {
      processingRef.current = false;
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        "/inventory-traceability/sale-scan/verify",
        { value: raw }
      );
      const data = response.data || {};
      if (!data.product) throw new Error("This scan did not identify a product.");
      if (!data.sale_ready) throw new Error(blockedMessage(data));
      await onResolvedScan?.(data);
      setValue("");
      setMessage(`${data.product.name} · GHS ${Number(data.product.selling_price || 0).toFixed(2)} added${data.unit?.unit_code ? ` · ${data.unit.unit_code}` : ""}.`);
      navigator?.vibrate?.(50);
    } catch (scanError) {
      setError(apiMessage(scanError, "Unable to identify this item."));
      navigator?.vibrate?.([70, 50, 70]);
    } finally {
      setBusy(false);
      processingRef.current = false;
    }
  }

  async function detectFrame() {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!cameraOpen || !video || !detector || video.readyState < 2) {
      if (cameraOpen) frameRef.current = requestAnimationFrame(detectFrame);
      return;
    }
    if (!processingRef.current) {
      try {
        const hits = await detector.detect(video);
        const raw = clean(hits?.[0]?.rawValue);
        const now = Date.now();
        if (raw && (raw !== lastScanRef.current.value || now - lastScanRef.current.at > 1400)) {
          lastScanRef.current = { value: raw, at: now };
          processingRef.current = true;
          await identify(raw);
        }
      } catch (scanError) {
        setError(apiMessage(scanError, "Camera detection failed. Type the code or use a handheld scanner."));
      }
    }
    if (cameraOpen) frameRef.current = requestAnimationFrame(detectFrame);
  }

  async function startCamera() {
    if (disabled || cameraOpen || cameraStarting) return;
    setCameraStarting(true);
    setError("");
    try {
      const Detector = globalThis.BarcodeDetector;
      if (!Detector || !navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Camera scanning is unavailable in this browser. Type the code or use a USB/Bluetooth scanner.");
      }
      let formats = ["qr_code"];
      if (typeof Detector.getSupportedFormats === "function") {
        const supported = await Detector.getSupportedFormats();
        formats = FORMATS.filter((format) => supported.includes(format));
        if (!formats.length) throw new Error("This browser camera does not support the required barcode formats.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 900 } },
      });
      streamRef.current = stream;
      detectorRef.current = new Detector({ formats });
      setCameraOpen(true);
      setCameraStarting(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      frameRef.current = requestAnimationFrame(detectFrame);
    } catch (cameraError) {
      stopCamera();
      setError(apiMessage(cameraError, "Unable to start the camera."));
    }
  }

  return (
    <div style={styles.box}>
      <div style={styles.heading}>
        <div>
          <strong>Scan Item</strong>
          <p style={styles.help}>Optional — scan QR/barcode or type a code. It adds to this same sale cart.</p>
        </div>
        <span style={styles.badge}>Fast add</span>
      </div>
      <div style={styles.actions}>
        <input
          value={value}
          disabled={disabled || busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              identify(value);
            }
          }}
          placeholder="Scan or enter CHALIN ID / product barcode"
          autoComplete="off"
          style={styles.input}
        />
        <button type="button" disabled={disabled || busy || !value.trim()} onClick={() => identify(value)} style={styles.addButton}>
          {busy ? "Adding…" : "Add Scan"}
        </button>
        <button type="button" disabled={disabled || cameraStarting} onClick={cameraOpen ? stopCamera : startCamera} style={styles.cameraButton}>
          {cameraStarting ? "Starting…" : cameraOpen ? "Stop Camera" : "Camera"}
        </button>
      </div>
      {cameraOpen ? (
        <div style={styles.cameraBox}>
          <video ref={videoRef} muted playsInline aria-label="Sale item camera scanner" style={styles.video} />
          <small>Keep the rear camera on one label at a time. Successful scans add to the cart while the camera stays open.</small>
        </div>
      ) : null}
      {message ? <div style={styles.success}>{message}</div> : null}
      {error ? <div style={styles.error}>{error}</div> : null}
    </div>
  );
}

const styles = {
  box: { marginBottom: "14px", padding: "12px", border: "1px solid #bfdbfe", borderRadius: "14px", background: "#f8fbff" },
  heading: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" },
  help: { margin: "3px 0 0", color: "#64748b", fontSize: "13px" },
  badge: { padding: "5px 9px", borderRadius: "999px", background: "#dbeafe", color: "#1d4ed8", fontSize: "11px", fontWeight: 900 },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" },
  input: { flex: "1 1 220px", minWidth: 0, minHeight: "44px", padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: "10px", font: "inherit" },
  addButton: { minHeight: "44px", padding: "10px 14px", border: 0, borderRadius: "10px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: "pointer" },
  cameraButton: { minHeight: "44px", padding: "10px 14px", border: "1px solid #93c5fd", borderRadius: "10px", background: "#fff", color: "#1d4ed8", fontWeight: 900, cursor: "pointer" },
  cameraBox: { display: "grid", gap: "6px", marginTop: "10px", color: "#475569" },
  video: { width: "100%", maxHeight: "320px", objectFit: "cover", borderRadius: "12px", background: "#0f172a" },
  success: { marginTop: "8px", padding: "8px 10px", borderRadius: "9px", background: "#ecfdf5", color: "#166534", fontWeight: 700 },
  error: { marginTop: "8px", padding: "8px 10px", borderRadius: "9px", background: "#fff1f2", color: "#9f1239", fontWeight: 700 },
};
