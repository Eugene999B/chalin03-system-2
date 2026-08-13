import { useEffect, useRef, useState } from "react";

const DECODER_URL = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
const clean = (value) => String(value || "").trim();

function normalize(value) {
  if (value === false) return { accepted: false, stop: false };
  if (value && typeof value === "object") {
    return { accepted: value.accepted !== false, stop: value.stop === true };
  }
  return { accepted: true, stop: false };
}

export default function BarcodeCapturePanel({
  onDetected,
  disabled = false,
  mode = "multi",
  title = "Scan Item",
  help = "Point the device at a QR code or product barcode.",
}) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const lastRef = useRef({ value: "", at: 0 });
  const callbackRef = useRef(onDetected);
  const modeRef = useRef(mode);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);

  useEffect(() => { callbackRef.current = onDetected; }, [onDetected]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  function stop() {
    try { controlsRef.current?.stop?.(); } catch {}
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    stream?.getTracks?.().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    busyRef.current = false;
    lastRef.current = { value: "", at: 0 };
    setRunning(false);
    setStarting(false);
    setStatus("");
  }

  useEffect(() => () => stop(), []);

  async function deliver(rawValue) {
    const raw = clean(rawValue);
    if (!raw || busyRef.current) return;

    const now = Date.now();
    if (raw === lastRef.current.value && now - lastRef.current.at < 1200) return;
    lastRef.current = { value: raw, at: now };
    busyRef.current = true;
    setError("");
    setStatus("Code captured — verifying item…");

    try {
      const result = normalize(await callbackRef.current?.(raw, "camera"));
      if (!result.accepted) {
        setStatus("Item was not added. Move it away, then retry.");
        return;
      }
      setCount((value) => value + 1);
      navigator?.vibrate?.(40);
      if (result.stop || modeRef.current === "single") {
        stop();
        return;
      }
      setStatus("Item added. Move it away, then scan the next item.");
    } catch (scanError) {
      setError(scanError?.message || "Unable to process this item.");
    } finally {
      busyRef.current = false;
    }
  }

  async function start() {
    if (disabled || starting || running) return;
    setStarting(true);
    setError("");
    setStatus("Starting scanner…");
    setCount(0);

    try {
      if (!window.isSecureContext) throw new Error("Scanning requires this secure HTTPS page.");
      if (!videoRef.current) throw new Error("The live preview is not ready.");

      const module = await import(/* @vite-ignore */ DECODER_URL);
      const Reader = module.BrowserMultiFormatReader;
      if (!Reader) throw new Error("The barcode decoder could not load.");

      const reader = new Reader();
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        videoRef.current,
        (result) => {
          const raw = clean(typeof result?.getText === "function" ? result.getText() : result?.text);
          if (raw) deliver(raw);
        }
      );

      setRunning(true);
      setStatus("Ready. Point at an item code.");
    } catch (startError) {
      stop();
      const name = String(startError?.name || "");
      if (name === "NotAllowedError") setError("Access is blocked. Allow Camera for this site, then press Retry.");
      else if (name === "NotReadableError") setError("The device is busy. Close another app using it, then retry.");
      else if (name === "NotFoundError") setError("No usable capture device was found.");
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
      <button type="button" disabled={disabled || starting} onClick={running ? stop : start} style={styles.button}>
        {starting ? "Starting…" : running ? "Stop" : error ? "Retry" : "Open Scanner"}
      </button>
      <div style={{ ...styles.preview, display: visible ? "block" : "none" }}>
        <video ref={videoRef} muted playsInline autoPlay style={styles.video} aria-label="Live barcode preview" />
        <div style={styles.guide} aria-hidden="true" />
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
  button: { width: "fit-content", minHeight: 44, padding: "10px 14px", border: 0, borderRadius: 10, background: "#07182c", color: "#fff", fontWeight: 900 },
  preview: { position: "relative", overflow: "hidden", borderRadius: 14, background: "#020617" },
  video: { display: "block", width: "100%", minHeight: 240, maxHeight: 460, objectFit: "cover", background: "#020617" },
  guide: { position: "absolute", inset: "18% 12% 24%", border: "2px solid rgba(255,255,255,.92)", borderRadius: 16, boxShadow: "0 0 0 999px rgba(2,6,23,.22)", pointerEvents: "none" },
  status: { display: "block", padding: "8px 10px", color: "#e2e8f0", fontWeight: 700 },
  error: { padding: "9px 11px", borderRadius: 10, background: "#fff1f2", color: "#9f1239", fontWeight: 800 },
};
