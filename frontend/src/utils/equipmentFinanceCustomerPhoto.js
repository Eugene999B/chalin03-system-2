import axiosClient from "../api/axiosClient";

export const FINANCE_CUSTOMER_PHOTO_KEY =
  "chalin03.finance.customer-passport-photo.v1";

const START_INSTALLMENT_PATH =
  "/equipment-catalogue/sales/phase-one/start-installment";
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const TARGET_BYTES = 480 * 1024;
const MAX_DIMENSION = 1400;
const PASSPORT_RATIO = 35 / 45;
const PASSPORT_HEIGHT = 900;

function cleanPath(value) {
  return String(value || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/api(?=\/)/, "")
    .replace(/\?.*$/, "");
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected picture."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected picture could not be opened."));
    image.src = dataUrl;
  });
}

function canvasDataUrl(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

function dataUrlBytes(value) {
  const base64 = String(value || "").split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

export function readFinanceCustomerPhoto() {
  try {
    const value = window.localStorage.getItem(FINANCE_CUSTOMER_PHOTO_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return parsed?.data_url ? parsed : null;
  } catch {
    return null;
  }
}

export function saveFinanceCustomerPhoto(photo) {
  window.localStorage.setItem(FINANCE_CUSTOMER_PHOTO_KEY, JSON.stringify(photo));
  window.dispatchEvent(
    new CustomEvent("chalin03:finance-customer-photo-change", {
      detail: { photo },
    })
  );
}

export function clearFinanceCustomerPhoto() {
  window.localStorage.removeItem(FINANCE_CUSTOMER_PHOTO_KEY);
  window.dispatchEvent(
    new CustomEvent("chalin03:finance-customer-photo-change", {
      detail: { photo: null },
    })
  );
}

export async function compressFinanceCustomerPhoto(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG or WebP customer picture.");
  }
  if (Number(file.size || 0) > MAX_SOURCE_BYTES) {
    throw new Error("The original picture is too large. Choose a picture below 12 MB.");
  }

  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(Number(image.naturalWidth || 1), Number(image.naturalHeight || 1))
  );
  const scaledWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const scaledHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const targetWidth = Math.round(PASSPORT_HEIGHT * PASSPORT_RATIO);
  const targetHeight = PASSPORT_HEIGHT;
  const sourceRatio = scaledWidth / scaledHeight;
  const cropWidth = sourceRatio > PASSPORT_RATIO ? Math.round(scaledHeight * PASSPORT_RATIO) : scaledWidth;
  const cropHeight = sourceRatio > PASSPORT_RATIO ? scaledHeight : Math.round(scaledWidth / PASSPORT_RATIO);
  const cropX = Math.max(0, Math.round((scaledWidth - cropWidth) / 2));
  const cropY = Math.max(0, Math.round((scaledHeight - cropHeight) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Picture compression is unavailable in this browser.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, cropX / scale, cropY / scale, cropWidth / scale, cropHeight / scale, 0, 0, targetWidth, targetHeight);

  let quality = 0.86;
  let dataUrl = canvasDataUrl(canvas, quality);
  while (dataUrlBytes(dataUrl) > TARGET_BYTES && quality > 0.54) {
    quality = Number((quality - 0.06).toFixed(2));
    dataUrl = canvasDataUrl(canvas, quality);
  }

  return {
    data_url: dataUrl,
    mime_type: "image/jpeg",
    file_name: "customer-passport-photo.jpg",
    file_size_bytes: dataUrlBytes(dataUrl),
    original_file_name: String(file.name || "customer-photo").slice(0, 180),
    original_file_size_bytes: Number(file.size || 0),
    width: targetWidth,
    height: targetHeight,
    compressed: true,
    passport_crop: true,
    passport_ratio: "35:45",
    compression_quality: quality,
    captured_at: new Date().toISOString(),
  };
}

export function installFinanceCustomerPhotoRequestBridge() {
  return axiosClient.interceptors.request.use((config) => {
    const method = String(config.method || "get").toLowerCase();
    if (method !== "post" || cleanPath(config.url) !== START_INSTALLMENT_PATH) {
      return config;
    }
    const photo = readFinanceCustomerPhoto();
    if (!photo?.data_url) return config;
    return {
      ...config,
      data: {
        ...(config.data || {}),
        customer_photo: photo,
      },
    };
  });
}
