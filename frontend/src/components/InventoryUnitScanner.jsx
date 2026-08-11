import { useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/inventoryUnitScanner.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function clean(value) {
  return String(value || "").trim();
}

export default function InventoryUnitScanner({
  product,
  requiredCount,
  selectedUnitCodes = [],
  onChange,
  disabled = false,
  required = false,
}) {
  const [manualValue, setManualValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cameraSupport, setCameraSupport] = useState(null);
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
  const complete = selected.length === count && count > 0;

  function stopCamera() {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    detectorRef.current = null;
    processingRef.current = false;
    setCameraOpen(false);
    setCameraStarting(false);
  }

  useEffect(() => stopCamera, []);

  useEffect(() => {
    if (cameraOpen && selected.length >= count && count > 0) stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, count, selected.length]);

  async function verifyAndAdd(value, source = "manual") {
    const raw = clean(value);
    if (!raw || disabled || verifying) return;
    setError("");
    setMessage("");
    setVerifying(true);
    try {
      const response = await axiosClient.post("/inventory-traceability/sale-scan/verify", {
        value: raw,
      });
      const unit = response.data?.unit;
      const code = clean(unit?.unit_code).toUpperCase();
      if (!unit || !code) throw new Error("The scanned label did not resolve to a physical inventory unit.");
      if (Number(unit.product_id) !== Number(product?.id)) {
        throw new Error(
          `${code} belongs to ${unit.product_name || "another product"}, not ${product?.name || "this sale item"}.`
        );
      }
      if (unit.same_store === false) {
        throw new Error(`${code} belongs to another store and cannot be attached to this sale.`);
      }
      if (String(unit.status || "").toLowerCase() !== "active") {
        throw new Error(`${code} cannot be sold because its current status is ${unit.status || "unknown"}.`);
      }
      if (selected.includes(code)) {
        throw new Error(`${code} is already attached to this sale item.`);
      }
      if (count > 0 && selected.length >= count) {
        throw new Error(`This sale item already has the required ${count} physical unit ID${count === 1 ? "" : "s"}.`);
      }

      const next = [...selected, code];
      onChange?.(next);
      setManualValue("");
      setMessage(`${code} verified and attached${source === "camera" ? " by camera" : ""}.`);
    } catch (verifyError) {
      setError(apiMessage(verifyError, "Unable to verify this physical unit ID."));
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
        if (
          raw &&
          (raw !== lastScanRef.current.value || now - lastScanRef.current.at > 1800)
        ) {
          lastScanRef.current = { value: raw, at: now };
          processingRef.current = true;
          await verifyAndAdd(raw, "camera");
        }
      } catch (scanError) {
        if (cameraOpen) setError(apiMessage(scanError, "Camera QR detection failed. You can enter the unit ID manually."));
      }
    }

    if (cameraOpen) frameRef.current = requestAnimationFrame(detectFrame);
  }

  async function startCamera() {
    if (disabled || cameraOpen || cameraStarting) return;
    setError("");
    setMessage("");
    setCameraStarting(true);

    try {
      const BarcodeDetectorClass = globalThis.BarcodeDetector;
      const mediaDevices = navigator?.mediaDevices;
      if (!BarcodeDetectorClass || !mediaDevices?.getUserMedia) {
        setCameraSupport(false);
        throw new Error(
          "This browser does not provide built-in QR camera scanning. Enter the printed unit ID manually on this device."
        );
      }

      if (typeof BarcodeDetectorClass.getSupportedFormats === "function") {
        const formats = await BarcodeDetectorClass.getSupportedFormats();
        if (!formats.includes("qr_code")) {
          setCameraSupport(false);
          throw new Error("This browser camera cannot decode QR labels. Enter the unit ID manually.");
        }
      }

      const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      detectorRef.current = new BarcodeDetectorClass({ formats: ["qr_code"] });
      setCameraSupport(true);
      setCameraOpen(true);
      setCameraStarting(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      frameRef.current = requestAnimationFrame(detectFrame);
    } catch (cameraError) {
      stopCamera();
      setError(apiMessage(cameraError, "Unable to start the camera. Enter the unit ID manually."));
    }
  }

  function removeUnit(code) {
    if (disabled) return;
    onChange?.(selected.filter((value) => value !== code));
    setMessage("");
    setError("");
  }

  return (
    <div className={`inventory-unit-scanner ${required ? "is-required" : "is-optional"}`}>
      <div className="inventory-unit-scanner__head">
        <div>
          <strong>{required ? "Physical IDs required" : "Physical IDs (pilot / optional)"}</strong>
          <span>
            {selected.length} / {count} verified for {product?.name || "serialized product"}
          </span>
        </div>
        <span className={complete ? "is-complete" : required ? "is-incomplete" : ""}>
          {complete ? "Ready" : required ? "Scan remaining" : "Setup"}
        </span>
      </div>

      <div className="inventory-unit-scanner__actions">
        <div className="inventory-unit-scanner__manual">
          <input
            value={manualValue}
            disabled={disabled || verifying || (count > 0 && selected.length >= count)}
            onChange={(event) => setManualValue(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                verifyAndAdd(manualValue, "manual");
              }
            }}
            placeholder="Enter unit ID or QR payload"
            aria-label={`Physical unit ID for ${product?.name || "sale item"}`}
          />
          <button
            type="button"
            disabled={disabled || verifying || !manualValue.trim() || (count > 0 && selected.length >= count)}
            onClick={() => verifyAndAdd(manualValue, "manual")}
          >
            {verifying ? "Verifying…" : "Verify ID"}
          </button>
        </div>
        <button
          type="button"
          className="inventory-unit-scanner__camera-button"
          disabled={disabled || cameraStarting || (count > 0 && selected.length >= count)}
          onClick={cameraOpen ? stopCamera : startCamera}
        >
          {cameraStarting ? "Starting camera…" : cameraOpen ? "Stop Camera" : "Scan with Phone Camera"}
        </button>
      </div>

      {cameraOpen ? (
        <div className="inventory-unit-scanner__camera">
          <video ref={videoRef} muted playsInline aria-label="Inventory QR scanner camera preview" />
          <div className="inventory-unit-scanner__camera-frame" aria-hidden="true" />
          <p>Point the rear camera at one CHALIN 03 inventory QR label. Each verified unit is added once.</p>
        </div>
      ) : cameraSupport === false ? (
        <p className="inventory-unit-scanner__hint">Camera QR decoding is unavailable on this browser; manual ID entry remains fully supported.</p>
      ) : null}

      {selected.length > 0 ? (
        <div className="inventory-unit-scanner__selected">
          {selected.map((code) => (
            <span key={code}>
              <strong>{code}</strong>
              <button type="button" onClick={() => removeUnit(code)} disabled={disabled} aria-label={`Remove ${code}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {message ? <p className="inventory-unit-scanner__message">{message}</p> : null}
      {error ? <p className="inventory-unit-scanner__error">{error}</p> : null}
    </div>
  );
}
