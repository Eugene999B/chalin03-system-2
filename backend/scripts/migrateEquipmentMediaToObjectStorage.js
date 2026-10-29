const sharp = require("sharp");
const { pool } = require("../config/db");
const objectStorage = require("../services/objectStorageService");

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const BATCH_SIZE = 20;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_WIDTH = 2200;
const MAX_HEIGHT = 2200;
const WEBP_QUALITY = 82;
const KEY_PREFIX = "chalin03/media/images/";

function enabled() {
  return ENABLED_VALUES.has(String(process.env.CHALIN03_OBJECT_STORAGE_MIGRATION_ENABLED || "").trim().toLowerCase());
}

function parseInlineImage(value) {
  const text = String(value ?? "").trim();
  if (!text || text.startsWith("bucket://") || text.startsWith("http://") || text.startsWith("https://")) {
    return null;
  }

  const dataUrl = text.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  const encoded = dataUrl ? dataUrl[2] : text;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(encoded) || encoded.replace(/\s+/g, "").length < 16) {
    return null;
  }

  try {
    const buffer = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
    if (!buffer.length || buffer.length > MAX_INPUT_BYTES) return null;
    return buffer;
  } catch {
    return null;
  }
}

async function canonicalize(buffer) {
  const image = sharp(buffer, { failOn: "error" });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(String(metadata.format).toLowerCase())) {
    throw new Error("Unsupported image format.");
  }

  let pipeline = image.rotate();
  if (metadata.width && metadata.height && (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT)) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: "inside", withoutEnlargement: true });
  }

  const output = await pipeline.webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer();
  if (!output.length || output.length > MAX_OUTPUT_BYTES) {
    throw new Error("Optimized image exceeds the safety limit.");
  }
  return output;
}

async function migrateValue(row, field, value) {
  const source = parseInlineImage(value);
  if (!source) return { changed: false, reason: "not-inline-image" };

  const optimized = await canonicalize(source);
  const key = `${KEY_PREFIX}${require("node:crypto").createHash("sha256").update(optimized).digest("hex")}.webp`;
  const existing = await objectStorage.headObject(key);
  let etag = existing?.etag || null;
  if (!existing) {
    const uploaded = await objectStorage.uploadObject({
      key,
      buffer: optimized,
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });
    etag = uploaded.etag;
  }

  const publicReference = `bucket://${key}`;
  if (field === "file_url") {
    await pool.query(
      `UPDATE equipment_media
          SET file_url = ?,
              storage_key = ?,
              storage_provider = 's3-compatible',
              storage_bucket = ?,
              storage_status = 'stored',
              mime_type = 'image/webp',
              file_size_bytes = ?
        WHERE id = ? AND file_url = ?`,
      [publicReference, key, objectStorage.config().bucket, optimized.length, row.id, value]
    );
  } else if (field === "thumbnail_url") {
    await pool.query(
      `UPDATE equipment_media
          SET thumbnail_url = ?
        WHERE id = ? AND thumbnail_url = ?`,
      [publicReference, row.id, value]
    );
  } else {
    return { changed: false, reason: "unsupported-field" };
  }

  return { changed: true, key, etag, bytes: optimized.length };
}

async function run() {
  if (!enabled()) return { skipped: true, reason: "migration-disabled" };
  const config = objectStorage.config();
  if (!config.enabled || !config.endpoint || !config.bucket || !config.accessKey || !config.secretKey) {
    console.warn("Chalin03 media migration skipped: object storage is not fully configured.");
    return { skipped: true, reason: "object-storage-not-configured" };
  }

  let cursor = 0;
  let processed = 0;
  let migrated = 0;
  let failures = 0;

  while (true) {
    const [rows] = await pool.query(
      `SELECT id, file_url, thumbnail_url
         FROM equipment_media
        WHERE id > ?
          AND media_category = 'photo'
          AND (
            (file_url IS NOT NULL AND file_url <> '' AND file_url NOT LIKE 'bucket://%')
            OR (thumbnail_url IS NOT NULL AND thumbnail_url <> '' AND thumbnail_url NOT LIKE 'bucket://%')
          )
        ORDER BY id ASC
        LIMIT ${BATCH_SIZE}`,
      [cursor]
    );

    if (!rows.length) break;

    for (const row of rows) {
      cursor = Number(row.id);
      for (const field of ["file_url", "thumbnail_url"]) {
        const value = row[field];
        if (!value || String(value).startsWith("bucket://")) continue;
        processed += 1;
        try {
          const result = await migrateValue(row, field, value);
          if (result.changed) {
            migrated += 1;
            console.log(`Chalin03 media migrated id=${row.id} field=${field} bytes=${result.bytes} key=${result.key}`);
          }
        } catch (error) {
          failures += 1;
          console.warn(`Chalin03 media migration failed id=${row.id} field=${field}: ${error?.message || error}`);
        }
      }
    }
  }

  return { skipped: false, processed, migrated, failures };
}

module.exports = { run };

if (require.main === module) {
  run()
    .then((result) => {
      console.log(`Chalin03 media migration complete: ${JSON.stringify(result)}`);
    })
    .catch((error) => {
      console.error(`Chalin03 media migration failed: ${error?.stack || error}`);
      process.exitCode = 1;
    });
}
