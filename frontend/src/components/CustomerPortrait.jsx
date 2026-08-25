import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const PHOTO_API = "/equipment-catalogue/sales/phase-one/customers";
const MAX_BYTES = 120 * 1024;
const TARGET_WIDTH = 413;
const TARGET_HEIGHT = 531;

function initials(name) {
  return String(name || "Customer")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "C";
}

function readAsImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read by the browser."));
    };
    image.src = url;
  });
}

export async function normalizeCustomerPortrait(file) {
  if (!file || !String(file.type || "").toLowerCase().startsWith("image/")) {
    throw new Error("Choose an image file for the customer photo.");
  }

  const image = await readAsImage(file);
  const sourceWidth = Number(image.width || 0);
  const sourceHeight = Number(image.height || 0);
  if (!sourceWidth || !sourceHeight) throw new Error("The selected image has no usable dimensions.");

  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = TARGET_WIDTH / TARGET_HEIGHT;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = Math.round(sourceHeight * targetRatio);
    sx = Math.round((sourceWidth - sw) / 2);
  } else if (sourceRatio < targetRatio) {
    sh = Math.round(sourceWidth / targetRatio);
    sy = Math.round((sourceHeight - sh) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not prepare the photo.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

  let best = "";
  for (let quality = 0.86; quality >= 0.42; quality -= 0.06) {
    const candidate = canvas.toDataURL("image/jpeg", quality);
    best = candidate;
    const bytes = Math.ceil((candidate.length - candidate.indexOf(",") - 1) * 3 / 4);
    if (bytes <= MAX_BYTES) break;
  }
  if (!best) throw new Error("The photo could not be compressed safely.");

  return best;
}

export function CustomerPortrait({ customerId, src = "", name = "Customer", size = "medium", className = "" }) {
  const [remoteSource, setRemoteSource] = useState(src || "");

  useEffect(() => {
    setRemoteSource(src || "");
    if (!customerId || src) return undefined;
    let active = true;
    axiosClient
      .get(`${PHOTO_API}/${customerId}/photo`)
      .then((response) => {
        if (active) setRemoteSource(response.data?.photo || "");
      })
      .catch(() => {
        if (active) setRemoteSource("");
      });
    return () => {
      active = false;
    };
  }, [customerId, src]);

  return (
    <div className={`customer-portrait customer-portrait--${size} ${className}`.trim()} aria-label={`${name} photo`}>
      {remoteSource ? <img src={remoteSource} alt={`${name} profile`} /> : <span>{initials(name)}</span>}
    </div>
  );
}

export default function CustomerPortraitPicker({ value = "", name = "Customer", onChange, onError, compact = false }) {
  const [processing, setProcessing] = useState(false);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      const normalized = await normalizeCustomerPortrait(file);
      onChange?.(normalized);
      onError?.("");
    } catch (error) {
      onError?.(error?.message || "The customer photo could not be prepared. Choose another image.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className={`customer-photo-picker ${compact ? "is-compact" : ""}`}>
      <div className="customer-photo-picker__portrait">
        <CustomerPortrait src={value} name={name} size={compact ? "small" : "large"} />
      </div>
      <div className="customer-photo-picker__copy">
        <strong>Customer photo <em>Optional</em></strong>
        <span>Any normal image is accepted. Chalin automatically crops it to a neat passport portrait and compresses it.</span>
        <div className="customer-photo-picker__actions">
          <label className="customer-photo-picker__button is-primary">
            {processing ? "Preparing…" : value ? "Change photo" : "Add photo"}
            <input type="file" accept="image/*" onChange={handleFile} disabled={processing} hidden />
          </label>
          {value ? <button type="button" className="customer-photo-picker__button" onClick={() => onChange?.("")} disabled={processing}>Remove</button> : null}
        </div>
      </div>
    </div>
  );
}
