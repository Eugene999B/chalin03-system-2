import { useEffect, useRef, useState } from "react";

const ZXING_FALLBACK_URL =
  "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";

const DEFAULT_FORMATS = [
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

function cameraPolicyAllowsAccess() {
  const policy = document?.permissionsPolicy || document?.featurePolicy;
  if (!policy || typeof policy.allowsFeature !== "function") return true;
  try {
    return policy.allowsFeature("camera");
  } catch {
    return true;
  }
}

function cameraErrorMessage(error) {
  const name = String(error?.name || "");
  if (name === "NotAllowedError") {
    return "Camera permission is blocked. Open this site's browser permissions, allow Camera, then press Retry Camera.";
  }
  if (name === "NotFoundError") {
    return "No usable camera was found on this device. Connect or enable a camera, then try again.";
  }
  if (name === "NotReadableError") {
    return "The camera is busy or unavailable. Close any other app or browser tab using it, then retry.";
  }
  if (name === "OverconstrainedError") {
    return "The selected camera cannot use the requested mode. Choose another camera or retry the default camera.";
  }
  if (name === "SecurityError") {
    return "The browser blocked camera access for this page. Check site permissions and make sure the page is opened securely over HTTPS.";
  }
  if (name === "AbortError") {
    return "Camera startup was interrupted. Press Retry Camera.";
  }
  return error?.message || "Unable to start the camera. Check camera permission and try again.";
}

function resultText(result) {
  if (!result) return "";
  if (typeof result.getText === "function") return clean(result.getText());
  return clean(result.text || result.rawValue || result.value);
}

function normalizeOutcome(value) {
  if (value === false) return { accepted: false, stop: false };
  if (value && typeof value === "object") {
    return {
      accepted: value.accepted !== false,
      stop: value.stop === true,
    };
  }
  return { accepted: true, stop: false };
}

export default function CameraBarcodeReader({
  onDetected,
  disabled = false,
  mode = "multi",
  formats = DEFAULT_FORMATS,
  title = "Camera Scanner",
  help = "Point the camera at a QR code or barcode.",
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [engine, setEngine] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const zxingControlsRef = useRef(null);
  const frameRef = useRef(null);
  const activeRef = useRef(false);
  const processingRef = useRef(false);
  const blockedRawRef = useRef("");
  const blockedSeenAtRef = useRef(0);
  const onDetectedRef = useRef(onDetected);
  const modeRef = useRef(mode);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  function stopCamera({ keepError = true, keepCount = true } = {}) {
    activeRef.current = false;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    try {
      zxingControlsRef.current?.stop?.();
    } catch {
      // The MediaStream tracks below are the final cleanup boundary.
    }
    zxingControlsRef.current = null;
    detectorRef.current = null;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    processingRef.current = false;
    blockedRawRef.current = "";
    blockedSeenAtRef.current = 0;
    setCameraOpen(false);
    setStarting(false);
    setEngine("");
    setTorchSupported(false);
    setTorchOn(false);
    setStatus("");
    if (!keepError) setError("");
    if (!keepCount) setCapturedCount(0);
  }

  useEffect(() => () => stopCamera(), []);

  function noteNoVisibleCode() {
    if (
      blockedRawRef.current &&
      Date.now() - blockedSeenAtRef.current >= 650
    ) {
      blockedRawRef.current = "";
      blockedSeenAtRef.current = 0;
      setStatus("Ready for the next item.");
    }
  }

  async function deliver(rawValue) {
    const raw = clean(rawValue);
    if (!raw || !activeRef.current || processingRef.current) return;

    const now = Date.now();
    if (raw === blockedRawRef.current) {
      blockedSeenAtRef.current = now;
      return;
    }

    blockedRawRef.current = raw;
    blockedSeenAtRef.current = now;
    processingRef.current = true;
    setError("");
    setStatus("Code captured — verifying item…");

    try {
      const outcome = normalizeOutcome(
        await onDetectedRef.current?.(raw, "camera")
      );
      if (outcome.accepted) {
        setCapturedCount((count) => count + 1);
        navigator?.vibrate?.(45);
        if (outcome.stop || modeRef.current === "single") {
          stopCamera();
          return;
        }
        setStatus("Item captured. Move it away, then scan the next item.");
      } else {
        navigator?.vibrate?.([65, 45, 65]);
        setStatus("Item was not added. Move the code away before retrying.");
      }
    } catch (scanError) {
      navigator?.vibrate?.([65, 45, 65]);
      setError(scanError?.message || "Unable to process this scanned item.");
    } finally {
      await new Promise((resolve) =>
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(resolve)
        )
      );
      processingRef.current = false;
    }
  }

  async function nativeDetectionLoop() {
    if (!activeRef.current) return;
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || video.readyState < 2) {
      frameRef.current = requestAnimationFrame(nativeDetectionLoop);
      return;
    }

    try {
      const detections = await detector.detect(video);
      const raw = clean(detections?.[0]?.rawValue);
      if (raw) await deliver(raw);
      else noteNoVisibleCode();
    } catch {
      noteNoVisibleCode();
    }

    if (activeRef.current) {
      frameRef.current = requestAnimationFrame(nativeDetectionLoop);
    }
  }

  async function startNativeDetector() {
    const Detector = globalThis.BarcodeDetector;
    if (!Detector) return false;

    try {
      let usableFormats = formats;
      if (typeof Detector.getSupportedFormats === "function") {
        const supported = await Detector.getSupportedFormats();
        usableFormats = formats.filter((format) => supported.includes(format));
      }
      if (!usableFormats.length) return false;
      detectorRef.current = new Detector({ formats: usableFormats });
      setEngine("Native decoder");
      frameRef.current = requestAnimationFrame(nativeDetectionLoop);
      return true;
    } catch {
      detectorRef.current = null;
      return false;
    }
  }

  async function startZxingFallback(stream) {
    const module = await import(/* @vite-ignore */ ZXING_FALLBACK_URL);
    const Reader = module.BrowserMultiFormatReader;
    if (!Reader) throw new Error("Compatibility barcode decoder did not load correctly.");
    const reader = new Reader();
    const controls = await reader.decodeFromStream(
      stream,
      videoRef.current,
      (result) => {
        const raw = resultText(result);
        if (raw) deliver(raw);
        else noteNoVisibleCode();
      }
    );
    zxingControlsRef.current = controls;
    setEngine("Compatibility decoder");
  }

  async function refreshDevices(stream) {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const cameras = allDevices.filter((device) => device.kind === "videoinput");
      setDevices(cameras);
      const activeId = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
      if (activeId) setSelectedDeviceId(activeId);
    } catch {
      setDevices([]);
    }
  }

  function updateTorchCapability(stream) {
    try {
      const track = stream?.getVideoTracks?.()[0];
      const capabilities = track?.getCapabilities?.();
      setTorchSupported(Boolean(capabilities?.torch));
    } catch {
      setTorchSupported(false);
    }
  }

  async function getCameraStream(deviceId) {
    const video = deviceId
      ? { deviceId: { exact: deviceId } }
      : {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 900 },
        };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (initialError) {
      if (deviceId && initialError?.name === "OverconstrainedError") {
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      throw initialError;
    }
  }

  async function startCamera(deviceId = "") {
    if (disabled || starting || activeRef.current) return;
    setStarting(true);
    setError("");
    setStatus("Checking camera…");
    setCapturedCount(0);

    try {
      if (!window.isSecureContext) {
        throw Object.assign(
          new Error("Camera access requires a secure HTTPS page."),
          { name: "SecurityError" }
        );
      }
      if (!cameraPolicyAllowsAccess()) {
        throw Object.assign(
          new Error("This site's security policy currently blocks camera access."),
          { name: "SecurityError" }
        );
      }
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw Object.assign(
          new Error("This browser does not expose camera access to web apps."),
          { name: "NotFoundError" }
        );
      }

      const stream = await getCameraStream(deviceId);
      streamRef.current = stream;
      activeRef.current = true;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
      setStatus("Camera ready — loading barcode decoder…");
      await refreshDevices(stream);
      updateTorchCapability(stream);

      const nativeStarted = await startNativeDetector();
      if (!nativeStarted) await startZxingFallback(stream);
      setStatus("Ready. Point the camera at an item code.");
    } catch (cameraError) {
      stopCamera();
      setError(cameraErrorMessage(cameraError));
    } finally {
      setStarting(false);
    }
  }

  async function switchCamera(deviceId) {
    setSelectedDeviceId(deviceId);
    stopCamera({ keepError: false });
    await startCamera(deviceId);
  }

  async function toggleTorch() {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track) return;
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setError("This camera reported a torch but could not switch it.");
    }
  }

  return (
    <div style={styles.box}>
      <div style={styles.topRow}>
        <div>
          <strong>{title}</strong>
          <p style={styles.help}>{help}</p>
        </div>
        <span style={styles.engineBadge}>
          {cameraOpen ? `${engine || "Starting decoder"} · ${capturedCount} captured` : "Camera ready"}
        </span>
      </div>

      <div style={styles.controls}>
        <button
          type="button"
          disabled={disabled || starting}
          onClick={() => (cameraOpen ? stopCamera({ keepError: false }) : startCamera(selectedDeviceId))}
          style={styles.primaryButton}
        >
          {starting ? "Starting Camera…" : cameraOpen ? "Stop Camera" : error ? "Retry Camera" : "Open Camera"}
        </button>

        {cameraOpen && devices.length > 1 ? (
          <select
            value={selectedDeviceId}
            onChange={(event) => switchCamera(event.target.value)}
            style={styles.select}
            aria-label="Choose camera"
          >
            {devices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {device.label || `Camera ${index + 1}`}
              </option>
            ))}
          </select>
        ) : null}

        {cameraOpen && torchSupported ? (
          <button type="button" onClick={toggleTorch} style={styles.secondaryButton}>
            {torchOn ? "Turn Torch Off" : "Turn Torch On"}
          </button>
        ) : null}
      </div>

      {cameraOpen ? (
        <div style={styles.previewBox}>
          <video ref={videoRef} muted playsInline autoPlay style={styles.video} aria-label="Live barcode scanner camera" />
          <div style={styles.scanGuide} aria-hidden="true" />
          <small style={styles.status}>{status}</small>
        </div>
      ) : status ? (
        <small style={styles.status}>{status}</small>
      ) : null}

      {error ? <div style={styles.error}>{error}</div> : null}
    </div>
  );
}

const styles = {
  box: { display: "grid", gap: "10px", marginTop: "10px" },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" },
  help: { margin: "3px 0 0", color: "#64748b", fontSize: "13px" },
  engineBadge: { padding: "5px 9px", borderRadius: "999px", background: "#e2e8f0", color: "#334155", fontSize: "11px", fontWeight: 800 },
  controls: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  primaryButton: { minHeight: "44px", padding: "10px 14px", border: 0, borderRadius: "10px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: "pointer" },
  secondaryButton: { minHeight: "44px", padding: "10px 14px", border: "1px solid #94a3b8", borderRadius: "10px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" },
  select: { minHeight: "44px", minWidth: "180px", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "10px", background: "#fff", font: "inherit" },
  previewBox: { position: "relative", overflow: "hidden", borderRadius: "14px", background: "#020617" },
  video: { display: "block", width: "100%", maxHeight: "420px", minHeight: "220px", objectFit: "cover", background: "#020617" },
  scanGuide: { position: "absolute", inset: "18% 12% 24%", border: "2px solid rgba(255,255,255,.92)", borderRadius: "16px", boxShadow: "0 0 0 999px rgba(2,6,23,.22)", pointerEvents: "none" },
  status: { display: "block", padding: "8px 10px", color: "#475569", fontWeight: 700 },
  error: { padding: "9px 11px", borderRadius: "10px", background: "#fff1f2", color: "#9f1239", fontWeight: 800 },
};
