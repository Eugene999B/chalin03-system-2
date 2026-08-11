import { useEffect, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/inventoryBlindCountScanner.css";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function clean(value) {
  return String(value || "").trim();
}

export default function InventoryBlindCountScanner({
  sessionId,
  disabled = false,
  onObserved,
}) {
  const [manualValue, setManualValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [cameraSupport, setCameraSupport] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const detectorRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });

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

  async function recordObservation(value, source = "manual") {
    const raw = clean(value);
    if (!raw || !sessionId || disabled || sending) return;
    setError("");
    setMessage("");
    setSending(true);
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/loss-control/counts/${sessionId}/unit-observations`,
        {
          value: raw,
          device_note: source === "camera" ? "phone-camera" : "manual-entry",
        }
      );
      const observation = response.data?.observation || {};
      setManualValue("");
      setMessage(response.data?.message || `${observation.unit_code || raw} recorded.`);
      onObserved?.(observation);
    } catch (scanError) {
      setError(apiMessage(scanError, "Unable to record this physical inventory unit."));
    } finally {
      setSending(false);
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
          await recordObservation(raw, "camera");
        }
      } catch (scanError) {
        if (cameraOpen) {
          setError(apiMessage(scanError, "Camera QR detection failed. Manual ID entry is still available."));
        }
      }
    }

    if (cameraOpen) frameRef.current = requestAnimationFrame(detectFrame);
  }

  async function startCamera() {
    if (disabled || cameraOpen || cameraStarting || !sessionId) return;
    setError("");
    setMessage("");
    setCameraStarting(true);
    try {
      const BarcodeDetectorClass = globalThis.BarcodeDetector;
      const mediaDevices = navigator?.mediaDevices;
      if (!BarcodeDetectorClass || !mediaDevices?.getUserMedia) {
        setCameraSupport(false);
        throw new Error("This browser cannot decode QR labels with its camera. Enter the printed unit ID manually.");
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
      setError(apiMessage(cameraError, "Unable to start the camera."));
    }
  }

  return (
    <div className="inventory-blind-scanner">
      <div className="inventory-blind-scanner__head">
        <div>
          <strong>Blind physical-ID scanner</strong>
          <span>Scan what is physically present. CHALIN records exceptions instead of hiding them.</span>
        </div>
        <span className="inventory-blind-scanner__blind">Expected IDs hidden</span>
      </div>

      <div className="inventory-blind-scanner__actions">
        <div className="inventory-blind-scanner__manual">
          <input
            value={manualValue}
            disabled={disabled || sending || !sessionId}
            onChange={(event) => setManualValue(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                recordObservation(manualValue, "manual");
              }
            }}
            placeholder="Enter unit ID or scan QR payload"
            aria-label="Blind count physical unit ID"
          />
          <button
            type="button"
            disabled={disabled || sending || !manualValue.trim() || !sessionId}
            onClick={() => recordObservation(manualValue, "manual")}
          >
            {sending ? "Recording…" : "Record Unit"}
          </button>
        </div>
        <button
          type="button"
          className="inventory-blind-scanner__camera-button"
          disabled={disabled || cameraStarting || !sessionId}
          onClick={cameraOpen ? stopCamera : startCamera}
        >
          {cameraStarting ? "Starting camera…" : cameraOpen ? "Stop Camera" : "Scan with Phone Camera"}
        </button>
      </div>

      {cameraOpen ? (
        <div className="inventory-blind-scanner__camera">
          <video ref={videoRef} muted playsInline aria-label="Blind inventory QR scanner camera preview" />
          <div className="inventory-blind-scanner__camera-frame" aria-hidden="true" />
          <p>Point the rear camera at each CHALIN inventory label. Duplicates are preserved as evidence but never counted twice.</p>
        </div>
      ) : cameraSupport === false ? (
        <p className="inventory-blind-scanner__hint">Camera QR decoding is unavailable on this browser. Manual unit-ID entry remains supported.</p>
      ) : null}

      {message ? <p className="inventory-blind-scanner__message">{message}</p> : null}
      {error ? <p className="inventory-blind-scanner__error">{error}</p> : null}
    </div>
  );
}
