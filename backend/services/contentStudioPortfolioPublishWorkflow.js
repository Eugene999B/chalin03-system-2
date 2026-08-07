"use strict";

const { pool } = require("../config/db");
const {
  ContentStudioError,
  cleanText,
  insertContentAudit,
  normalizeDateTime,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
  validatePublishingWindow,
} = require("./contentStudioPageService");
const { configFor, sanitizeSnapshot } = require("./contentStudioPortfolioSchema");
const {
  applyPublishedSnapshot,
  assertReferences,
  getEntityDetails,
  insertVersion,
  loadEntityForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  platformAudit,
} = require("./contentStudioPortfolioStore");

async function publishEntityVersion({
  kind,
  entityId,
  versionId,
  publishAt,
  expiresAt,
  user,
  req,
}) {
  const id = positiveInteger(entityId);
  const approvedVersionId = positiveInteger(versionId);
  const { entityType, label } = configFor(kind);
  if (!id || !approvedVersionId) {
    throw new ContentStudioError("Invalid content entity or version ID.", {
      code: "INVALID_PORTFOLIO_VERSION_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const entity = await loadEntityForUpdate(connection, kind, id);
    const version = await loadVersionForUpdate(
      connection,
      kind,
      id,
      approvedVersionId
    );
    if (version.version_status !== "approved") {
      throw new ContentStudioError(
        `Only an approved ${label.toLowerCase()} version may be published.`,
        { code: "PORTFOLIO_VERSION_NOT_APPROVED", statusCode: 409 }
      );
    }

    const [approvalRows] = await connection.query(
      `SELECT *
       FROM public_content_approvals
       WHERE entity_type = ?
         AND entity_id = ?
         AND content_version_id = ?
         AND approval_status = 'approved'
       ORDER BY decided_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [entityType, id, approvedVersionId]
    );
    const approval = approvalRows[0];
    if (!approval) {
      throw new ContentStudioError(
        "Publishing requires an approved human review record.",
        { code: "APPROVED_REVIEW_REQUIRED", statusCode: 409 }
      );
    }

    const snapshot = sanitizeSnapshot(
      kind,
      parseJson(version.snapshot_json, {})
    );
    if (publishAt !== undefined) {
      snapshot.publish_at = normalizeDateTime(publishAt);
    }
    if (expiresAt !== undefined) {
      snapshot.expires_at = normalizeDateTime(expiresAt);
    }
    validatePublishingWindow(snapshot.publish_at, snapshot.expires_at);
    await assertReferences(connection, kind, snapshot, { publicReady: true });

    if (
      snapshot.publish_at &&
      new Date(snapshot.publish_at).getTime() > Date.now()
    ) {
      throw new ContentStudioError(
        "Scheduled publication for leadership, projects and equipment remains disabled until the version-aware scheduler is completed and accepted.",
        { code: "PORTFOLIO_SCHEDULING_NOT_READY", statusCode: 409 }
      );
    }
    // Immediate publication is represented by status + published_at.
    // Keep publish_at NULL unless an explicit non-future timestamp was supplied.
    snapshot.publish_at = snapshot.publish_at || null;

    await applyPublishedSnapshot(
      connection,
      kind,
      id,
      snapshot,
      "published",
      approval,
      user?.id
    );
    await connection.query(
      `UPDATE public_content_versions
       SET version_status = 'superseded'
       WHERE entity_type = ?
         AND entity_id = ?
         AND id <> ?
         AND version_status = 'published'`,
      [entityType, id, approvedVersionId]
    );
    await connection.query(
      "UPDATE public_content_versions SET version_status = 'published' WHERE id = ?",
      [approvedVersionId]
    );
    await connection.query(
      "UPDATE public_content_approvals SET executed_at = UTC_TIMESTAMP() WHERE id = ?",
      [approval.id]
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_published`,
      actorUserId: user?.id,
      approvalId: approval.id,
      requestId: req?.requestId,
      before: { publication_status: entity.publication_status },
      after: {
        publication_status: "published",
        version_id: approvedVersionId,
        snapshot,
      },
    });
    await platformAudit(
      connection,
      req,
      kind,
      `PUBLIC_${entityType.toUpperCase()}_PUBLISHED`,
      id,
      { version_id: approvedVersionId, approval_id: approval.id }
    );
    await connection.commit();
    return getEntityDetails(kind, id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(`${label} key or slug already exists.`, {
        code: "PORTFOLIO_ENTITY_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function restoreEntityVersion({
  kind,
  entityId,
  versionId,
  reason,
  user,
  req,
}) {
  const id = positiveInteger(entityId);
  const sourceVersionId = positiveInteger(versionId);
  const { entityType } = configFor(kind);
  if (!id || !sourceVersionId) {
    throw new ContentStudioError("Invalid content entity or version ID.", {
      code: "INVALID_PORTFOLIO_VERSION_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadEntityForUpdate(connection, kind, id);
    const source = await loadVersionForUpdate(
      connection,
      kind,
      id,
      sourceVersionId
    );
    const latest = await loadLatestVersion(connection, kind, id, true);
    const snapshot = sanitizeSnapshot(
      kind,
      parseJson(source.snapshot_json, {})
    );
    snapshot.publish_at = null;
    snapshot.expires_at = null;
    await assertReferences(connection, kind, snapshot);

    const nextVersion = Number(latest?.version_number || 0) + 1;
    const newVersionId = await insertVersion(
      connection,
      kind,
      id,
      nextVersion,
      snapshot,
      cleanText(reason, 500) ||
        `Restored from version ${source.version_number}`,
      user?.id
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_version_restored_as_draft`,
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        source_version_id: sourceVersionId,
        source_version_number: source.version_number,
      },
      after: {
        version_id: newVersionId,
        version_number: nextVersion,
        version_status: "draft",
      },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await platformAudit(
      connection,
      req,
      kind,
      `PUBLIC_${entityType.toUpperCase()}_VERSION_RESTORED`,
      id,
      { source_version_id: sourceVersionId, version_id: newVersionId }
    );
    await connection.commit();
    return getEntityDetails(kind, id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function archiveEntity({ kind, entityId, reason, user, req }) {
  const id = positiveInteger(entityId);
  const { entityType, table, label } = configFor(kind);
  if (!id) {
    throw new ContentStudioError(`Invalid ${label.toLowerCase()} ID.`, {
      code: "INVALID_PORTFOLIO_ENTITY_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const entity = await loadEntityForUpdate(connection, kind, id);
    await connection.query(
      `UPDATE ${table}
       SET publication_status = 'archived',
           expires_at = COALESCE(expires_at, UTC_TIMESTAMP()),
           updated_by = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await connection.query(
      `UPDATE public_content_versions
       SET version_status = CASE
             WHEN version_status IN ('draft','in_review','approved','published')
               THEN 'archived'
             ELSE version_status
           END
       WHERE entity_type = ?
         AND entity_id = ?`,
      [entityType, id]
    );
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = 'cancelled',
           decided_by = ?,
           decision_note = COALESCE(decision_note, ?),
           decided_at = COALESCE(decided_at, UTC_TIMESTAMP())
       WHERE entity_type = ?
         AND entity_id = ?
         AND approval_status = 'pending'`,
      [
        user?.id || null,
        cleanText(reason, 500) || "Content entity archived",
        entityType,
        id,
      ]
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_archived`,
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { publication_status: entity.publication_status },
      after: { publication_status: "archived" },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await platformAudit(
      connection,
      req,
      kind,
      `PUBLIC_${entityType.toUpperCase()}_ARCHIVED`,
      id,
      { reason: cleanText(reason, 500) || null }
    );
    await connection.commit();
    return getEntityDetails(kind, id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  archiveEntity,
  publishEntityVersion,
  restoreEntityVersion,
};
