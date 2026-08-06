"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const EMPTY_SHA256 = crypto.createHash("sha256").update("").digest("hex");
const DEFAULT_LOCAL_ROOT = path.resolve(__dirname, "../.local-public-media");

class PublicMediaStorageError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PublicMediaStorageError";
    this.code = options.code || "PUBLIC_MEDIA_STORAGE_ERROR";
    this.statusCode = options.statusCode || 503;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeProvider(value) {
  const provider = clean(value).toLowerCase();
  return ["r2", "local", "disabled"].includes(provider)
    ? provider
    : "disabled";
}

function safeStorageKey(value) {
  const key = clean(value).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!key || key.length > 500 || key.includes("..") || /[\u0000-\u001f]/.test(key)) {
    throw new PublicMediaStorageError("Unsafe media storage key.", {
      code: "UNSAFE_MEDIA_STORAGE_KEY",
      statusCode: 400,
    });
  }
  return key
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join("/");
}

function normalizeHttpsBase(value) {
  const raw = clean(value).replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getStorageConfig(env = process.env) {
  const production = clean(env.NODE_ENV).toLowerCase() === "production";
  const provider = normalizeProvider(
    env.PUBLIC_MEDIA_STORAGE_PROVIDER || (production ? "disabled" : "local")
  );
  return {
    production,
    provider,
    localRoot: path.resolve(clean(env.PUBLIC_MEDIA_LOCAL_ROOT) || DEFAULT_LOCAL_ROOT),
    accountId: clean(env.CLOUDFLARE_R2_ACCOUNT_ID),
    bucket: clean(env.CLOUDFLARE_R2_BUCKET),
    accessKeyId: clean(env.CLOUDFLARE_R2_ACCESS_KEY_ID),
    secretAccessKey: clean(env.CLOUDFLARE_R2_SECRET_ACCESS_KEY),
    publicBaseUrl: normalizeHttpsBase(env.PUBLIC_MEDIA_PUBLIC_BASE_URL),
  };
}

function validateStorageConfig(env = process.env) {
  const config = getStorageConfig(env);
  const errors = [];

  if (config.production && config.provider !== "r2") {
    errors.push("Production Content Studio media storage must use Cloudflare R2.");
  }
  if (config.provider === "r2") {
    if (!/^[a-f0-9]{32}$/i.test(config.accountId)) {
      errors.push("CLOUDFLARE_R2_ACCOUNT_ID must be a 32-character account ID.");
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) {
      errors.push("CLOUDFLARE_R2_BUCKET must be a valid lowercase bucket name.");
    }
    if (!config.accessKeyId) errors.push("CLOUDFLARE_R2_ACCESS_KEY_ID is required.");
    if (!config.secretAccessKey) {
      errors.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY is required.");
    }
    if (!config.publicBaseUrl) {
      errors.push("PUBLIC_MEDIA_PUBLIC_BASE_URL must be an HTTPS URL.");
    }
  }
  if (config.provider === "disabled") {
    errors.push("Public media storage is disabled.");
  }

  if (errors.length > 0) {
    throw new PublicMediaStorageError(errors.join(" "), {
      code: "PUBLIC_MEDIA_STORAGE_NOT_CONFIGURED",
      statusCode: 503,
    });
  }
  return config;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function amzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodedPath(bucket, storageKey) {
  return `/${encodeURIComponent(bucket)}/${safeStorageKey(storageKey)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function signR2Request({ config, method, storageKey, body, contentType, now }) {
  const timestamp = amzDate(now);
  const date = timestamp.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = encodedPath(config.bucket, storageKey);
  const payloadHash = body ? sha256(body) : EMPTY_SHA256;
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${String(headers[name]).trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function r2Request({ method, storageKey, body, contentType, config }) {
  const signed = signR2Request({
    config,
    method,
    storageKey,
    body,
    contentType,
    now: new Date(),
  });
  const response = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: body || undefined,
  });
  if (!response.ok) {
    const responseText = (await response.text()).slice(0, 500);
    throw new PublicMediaStorageError(
      `Cloudflare R2 ${method} failed with HTTP ${response.status}. ${responseText}`,
      { code: "R2_REQUEST_FAILED", statusCode: 502 }
    );
  }
  return response;
}

function localPath(config, storageKey) {
  const key = safeStorageKey(storageKey);
  const filePath = path.resolve(config.localRoot, key);
  const relative = path.relative(config.localRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PublicMediaStorageError("Unsafe local media path.", {
      code: "UNSAFE_LOCAL_MEDIA_PATH",
      statusCode: 400,
    });
  }
  return filePath;
}

function publicUrl(config, storageKey) {
  if (config.provider !== "r2" || !config.publicBaseUrl) return null;
  return `${config.publicBaseUrl}/${safeStorageKey(storageKey)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

async function putObject({ storageKey, body, contentType, env = process.env }) {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new PublicMediaStorageError("Media object body is empty.", {
      code: "EMPTY_MEDIA_OBJECT",
      statusCode: 400,
    });
  }
  const config = validateStorageConfig(env);
  const key = safeStorageKey(storageKey);
  if (config.provider === "r2") {
    await r2Request({
      method: "PUT",
      storageKey: key,
      body,
      contentType,
      config,
    });
  } else {
    const filePath = localPath(config, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, { flag: "wx" });
  }
  return {
    provider: config.provider === "r2" ? "cloudflare_r2" : "local",
    storage_key: key,
    public_url: publicUrl(config, key),
  };
}

async function deleteObject({ storageKey, env = process.env }) {
  const config = validateStorageConfig(env);
  const key = safeStorageKey(storageKey);
  if (config.provider === "r2") {
    await r2Request({ method: "DELETE", storageKey: key, config });
  } else {
    await fs.rm(localPath(config, key), { force: true });
  }
}

module.exports = {
  DEFAULT_LOCAL_ROOT,
  EMPTY_SHA256,
  PublicMediaStorageError,
  amzDate,
  deleteObject,
  encodedPath,
  getStorageConfig,
  localPath,
  normalizeHttpsBase,
  normalizeProvider,
  publicUrl,
  putObject,
  safeStorageKey,
  sha256,
  signR2Request,
  validateStorageConfig,
};
