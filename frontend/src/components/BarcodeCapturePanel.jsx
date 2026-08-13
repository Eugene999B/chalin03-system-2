import { useEffect, useRef, useState } from "react";

const DECODER_URL = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/+esm";
const COMMON_FORMATS = ["qr_code", "code_128", "ean_13", "ean_8", "upc_a", "upc_e"];
const FORMAT_KEYS = {
  qr_code: "QR_CODE",
  code_128: "CODE_128",
  code_39: "CODE_39",
  code_93: "CODE_93",
  ean_13: "EAN_13",
  ean_8: "EAN_8",
  upc_a: "UPC_A",
  upc_e: "UPC_E",
  data_matrix: "DATA_MATRIX",
  aztec: "AZTEC",
  pdf417: "PDF_417",
};
const REARM_AFTER_MISS_MS = 700;
const ZXING_ATTEMPT_DELAY = 80;
const ZXING_SUCCESS_DELAY = 100;
const NATIVE_ATTEMPT_DELAY = 90;

const clean = (value) => String(value || "").trim();

function normalize(value) {
  if (value === false) return { accepted: false, stop: false };
  if (value && typeof value === "object") {
    return { accepted: value.accepted !== false, stop: value.stop === true };
  }
  return { accepted: true, stop: false };
}

function requestedFormats(formats) {
  const source = Array.isArray(formats) && formats.length ? formats : COMMON_FORMATS;
  return [...new Set(source.map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

export default function BarcodeCapturePanel({
  onDetected,
  disabled = false,
  mode = "multi",
  formats = COMMON_FORMATS,
  title = "Scan Item",
  help = "Point the device at a QR code or product barcode.",
}) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const trackRef = useRef(null);
  const busyRef = useRef(false);
  const callbackRef = useRef(onDetected);
  const modeRef = useRef(mode);
  const blockedRawRef = useRef("");
  const lastSeenRef = useRef(0);
  const nativeDetectorRef = useRef(null);
  const nativeFrameRef = useRef(0);
  const nativeBusyRef = useRef(false);
  const scanningRef = useRef(false);
  const autoZoomRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  function clearNativeDetector() {
    if (nativeFrameRef.current) cancelAnimationFrame(nativeFrameRef.current);
    nativeFrameRef.current = 0;
    nativeDetectorRef.current = null;
    nativeBusyRef.current = false;
  }

  function stop() {
    scanningRef.current = false;
    clearNativeDetector();
    if (autoZoomRef.current) clearTimeout(autoZoomRef.current);
    autoZoomRef.current = 0;
    try { controlsRef.current?.stop?.(); } catch {}
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    stream?.getTracks?.().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    trackRef.current = null;
    busyRef.current = false;
    blockedRawRef.current = "";
    lastSeenRef.current = 0;
    setRunning(false);
    setStarting(false);
    setStatus("");
    setTorchAvailable(false);
    setTorchOn(false);
  }

  useEffect(() => () => stop(), []);

  function noteMiss() {
    if (!blockedRawRef.current || busyRef.current) return;
    if (Date.now() - lastSeenRef.current >= REARM_AFTER_MISS_MS) {
      blockedRawRef.current = "";
      lastSeenRef.current = 0;
    }
  }

  function noteSeen(rawValue) {
    const raw = clean(rawValue);
    if (!raw) return;
    lastSeenRef.current = Date.now();
    if (raw === blockedRawRef.current || busyRef.current) return;
    deliver(raw);
  }

  async function deliver(rawValue) {
    const raw = clean(rawValue);
    if (!raw || busyRef.current) return;
    blockedRawRef.current = raw;
    lastSeenRef.current = Date.now();
    busyRef.current = true;
    setError("");
    setStatus("Captured — checking item…");

    try {
      const result = normalize(await callbackRef.current?.(raw, "camera"));
      if (!result.accepted) {
        setStatus("Not added. Move the code away briefly, then point it back to retry.");
        return;
      }
      setCount((value) => value + 1);
      navigator?.vibrate?.(35);
      if (result.stop || modeRef.current === "single") {
        stop();
        return;
      }
      setStatus("Added. Move this item away and present the next code.");
    } catch (scanError) {
      setError(scanError?.message || "Unable to process this item.");
    } finally {
      busyRef.current = false;
    }
  }

  async function applyTrackSetting(key, value) {
    const track = trackRef.current;
    if (!track?.applyConstraints) return false;
    try {
      await track.applyConstraints({ advanced: [{ [key]: value }] });
      return true;
    } catch {
      return false;
    }
  }

  async function tuneTrack() {
    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
    if (!track) return;
    trackRef.current = track;

    let capabilities = {};
    try { capabilities = track.getCapabilities?.() || {}; } catch {}

    for (const key of ["focusMode", "exposureMode", "whiteBalanceMode"]) {
      const values = capabilities[key];
      if (Array.isArray(values) && values.includes("continuous")) {
        await applyTrackSetting(key, "continuous");
      }
    }

    setTorchAvailable(Boolean(capabilities.torch));

    const zoom = capabilities.zoom;
    if (zoom && Number(zoom.max) > Number(zoom.min)) {
      const current = Number(track.getSettings?.()?.zoom || zoom.min || 1);
      const target = Math.min(Number(zoom.max), Math.max(current, 1.2));
      autoZoomRef.current = window.setTimeout(() => {
        if (scanningRef.current && target > current + 0.05) {
          applyTrackSetting("zoom", target);
        }
      }, 1400);
    }
  }

  async function toggleTorch() {
    if (!torchAvailable) return;
    const next = !torchOn;
    if (await applyTrackSetting("torch", next)) setTorchOn(next);
  }

  async function startNativeDetector(wantedFormats) {
    const Detector = window.BarcodeDetector;
    if (!Detector || !videoRef.current) return;

    try {
      const supported = typeof Detector.getSupportedFormats === "function"
        ? await Detector.getSupportedFormats()
        : [];
      const usable = wantedFormats.filter((format) => supported.includes(format));
      if (!usable.length) return;

      nativeDetectorRef.current = new Detector({ formats: usable });
      let lastAttempt = 0;
      const scanFrame = async (timestamp) => {
        if (!scanningRef.current || !nativeDetectorRef.current) return;
        nativeFrameRef.current = requestAnimationFrame(scanFrame);
        if (
          timestamp - lastAttempt < NATIVE_ATTEMPT_DELAY ||
          nativeBusyRef.current ||
          busyRef.current ||
          videoRef.current?.readyState < 2
        ) return;

        lastAttempt = timestamp;
        nativeBusyRef.current = true;
        try {
          const found = await nativeDetectorRef.current.detect(videoRef.current);
          const raw = clean(found?.[0]?.rawValue);
          if (raw) noteSeen(raw);
          else noteMiss();
        } catch {
          noteMiss();
        } finally {
          nativeBusyRef.current = false;
        }
      };
      nativeFrameRef.current = requestAnimationFrame(scanFrame);
    } catch {
      clearNativeDetector();
    }
  }

  async function start() {
    if (disabled || starting || running) return;
    setStarting(true);
    setError("");
    setStatus("Opening fast scanner…");
    setCount(0);

    try {
      if (!window.isSecureContext) throw new Error("Scanning requires this secure HTTPS page.");
      if (!videoRef.current) throw new Error("The live preview is not ready.");

      const module = await import(/* @vite-ignore */ DECODER_URL);
      const Reader = module.BrowserMultiFormatReader;
      if (!Reader) throw new Error("The barcode decoder could not load.");

      const wantedFormats = requestedFormats(formats);
      const reader = new Reader(undefined, {
        delayBetweenScanAttempts: ZXING_ATTEMPT_DELAY,
        delayBetweenScanSuccess: ZXING_SUCCESS_DELAY,
        tryPlayVideoTimeout: 5000,
      });
      const possibleFormats = wantedFormats
        .map((format) => module.BarcodeFormat?.[FORMAT_KEYS[format]])
        .filter((value) => value !== undefined);
      if (possibleFormats.length) reader.possibleFormats = possibleFormats;

      controlsRef.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        videoRef.current,
        (result) => {
          const raw = clean(typeof result?.getText === "function" ? result.getText() : result?.text);
          if (raw) noteSeen(raw);
          else noteMiss();
        }
      );

      scanningRef.current = true;
      setRunning(true);
      setStatus("Ready — just point the code toward the camera. No exact alignment needed.");
      await tuneTrack();
      startNativeDetector(wantedFormats);
    } catch (startError) {
      stop();
      const name = String(startError?.name || "");
      if (name === "NotAllowedError") setError("Access is blocked. Allow Camera for this site, then press Retry.");
      else if (name === "NotReadableError") setError("The camera is busy. Close another app using it, then retry.");
      else if (name === "NotFoundError") setError("No usable camera was found.");
      else setError(startError?.message || "Unable to start scanning.");
    } finally {
      setStarting(false);
    }
  }

  const visible = running || starting;

  return (
    <div style={styles.box}>
      <div style={styles.header}>
        <div><strong>{title}</strong><p style={styles.help}>{help}</p></div>
        <span style={styles.badge}>{count} captured</span>
      </div>
      <div style={styles.actions}>
        <button type="button" disabled={disabled || starting} onClick={running ? stop : start} style={styles.button}>
          {starting ? "Starting…" : running ? "Stop" : error ? "Retry" : "Open Scanner"}
        </button>
        {running && torchAvailable ? (
          <button type="button" onClick={toggleTorch} style={styles.secondaryButton}>
            {torchOn ? "Light Off" : "Light On"}
          </button>
        ) : null}
      </div>
      <div style={{ ...styles.preview, display: visible ? "block" : "none" }}>
        <video ref={videoRef} muted playsInline autoPlay style={styles.video} aria-label="Live barcode preview" />
        <div style={styles.guide} aria-hidden="true" />
        <div style={styles.tip}>Move a little closer or farther until the code looks sharp. Capture is automatic.</div>
        <small style={styles.status}>{status}</small>
      </div>
      {error ? <div style={styles.error}>{error}</div> : null}
    </div>
  );
}

const styles = {
  box: { display: "grid", gap: 10, marginTop: 10 },
  header: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  help: { margin: "3px 0 0", color: "#64748b", fontSize: 13 },
  badge: { padding: "5px 9px", borderRadius: 999, background: "#e2e8f0", color: "#334155", fontSize: 11, fontWeight: 800 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  button: { width: "fit-content", minHeight: 44, padding: "10px 14px", border: 0, borderRadius: 10, background: "#07182c", color: "#fff", fontWeight: 900 },
  secondaryButton: { minHeight: 44, padding: "10px 13px", border: "1px solid #cbd5e1", borderRadius: 10, background: "#fff", color: "#0f172a", fontWeight: 800 },
  preview: { position: "relative", overflow: "hidden", borderRadius: 14, background: "#020617" },
  video: { display: "block", width: "100%", minHeight: 280, maxHeight: 520, objectFit: "cover", background: "#020617" },
  guide: { position: "absolute", inset: "10% 5% 22%", border: "2px solid rgba(255,255,255,.96)", borderRadius: 16, boxShadow: "0 0 0 999px rgba(2,6,23,.14)", pointerEvents: "none" },
  tip: { position: "absolute", left: 12, right: 12, bottom: 38, padding: "7px 9px", borderRadius: 9, background: "rgba(2,6,23,.68)", color: "#f8fafc", fontSize: 12, fontWeight: 700, textAlign: "center", pointerEvents: "none" },
  status: { display: "block", padding: "8px 10px", color: "#e2e8f0", fontWeight: 700 },
  error: { padding: "9px 11px", borderRadius: 10, background: "#fff1f2", color: "#9f1239", fontWeight: 800 },
};
