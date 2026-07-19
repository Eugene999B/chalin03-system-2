const sharp = require("sharp");

function asBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (typeof value === "string") {
    const dataUrlMatch = value.match(/^data:[^;]+;base64,(.+)$/i);
    try {
      return Buffer.from(dataUrlMatch ? dataUrlMatch[1] : value, "base64");
    } catch {
      return null;
    }
  }
  return null;
}

async function normalizePdfImageBuffer(value, mimeType = "") {
  const input = asBuffer(value);
  if (!input?.length) return null;

  try {
    return await sharp(input)
      .rotate()
      .png({ compressionLevel: 6 })
      .toBuffer();
  } catch (error) {
    const normalizedMime = String(mimeType || "").trim().toLowerCase();
    if (normalizedMime === "image/png" || normalizedMime === "image/jpeg" || normalizedMime === "image/jpg") {
      return input;
    }
    console.warn("Worker PDF photo conversion failed:", error.message);
    return null;
  }
}

module.exports = {
  asBuffer,
  normalizePdfImageBuffer,
};
