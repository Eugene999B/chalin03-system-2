"use strict";

const { pool } = require("../config/db");
const {
  ContentStudioError,
  assertJsonSize,
  cleanText,
  insertContentAudit,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const { configFor, sanitizeSnapshot } = require("./contentStudioNewsroomSchema");
const {
  assertReferences,
  getEntityDetails,
  insertBaseEntity,
  insertVersion,
  loadEntityForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  platformAudit,
  snapshotFromRow,
} = require("./contentStudioNewsroomStore");

async function createEntityDraft({ kind, input = {}, user, req }) {
  const snapshot = sanitizeSnapshot(kind, input);
  const { entityType, label } = configFor(kind);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertReferences(connection, kind, snapshot);
    const entityId = await insertBaseEntity(
      connection,
      kind,
      snapshot,
      user?.id
    );
    const versionId = await insertVersion(
      connection,
      kind,
      entityId,
      1,
      snapshot,
      input.change_summary || `Initial ${label.toLowerCase()} draft`,
      user?.id
    );
    await insertContentAudit(connection, {
      entityType,
      entityId,
      actionKey: `${entityType}_created`,
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: { version_id: versionId, version_number: 1, snapshot },
    });
    await platformAudit(
      connection,
      req,
      kind,
      `PUBLIC_${entityType.toUpperCase()}_CREATED`,
      entityId,
      { version_id: versionId }
    );
    await connection.commit();
    return getEntityDetails(kind, entityId);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError(`${label} key or slug already exists.`, {
        code: "NEWSROOM_ENTITY_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function createEntityVersion({ kind, entityId, input = {}, user, req }) {
  const id = positiveInteger(entityId);
  const { entityType, label } = configFor(kind);
  if (!id) {
    throw new ContentStudioError(`Invalid ${label.toLowerCase()} ID.`, {
      code: "INVALID_NEWSROOM_ENTITY_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const entity = await loadEntityForUpdate(connection, kind, id);
    const latest = await loadLatestVersion(connection, kind, id, true);
    const current = snapshotFromRow(kind, entity);
    const base = latest ? parseJson(latest.snapshot_json, current) : current;
    const snapshot = sanitizeSnapshot(kind, input, base);
    if (!Object.prototype.hasOwnProperty.call(input, "publish_at")) {
      snapshot.publish_at = null;
    }
    if (!Object.prototype.hasOwnProperty.call(input, "expires_at")) {
      snapshot.expires_at = null;
    }
    await assertReferences(connection, kind, snapshot);
    const nextVersion = Number(latest?.version_number || 0) + 1;
    const versionId = await insertVersion(
      connection,
      kind,
      id,
      nextVersion,
      snapshot,
      input.change_summary,
      user?.id
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_version_created`,
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: latest
        ? { version_id: latest.id, version_number: latest.version_number }
        : null,
      after: { version_id: versionId, version_number: nextVersion, snapshot },
    });
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

async function updateEntityDraft({
  kind,
  entityId,
  versionId,
  input = {},
  user,
  req,
}) {
  const id = positiveInteger(entityId);
  const draftId = positiveInteger(versionId);
  const { entityType } = configFor(kind);
  if (!id || !draftId) {
    throw new ContentStudioError("Invalid Newsroom entity or version ID.", {
      code: "INVALID_NEWSROOM_VERSION_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadEntityForUpdate(connection, kind, id);
    const version = await loadVersionForUpdate(connection, kind, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft Newsroom version may be edited.", {
        code: "NEWSROOM_VERSION_NOT_EDITABLE",
        statusCode: 409,
      });
    }
    const before = parseJson(version.snapshot_json, {});
    const snapshot = sanitizeSnapshot(kind, input, before);
    await assertReferences(connection, kind, snapshot);
    await connection.query(
      `UPDATE public_content_versions
       SET snapshot_json = ?, change_summary = ? WHERE id = ?`,
      [
        assertJsonSize(snapshot, "Newsroom snapshot"),
        cleanText(input.change_summary, 500) || version.change_summary,
        draftId,
      ]
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_draft_updated`,
      actorUserId: user?.id,
      requestId: req?.requestId,
      before,
      after: snapshot,
    });
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
  createEntityDraft,
  createEntityVersion,
  updateEntityDraft,
};
