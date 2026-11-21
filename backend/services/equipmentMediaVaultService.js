const crypto = require("node:crypto");

const { config, headObject, uploadObject } = require("./objectStorageService");

const MAX_INLINE_IMAGE_BYTES = 512 * 1024;
const PRESIGN_SECONDS = 15 * 60;
const URL_CACHE_MS = 12 * 60 * 1000;
const MAX_DEPTH = 8;
const MAX_MEDIA_VALUES_PER_RESPONSE = 100;

const signedUrlCache = new Map();
const uploadInFlight = new Map();

const IMAGE_FIELD_NAMES = new Set([
  "file_url",
  "thumbnail_url",
  "main_image_url",
  "image_url",
  "photo_url",
  "portrait_url",
  "customer_photo_url",
  "equipment_photo_url",
  "image",
  "photo",
  "thumbnail",
  "portrait",
  "signature_image",
]);

function isImageField(name) {
  return IMAGE_FIELD_NAMES.has(String(name || "").toLowerCase());
}

function parseImageDataUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_INLINE_IMAGE_BYTES) return null;
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return { buffer, mimeType };
}

function isBucketReference(value) {
  return /^bucket:\/\//i.test(String(value || "").trim());
}

function bucketKey(value) {
  return String(value || "").trim().replace(/^bucket:\/\//i, "").replace(/^\/+/, "");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function awsEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(key, endpoint, bucket) {
  const base = new URL(endpoint);
  const prefix = base.pathname.replace(/\/$/, "");
  const path = `${prefix}/${String(key).replace(/^\/+/, "")}`;
  return {
    host: `${bucket}.${base.host}`,
    path: path.split("/").map((part, index) => (index === 0 ? "" : awsEncode(part))).join("/") || "/",
    protocol: base.protocol,
  };
}

function hmac(key, value, encoding) {
  const digest = crypto.createHmac("sha256", key).update(value).digest();
  return encoding ? digest.toString(encoding) : digest;
}

function signingKey(secret, dateStamp, region, service) {
  return hmac(
    hmac(
      hmac(
        hmac(`AWS4${secret}`, dateStamp),
        region
      ),
      service
    ),
    "aws4_request"
  );
}

function presignGetObject(key, expiresIn = PRESIGN_SECONDS) {
  const cfg = config();
  if (!cfg.enabled || !cfg.endpoint || !cfg.bucket || !cfg.accessKey || !cfg.secretKey) return null;
  const safeExpires = Math.max(1, Math.min(7 * 24 * 60 * 60, Number(expiresIn) || PRESIGN_SECONDS));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const target = canonicalUri(key, cfg.endpoint, cfg.bucket);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKey}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", safeExpires],
    ["X-Amz-SignedHeaders", "host"],
  ]
    .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
    .sort()
    .join("&");
  const canonicalHeaders = `host:${target.host}\n`;
  const canonicalRequest = [
    "GET",
    target.path,
    query,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(Buffer.from(canonicalRequest)),
  ].join("\n");
  const signature = hmac(
    signingKey(cfg.secretKey, dateStamp, cfg.region, "s3"),
    stringToSign,
    "hex"
  );
  return `${target.protocol}//${target.host}${target.path}?${query}&X-Amz-Signature=${signature}`;
}

async function ensureStored(parsed) {
  const cfg = config();
  if (!cfg.enabled || !cfg.endpoint || !cfg.bucket || !cfg.accessKey || !cfg.secretKey) return null;

  const digest = sha256(parsed.buffer);
  const extension = parsed.mimeType === "image/png" ? "png" : parsed.mimeType === "image/webp" ? "webp" : "jpg";
  const key = `chalin03/media/images/${digest}.${extension}`;
  const cached = signedUrlCache.get(digest);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.url;

  if (!uploadInFlight.has(key)) {
    uploadInFlight.set(key, (async () => {
      const existing = await headObject(key);
      if (!existing) {
        await uploadObject({
          key,
          buffer: parsed.buffer,
          contentType: parsed.mimeType,
          cacheControl: "private, max-age=900",
        });
      }
      return key;
    })().finally(() => uploadInFlight.delete(key)));
  }

  try {
    await uploadInFlight.get(key);
  } catch {
    return null;
  }

  const url = presignGetObject(key, PRESIGN_SECONDS);
  if (!url) return null;
  signedUrlCache.set(digest, { url, expiresAt: now + URL_CACHE_MS });
  return url;
}

function containsImageReference(value, fieldName = "", depth = 0) {
  if (depth > MAX_DEPTH || value == null) return false;
  if (typeof value === "string") {
    return isImageField(fieldName) && (isBucketReference(value) || /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value));
  }
  if (Array.isArray(value)) return value.some((item) => containsImageReference(item, fieldName, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => containsImageReference(child, key, depth + 1));
}

async function transformValue(value, fieldName, state, depth = 0) {
  if (depth > MAX_DEPTH || state.count >= MAX_MEDIA_VALUES_PER_RESPONSE) return value;

  if (typeof value === "string" && isImageField(fieldName)) {
    if (isBucketReference(value)) {
      state.count += 1;
      const key = bucketKey(value);
      const url = key ? presignGetObject(key, PRESIGN_SECONDS) : null;
      return url || value;
    }

    const parsed = parseImageDataUrl(value);
    if (parsed) {
      state.count += 1;
      const url = await ensureStored(parsed);
      return url || value;
    }
    return value;
  }

  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => transformValue(item, fieldName, state, depth + 1)));
  }

  const output = { ...value };
  for (const [key, child] of Object.entries(output)) {
    output[key] = await transformValue(child, key, state, depth + 1);
  }
  return output;
}

async function transformResponseBody(body) {
  if (!body || typeof body !== "object" || !containsImageReference(body)) return body;
  try {
    return await transformValue(body, "", { count: 0 }, 0);
  } catch {
    return body;
  }
}

function installResponseMediaVault() {
  const express = require("express");
  const responsePrototype = express.response;
  if (responsePrototype.__chalin03MediaVaultInstalled) return;

  const originalJson = responsePrototype.json;
  responsePrototype.json = function patchedJson(body) {
    const response = this;
    if (response.__chalin03MediaVaultBypass || !containsImageReference(body)) {
      return originalJson.call(response, body);
    }

    response.__chalin03MediaVaultBypass = true;
    transformResponseBody(body)
      .then((transformed) => originalJson.call(response, transformed))
      .catch(() => originalJson.call(response, body))
      .catch(() => undefined);

    return response;
  };
  responsePrototype.__chalin03MediaVaultInstalled = true;
}

function clearExpiredCaches() {
  const now = Date.now();
  for (const [digest, entry] of signedUrlCache.entries()) {
    if (!entry || entry.expiresAt <= now) signedUrlCache.delete(digest);
  }
}

function startMediaVaultMaintenance() {
  clearExpiredCaches();
  const timer = setInterval(clearExpiredCaches, 5 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = {
  installResponseMediaVault,
  startMediaVaultMaintenance,
  transformResponseBody,
  presignGetObject,
};
