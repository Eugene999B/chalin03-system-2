import { useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/inventoryUnitScanner.css";

function messageOf(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function clean(value) {
  return String(value || "").trim();
}

export default function InventoryReturnUnitScanner({
  saleId,
  product,
  requiredCount,
  selectedUnitCodes = [],
  onChange,
  disabled = false,
}) {
  const [manualValue, setManualValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const detectorRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });

  const count = Math.max(0, Number(requiredCount || 0));
  const selected = useMemo(
    () => [...new Set((selectedUnitCodes || []).map((value) => clean(value).toUpperCase()).filter(Boolean))],
    [selectedUnitCodes]
  );

  function stopCamera() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current = null;
    processingRef.current = false;
    setCameraOpen(false);
    setCameraStarting(false);
  }

  useEffect(() => stopCamera, []);

  async function verifyAndAdd(value) {
    const raw = clean(value);
    if (!raw || disabled || verifying || !saleId || !product?.product_id) return;
    setVerifying(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post("/inventory-traceability/return-scan/verify", {
        value: raw,
        sale_id: Number(saleId),
        product_id: Number(product.product_id),
      });
      const unit = response.data?.unit;
      const code = clean(unit?.unit_code).toUpperCase();
      if (!response.data?.eligible || !unit || !code) {
        if (unit?.same_sale === false) throw new Error(`${code || "This unit"} was not sold on this receipt.`);
        if (unit?.same_product === false) throw new Error(`${code || "This unit"} belongs to another product.`);
        if (unit?.same_store === false) throw new Error(`${code || "This unit"} belongs to another store.`);
        if (unit?.already_returned) throw new Error(`${code || "This unit"} has already been returned.`);
        throw new Error(`${code || "This unit"} is not currently eligible for return.`);
      }
      if (selected.includes(code)) throw new Error(`${code} is already selected for this return.`);
      if (selected.length >= count) throw new Error(`This return already has ${count} physical unit ID${count === 1 ? "" : "s"}.`);
      onChange?.([...selected, code]);
      setManualValue("");
      setMessage(`${code} verified against this receipt and selected for quarantine return.`);
    } catch (verifyError) {
      setError(messageOf(verifyError, "Unable to verify returned physical unit."));
    } finally {
      setVerifying(false);
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
        const barcodes = await detector.detect(video);
        const raw = clean(barcodes?.[0]?.rawValue);
        const now = Date.now();
        if (raw && (raw !== lastScanRef.current.value || now - lastScanRef.current.at > 1800)) {
          lastScanRef.current = { value: raw, at: now };
          processingRef.current = true;
          await verifyAndAdd(raw);
        }
      } catch (scanError) {
        setError(messageOf(scanError, "Camera QR detection failed. Enter the unit ID manually."));
      }
    }
    if (cameraOpen) frameRef.current = requestAnimationFrame(detectFrame);
  }

  async function startCamera() {
    if (disabled || cameraStarting || cameraOpen) return;
    setCameraStarting(true);
    setError("");
    try {
      const Detector = globalThis.BarcodeDetector;
      if (!Detector || !navigator?.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot scan QR labels with its camera. Enter the printed unit ID manually.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      detectorRef.current = new Detector({ formats: ["qr_code"] });
      setCameraOpen(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      frameRef.current = requestAnimationFrame(detectFrame);
    } catch (cameraError) {
      stopCamera();
      setError(messageOf(cameraError, "Unable to start the camera."));
    } finally {
      setCameraStarting(false);
    }
  }

  function remove(code) {
    onChange?.(selected.filter((value) => value !== code));
  }

  return (
    <div className="inventory-unit-scanner is-required">
      <div className="inventory-unit-scanner__head">
        <div>
          <strong>Exact returned physical IDs required</strong>
          <span>{selected.length} / {count} verified against this receipt</span>
        </div>
        <span className={selected.length === count && count > 0 ? "is-complete" : "is-incomplete"}>
          {selected.length === count && count > 0 ? "Ready for quarantine" : "Scan returned units"}
        </span>
      </div>

      <div className="inventory-unit-scanner__actions">
        <div className="inventory-unit-scanner__manual">
          <input
            value={manualValue}
            disabled={disabled || verifying || selected.length >= count}
            onChange={(event) => setManualValue(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                verifyAndAdd(manualValue);
              }
            }}
            placeholder="Enter returned unit ID or QR payload"
          />
          <button type="button" disabled={disabled || verifying || !manualValue.trim()} onClick={() => verifyAndAdd(manualValue)}>
            {verifying ? "Verifying…" : "Verify Returned ID"}
          </button>
        </div>
        <button type="button" className="inventory-unit-scanner__camera-button" disabled={disabled || cameraStarting || selected.length >= count} onClick={cameraOpen ? stopCamera : startCamera}>
          {cameraStarting ? "Starting camera…" : cameraOpen ? "Stop Camera" : "Scan Returned QR"}
        </button>
      </div>

      {cameraOpen ? (
        <div className="inventory-unit-scanner__camera">
          <video ref={videoRef} muted playsInline aria-label="Returned inventory QR scanner camera preview" />
          <div className="inventory-unit-scanner__camera-frame" aria-hidden="true" />
          <p>Scan the physical item coming back. CHALIN verifies it was sold on this exact receipt before accepting it.</p>
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div className="inventory-unit-scanner__selected">
          {selected.map((code) => (
            <span key={code}>
              <strong>{code}</strong>
              <button type="button" onClick={() => remove(code)} disabled={disabled} aria-label={`Remove ${code}`}>×</button>
            </span>
          ))}
        </div>
      ) : null}

      <p className="inventory-unit-scanner__hint">Returned serialized units go to quarantine first. They do not become sellable again until a later inspection clears them.</p>
      {message ? <p className="inventory-unit-scanner__message">{message}</p> : null}
      {error ? <p className="inventory-unit-scanner__error">{error}</p> : null}
    </div>
  );
}
