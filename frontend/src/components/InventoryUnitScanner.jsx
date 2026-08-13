import { useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import CameraBarcodeReader from "./BarcodeCapturePanel";
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
  const [verifying, setVerifying] = useState(false);
  const selectedRef = useRef([]);

  const count = Math.max(0, Number(requiredCount || 0));
  const selected = useMemo(
    () => [
      ...new Set(
        (selectedUnitCodes || [])
          .map((value) => clean(value).toUpperCase())
          .filter(Boolean)
      ),
    ],
    [selectedUnitCodes]
  );
  const complete = selected.length === count && count > 0;

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  async function verifyAndAdd(value, source = "manual") {
    const raw = clean(value);
    if (!raw || disabled) return false;
    setError("");
    setMessage("");
    setVerifying(true);

    try {
      const response = await axiosClient.post(
        "/inventory-traceability/sale-scan/verify",
        { value: raw }
      );
      const unit = response.data?.unit;
      const code = clean(unit?.unit_code).toUpperCase();
      if (!unit || !code) {
        throw new Error(
          "The scanned label did not resolve to a physical inventory unit."
        );
      }
      if (Number(unit.product_id) !== Number(product?.id)) {
        throw new Error(
          `${code} belongs to ${
            unit.product_name || "another product"
          }, not ${product?.name || "this sale item"}.`
        );
      }
      if (unit.same_store === false) {
        throw new Error(
          `${code} belongs to another store and cannot be attached to this sale.`
        );
      }
      if (String(unit.status || "").toLowerCase() !== "active") {
        throw new Error(
          `${code} cannot be sold because its current status is ${
            unit.status || "unknown"
          }.`
        );
      }

      const current = selectedRef.current;
      if (current.includes(code)) {
        throw new Error(`${code} is already attached to this sale item.`);
      }
      if (count > 0 && current.length >= count) {
        throw new Error(
          `This sale item already has the required ${count} physical unit ID${
            count === 1 ? "" : "s"
          }.`
        );
      }

      const next = [...current, code];
      selectedRef.current = next;
      onChange?.(next);
      setManualValue("");
      setMessage(
        `${code} verified and attached${
          source === "camera" ? " automatically by camera" : ""
        }.${next.length < count ? " Scan the next physical item." : ""}`
      );
      return {
        accepted: true,
        stop: count > 0 && next.length >= count,
      };
    } catch (verifyError) {
      setError(
        apiMessage(verifyError, "Unable to verify this physical unit ID.")
      );
      return false;
    } finally {
      setVerifying(false);
    }
  }

  function removeUnit(code) {
    if (disabled) return;
    const next = selected.filter((value) => value !== code);
    selectedRef.current = next;
    onChange?.(next);
    setMessage("");
    setError("");
  }

  return (
    <div
      className={`inventory-unit-scanner ${
        required ? "is-required" : "is-optional"
      }`}
    >
      <div className="inventory-unit-scanner__head">
        <div>
          <strong>
            {required ? "Physical IDs required" : "Physical IDs (pilot / optional)"}
          </strong>
          <span>
            {selected.length} / {count} verified for {product?.name || "serialized product"}
          </span>
        </div>
        <span
          className={complete ? "is-complete" : required ? "is-incomplete" : ""}
        >
          {complete ? "Ready" : required ? "Scan remaining" : "Setup"}
        </span>
      </div>

      {!complete ? (
        <CameraBarcodeReader
          disabled={disabled || verifying}
          mode="multi"
          formats={["qr_code", "code_128"]}
          title="Scan Physical Item IDs"
          help={`Keep the camera open and scan the exact label on each ${
            product?.name || "physical item"
          }. Each verified ID is attached automatically.`}
          onDetected={(raw) => verifyAndAdd(raw, "camera")}
        />
      ) : null}

      <div className="inventory-unit-scanner__actions">
        <div className="inventory-unit-scanner__manual">
          <input
            value={manualValue}
            disabled={
              disabled || verifying || (count > 0 && selected.length >= count)
            }
            onChange={(event) => setManualValue(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                verifyAndAdd(manualValue, "manual");
              }
            }}
            placeholder="Enter unit ID or scan with handheld scanner"
            aria-label={`Physical unit ID for ${product?.name || "sale item"}`}
          />
          <button
            type="button"
            disabled={
              disabled ||
              verifying ||
              !manualValue.trim() ||
              (count > 0 && selected.length >= count)
            }
            onClick={() => verifyAndAdd(manualValue, "manual")}
          >
            {verifying ? "Verifying…" : "Verify ID"}
          </button>
        </div>
      </div>

      {selected.length > 0 ? (
        <div className="inventory-unit-scanner__selected">
          {selected.map((code) => (
            <span key={code}>
              <strong>{code}</strong>
              <button
                type="button"
                onClick={() => removeUnit(code)}
                disabled={disabled}
                aria-label={`Remove ${code}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {message ? (
        <p className="inventory-unit-scanner__message">{message}</p>
      ) : null}
      {error ? (
        <p className="inventory-unit-scanner__error">{error}</p>
      ) : null}
    </div>
  );
}
