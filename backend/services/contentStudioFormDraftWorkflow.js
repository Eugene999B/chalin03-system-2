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
const { sanitizeFormSnapshot } = require("./contentStudioFormSchema");
const {
  FORM_ENTITY_TYPE,
  getFormDetails,
  insertVersion,
  loadFields,
  loadFormForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  platformAudit,
  replaceFields,
  snapshotFromRow,
} = require("./contentStudioFormStore");

async function createFormDraft({ input = {}, user, req }) {
  const snapshot = sanitizeFormSnapshot(input);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO public_forms (
         form_key, slug, name, form_type, description, confirmation_message,
         settings_json, publication_status, publish_at, expires_at,
         created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
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
        user?.id || null,
        user?.id || null,
      ]
    );
    const formId = Number(result.insertId);
    await replaceFields(connection, formId, snapshot.fields);
    const versionId = await insertVersion(
      connection,
      formId,
      1,
      snapshot,
      input.change_summary || "Initial public form draft",
      user?.id
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: formId,
      actionKey: "public_form_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: { version_id: versionId, field_count: snapshot.fields.length },
    });
    await platformAudit(connection, req, "PUBLIC_FORM_CREATED", formId, {
      version_id: versionId,
    });
    await connection.commit();
    return getFormDetails(formId);
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

async function createFormVersion({ formId, input = {}, user, req }) {
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
    const fields = await loadFields(connection, id);
    const latest = await loadLatestVersion(connection, id, true);
    const current = snapshotFromRow(form, fields);
    const base = latest ? parseJson(latest.snapshot_json, current) : current;
    const snapshot = sanitizeFormSnapshot(input, base);
    if (!Object.prototype.hasOwnProperty.call(input, "publish_at")) {
      snapshot.publish_at = null;
    }
    if (!Object.prototype.hasOwnProperty.call(input, "expires_at")) {
      snapshot.expires_at = null;
    }
    const nextVersion = Number(latest?.version_number || 0) + 1;
    const versionId = await insertVersion(
      connection,
      id,
      nextVersion,
      snapshot,
      input.change_summary,
      user?.id
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: id,
      actionKey: "public_form_version_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: {
        version_id: versionId,
        version_number: nextVersion,
        field_count: snapshot.fields.length,
      },
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

async function updateFormDraft({ formId, versionId, input = {}, user, req }) {
  const id = positiveInteger(formId);
  const draftId = positiveInteger(versionId);
  if (!id || !draftId) {
    throw new ContentStudioError("Invalid public form or version ID.", {
      code: "INVALID_PUBLIC_FORM_VERSION_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadFormForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft form version may be edited.", {
        code: "PUBLIC_FORM_VERSION_NOT_EDITABLE",
        statusCode: 409,
      });
    }
    const before = parseJson(version.snapshot_json, {});
    const snapshot = sanitizeFormSnapshot(input, before);
    await connection.query(
      `UPDATE public_content_versions
       SET snapshot_json = ?, change_summary = ? WHERE id = ?`,
      [
        assertJsonSize(snapshot, "Public form snapshot"),
        cleanText(input.change_summary, 500) || version.change_summary,
        draftId,
      ]
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: id,
      actionKey: "public_form_draft_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        field_count: Array.isArray(before.fields) ? before.fields.length : 0,
      },
      after: { field_count: snapshot.fields.length },
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
  createFormDraft,
  createFormVersion,
  updateFormDraft,
};
