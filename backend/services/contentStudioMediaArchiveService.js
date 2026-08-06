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
const { assertMediaUnused, getMediaUsage } = require("./contentStudioMediaUsageService");

async function getMediaAssetUsage(assetId) {
  const id = positiveInteger(assetId);
  if (!id) {
    throw new ContentStudioError("Invalid media asset ID.", {
      code: "INVALID_PUBLIC_MEDIA_ID",
      statusCode: 400,
    });
  }
  return getMediaUsage(pool, id);
}

async function archiveMediaAsset({ assetId, reason, user, req }) {
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
      `SELECT * FROM public_media_assets
       WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const asset = rows[0];
    if (!asset || !booleanValue(asset.is_active)) {
      throw new ContentStudioError("Media asset not found.", {
        code: "PUBLIC_MEDIA_NOT_FOUND",
        statusCode: 404,
      });
    }

    await assertMediaUnused(connection, id);
    await connection.query(
      `UPDATE public_media_assets
       SET visibility = 'private',
           processing_status = 'archived',
           is_active = 0,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [id]
    );
    await insertContentAudit(connection, {
      entityType: "media_asset",
      entityId: id,
      actionKey: "media_asset_archived",
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
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await writeAuditEvent({
      connection,
      req,
      action: "PUBLIC_MEDIA_ASSET_ARCHIVED",
      details: `CHALIN ONE media asset ${asset.asset_key} archived`,
      entityType: "public_media_asset",
      entityId: id,
      actionType: "PUBLIC_MEDIA_ASSET_ARCHIVED",
      metadata: {
        asset_key: asset.asset_key,
        reason: cleanText(reason, 500) || null,
      },
    });
    await connection.commit();
    return {
      id,
      asset_key: asset.asset_key,
      archived: true,
      storage_deleted: false,
    };
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  archiveMediaAsset,
  getMediaAssetUsage,
};
