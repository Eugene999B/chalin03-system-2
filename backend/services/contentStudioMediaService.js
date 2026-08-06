"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  booleanValue,
  cleanText,
  insertContentAudit,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  PublicMediaStorageError,
  deleteObject,
  putObject,
  sha256,
} = require("./publicMediaStorageService");

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const IMAGE_WIDTHS = Object.freeze([480, 960, 1600]);
const ALLOWED_IMAGE_FORMATS = Object.freeze(["jpeg", "png", "webp"]);
const ALLOWED_VISIBILITY = Object.freeze(["public", "private", "restricted"]);
const DEFAULT_VIDEO_HOSTS = Object.freeze([
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "player.vimeo.com",
  "videodelivery.net",
  "cloudflarestream.com",
]);

function normalizeFileName(value, fallback = "image") {
  const base = path.basename(cleanText(value, 255) || fallback);
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.slice(0, 255) || fallback;
}

function normalizeVisibility(value, fallback = "private") {
  const visibility = cleanText(value, 30).toLowerCase();
  return ALLOWED_VISIBILITY.includes(visibility) ? visibility : fallback;
}

function videoHosts(env = process.env) {
  const configured = cleanText(env.PUBLIC_MEDIA_VIDEO_HOSTS, 4000)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : [...DEFAULT_VIDEO_HOSTS];
}

function safeExternalVideoUrl(value, env = process.env) {
  const raw = cleanText(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const allowed = videoHosts(env).some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`)
    );
    return allowed ? url.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

function isSafeHttpsPublicUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function assertFolder(connection, folderId) {
  if (!folderId) return;
  const [rows] = await connection.query(
    "SELECT id FROM public_media_folders WHERE id = ? AND is_active = 1 LIMIT 1",
    [folderId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("The selected media folder is unavailable.", {
      code: "PUBLIC_MEDIA_FOLDER_NOT_FOUND",
      statusCode: 409,
    });
  }
}

function mapAsset(row) {
  return {
    id: Number(row.id),
    folder_id: row.folder_id ? Number(row.folder_id) : null,
    asset_key: row.asset_key,
    storage_provider: row.storage_provider,
    public_url: row.public_url || null,
    original_filename: row.original_filename,
    display_name: row.display_name || "",
    media_type: row.media_type,
    mime_type: row.mime_type,
    file_extension: row.file_extension || null,
    file_size_bytes: Number(row.file_size_bytes || 0),
    width: row.width_pixels ?? null,
    height: row.height_pixels ?? null,
    duration_seconds: row.duration_seconds ?? null,
    alt_text: row.alt_text || "",
    caption: row.caption || "",
    credit: row.credit_text || "",
    checksum_sha256: row.checksum_sha256 || null,
    visibility: row.visibility,
    processing_status: row.processing_status,
    metadata: parseJson(row.metadata_json, {}),
    is_active: booleanValue(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listMediaAssets(options = {}) {
  const filters = ["a.is_active = 1"];
  const values = [];
  const mediaType = cleanText(options.mediaType, 30).toLowerCase();
  const visibility = cleanText(options.visibility, 30).toLowerCase();
  const search = cleanText(options.search, 120);
  const folderId = positiveInteger(options.folderId);
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const offset = Math.max(Number(options.offset) || 0, 0);

  if (mediaType) {
    filters.push("a.media_type = ?");
    values.push(mediaType);
  }
  if (visibility) {
    if (!ALLOWED_VISIBILITY.includes(visibility)) {
      return { items: [], total: 0, limit, offset };
    }
    filters.push("a.visibility = ?");
    values.push(visibility);
  }
  if (folderId) {
    filters.push("a.folder_id = ?");
    values.push(folderId);
  }
  if (search) {
    filters.push(
      "(a.display_name LIKE ? OR a.original_filename LIKE ? OR a.alt_text LIKE ?)"
    );
    const like = `%${search}%`;
    values.push(like, like, like);
  }

  const where = filters.join(" AND ");
  try {
    const [[rows], [countRows]] = await Promise.all([
      pool.query(
        `SELECT a.*
         FROM public_media_assets a
         WHERE ${where}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM public_media_assets a
         WHERE ${where}`,
        values
      ),
    ]);
    return {
      items: rows.map(mapAsset),
      total: Number(countRows[0]?.total || 0),
      limit,
      offset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function generateImageVariants(buffer, assetKey) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ContentStudioError("Choose an image to upload.", {
      code: "PUBLIC_MEDIA_IMAGE_REQUIRED",
      statusCode: 400,
    });
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ContentStudioError("Image exceeds the 12 MB upload limit.", {
      code: "PUBLIC_MEDIA_IMAGE_TOO_LARGE",
      statusCode: 413,
    });
  }

  let metadata;
  try {
    metadata = await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: "warning",
    }).metadata();
  } catch {
    throw new ContentStudioError("The uploaded file is not a safe readable image.", {
      code: "PUBLIC_MEDIA_IMAGE_INVALID",
      statusCode: 400,
    });
  }
  if (!ALLOWED_IMAGE_FORMATS.includes(metadata.format)) {
    throw new ContentStudioError(
      "Only JPEG, PNG and WebP images are supported.",
      { code: "PUBLIC_MEDIA_IMAGE_FORMAT_BLOCKED", statusCode: 415 }
    );
  }

  const sourceWidth = Number(metadata.width || 0);
  const widths = [
    ...new Set(
      IMAGE_WIDTHS.filter((width) => !sourceWidth || width < sourceWidth).concat(
        Math.min(sourceWidth || 1600, 1600)
      )
    ),
  ].sort((a, b) => a - b);
  const variants = [];

  for (const width of widths) {
    const result = await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: "warning",
    })
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    variants.push({
      name: `w${result.info.width}`,
      storage_key: `public-media/images/${assetKey}/w${result.info.width}.webp`,
      body: result.data,
      mime_type: "image/webp",
      width: result.info.width,
      height: result.info.height,
      size: result.data.length,
    });
  }
  return variants;
}

async function uploadImage({
  buffer,
  originalFilename,
  displayName,
  altText,
  caption,
  credit,
  folderId,
  user,
  req,
  env = process.env,
}) {
  const checksum = sha256(buffer);
  let duplicateRows;
  try {
    [duplicateRows] = await pool.query(
      `SELECT * FROM public_media_assets
       WHERE checksum_sha256 = ?
         AND media_type = 'image'
         AND is_active = 1
         AND processing_status <> 'archived'
       ORDER BY id DESC LIMIT 1`,
      [checksum]
    );
  } catch (error) {
    throw schemaNotReadyError(error);
  }
  if (duplicateRows[0]) {
    return { duplicate: true, asset: mapAsset(duplicateRows[0]) };
  }

  const assetKey = `img_${crypto.randomUUID().replaceAll("-", "")}`;
  const variants = await generateImageVariants(buffer, assetKey);
  const uploaded = [];
  const connection = await pool.getConnection();

  try {
    for (const variant of variants) {
      const stored = await putObject({
        storageKey: variant.storage_key,
        body: variant.body,
        contentType: variant.mime_type,
        env,
      });
      uploaded.push({ ...variant, ...stored });
    }
    const primary = uploaded[uploaded.length - 1];

    await connection.beginTransaction();
    await assertFolder(connection, positiveInteger(folderId));
    const [result] = await connection.query(
      `INSERT INTO public_media_assets (
         folder_id, asset_key, storage_provider, storage_key, public_url,
         original_filename, display_name, media_type, mime_type,
         file_extension, file_size_bytes, width_pixels, height_pixels,
         alt_text, caption, credit_text, checksum_sha256, visibility,
         processing_status, metadata_json, is_active, uploaded_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'image', 'image/webp', 'webp',
                 ?, ?, ?, ?, ?, ?, ?, 'private', 'ready', ?, 1, ?)`,
      [
        positiveInteger(folderId),
        assetKey,
        primary.provider,
        primary.storage_key,
        primary.public_url,
        normalizeFileName(originalFilename),
        cleanText(displayName, 180) || normalizeFileName(originalFilename),
        primary.size,
        primary.width,
        primary.height,
        cleanText(altText, 500) || null,
        cleanText(caption, 5000) || null,
        cleanText(credit, 255) || null,
        checksum,
        JSON.stringify({
          source_format: "decoded_and_reencoded",
          variants: uploaded.map((item) => ({
            name: item.name,
            storage_key: item.storage_key,
            public_url: item.public_url,
            mime_type: item.mime_type,
            width: item.width,
            height: item.height,
            size: item.size,
          })),
        }),
        user?.id || null,
      ]
    );
    const assetId = Number(result.insertId);
    await insertContentAudit(connection, {
      entityType: "media_asset",
      entityId: assetId,
      actionKey: "media_image_uploaded",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: {
        asset_key: assetKey,
        checksum_sha256: checksum,
        variant_count: uploaded.length,
      },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "PUBLIC_MEDIA_IMAGE_UPLOADED",
      details: "CHALIN ONE processed image uploaded",
      entityType: "public_media_asset",
      entityId: assetId,
      actionType: "PUBLIC_MEDIA_IMAGE_UPLOADED",
      metadata: { asset_key: assetKey, variant_count: uploaded.length },
    });
    await connection.commit();
    const [rows] = await pool.query(
      "SELECT * FROM public_media_assets WHERE id = ? LIMIT 1",
      [assetId]
    );
    return { duplicate: false, asset: mapAsset(rows[0]) };
  } catch (error) {
    await connection.rollback().catch(() => {});
    for (const item of uploaded) {
      await deleteObject({ storageKey: item.storage_key, env }).catch(() => {});
    }
    if (
      error instanceof ContentStudioError ||
      error instanceof PublicMediaStorageError
    ) {
      throw error;
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function registerExternalVideo({ input = {}, user, req, env = process.env }) {
  const url = safeExternalVideoUrl(input.url, env);
  if (!url) {
    throw new ContentStudioError(
      "Video URL must be HTTPS and hosted by an approved video provider.",
      { code: "PUBLIC_MEDIA_VIDEO_URL_BLOCKED", statusCode: 400 }
    );
  }
  const assetKey = `vid_${crypto.randomUUID().replaceAll("-", "")}`;
  const durationSeconds =
    input.duration_seconds === undefined || input.duration_seconds === null ||
    input.duration_seconds === ""
      ? null
      : Number(input.duration_seconds);
  if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) {
    throw new ContentStudioError("Video duration must be a non-negative number.", {
      code: "PUBLIC_MEDIA_VIDEO_DURATION_INVALID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertFolder(connection, positiveInteger(input.folder_id));
    const [result] = await connection.query(
      `INSERT INTO public_media_assets (
         folder_id, asset_key, storage_provider, storage_key, public_url,
         original_filename, display_name, media_type, mime_type,
         file_extension, file_size_bytes, duration_seconds, alt_text,
         caption, credit_text, visibility, processing_status, metadata_json,
         is_active, uploaded_by
       ) VALUES (?, ?, 'external_video', ?, ?, ?, ?, 'video',
                 'video/external', NULL, 0, ?, ?, ?, ?, 'private', 'ready',
                 ?, 1, ?)`,
      [
        positiveInteger(input.folder_id),
        assetKey,
        `external-video/${assetKey}`,
        url,
        normalizeFileName(input.original_filename, "external-video"),
        cleanText(input.display_name, 180) || "External video",
        durationSeconds,
        cleanText(input.alt_text, 500) || null,
        cleanText(input.caption, 5000) || null,
        cleanText(input.credit, 255) || null,
        JSON.stringify({ provider_url: url }),
        user?.id || null,
      ]
    );
    const assetId = Number(result.insertId);
    await insertContentAudit(connection, {
      entityType: "media_asset",
      entityId: assetId,
      actionKey: "external_video_registered",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: { asset_key: assetKey, url },
    });
    await connection.commit();
    const [rows] = await pool.query(
      "SELECT * FROM public_media_assets WHERE id = ? LIMIT 1",
      [assetId]
    );
    return mapAsset(rows[0]);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function updateMediaAsset({ assetId, input = {}, user, req }) {
  const id = positiveInteger(assetId);
  if (!id) {
    throw new ContentStudioError("Invalid media asset ID.", {
      code: "INVALID_PUBLIC_MEDIA_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM public_media_assets WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const asset = rows[0];
    if (!asset || !booleanValue(asset.is_active)) {
      throw new ContentStudioError("Media asset not found.", {
        code: "PUBLIC_MEDIA_NOT_FOUND",
        statusCode: 404,
      });
    }
    const folderId =
      input.folder_id === null || input.folder_id === ""
        ? null
        : positiveInteger(input.folder_id ?? asset.folder_id);
    await assertFolder(connection, folderId);
    const visibility = normalizeVisibility(input.visibility, asset.visibility);
    const altText =
      input.alt_text === undefined
        ? asset.alt_text
        : cleanText(input.alt_text, 500) || null;
    const displayName =
      input.display_name === undefined
        ? asset.display_name
        : cleanText(input.display_name, 180) || asset.display_name;
    const caption =
      input.caption === undefined
        ? asset.caption
        : cleanText(input.caption, 5000) || null;
    const credit =
      input.credit === undefined
        ? asset.credit_text
        : cleanText(input.credit, 255) || null;
    if (visibility === "public") {
      if (
        asset.processing_status !== "ready" ||
        !isSafeHttpsPublicUrl(asset.public_url)
      ) {
        throw new ContentStudioError(
          "Only processed media with an HTTPS public URL can be made public.",
          { code: "PUBLIC_MEDIA_NOT_READY", statusCode: 409 }
        );
      }
      if (asset.media_type === "image" && !altText && !asset.alt_text) {
        throw new ContentStudioError(
          "Public images require descriptive alternative text.",
          { code: "PUBLIC_MEDIA_ALT_TEXT_REQUIRED", statusCode: 409 }
        );
      }
    }
    await connection.query(
      `UPDATE public_media_assets
       SET folder_id = ?, display_name = ?, alt_text = ?, caption = ?,
           credit_text = ?, visibility = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        folderId,
        displayName,
        altText,
        caption,
        credit,
        visibility,
        id,
      ]
    );
    await insertContentAudit(connection, {
      entityType: "media_asset",
      entityId: id,
      actionKey: "media_asset_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { visibility: asset.visibility, folder_id: asset.folder_id },
      after: { visibility, folder_id: folderId },
    });
    await connection.commit();
    const [updatedRows] = await pool.query(
      "SELECT * FROM public_media_assets WHERE id = ? LIMIT 1",
      [id]
    );
    return mapAsset(updatedRows[0]);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  ALLOWED_IMAGE_FORMATS,
  ALLOWED_VISIBILITY,
  DEFAULT_VIDEO_HOSTS,
  IMAGE_WIDTHS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  generateImageVariants,
  isSafeHttpsPublicUrl,
  listMediaAssets,
  mapAsset,
  normalizeFileName,
  normalizeVisibility,
  registerExternalVideo,
  safeExternalVideoUrl,
  updateMediaAsset,
  uploadImage,
  videoHosts,
};
