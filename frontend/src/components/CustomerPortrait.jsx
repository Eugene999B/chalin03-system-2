import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/customerProfilePortrait.css";

const PHOTO_API = "/equipment-catalogue/sales/phase-one/customers";
const MAX_BYTES = 120 * 1024;
const TARGET_WIDTH = 413;
const TARGET_HEIGHT = 531;
const SAFE_PHOTO_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

function initials(name) { return String(name || "Customer").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C"; }
function safePhotoSource(value) { const source = String(value || "").trim(); return SAFE_PHOTO_PATTERN.test(source) && source.length <= 180000 ? source : ""; }
function readAsImage(file) { if (typeof createImageBitmap === "function") return createImageBitmap(file).catch(() => readAsImageElement(file)); return readAsImageElement(file); }
function readAsImageElement(file) { return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be read by the browser.")); }; image.src = url; }); }
export async function normalizeCustomerPortrait(file) {
  if (!file) throw new Error("Choose a customer photo.");
  const image = await readAsImage(file); const sourceWidth = Number(image.width || image.naturalWidth || 0); const sourceHeight = Number(image.height || image.naturalHeight || 0);
  if (!sourceWidth || !sourceHeight) throw new Error("The selected image has no usable dimensions.");
  const sourceRatio = sourceWidth / sourceHeight; const targetRatio = TARGET_WIDTH / TARGET_HEIGHT; let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
  if (sourceRatio > targetRatio) { sw = Math.round(sourceHeight * targetRatio); sx = Math.round((sourceWidth - sw) / 2); } else if (sourceRatio < targetRatio) { sh = Math.round(sourceWidth / targetRatio); sy = Math.round((sourceHeight - sh) / 2); }
  const canvas = document.createElement("canvas"); canvas.width = TARGET_WIDTH; canvas.height = TARGET_HEIGHT; const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not prepare the photo."); context.fillStyle = "#fff"; context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(image, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT); if (typeof image.close === "function") image.close();
  let best = ""; for (let quality = 0.86; quality >= 0.42; quality -= 0.06) { best = canvas.toDataURL("image/jpeg", quality); const bytes = Math.ceil((best.length - best.indexOf(",") - 1) * 3 / 4); if (bytes <= MAX_BYTES) break; }
  if (!best || !SAFE_PHOTO_PATTERN.test(best)) throw new Error("The photo could not be compressed safely."); return best;
}
export function CustomerPortrait({ customerId, src = "", name = "Customer", size = "medium", className = "", fallback = "initials" }) {
  const [remoteSource, setRemoteSource] = useState(safePhotoSource(src));
  useEffect(() => { const localSource = safePhotoSource(src); setRemoteSource(localSource); if (!customerId || localSource) return undefined; let active = true; axiosClient.get(`${PHOTO_API}/${customerId}/photo`).then((response) => { if (active) setRemoteSource(safePhotoSource(response.data?.photo)); }).catch(() => { if (active) setRemoteSource(""); }); return () => { active = false; }; }, [customerId, src]);
  return <div className={`customer-portrait customer-portrait--${size} ${className}`.trim()} aria-label={`${name} photo`}>{remoteSource ? <img src={remoteSource} alt={`${name} profile`} /> : fallback === "blank" ? <span className="customer-portrait__blank" aria-hidden="true" /> : <span>{initials(name)}</span>}</div>;
}
export function CustomerPortraitPicker({ value = "", name = "Customer", onChange, onError, compact = false }) {
  const [processing, setProcessing] = useState(false);
  async function handleFile(event) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setProcessing(true); try { onChange?.(await normalizeCustomerPortrait(file)); onError?.(""); } catch (error) { onError?.(error?.message || "The customer photo could not be prepared."); } finally { setProcessing(false); } }
  return <div className={`customer-photo-picker ${compact ? "is-compact" : ""}`}><div className="customer-photo-picker__portrait"><CustomerPortrait src={value} name={name} size={compact ? "small" : "large"} /></div><div className="customer-photo-picker__copy"><strong>Customer photo <em>Optional</em></strong><span>Any normal image is accepted. Chalin crops it to a passport portrait and compresses it automatically.</span><div className="customer-photo-picker__actions"><label className="customer-photo-picker__button is-primary">{processing ? "Preparing…" : value ? "Change photo" : "Add photo"}<input type="file" accept="image/*" onChange={handleFile} disabled={processing} hidden /></label>{value ? <button type="button" className="customer-photo-picker__button" onClick={() => onChange?.("")} disabled={processing}>Remove</button> : null}</div></div></div>;
}
export default CustomerPortrait;
