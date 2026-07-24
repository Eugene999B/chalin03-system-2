import { useCallback, useEffect, useRef, useState } from "react";

import axiosClient from "../api/axiosClient";
import "../styles/documentSignatureSettings.css";

const PEN_OPTIONS = [
  { value: 2.2, label: "Fine" },
  { value: 3.2, label: "Standard" },
  { value: 4.6, label: "Bold" },
];

function errorMessage(error, fallback) {
  return error.response?.data?.message || error.message || fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function Notice({ tone = "info", children }) {
  return (
    <div className={`signature-notice ${tone}`} role="status" aria-live="polite">
      {children}
    </div>
  );
}

function drawStroke(context, stroke, width, height) {
  if (!stroke?.points?.length) return;
  const points = stroke.points;

  context.strokeStyle = "#07182c";
  context.fillStyle = "#07182c";
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (points.length === 1) {
    context.beginPath();
    context.arc(
      points[0].x * width,
      points[0].y * height,
      stroke.width / 2,
      0,
      Math.PI * 2
    );
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x * width, points[0].y * height);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(
      point.x * width,
      point.y * height,
      ((point.x + next.x) / 2) * width,
      ((point.y + next.y) / 2) * height
    );
  }
  const last = points[points.length - 1];
  context.lineTo(last.x * width, last.y * height);
  context.stroke();
}

function trimmedSignatureDataUrl(canvas, paddingCssPixels = 18) {
  if (!canvas?.width || !canvas?.height) return "";

  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left || bottom < top) return "";

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const padding = Math.round(paddingCssPixels * ratio);
  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  const output = document.createElement("canvas");
  output.width = sourceWidth + padding * 2;
  output.height = sourceHeight + padding * 2;
  output
    .getContext("2d")
    .drawImage(
      canvas,
      left,
      top,
      sourceWidth,
      sourceHeight,
      padding,
      padding,
      sourceWidth,
      sourceHeight
    );
  return output.toDataURL("image/png");
}

export default function DocumentSignatureSettingsPage() {
  const canvasRef = useRef(null);
  const padWrapRef = useRef(null);
  const drawingRef = useRef(false);
  const activePointerRef = useRef(null);
  const currentStrokeRef = useRef(null);
  const strokesRef = useRef([]);
  const redoRef = useRef([]);
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({
    signatory_name: "",
    signatory_title: "Managing Director",
  });
  const [penWidth, setPenWidth] = useState(PEN_OPTIONS[1].value);
  const [history, setHistory] = useState({ strokes: 0, redo: 0 });
  const [draftPreview, setDraftPreview] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const paintCanvas = useCallback((draftStroke = currentStrokeRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, rect.width, rect.height);
    strokesRef.current.forEach((stroke) =>
      drawStroke(context, stroke, rect.width, rect.height)
    );
    drawStroke(context, draftStroke, rect.width, rect.height);
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const nextWidth = Math.max(Math.round(rect.width * ratio), 1);
    const nextHeight = Math.max(Math.round(rect.height * ratio), 1);

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintCanvas();
  }, [paintCanvas]);

  const refreshDraftPreview = useCallback(() => {
    const preview = trimmedSignatureDataUrl(canvasRef.current);
    setDraftPreview(preview);
  }, []);

  const resetDrawing = useCallback(() => {
    drawingRef.current = false;
    activePointerRef.current = null;
    currentStrokeRef.current = null;
    strokesRef.current = [];
    redoRef.current = [];
    setDraftPreview("");
    setHistory({ strokes: 0, redo: 0 });
    window.requestAnimationFrame(() => {
      resizeCanvas();
    });
  }, [resizeCanvas]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(
        "/release2-final/document-signature"
      );
      const signature = response.data.signature || null;
      setCurrent(signature);
      setForm({
        signatory_name: signature?.signatory_name || "",
        signatory_title: signature?.signatory_title || "Managing Director",
      });
    } catch (requestError) {
      setError(
        errorMessage(requestError, "Document signature settings could not be loaded.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading) return undefined;
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    if (padWrapRef.current) resizeObserver.observe(padWrapRef.current);
    resizeCanvas();
    return () => resizeObserver.disconnect();
  }, [expanded, loading, resizeCanvas]);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  function pointFromEvent(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function startDrawing(event) {
    if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    setMessage("");
    setError("");
    activePointerRef.current = event.pointerId;
    canvasRef.current.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    currentStrokeRef.current = {
      width: penWidth,
      points: [pointFromEvent(event)],
    };
    paintCanvas();
  }

  function draw(event) {
    if (
      !drawingRef.current ||
      activePointerRef.current !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const samples = event.getCoalescedEvents?.() || [event];
    samples.forEach((sample) => {
      currentStrokeRef.current.points.push(pointFromEvent(sample));
    });
    paintCanvas();
  }

  function stopDrawing(event) {
    if (
      !drawingRef.current ||
      activePointerRef.current !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const stroke = currentStrokeRef.current;
    drawingRef.current = false;
    activePointerRef.current = null;
    currentStrokeRef.current = null;
    canvasRef.current?.releasePointerCapture?.(event.pointerId);

    if (stroke?.points?.length) {
      strokesRef.current = [...strokesRef.current, stroke];
      redoRef.current = [];
      setHistory({ strokes: strokesRef.current.length, redo: 0 });
      paintCanvas(null);
      refreshDraftPreview();
    }
  }

  function undoStroke() {
    const strokes = strokesRef.current;
    if (!strokes.length) return;
    redoRef.current = [...redoRef.current, strokes[strokes.length - 1]];
    strokesRef.current = strokes.slice(0, -1);
    setHistory({
      strokes: strokesRef.current.length,
      redo: redoRef.current.length,
    });
    paintCanvas(null);
    refreshDraftPreview();
  }

  function redoStroke() {
    const redoStrokes = redoRef.current;
    if (!redoStrokes.length) return;
    const stroke = redoStrokes[redoStrokes.length - 1];
    redoRef.current = redoStrokes.slice(0, -1);
    strokesRef.current = [...strokesRef.current, stroke];
    setHistory({
      strokes: strokesRef.current.length,
      redo: redoRef.current.length,
    });
    paintCanvas(null);
    refreshDraftPreview();
  }

  async function saveSignature(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const hasDraft = strokesRef.current.length > 0;
      const signatureDataUrl = hasDraft
        ? trimmedSignatureDataUrl(canvasRef.current)
        : current?.signature_data_url || "";

      if (!signatureDataUrl) {
        setError("Draw the boss's signature on the pad before saving.");
        return;
      }

      const response = await axiosClient.put(
        "/release2-final/document-signature",
        {
          ...form,
          signature_data_url: signatureDataUrl,
        }
      );
      const saved = response.data.signature || {
        ...form,
        signature_data_url: signatureDataUrl,
        updated_at: new Date().toISOString(),
      };
      setCurrent(saved);
      setForm({
        signatory_name: saved.signatory_name || form.signatory_name,
        signatory_title: saved.signatory_title || form.signatory_title,
      });
      setMessage(response.data.message);
      resetDrawing();
      setExpanded(false);
    } catch (requestError) {
      setError(errorMessage(requestError, "The authorised signature could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function removeSignature() {
    if (
      !window.confirm(
        "Remove the saved boss signature? Previously issued documents will keep their historical signature snapshot."
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.delete(
        "/release2-final/document-signature"
      );
      setMessage(response.data.message);
      setCurrent(null);
      setForm({ signatory_name: "", signatory_title: "Managing Director" });
      resetDrawing();
    } catch (requestError) {
      setError(errorMessage(requestError, "The authorised signature could not be removed."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="signature-loading">Loading signature settings...</div>;
  }

  return (
    <div className="signature-page">
      <header className="signature-hero">
        <div>
          <p>Settings · Controlled Approval Identity</p>
          <h1>Document Signature Settings</h1>
          <span>
            Draw, align and review the authorised signature before it is used on
            future employment and HR documents.
          </span>
        </div>
        <div className={`signature-state ${current ? "ready" : "missing"}`}>
          <strong>{current ? "READY" : "NOT SET"}</strong>
          <span>approval signature</span>
        </div>
      </header>

      <Notice tone="warning">
        This feature stores an electronic signature image for authorised company
        documents. It is not biometric authentication. Keep access restricted to
        the boss or an expressly authorised administrator.
      </Notice>
      <Notice tone="info">
        The editor automatically removes unused space around a new drawing. Check
        the exact output preview before saving; previously signed PDFs never change.
      </Notice>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="signature-grid">
        <section className="signature-card">
          <div className="signature-heading-row">
            <div>
              <p>Current authorised identity</p>
              <h2>Saved Signature</h2>
            </div>
            {current ? (
              <button
                type="button"
                className="danger"
                onClick={removeSignature}
                disabled={saving}
              >
                Remove
              </button>
            ) : null}
          </div>

          {current ? (
            <div className="signature-current">
              <div className="signature-image-stage">
                <img src={current.signature_data_url} alt="Saved authorised signature" />
              </div>
              <strong>{current.signatory_name}</strong>
              <span>{current.signatory_title}</span>
              <small>
                Last changed {new Date(current.updated_at).toLocaleString("en-GB")}
              </small>
            </div>
          ) : (
            <div className="signature-empty">
              No signature has been saved. Documents can remain drafts but cannot
              be approved and signed.
            </div>
          )}

          <div className={`signature-output ${draftPreview ? "has-preview" : ""}`}>
            <div className="signature-output-heading">
              <div>
                <p>Automatic clean-up</p>
                <h3>Exact New Output</h3>
              </div>
              {draftPreview ? <span>Unsaved preview</span> : null}
            </div>
            {draftPreview ? (
              <div className="signature-image-stage">
                <img src={draftPreview} alt="Cleaned signature output preview" />
              </div>
            ) : (
              <div className="signature-preview-empty">
                Your cleaned and centred signature will appear here after drawing.
              </div>
            )}
          </div>
        </section>

        <section className={`signature-card signature-editor ${expanded ? "expanded" : ""}`}>
          <div className="signature-editor-header">
            <div>
              <p>{current ? "Replace or update" : "First-time setup"}</p>
              <h2>Controlled Signing Pad</h2>
              <span className="signature-helper">
                Keep the signature between the guides. Use Undo for a single
                mistake, or Clear to start again.
              </span>
            </div>
            <button
              type="button"
              className="secondary signature-expand-button"
              onClick={() => setExpanded((value) => !value)}
              disabled={saving}
              aria-pressed={expanded}
            >
              {expanded ? "Close Large Pad" : "Open Large Pad"}
            </button>
          </div>

          <form className="signature-form" onSubmit={saveSignature}>
            <div className="signature-fields">
              <label>
                <span>Authorised signatory name</span>
                <input
                  value={form.signatory_name}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      signatory_name: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                <span>Official title</span>
                <input
                  value={form.signatory_title}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      signatory_title: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            </div>

            <div className="signature-toolbar" aria-label="Signature drawing controls">
              <fieldset>
                <legend>Pen weight</legend>
                <div className="signature-pen-options">
                  {PEN_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={penWidth === option.value ? "active" : "secondary"}
                      onClick={() => setPenWidth(option.value)}
                      aria-pressed={penWidth === option.value}
                      disabled={saving}
                    >
                      <span
                        className="signature-pen-dot"
                        style={{ width: option.value * 2, height: option.value * 2 }}
                      />
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="signature-history-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={undoStroke}
                  disabled={!history.strokes || saving}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={redoStroke}
                  disabled={!history.redo || saving}
                >
                  Redo
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={resetDrawing}
                  disabled={!history.strokes || saving}
                >
                  Clear
                </button>
              </div>
            </div>

            <div
              ref={padWrapRef}
              className="signature-pad-wrap"
              data-stroke-count={history.strokes}
            >
              <canvas
                ref={canvasRef}
                className="signature-pad"
                aria-label="Draw authorised signature"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
              />
              <div className="signature-safe-area" aria-hidden="true">
                <span className="signature-centre-guide" />
                <span className="signature-baseline-guide" />
                <small>Keep signature inside this area</small>
              </div>
            </div>

            <div className="signature-pad-status">
              <span>
                {history.strokes
                  ? `${history.strokes} stroke${history.strokes === 1 ? "" : "s"} · output ready to review`
                  : "Pad ready · mouse, stylus or one finger"}
              </span>
              <strong>{expanded ? "Large pad active" : "Standard pad"}</strong>
            </div>

            <div className="signature-actions">
              <button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : current
                    ? "Save Identity / Replace Signature"
                    : "Save Authorised Signature"}
              </button>
              <span>
                {history.strokes
                  ? "A new trimmed signature will replace the saved image."
                  : current
                    ? "Without a new drawing, only name or title changes."
                    : "Draw and review the signature before saving."}
              </span>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
