import { useCallback, useEffect, useRef, useState } from "react";

import axiosClient from "../api/axiosClient";
import "../styles/documentSignatureSettings.css";

function errorMessage(error, fallback) {
  return error.response?.data?.message || error.message || fallback;
}

function Notice({ tone = "info", children }) {
  return <div className={`signature-notice ${tone}`}>{children}</div>;
}

export default function DocumentSignatureSettingsPage() {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({
    signatory_name: "",
    signatory_title: "Managing Director",
  });
  const [hasInk, setHasInk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(Math.round(rect.width * ratio), 1);
    canvas.height = Math.max(Math.round(rect.height * ratio), 1);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#07182c";
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.lineJoin = "round";
    setHasInk(false);
  }, []);

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
    prepareCanvas();
    const handleResize = () => prepareCanvas();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [prepareCanvas]);

  function pointFromEvent(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startDrawing(event) {
    event.preventDefault();
    const canvas = canvasRef.current;
    canvas.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
  }

  function draw(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = pointFromEvent(event);
    const previous = lastPointRef.current || point;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
    setHasInk(true);
  }

  function stopDrawing(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
  }

  async function saveSignature(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      let signatureDataUrl = current?.signature_data_url || "";
      if (hasInk) {
        signatureDataUrl = canvasRef.current.toDataURL("image/png");
      }
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
      setMessage(response.data.message);
      await load();
      prepareCanvas();
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
      prepareCanvas();
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
            The boss can sign once using one finger, a mouse or a stylus. The
            saved image is applied only when an authorised manager approves an
            employment or HR document.
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
        Every approved document receives its own signature snapshot. Replacing the
        signature here changes future approvals only; old signed PDFs remain
        unchanged.
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
              <img src={current.signature_data_url} alt="Saved authorised signature" />
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
        </section>

        <section className="signature-card">
          <div>
            <p>{current ? "Replace or update" : "First-time setup"}</p>
            <h2>Draw the Boss Signature</h2>
            <span className="signature-helper">
              Sign naturally inside the white pad. On a phone or tablet, use one
              finger. The pad does not scroll while signing.
            </span>
          </div>

          <form className="signature-form" onSubmit={saveSignature}>
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

            <div className="signature-pad-wrap">
              <canvas
                ref={canvasRef}
                className="signature-pad"
                aria-label="Draw authorised signature"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onPointerLeave={stopDrawing}
              />
              <span className="signature-pad-line">Sign above this line</span>
            </div>

            <div className="signature-actions">
              <button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : current
                    ? "Save Changes / Replace Signature"
                    : "Save Authorised Signature"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={prepareCanvas}
                disabled={saving}
              >
                Clear Drawing Pad
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
