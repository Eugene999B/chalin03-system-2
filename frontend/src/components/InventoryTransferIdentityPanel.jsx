import { useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/inventoryUnitScanner.css";
import "../styles/inventoryTransferIdentity.css";

function clean(value) {
  return String(value || "").trim();
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function uniqueCodes(values) {
  return [...new Set((values || []).map((value) => clean(value).toUpperCase()).filter(Boolean))];
}

function requiredForPhase(item, phase) {
  if (phase === "dispatch") return Number(item.requested_quantity || 0);
  return Number(item.outstanding_identity_count || 0);
}

function TransferUnitScannerLine({
  transferId,
  item,
  phase,
  selectedCodes,
  onChange,
  disabled,
}) {
  const [manualValue, setManualValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const detectorRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });

  const selected = useMemo(() => uniqueCodes(selectedCodes), [selectedCodes]);
  const requiredCount = requiredForPhase(item, phase);

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
    if (!raw || disabled || verifying || !transferId || !item?.id) return;
    setVerifying(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/inventory-traceability/transfer-control/${transferId}/items/${item.id}/scan`,
        { phase, value: raw }
      );
      const code = clean(response.data?.result?.unit_code).toUpperCase();
      if (!response.data?.result?.accepted || !code) {
        throw new Error("This physical ID was not accepted for the selected transfer line.");
      }
      if (selected.includes(code)) {
        throw new Error(`${code} is already selected for this ${phase}.`);
      }
      if (selected.length >= requiredCount) {
        throw new Error(
          `${item.product_name} already has ${requiredCount} verified physical ID${requiredCount === 1 ? "" : "s"} for this ${phase}.`
        );
      }
      onChange?.([...selected, code]);
      setManualValue("");
      setMessage(
        phase === "dispatch"
          ? `${code} verified as active source stock and selected for dispatch.`
          : `${code} verified against the exact IDs dispatched on this transfer.`
      );
    } catch (verifyError) {
      setError(errorMessage(verifyError, "Unable to verify this transfer physical ID."));
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
        setError(errorMessage(scanError, "Camera QR detection failed. Enter the unit ID manually."));
      }
    }
    if (cameraOpen) frameRef.current = requestAnimationFrame(detectFrame);
  }

  async function startCamera() {
    if (disabled || cameraStarting || cameraOpen || selected.length >= requiredCount) return;
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
      setError(errorMessage(cameraError, "Unable to start the transfer scanner camera."));
    } finally {
      setCameraStarting(false);
    }
  }

  function remove(code) {
    onChange?.(selected.filter((value) => value !== code));
  }

  const isComplete = selected.length === requiredCount && requiredCount > 0;

  return (
    <article className="inventory-transfer-identity__line">
      <div className="inventory-transfer-identity__line-head">
        <div>
          <strong>{item.product_name}</strong>
          <span>
            {phase === "dispatch"
              ? `${selected.length} / ${requiredCount} exact IDs verified for dispatch`
              : `${selected.length} / ${requiredCount} outstanding IDs physically observed now`}
          </span>
        </div>
        <span className={isComplete ? "is-complete" : "is-incomplete"}>
          {phase === "dispatch"
            ? isComplete
              ? "Dispatch IDs complete"
              : "Exact IDs required"
            : isComplete
            ? "All outstanding observed"
            : "Partial/zero receipt allowed"}
        </span>
      </div>

      <div className="inventory-unit-scanner is-required">
        <div className="inventory-unit-scanner__actions">
          <div className="inventory-unit-scanner__manual">
            <input
              value={manualValue}
              disabled={disabled || verifying || selected.length >= requiredCount}
              onChange={(event) => setManualValue(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  verifyAndAdd(manualValue);
                }
              }}
              placeholder={phase === "dispatch" ? "Scan source unit ID or QR payload" : "Scan physically arrived unit ID or QR payload"}
            />
            <button
              type="button"
              disabled={disabled || verifying || !manualValue.trim() || selected.length >= requiredCount}
              onClick={() => verifyAndAdd(manualValue)}
            >
              {verifying ? "Verifying…" : "Verify Physical ID"}
            </button>
          </div>
          <button
            type="button"
            className="inventory-unit-scanner__camera-button"
            disabled={disabled || cameraStarting || selected.length >= requiredCount}
            onClick={cameraOpen ? stopCamera : startCamera}
          >
            {cameraStarting ? "Starting camera…" : cameraOpen ? "Stop Camera" : "Scan Transfer QR"}
          </button>
        </div>

        {cameraOpen ? (
          <div className="inventory-unit-scanner__camera">
            <video ref={videoRef} muted playsInline aria-label="Stock transfer inventory QR scanner camera preview" />
            <div className="inventory-unit-scanner__camera-frame" aria-hidden="true" />
            <p>
              {phase === "dispatch"
                ? "Scan the physical unit leaving the source store. CHALIN verifies it is active stock for this exact transfer line."
                : "Scan only the physical units actually present at the destination. CHALIN compares them with the frozen dispatch evidence."}
            </p>
          </div>
        ) : null}

        {selected.length > 0 ? (
          <div className="inventory-unit-scanner__selected">
            {selected.map((code) => (
              <span key={code}>
                <strong>{code}</strong>
                <button type="button" onClick={() => remove(code)} disabled={disabled} aria-label={`Remove ${code}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {message ? <p className="inventory-unit-scanner__message">{message}</p> : null}
        {error ? <p className="inventory-unit-scanner__error">{error}</p> : null}
      </div>
    </article>
  );
}

export default function InventoryTransferIdentityPanel({
  transfer,
  actionNote,
  disabled = false,
  onPolicyChange,
  onCompleted,
}) {
  const [plan, setPlan] = useState(null);
  const [scansByItem, setScansByItem] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const transferId = Number(transfer?.id || 0);
  const status = String(transfer?.status || "").toLowerCase();
  const phase = status === "approved" ? "dispatch" : status === "dispatched" ? "receive" : null;
  const serializedItems = useMemo(
    () => (plan?.items || []).filter((item) => item.serialized_identity_required),
    [plan]
  );

  useEffect(() => {
    setScansByItem({});
    setError("");
    if (!transferId) {
      setPlan(null);
      onPolicyChange?.("none");
      return;
    }

    let active = true;
    setLoading(true);
    onPolicyChange?.("loading");
    axiosClient
      .get(`/inventory-traceability/transfer-control/${transferId}/plan`)
      .then((response) => {
        if (!active) return;
        const nextPlan = response.data || null;
        setPlan(nextPlan);
        onPolicyChange?.(nextPlan?.serialized_identity_required ? "serialized" : "quantity");
      })
      .catch((loadError) => {
        if (!active) return;
        setPlan(null);
        setError(errorMessage(loadError, "Unable to load physical-ID controls for this transfer."));
        onPolicyChange?.("error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [transferId, onPolicyChange]);

  if (!transferId) return null;
  if (loading) {
    return <div className="inventory-transfer-identity__notice">Checking whether this transfer requires exact physical IDs…</div>;
  }
  if (error) {
    return <div className="inventory-transfer-identity__error">{error}</div>;
  }
  if (!plan?.serialized_identity_required) return null;

  function selectedCodes(itemId) {
    return uniqueCodes(scansByItem[itemId] || []);
  }

  function setCodes(itemId, codes) {
    setScansByItem((current) => ({ ...current, [itemId]: uniqueCodes(codes) }));
  }

  const dispatchReady = serializedItems.every(
    (item) => selectedCodes(item.id).length === Number(item.requested_quantity || 0)
  );
  const receiveMissingCount = phase === "receive"
    ? serializedItems.reduce(
        (sum, item) => sum + Math.max(0, Number(item.outstanding_identity_count || 0) - selectedCodes(item.id).length),
        0
      )
    : 0;
  const shortageNoteReady = receiveMissingCount === 0 || clean(actionNote).length >= 8;

  async function submitIdentityAction() {
    if (!phase || submitting || disabled) return;
    setError("");
    if (phase === "dispatch" && !dispatchReady) {
      setError("Every enforced serialized transfer line must have the exact requested number of verified physical IDs before dispatch.");
      return;
    }
    if (phase === "receive" && !shortageNoteReady) {
      setError(`This physical receipt is short by ${receiveMissingCount} serialized unit${receiveMissingCount === 1 ? "" : "s"}. Enter a receiving note of at least 8 characters before recording the variance.`);
      return;
    }
    if (
      phase === "receive" &&
      receiveMissingCount > 0 &&
      !window.confirm(
        `${receiveMissingCount} dispatched serialized unit${receiveMissingCount === 1 ? " was" : "s were"} not physically scanned. CHALIN will keep those IDs in transit and open investigation evidence. Record this partial receipt?`
      )
    ) {
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        items: serializedItems.map((item) => ({
          transfer_item_id: Number(item.id),
          unit_ids: selectedCodes(item.id),
        })),
        ...(phase === "dispatch"
          ? { dispatch_note: clean(actionNote) }
          : { receive_note: clean(actionNote) }),
      };
      const response = await axiosClient.post(
        `/inventory-traceability/transfer-control/${transferId}/${phase === "dispatch" ? "dispatch" : "receive"}`,
        payload
      );
      const nextPlan = response.data || null;
      setPlan(nextPlan);
      onPolicyChange?.(nextPlan?.serialized_identity_required ? "serialized" : "quantity");
      setScansByItem({});
      onCompleted?.({
        message: response.data?.message || (phase === "dispatch" ? "Serialized transfer dispatched." : "Serialized transfer receipt recorded."),
        result: response.data?.result || null,
      });
    } catch (submitError) {
      setError(errorMessage(submitError, "Unable to save the serialized transfer action."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="inventory-transfer-identity">
      <div className="inventory-transfer-identity__header">
        <div>
          <span>Exact physical identity control</span>
          <h3>Serialized Stock Transfer</h3>
          <p>
            {status === "requested"
              ? "This request contains enforced serialized inventory. Exact physical IDs will be mandatory after approval."
              : phase === "dispatch"
              ? "Scan the exact units physically leaving the source store. The expected ID list is deliberately hidden."
              : phase === "receive"
              ? "Scan only what physically arrived. Destination stock increases only for verified arrivals; shortages stay in transit and become investigation evidence."
              : "This transfer contains enforced serialized inventory and retains exact physical-ID evidence."}
          </p>
        </div>
        <div className="inventory-transfer-identity__route">
          <strong>{plan.transfer?.from_branch_code}</strong>
          <span>→</span>
          <strong>{plan.transfer?.to_branch_code}</strong>
        </div>
      </div>

      <div className="inventory-transfer-identity__principles">
        <span>Expected IDs hidden</span>
        <span>No quantity-only bypass</span>
        <span>Missing arrivals stay in transit</span>
      </div>

      {phase ? (
        <div className="inventory-transfer-identity__lines">
          {serializedItems.map((item) => (
            <TransferUnitScannerLine
              key={`${phase}-${item.id}`}
              transferId={transferId}
              item={item}
              phase={phase}
              selectedCodes={selectedCodes(item.id)}
              onChange={(codes) => setCodes(item.id, codes)}
              disabled={disabled || submitting}
            />
          ))}
        </div>
      ) : null}

      {phase === "receive" ? (
        <div className={receiveMissingCount > 0 ? "inventory-transfer-identity__variance is-short" : "inventory-transfer-identity__variance"}>
          <strong>{receiveMissingCount > 0 ? `${receiveMissingCount} outstanding ID${receiveMissingCount === 1 ? "" : "s"} not scanned` : "All outstanding serialized IDs scanned"}</strong>
          <span>
            {receiveMissingCount > 0
              ? "A note of at least 8 characters is required. Unscanned IDs remain in transit and open transfer-shortage investigations."
              : "The receipt can complete without a serialized shortage investigation."}
          </span>
        </div>
      ) : null}

      {phase ? (
        <button
          type="button"
          className="inventory-transfer-identity__submit"
          disabled={
            disabled ||
            submitting ||
            (phase === "dispatch" && !dispatchReady) ||
            (phase === "receive" && !shortageNoteReady)
          }
          onClick={submitIdentityAction}
        >
          {submitting
            ? phase === "dispatch"
              ? "Dispatching exact IDs…"
              : "Recording physical receipt…"
            : phase === "dispatch"
            ? "Dispatch Verified Physical IDs"
            : receiveMissingCount > 0
            ? "Record Partial Receipt & Investigate Shortage"
            : "Receive Verified Physical IDs"}
        </button>
      ) : null}

      {error ? <div className="inventory-transfer-identity__error">{error}</div> : null}
    </section>
  );
}
