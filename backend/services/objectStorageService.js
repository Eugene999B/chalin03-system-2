const crypto = require("node:crypto");

class ObjectStorageError extends Error {
  constructor(statusCode, message, code = "OBJECT_STORAGE_ERROR") {
    super(message);
    this.name = "ObjectStorageError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function config() {
  const enabled = clean(process.env.CHALIN03_OBJECT_STORAGE_ENABLED, 10).toLowerCase() === "true";
  const endpoint = clean(process.env.CHALIN03_OBJECT_STORAGE_ENDPOINT, 500).replace(/\/$/, "");
  const region = clean(process.env.CHALIN03_OBJECT_STORAGE_REGION, 100) || "auto";
  const bucket = clean(process.env.CHALIN03_OBJECT_STORAGE_BUCKET, 255);
  const accessKey = clean(process.env.CHALIN03_OBJECT_STORAGE_ACCESS_KEY, 255);
  const secretKey = String(process.env.CHALIN03_OBJECT_STORAGE_SECRET_KEY || "").trim();
  return { enabled, endpoint, region, bucket, accessKey, secretKey };
}

function assertEnabled() {
  const cfg = config();
  if (!cfg.enabled) {
    throw new ObjectStorageError(
      503,
      "Object storage is not configured for this environment.",
      "OBJECT_STORAGE_NOT_CONFIGURED"
    );
  }
  if (!cfg.endpoint || !cfg.bucket || !cfg.accessKey || !cfg.secretKey) {
    throw new ObjectStorageError(
      503,
      "Object storage is enabled but its server credentials are incomplete.",
      "OBJECT_STORAGE_CONFIGURATION_INCOMPLETE"
    );
  }
  return cfg;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  const digest = crypto.createHmac("sha256", key).update(value).digest();
  return encoding ? digest.toString(encoding) : digest;
}

function signingKey(secret, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function objectPath(key) {
  const normalized = clean(key, 1200).replace(/^\/+/, "");
  if (!normalized) {
    throw new ObjectStorageError(400, "An object storage key is required.", "OBJECT_STORAGE_KEY_REQUIRED");
  }
  return normalized.split("/").map(encodePathSegment).join("/");
}

function requestTarget(cfg, key) {
  const base = new URL(cfg.endpoint);
  const path = `${base.pathname.replace(/\/$/, "")}/${encodeURIComponent(cfg.bucket)}/${objectPath(key)}`;
  return new URL(path + base.search, base.origin);
}

function signedRequest({ method, key, body, contentType, expires }) {
  const cfg = assertEnabled();
  const service = "s3";
  const url = requestTarget(cfg, key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? sha256(body) : sha256("");
  const host = url.host;
  const canonicalUri = url.pathname;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${cfg.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(cfg.secretKey, dateStamp, cfg.region, service),
    stringToSign,
    "hex"
  );
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization,
  };
  if (contentType) headers["content-type"] = contentType;
  return { url: url.toString(), headers, expires };
}

async function uploadObject({ key, buffer, contentType, cacheControl = "private, max-age=0, no-cache" }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ObjectStorageError(400, "Object storage upload requires non-empty bytes.", "OBJECT_STORAGE_EMPTY_OBJECT");
  }
  const signed = signedRequest({ method: "PUT", key, body: buffer, contentType });
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: { ...signed.headers, "content-type": contentType || "application/octet-stream", "cache-control": cacheControl },
    body: buffer,
  });
  if (!response.ok) {
    throw new ObjectStorageError(502, `Object storage upload failed with HTTP ${response.status}.`, "OBJECT_STORAGE_UPLOAD_FAILED");
  }
  const cfg = config();
  return {
    provider: "s3-compatible",
    bucket: cfg.bucket,
    key: clean(key, 1200),
    etag: clean(response.headers.get("etag"), 255) || null,
  };
}

async function deleteObject(key) {
  const signed = signedRequest({ method: "DELETE", key });
  const response = await fetch(signed.url, { method: "DELETE", headers: signed.headers });
  if (!response.ok && response.status !== 404) {
    throw new ObjectStorageError(502, `Object storage deletion failed with HTTP ${response.status}.`, "OBJECT_STORAGE_DELETE_FAILED");
  }
}

function status() {
  const cfg = config();
  return {
    enabled: cfg.enabled,
    configured: Boolean(cfg.endpoint && cfg.bucket && cfg.accessKey && cfg.secretKey),
    provider: cfg.enabled ? "s3-compatible" : null,
    bucket: cfg.bucket || null,
    region: cfg.region,
  };
}

module.exports = {
  ObjectStorageError,
  config,
  status,
  uploadObject,
  deleteObject,
};
