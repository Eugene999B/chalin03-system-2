"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  booleanValue,
  cleanText,
  insertContentAudit,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  ALLOWED_VISIBILITY,
  isSafeHttpsPublicUrl,
  mapAsset,
} = require("./contentStudioMediaService");
const {
  assertMediaUnused,
} = require("./contentStudioMediaUsageService");

const MAX_BULK_MEDIA_ASSETS = 50;

function normalizeAssetIds(value) {
  if (!Array.isArray(value)) {
    throw new ContentStudioError("Choose media assets for the bulk action.", {
      code: "PUBLIC_MEDIA_BULK_IDS_REQUIRED",
      statusCode: 400,
    });
  }
  const ids = [...new Set(value.map(positiveInteger).filter(Boolean))];
  if (!ids.length) {
    throw new ContentStudioError("Choose at least one valid media asset.", {
      code: "PUBLIC_MEDIA_BULK_IDS_REQUIRED",
      statusCode: 400,
    });
  }
  if (ids.length > MAX_BULK_MEDIA_ASSETS) {
    throw new ContentStudioError(
      `Bulk media actions are limited to ${MAX_BULK_MEDIA_ASSETS} assets at a time.`,
      {
        code: "PUBLIC_MEDIA_BULK_LIMIT_EXCEEDED",
        statusCode: 400,
      }
    );
  }
  return ids;
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

async function assertFolder(connection, folderId) {
  if (folderId === null) return;
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

async function loadLockedAssets(connection, ids) {
  const [rows] = await connection.query(
    `SELECT * FROM public_media_assets
     WHERE id IN (${placeholders(ids.length)})
     ORDER BY id ASC
     FOR UPDATE`,
    ids
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const unavailable = ids.filter((id) => {
    const row = byId.get(id);
    return !row || !booleanValue(row.is_active) || row.processing_status === "archived";
  });
  if (unavailable.length) {
    throw new ContentStudioError(
      "One or more selected media assets are no longer available.",
      {
        code: "PUBLIC_MEDIA_BULK_ASSET_UNAVAILABLE",
        statusCode: 409,
        details: unavailable.map((id) => ({ asset_id: id })),
      }
    );
  }
  return ids.map((id) => byId.get(id));
}

function normalizeBulkUpdate(input = {}) {
  const folderProvided = Object.prototype.hasOwnProperty.call(input, "folder_id");
  const visibilityProvided = Object.prototype.hasOwnProperty.call(input, "visibility");
  if (!folderProvided && !visibilityProvided) {
    throw new ContentStudioError(
      "Choose a folder or visibility change for the selected assets.",
      { code: "PUBLIC_MEDIA_BULK_CHANGE_REQUIRED", statusCode: 400 }
    );
  }

  let folderId;
  if (folderProvided) {
    if (input.folder_id === null || input.folder_id === "") {
      folderId = null;
    } else {
      folderId = positiveInteger(input.folder_id);
      if (!folderId) {
        throw new ContentStudioError("Choose a valid media folder.", {
          code: "PUBLIC_MEDIA_FOLDER_NOT_FOUND",
          statusCode: 400,
        });
      }
    }
  }

  let visibility;
  if (visibilityProvided) {
    visibility = cleanText(input.visibility, 30).toLowerCase();
    if (!ALLOWED_VISIBILITY.includes(visibility)) {
      throw new ContentStudioError("Choose a valid media visibility.", {
        code: "PUBLIC_MEDIA_VISIBILITY_INVALID",
        statusCode: 400,
      });
    }
  }

  return { folderProvided, folderId, visibilityProvided, visibility };
}

function assertCanBecomePublic(asset) {
  if (
    asset.processing_status !== "ready" ||
    !isSafeHttpsPublicUrl(asset.public_url)
  ) {
    throw new ContentStudioError(
      `Asset ${asset.asset_key || asset.id} is not ready for public delivery.`,
      {
        code: "PUBLIC_MEDIA_BULK_NOT_READY",
        statusCode: 409,
        details: [{ asset_id: Number(asset.id), asset_key: asset.asset_key }],
      }
    );
  }
  if (asset.media_type === "image" && !cleanText(asset.alt_text, 500)) {
    throw new ContentStudioError(
      `Asset ${asset.asset_key || asset.id} needs alternative text before it can be public.`,
      {
        code: "PUBLIC_MEDIA_BULK_ALT_TEXT_REQUIRED",
        statusCode: 409,
        details: [{ asset_id: Number(asset.id), asset_key: asset.asset_key }],
      }
    );
  }
}

async function bulkUpdateMediaAssets({ input = {}, user, req }) {
  const ids = normalizeAssetIds(input.asset_ids);
  const change = normalizeBulkUpdate(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (change.folderProvided) await assertFolder(connection, change.folderId);
    const assets = await loadLockedAssets(connection, ids);
    if (change.visibilityProvided && change.visibility === "public") {
      for (const asset of assets) assertCanBecomePublic(asset);
    }

    const assignments = [];
    const values = [];
    if (change.folderProvided) {
      assignments.push("folder_id = ?");
      values.push(change.folderId);
    }
    if (change.visibilityProvided) {
      assignments.push("visibility = ?");
      values.push(change.visibility);
    }
    assignments.push("updated_at = UTC_TIMESTAMP()");
    await connection.query(
      `UPDATE public_media_assets
       SET ${assignments.join(", ")}
       WHERE id IN (${placeholders(ids.length)})`,
      [...values, ...ids]
    );

    for (const asset of assets) {
      const after = {
        folder_id: change.folderProvided ? change.folderId : asset.folder_id,
        visibility: change.visibilityProvided ? change.visibility : asset.visibility,
      };
      await insertContentAudit(connection, {
        entityType: "media_asset",
        entityId: Number(asset.id),
        actionKey: "media_asset_bulk_updated",
        actorUserId: user?.id,
        requestId: req?.requestId,
        before: { folder_id: asset.folder_id, visibility: asset.visibility },
        after,
        metadata: { bulk_size: ids.length },
      });
      await writeAuditEvent({
        connection,
        req,
        action: "PUBLIC_MEDIA_BULK_UPDATED",
        details: `CHALIN ONE media asset ${asset.asset_key} updated in governed bulk action`,
        entityType: "public_media_asset",
        entityId: Number(asset.id),
        actionType: "PUBLIC_MEDIA_BULK_UPDATED",
        metadata: { bulk_size: ids.length, ...after },
      });
    }

    await connection.commit();
    const [updatedRows] = await pool.query(
      `SELECT * FROM public_media_assets
       WHERE id IN (${placeholders(ids.length)})
       ORDER BY id ASC`,
      ids
    );
    return {
      updated: updatedRows.length,
      items: updatedRows.map(mapAsset),
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function bulkArchiveMediaAssets({ input = {}, user, req }) {
  const ids = normalizeAssetIds(input.asset_ids);
  const reason = cleanText(input.reason, 500) || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const assets = await loadLockedAssets(connection, ids);

    // Every reference check happens before the first archive update. One used
    // asset therefore blocks the entire selection instead of causing a partial cleanup.
    for (const asset of assets) {
      await assertMediaUnused(connection, Number(asset.id));
    }

    await connection.query(
      `UPDATE public_media_assets
       SET visibility = 'private',
           processing_status = 'archived',
           is_active = 0,
           updated_at = UTC_TIMESTAMP()
       WHERE id IN (${placeholders(ids.length)})`,
      ids
    );

    for (const asset of assets) {
      await insertContentAudit(connection, {
        entityType: "media_asset",
        entityId: Number(asset.id),
        actionKey: "media_asset_bulk_archived",
        actorUserId: user?.id,
        requestId: req?.requestId,
        before: {
          visibility: asset.visibility,
          processing_status: asset.processing_status,
          is_active: true,
        },
        after: {
          visibility: "private",
          processing_status: "archived",
          is_active: false,
        },
        metadata: { reason, bulk_size: ids.length },
      });
      await writeAuditEvent({
        connection,
        req,
        action: "PUBLIC_MEDIA_BULK_ARCHIVED",
        details: `CHALIN ONE media asset ${asset.asset_key} archived in governed bulk cleanup`,
        entityType: "public_media_asset",
        entityId: Number(asset.id),
        actionType: "PUBLIC_MEDIA_BULK_ARCHIVED",
        metadata: { reason, bulk_size: ids.length, storage_deleted: false },
      });
    }

    await connection.commit();
    return {
      archived: assets.length,
      storage_deleted: false,
      items: assets.map((asset) => ({
        id: Number(asset.id),
        asset_key: asset.asset_key,
      })),
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  MAX_BULK_MEDIA_ASSETS,
  bulkArchiveMediaAssets,
  bulkUpdateMediaAssets,
  normalizeAssetIds,
  normalizeBulkUpdate,
};
