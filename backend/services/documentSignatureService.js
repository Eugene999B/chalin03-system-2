const { pool } = require("../config/db");

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const PNG_PREFIX = "data:image/png;base64,";

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeSignatureDataUrl(value) {
  const dataUrl = cleanText(value, 4 * 1024 * 1024);
  if (!dataUrl.startsWith(PNG_PREFIX)) {
    const error = new Error("The signature must be a PNG drawing captured by the system.");
    error.statusCode = 400;
    throw error;
  }

  const base64 = dataUrl.slice(PNG_PREFIX.length).replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    const error = new Error("The signature drawing is not valid PNG data.");
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(base64, "base64");
  const pngMagic = buffer.subarray(0, 8).toString("hex");
  if (pngMagic !== "89504e470d0a1a0a") {
    const error = new Error("The signature drawing is not a valid PNG image.");
    error.statusCode = 400;
    throw error;
  }

  if (buffer.length > MAX_SIGNATURE_BYTES) {
    const error = new Error("The signature drawing is too large. Clear the pad and sign again.");
    error.statusCode = 413;
    throw error;
  }

  return `${PNG_PREFIX}${base64}`;
}

function signatureDataUrlToBuffer(value) {
  if (!value) return null;
  const normalized = normalizeSignatureDataUrl(value);
  return Buffer.from(normalized.slice(PNG_PREFIX.length), "base64");
}

async function loadDocumentSignature() {
  const [rows] = await pool.query(
    `SELECT id, signatory_name, signatory_title, signature_data_url, updated_by, created_at, updated_at
     FROM document_signature_settings
     WHERE id = 1
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getDocumentSignatureSnapshot() {
  const setting = await loadDocumentSignature();
  if (!setting) return null;
  return {
    dataUrl: setting.signature_data_url,
    name: setting.signatory_name,
    title: setting.signatory_title,
    capturedAt: new Date(),
  };
}

module.exports = {
  MAX_SIGNATURE_BYTES,
  normalizeSignatureDataUrl,
  signatureDataUrlToBuffer,
  loadDocumentSignature,
  getDocumentSignatureSnapshot,
};
