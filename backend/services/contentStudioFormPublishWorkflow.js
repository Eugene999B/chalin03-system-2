"use strict";

const { pool } = require("../config/db");
const {
  ContentStudioError,
  assertJsonSize,
  cleanText,
  insertContentAudit,
  normalizeDateTime,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
  validatePublishingWindow,
} = require("./contentStudioPageService");
const { sanitizeFormSnapshot } = require("./contentStudioFormSchema");
const {
  FORM_ENTITY_TYPE,
  getFormDetails,
  insertVersion,
  loadFormForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  platformAudit,
  replaceFields,
} = require("./contentStudioFormStore");

async function publishFormVersion({ formId, versionId, publishAt, expiresAt, user, req }) {
  const id = positiveInteger(formId);
  const approvedVersionId = positiveInteger(versionId);
  if (!id || !approvedVersionId) {
    throw new ContentStudioError("Invalid public form or version ID.", {
      code: "INVALID_PUBLIC_FORM_VERSION_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const form = await loadFormForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, approvedVersionId);
    if (version.version_status !== "approved") {
      throw new ContentStudioError("Only an approved form version may be published.", {
        code: "PUBLIC_FORM_VERSION_NOT_APPROVED",
        statusCode: 409,
      });
    }
    const [approvalRows] = await connection.query(
      `SELECT * FROM public_content_approvals
       WHERE entity_type = ? AND entity_id = ? AND content_version_id = ?
         AND approval_status = 'approved'
       ORDER BY decided_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [FORM_ENTITY_TYPE, id, approvedVersionId]
    );
    const approval = approvalRows[0];
    if (!approval) {
      throw new ContentStudioError(
        "Publishing requires an approved human review record.",
        { code: "APPROVED_REVIEW_REQUIRED", statusCode: 409 }
      );
    }
    const snapshot = sanitizeFormSnapshot(parseJson(version.snapshot_json, {}));
    if (publishAt !== undefined) snapshot.publish_at = normalizeDateTime(publishAt);
    if (expiresAt !== undefined) snapshot.expires_at = normalizeDateTime(expiresAt);
    validatePublishingWindow(snapshot.publish_at, snapshot.expires_at);
    if (snapshot.publish_at && new Date(snapshot.publish_at).getTime() > Date.now()) {
      throw new ContentStudioError(
        "Scheduled public form publication remains disabled until the version-aware scheduler is accepted.",
        { code: "PUBLIC_FORM_SCHEDULING_NOT_READY", statusCode: 409 }
      );
    }
    snapshot.publish_at = snapshot.publish_at || new Date();
    await connection.query(
      `UPDATE public_forms
       SET form_key = ?, slug = ?, name = ?, form_type = ?, description = ?,
           confirmation_message = ?, settings_json = ?,
           publication_status = 'published', publish_at = ?, expires_at = ?,
           published_at = UTC_TIMESTAMP(), approved_by = ?, published_by = ?,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.form_key,
        snapshot.slug,
        snapshot.name,
        snapshot.form_type,
        snapshot.description,
        snapshot.confirmation_message,
        assertJsonSize(snapshot.settings, "Public form settings"),
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        user?.id || null,
        user?.id || null,
        id,
      ]
    );
    await replaceFields(connection, id, snapshot.fields);
    await connection.query(
      `UPDATE public_content_versions SET version_status = 'superseded'
       WHERE entity_type = ? AND entity_id = ? AND id <> ?
         AND version_status = 'published'`,
      [FORM_ENTITY_TYPE, id, approvedVersionId]
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
      entityType: FORM_ENTITY_TYPE,
      entityId: id,
      actionKey: "public_form_published",
      actorUserId: user?.id,
      approvalId: approval.id,
      requestId: req?.requestId,
      before: { publication_status: form.publication_status },
      after: {
        publication_status: "published",
        version_id: approvedVersionId,
        field_count: snapshot.fields.length,
      },
    });
    await platformAudit(connection, req, "PUBLIC_FORM_PUBLISHED", id, {
      version_id: approvedVersionId,
      approval_id: approval.id,
    });
    await connection.commit();
    return getFormDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new ContentStudioError("A form with this key or slug already exists.", {
        code: "PUBLIC_FORM_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function restoreFormVersion({ formId, versionId, reason, user, req }) {
  const id = positiveInteger(formId);
  const sourceVersionId = positiveInteger(versionId);
  if (!id || !sourceVersionId) {
    throw new ContentStudioError("Invalid public form or version ID.", {
      code: "INVALID_PUBLIC_FORM_VERSION_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadFormForUpdate(connection, id);
    const source = await loadVersionForUpdate(connection, id, sourceVersionId);
    const latest = await loadLatestVersion(connection, id, true);
    const snapshot = sanitizeFormSnapshot(parseJson(source.snapshot_json, {}));
    snapshot.publish_at = null;
    snapshot.expires_at = null;
    const nextVersion = Number(latest?.version_number || 0) + 1;
    const newVersionId = await insertVersion(
      connection,
      id,
      nextVersion,
      snapshot,
      cleanText(reason, 500) || `Restored from version ${source.version_number}`,
      user?.id
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: id,
      actionKey: "public_form_version_restored_as_draft",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { source_version_id: sourceVersionId },
      after: { version_id: newVersionId, version_number: nextVersion },
    });
    await connection.commit();
    return getFormDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function archiveForm({ formId, reason, user, req }) {
  const id = positiveInteger(formId);
  if (!id) {
    throw new ContentStudioError("Invalid public form ID.", {
      code: "INVALID_PUBLIC_FORM_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const form = await loadFormForUpdate(connection, id);
    await connection.query(
      `UPDATE public_forms
       SET publication_status = 'archived',
           expires_at = COALESCE(expires_at, UTC_TIMESTAMP()),
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await connection.query(
      `UPDATE public_content_versions
       SET version_status = CASE
             WHEN version_status IN ('draft','in_review','approved','published')
               THEN 'archived'
             ELSE version_status END
       WHERE entity_type = ? AND entity_id = ?`,
      [FORM_ENTITY_TYPE, id]
    );
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = 'cancelled', decided_by = ?,
           decision_note = COALESCE(decision_note, ?),
           decided_at = COALESCE(decided_at, UTC_TIMESTAMP())
       WHERE entity_type = ? AND entity_id = ? AND approval_status = 'pending'`,
      [
        user?.id || null,
        cleanText(reason, 500) || "Public form archived",
        FORM_ENTITY_TYPE,
        id,
      ]
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: id,
      actionKey: "public_form_archived",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { publication_status: form.publication_status },
      after: { publication_status: "archived" },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await connection.commit();
    return getFormDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  archiveForm,
  publishFormVersion,
  restoreFormVersion,
};
