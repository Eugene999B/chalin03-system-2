import { useEffect, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/inventoryUnitScanner.css";

const FORMATS = ["qr_code", "code_128", "ean_13", "ean_8", "upc_a", "upc_e"];

function clean(value) {
  return String(value || "").trim();
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function blockMessage(data) {
  const name = data?.product?.name || "This item";
  const reason = String(data?.blocking_reason || "");
  if (reason === "wrong_store") return `${name} belongs to another store.`;
  if (reason === "already_sold") return `${name} was already sold and cannot be scanned again.`;
  if (reason === "out_of_stock") return `${name} is out of stock.`;
  if (reason === "exact_id_required") {
    return `${name} requires its exact CHALIN physical ID. Scan the CHALIN label instead of the general product barcode.`;
  }
  if (reason.startsWith("status_")) {
    return `${name} cannot be sold because this exact unit is ${reason.slice(7).replaceAll("_", " ")}.`;
  }
  return `${name} is not ready for sale.`;
}

export default function AutonomousSaleScanner({ onResolvedScan, disabled = false }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const frameRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });

  function stopCamera() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
    detectorRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    processingRef.current = false;
    setCameraOpen(false);
    setCameraStarting(false);
  }

  useEffect(() => stopCamera, []);

  async function identify(rawValue, source = "manual") {
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
      if (!data.product) throw new Error("The scan did not identify a product.");
      if (!data.sale_ready) throw new Error(blockMessage(data));
      await onResolvedScan?.(data);
      setValue("");
      setMessage(
        `${data.product.name} · GHS ${Number(data.product.selling_price || 0).toFixed(2)} added${data.unit?.unit_code ? ` · ${data.unit.unit_code}` : ""}${source === "camera" ? " by camera" : ""}. Scan the next item.`
      );
      navigator?.vibrate?.(60);
    } catch (scanError) {
      setError(apiMessage(scanError, "Unable to identify and add this item."));
      navigator?.vibrate?.([80, 60, 80]);
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
          await identify(raw, "camera");
        }
      } catch (scanError) {
        setError(apiMessage(scanError, "Camera detection failed. Use the scanner input below."));
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
        throw new Error("Built-in camera scanning is unavailable in this browser. A USB/Bluetooth scanner or manual code entry still works.");
      }
      let formats = ["qr_code"];
      if (typeof Detector.getSupportedFormats === "function") {
        const supported = await Detector.getSupportedFormats();
        formats = FORMATS.filter((format) => supported.includes(format));
        if (!formats.length) throw new Error("This browser camera does not support the required QR/barcode formats.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
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
      setError(apiMessage(cameraError, "Unable to start the camera scanner."));
    }
  }

  return (
    <div className="inventory-unit-scanner is-required">
      <div className="inventory-unit-scanner__head">
        <div>
          <strong>Autonomous Scan</strong>
          <span>Scan a CHALIN exact-ID label or supported product barcode. Product and price are resolved automatically.</span>
        </div>
        <span className="is-complete">Continuous</span>
      </div>

      <div className="inventory-unit-scanner__actions">
        <div className="inventory-unit-scanner__manual">
          <input
            value={value}
            disabled={disabled || busy}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                identify(value, "scanner");
              }
            }}
            placeholder="Scan or enter CHALIN ID / product barcode"
            autoComplete="off"
            autoFocus
          />
          <button type="button" disabled={disabled || busy || !value.trim()} onClick={() => identify(value)}>
            {busy ? "Identifying…" : "Identify & Add"}
          </button>
        </div>
        <button
          type="button"
          className="inventory-unit-scanner__camera-button"
          disabled={disabled || cameraStarting}
          onClick={cameraOpen ? stopCamera : startCamera}
        >
          {cameraStarting ? "Starting Camera…" : cameraOpen ? "Stop Camera" : "Start Continuous Camera Scan"}
        </button>
      </div>

      {cameraOpen ? (
        <div className="inventory-unit-scanner__camera">
          <video ref={videoRef} muted playsInline aria-label="Autonomous sale camera scanner" />
          <div className="inventory-unit-scanner__camera-frame" aria-hidden="true" />
          <p>Keep scanning one item after another. A valid item is added once and the camera stays open.</p>
        </div>
      ) : null}

      {message ? <p className="inventory-unit-scanner__message">{message}</p> : null}
      {error ? <p className="inventory-unit-scanner__error">{error}</p> : null}
    </div>
  );
}
