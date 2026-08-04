import axios from "axios";
import "../styles/equipmentSecureUpload.css";

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_STORED_BYTES = 44 * 1024;
const INITIAL_MAX_DIMENSION = 1200;
const MIN_DIMENSION = 520;
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.44, 0.36];
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROTECTED_MIME_TYPE = "image/jpeg";
const FINANCE_IMAGE_TIMEOUT_MS = 12000;
const API_BASE_URL = String(
  import.meta.env.VITE_API_URL || "http://localhost:5000/api"
).replace(/\/$/, "");
const FINANCE_IMAGE_PATHS = [
  /\/equipment-catalogue\/sales\/protected-images\//,
  /\/equipment-catalogue\/sales\/credit-applications\/\d+\/image(?:$|\?)/,
  /\/equipment-catalogue\/sales\/phase-one\/machine-image\//,
];

let installed = false;
let observer = null;
let nativeImageSourceDescriptor = null;
const protectedImageRequests = new WeakMap();

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The selected picture could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected picture is not a valid image."));
    image.src = dataUrl;
  });
}

function canvasBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

async function blobToDataUrl(blob) {
  return fileToDataUrl(blob);
}

function scaledSize(width, height, maximumDimension) {
  const longest = Math.max(width, height);
  if (longest <= maximumDimension) return { width, height };
  const ratio = maximumDimension / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

async function optimizeEquipmentPhoto(file) {
  if (!file) throw new Error("Choose an equipment picture first.");
  if (!ALLOWED_TYPES.has(String(file.type || "").toLowerCase())) {
    throw new Error("Use a JPEG, PNG or WebP picture.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("The original picture is larger than 15 MB.");
  }

  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);
  let maximumDimension = INITIAL_MAX_DIMENSION;
  let bestBlob = null;

  while (maximumDimension >= MIN_DIMENSION) {
    const size = scaledSize(image.naturalWidth, image.naturalHeight, maximumDimension);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the picture.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasBlob(canvas, PROTECTED_MIME_TYPE, quality);
      if (!blob) continue;
      bestBlob = blob;
      if (blob.size <= MAX_STORED_BYTES) {
        return {
          dataUrl: await blobToDataUrl(blob),
          mimeType: PROTECTED_MIME_TYPE,
          fileName: String(file.name || "equipment-photo")
            .replace(/\.[^.]+$/, "")
            .concat(".jpg"),
          sizeBytes: blob.size,
          width: size.width,
          height: size.height,
        };
      }
    }

    maximumDimension = Math.floor(maximumDimension * 0.82);
  }

  if (!bestBlob || bestBlob.size > MAX_STORED_BYTES) {
    throw new Error(
      "The picture could not be compressed safely. Try taking it again with less background detail."
    );
  }

  return {
    dataUrl: await blobToDataUrl(bestBlob),
    mimeType: PROTECTED_MIME_TYPE,
    fileName: "equipment-photo.jpg",
    sizeBytes: bestBlob.size,
  };
}

function setReactInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function secureUrlInput(fileInput) {
  const form = fileInput.closest("form");
  const urlInput = form?.querySelector('input[type="url"]');
  if (!urlInput) return null;
  urlInput.closest(".equipment-catalogue__field")?.classList.add(
    "equipment-secure-upload__legacy-url"
  );
  return urlInput;
}

function prepareEquipmentPhotoField(fileInput) {
  if (!(fileInput instanceof HTMLInputElement)) return;
  if (fileInput.type !== "file") return;
  if (!fileInput.closest(".equipment-catalogue")) return;

  const field = fileInput.closest(".equipment-catalogue__field");
  if (!field) return;

  field.classList.add("equipment-secure-upload__picker");
  const hint = field.querySelector("small");
  if (hint) {
    hint.textContent =
      "Take a photo or choose one. Chalin compresses it securely for mobile use and PDF documents.";
  }
  secureUrlInput(fileInput);
}

function prepareEquipmentPhotoForms(root = document) {
  root
    .querySelectorAll?.('.equipment-catalogue input[type="file"]')
    .forEach(prepareEquipmentPhotoField);
}

function ensurePreview(fileInput) {
  prepareEquipmentPhotoField(fileInput);
  const field = fileInput.closest(".equipment-catalogue__field");
  if (!field) return null;

  let preview = field.querySelector(".equipment-secure-upload__preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.className = "equipment-secure-upload__preview";
    preview.innerHTML =
      '<img alt="Selected equipment preview"><div><strong>Preparing picture…</strong><small>Please wait</small></div>';
    field.appendChild(preview);
  }
  return preview;
}

async function handleEquipmentPhotoSelection(fileInput) {
  const file = fileInput.files?.[0];
  if (!file) return;

  const preview = ensurePreview(fileInput);
  const urlInput = secureUrlInput(fileInput);
  if (!preview || !urlInput) return;

  const image = preview.querySelector("img");
  const title = preview.querySelector("strong");
  const detail = preview.querySelector("small");
  preview.classList.remove("is-error", "is-ready");
  title.textContent = "Compressing securely…";
  detail.textContent = "Optimising for mobile upload and PDF documents";

  try {
    const optimized = await optimizeEquipmentPhoto(file);
    image.src = optimized.dataUrl;
    title.textContent = "Picture ready";
    detail.textContent = `${optimized.width || ""}${optimized.width ? "×" : ""}${
      optimized.height || ""
    } · ${Math.max(1, Math.round(optimized.sizeBytes / 1024))} KB protected image`;
    preview.classList.add("is-ready");

    setReactInputValue(urlInput, optimized.dataUrl);
    fileInput.dataset.secureEquipmentMime = optimized.mimeType;
    fileInput.dataset.secureEquipmentName = optimized.fileName;
    fileInput.dataset.secureEquipmentSize = String(optimized.sizeBytes);
  } catch (error) {
    image.removeAttribute("src");
    title.textContent = "Picture not ready";
    detail.textContent = error.message || "Choose another picture.";
    preview.classList.add("is-error");
    setReactInputValue(urlInput, "");
  }
}

function isProtectedFinanceImageSource(value) {
  const source = String(value || "").trim();
  if (!source || /^(?:blob:|data:)/i.test(source)) return false;
  return FINANCE_IMAGE_PATHS.some((pattern) => pattern.test(source));
}

function financeImageRequestUrl(source) {
  const value = String(source || "").trim();
  if (/^https?:\/\//i.test(value)) return value;
  const path = value.replace(/^\/api(?=\/)/, "");
  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function buildFinanceImageHeaders() {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("chalin03_user") || "null");
  } catch {
    // A damaged cached profile must not stop the protected image request.
  }
  const token = String(localStorage.getItem("chalin03_token") || "");
  const workspaceCode =
    user?.workspace_code || user?.active_workspace?.code || "equipment_hire";
  return {
    Accept: "image/*",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-Chalin03-Workspace": String(workspaceCode),
    "X-Chalin03-Division": "installment_finance",
  };
}

function removeRuntimeStatus(image) {
  const status = image.parentElement?.querySelector(
    ':scope > [data-finance-image-runtime-status="true"]'
  );
  status?.remove();
}

function showRuntimeStatus(image, text, state) {
  removeRuntimeStatus(image);
  image.dataset.imageState = state;
  const parent = image.parentElement;
  if (!parent) return;
  const status = document.createElement("span");
  status.dataset.financeImageRuntimeStatus = "true";
  status.className = `finance-protected-image-runtime-status is-${state}`;
  status.textContent = text;
  parent.appendChild(status);
}

function cleanupProtectedImage(image) {
  const current = protectedImageRequests.get(image);
  current?.controller?.abort();
  if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
  protectedImageRequests.delete(image);
}

async function hydrateProtectedFinanceImage(image, source) {
  if (!(image instanceof HTMLImageElement)) return;
  const normalizedSource = String(source || image.dataset.financeImageSource || "").trim();
  if (!isProtectedFinanceImageSource(normalizedSource)) return;

  cleanupProtectedImage(image);
  image.dataset.financeImageSource = normalizedSource;
  image.hidden = true;
  image.removeAttribute("src");
  showRuntimeStatus(image, "Loading photo…", "loading");

  const controller = new AbortController();
  protectedImageRequests.set(image, { controller, objectUrl: "" });

  try {
    const response = await axios.get(financeImageRequestUrl(normalizedSource), {
      responseType: "blob",
      signal: controller.signal,
      timeout: FINANCE_IMAGE_TIMEOUT_MS,
      headers: buildFinanceImageHeaders(),
    });
    const contentType = String(
      response.headers?.["content-type"] || response.data?.type || ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();
    const blob = response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: contentType });
    if (response.status !== 200) {
      throw new Error("The protected image request did not return HTTP 200.");
    }
    if (!contentType.startsWith("image/") || !blob.size) {
      throw new Error("The protected image response is invalid or empty.");
    }

    const objectUrl = URL.createObjectURL(blob);
    protectedImageRequests.set(image, { controller, objectUrl });
    image.addEventListener(
      "load",
      () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          image.hidden = false;
          image.dataset.imageState = "ready";
          removeRuntimeStatus(image);
        } else {
          image.hidden = true;
          showRuntimeStatus(image, "Photo unavailable", "failed");
        }
      },
      { once: true }
    );
    image.addEventListener(
      "error",
      () => {
        image.hidden = true;
        showRuntimeStatus(image, "Photo unavailable", "failed");
      },
      { once: true }
    );
    nativeImageSourceDescriptor?.set?.call(image, objectUrl);
  } catch (error) {
    if (error?.code === "ERR_CANCELED" || controller.signal.aborted) return;
    image.hidden = true;
    showRuntimeStatus(image, "Photo unavailable", "failed");
  }
}

function prepareProtectedFinanceImage(image) {
  if (!(image instanceof HTMLImageElement)) return;
  const source = image.getAttribute("src") || image.src;
  if (isProtectedFinanceImageSource(source)) {
    hydrateProtectedFinanceImage(image, source);
  }
}

function prepareProtectedFinanceImages(root = document) {
  if (root instanceof HTMLImageElement) prepareProtectedFinanceImage(root);
  root.querySelectorAll?.("img[src]").forEach(prepareProtectedFinanceImage);
}

function installProtectedFinanceImageSetter() {
  if (nativeImageSourceDescriptor || typeof HTMLImageElement === "undefined") return;
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src"
  );
  if (!descriptor?.get || !descriptor?.set || descriptor.configurable === false) return;
  nativeImageSourceDescriptor = descriptor;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) {
      if (isProtectedFinanceImageSource(value)) {
        hydrateProtectedFinanceImage(this, value);
        return;
      }
      descriptor.set.call(this, value);
    },
  });
}

function installEquipmentMediaCaptureBridge() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  installProtectedFinanceImageSetter();
  prepareEquipmentPhotoForms();
  prepareProtectedFinanceImages();
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        prepareProtectedFinanceImage(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('.equipment-catalogue input[type="file"]')) {
          prepareEquipmentPhotoField(node);
        }
        prepareEquipmentPhotoForms(node);
        prepareProtectedFinanceImages(node);
      }
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) cleanupProtectedImage(node);
        node.querySelectorAll?.("img").forEach(cleanupProtectedImage);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  document.addEventListener(
    "change",
    (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.type !== "file") return;
      if (!input.closest(".equipment-catalogue")) return;
      handleEquipmentPhotoSelection(input);
    },
    true
  );
}

installEquipmentMediaCaptureBridge();

export {
  buildFinanceImageHeaders,
  financeImageRequestUrl,
  hydrateProtectedFinanceImage,
  installEquipmentMediaCaptureBridge,
  isProtectedFinanceImageSource,
  optimizeEquipmentPhoto,
  prepareEquipmentPhotoForms,
  prepareProtectedFinanceImages,
};