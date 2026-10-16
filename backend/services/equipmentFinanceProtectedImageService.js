const sharp = require("sharp");

const { pool } = require("../config/db");

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1000 * 1000;
const DIRECT_BROWSER_FORMATS = new Map([
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const BLOCKED_FORMATS = new Set(["svg"]);

class FinanceProtectedImageError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = "FinanceProtectedImageError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function bufferFromStoredValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  const text = String(value || "").trim();
  if (!text) return null;

  const dataUrl = text.match(
    /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i
  );
  if (dataUrl) {
    return Buffer.from(dataUrl[2].replace(/\s+/g, ""), "base64");
  }

  // A few early test records stored only the base64 body. Keep that narrow
  // compatibility path without allowing remote URLs or server-side fetching.
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length >= 64) {
    return Buffer.from(text.replace(/\s+/g, ""), "base64");
  }

  return null;
}

function assertSafeBuffer(buffer) {
  if (!buffer?.length) {
    throw new FinanceProtectedImageError(
      404,
      "The protected excavator image is empty.",
      "FINANCE_PROTECTED_IMAGE_EMPTY"
    );
  }
  if (buffer.length > MAX_INPUT_BYTES) {
    throw new FinanceProtectedImageError(
      413,
      "The protected excavator image exceeds the safe viewing limit.",
      "FINANCE_PROTECTED_IMAGE_TOO_LARGE"
    );
  }
}

async function normalizeStoredImage(value) {
  const buffer = bufferFromStoredValue(value);
  if (!buffer) {
    throw new FinanceProtectedImageError(
      404,
      "The protected excavator image could not be read.",
      "FINANCE_PROTECTED_IMAGE_NOT_READABLE"
    );
  }
  assertSafeBuffer(buffer);

  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    }).metadata();
  } catch {
    throw new FinanceProtectedImageError(
      415,
      "The stored excavator picture is not a valid image.",
      "FINANCE_PROTECTED_IMAGE_INVALID_BYTES"
    );
  }

  const format = String(metadata.format || "").toLowerCase();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!format || BLOCKED_FORMATS.has(format) || width < 1 || height < 1) {
    throw new FinanceProtectedImageError(
      415,
      "The stored excavator picture format is not safe for browser display.",
      "FINANCE_PROTECTED_IMAGE_UNSUPPORTED_FORMAT"
    );
  }
  if (width * height > MAX_INPUT_PIXELS) {
    throw new FinanceProtectedImageError(
      413,
      "The stored excavator picture dimensions exceed the safe viewing limit.",
      "FINANCE_PROTECTED_IMAGE_DIMENSIONS_TOO_LARGE"
    );
  }

  const directMimeType = DIRECT_BROWSER_FORMATS.get(format);
  if (directMimeType) {
    return {
      buffer,
      mimeType: directMimeType,
      width,
      height,
      sourceFormat: format,
      transcoded: false,
    };
  }

  let pngBuffer;
  try {
    pngBuffer = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    })
      .rotate()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch {
    throw new FinanceProtectedImageError(
      415,
      "The older excavator picture could not be converted safely.",
      "FINANCE_PROTECTED_IMAGE_CONVERSION_FAILED"
    );
  }

  if (!pngBuffer.length || pngBuffer.length > MAX_OUTPUT_BYTES) {
    throw new FinanceProtectedImageError(
      413,
      "The converted excavator picture exceeds the safe viewing limit.",
      "FINANCE_PROTECTED_IMAGE_OUTPUT_TOO_LARGE"
    );
  }

  return {
    buffer: pngBuffer,
    mimeType: "image/png",
    width,
    height,
    sourceFormat: format,
    transcoded: true,
  };
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function loadMediaValue(connection, assetId, photoId) {
  const columns = await tableColumns(connection, "equipment_media");
  if (!columns.has("id") || !columns.has("asset_id") || !columns.has("file_url")) {
    return null;
  }

  const where = ["id = ?", "asset_id = ?"];
  if (columns.has("archived_at")) where.push("archived_at IS NULL");
  if (columns.has("media_category")) where.push("media_category = 'photo'");
  const [rows] = await connection.query(
    `SELECT file_url
       FROM equipment_media
      WHERE ${where.join(" AND ")}
      LIMIT 1`,
    [photoId, assetId]
  );
  return rows[0]?.file_url || null;
}

async function loadLegacyValue(connection, assetId) {
  const columns = await tableColumns(connection, "fleet_assets");
  if (!columns.has("id") || !columns.has("main_image_url")) return null;
  const [rows] = await connection.query(
    "SELECT main_image_url FROM fleet_assets WHERE id = ? LIMIT 1",
    [assetId]
  );
  return rows[0]?.main_image_url || null;
}

async function preferredAssetImageValue(connection, assetId) {
  const mediaColumns = await tableColumns(connection, "equipment_media");
  if (
    mediaColumns.has("asset_id") &&
    mediaColumns.has("file_url")
  ) {
    const where = ["asset_id = ?"];
    if (mediaColumns.has("archived_at")) where.push("archived_at IS NULL");
    if (mediaColumns.has("media_category")) where.push("media_category = 'photo'");
    const order = [
      mediaColumns.has("is_primary") ? "is_primary DESC" : null,
      mediaColumns.has("sort_order") ? "sort_order ASC" : null,
      mediaColumns.has("id") ? "id ASC" : null,
    ].filter(Boolean);
    const [rows] = await connection.query(
      `SELECT file_url
         FROM equipment_media
        WHERE ${where.join(" AND ")}
        ${order.length ? `ORDER BY ${order.join(", ")}` : ""}
        LIMIT 1`,
      [assetId]
    );
    if (rows[0]?.file_url) return rows[0].file_url;
  }
  return loadLegacyValue(connection, assetId);
}

async function loadAssetProtectedImage({ assetId: inputAssetId, photoId }) {
  const assetId = positiveId(inputAssetId);
  const normalizedPhotoId = photoId === "legacy" ? "legacy" : positiveId(photoId);
  if (!assetId || !normalizedPhotoId) {
    throw new FinanceProtectedImageError(
      400,
      "Invalid excavator picture reference.",
      "INVALID_FINANCE_PROTECTED_IMAGE_REFERENCE"
    );
  }

  const connection = await pool.getConnection();
  try {
    const value =
      normalizedPhotoId === "legacy"
        ? await loadLegacyValue(connection, assetId)
        : await loadMediaValue(connection, assetId, normalizedPhotoId);
    if (!value) {
      throw new FinanceProtectedImageError(
        404,
        "No protected picture is available for this excavator.",
        "FINANCE_PROTECTED_IMAGE_NOT_FOUND"
      );
    }
    return normalizeStoredImage(value);
  } finally {
    connection.release();
  }
}

async function loadApplicationProtectedImage(inputApplicationId) {
  const applicationId = positiveId(inputApplicationId);
  if (!applicationId) {
    throw new FinanceProtectedImageError(
      400,
      "Invalid installment application picture reference.",
      "INVALID_FINANCE_APPLICATION_IMAGE_REFERENCE"
    );
  }

  const connection = await pool.getConnection();
  try {
    const applicationColumns = await tableColumns(
      connection,
      "equipment_credit_applications"
    );
    if (!applicationColumns.has("id") || !applicationColumns.has("asset_id")) {
      throw new FinanceProtectedImageError(
        503,
        "The application-to-excavator image link is not ready on this database revision.",
        "FINANCE_APPLICATION_IMAGE_SCHEMA_REQUIRED"
      );
    }
    const [rows] = await connection.query(
      "SELECT asset_id FROM equipment_credit_applications WHERE id = ? LIMIT 1",
      [applicationId]
    );
    const assetId = positiveId(rows[0]?.asset_id);
    if (!assetId) {
      throw new FinanceProtectedImageError(
        404,
        "The installment application or its excavator was not found.",
        "FINANCE_APPLICATION_IMAGE_NOT_FOUND"
      );
    }
    const value = await preferredAssetImageValue(connection, assetId);
    if (!value) {
      throw new FinanceProtectedImageError(
        404,
        "No protected excavator picture is available for this application.",
        "FINANCE_APPLICATION_IMAGE_NOT_FOUND"
      );
    }
    return normalizeStoredImage(value);
  } finally {
    connection.release();
  }
}

module.exports = {
  FinanceProtectedImageError,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_BYTES,
  bufferFromStoredValue,
  loadApplicationProtectedImage,
  loadAssetProtectedImage,
  normalizeStoredImage,
};