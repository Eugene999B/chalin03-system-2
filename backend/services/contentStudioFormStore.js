"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  assertJsonSize,
  cleanText,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const { sanitizeFormSnapshot } = require("./contentStudioFormSchema");

const FORM_ENTITY_TYPE = "public_form";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function clampLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? Math.min(number, MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function normalizeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

async function loadFields(connection, formId) {
  const [rows] = await connection.query(
    `SELECT field_key, field_type, label, placeholder, help_text,
            is_required, options_json, validation_json, sort_order
     FROM public_form_fields
     WHERE form_id = ? AND is_active = 1
     ORDER BY sort_order, id`,
    [formId]
  );
  return rows.map((row) => ({
    field_key: row.field_key,
    field_type: row.field_type,
    label: row.label,
    placeholder: row.placeholder || null,
    help_text: row.help_text || null,
    is_required: Boolean(Number(row.is_required)),
    options: parseJson(row.options_json, []),
    validation: parseJson(row.validation_json, {}),
    sort_order: Number(row.sort_order || 0),
  }));
}

function snapshotFromRow(row, fields) {
  return sanitizeFormSnapshot({}, {
    ...row,
    settings: parseJson(row.settings_json, {}),
    fields,
  });
}

async function loadFormForUpdate(connection, formId) {
  const [rows] = await connection.query(
    "SELECT * FROM public_forms WHERE id = ? LIMIT 1 FOR UPDATE",
    [formId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Public form not found.", {
      code: "PUBLIC_FORM_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function loadLatestVersion(connection, formId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT * FROM public_content_versions
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY version_number DESC, id DESC
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [FORM_ENTITY_TYPE, formId]
  );
  return rows[0] || null;
}

async function loadVersionForUpdate(connection, formId, versionId) {
  const [rows] = await connection.query(
    `SELECT * FROM public_content_versions
     WHERE id = ? AND entity_type = ? AND entity_id = ?
     LIMIT 1 FOR UPDATE`,
    [versionId, FORM_ENTITY_TYPE, formId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Public form version not found.", {
      code: "PUBLIC_FORM_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function insertVersion(
  connection,
  formId,
  versionNumber,
  snapshot,
  summary,
  userId
) {
  const [result] = await connection.query(
    `INSERT INTO public_content_versions (
       entity_type, entity_id, version_number, version_status,
       snapshot_json, change_summary, created_by
     ) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    [
      FORM_ENTITY_TYPE,
      formId,
      versionNumber,
      assertJsonSize(snapshot, "Public form snapshot"),
      cleanText(summary, 500) || `Public form draft version ${versionNumber}`,
      userId || null,
    ]
  );
  return Number(result.insertId);
}

async function replaceFields(connection, formId, fields) {
  await connection.query("DELETE FROM public_form_fields WHERE form_id = ?", [
    formId,
  ]);
  for (const field of fields) {
    await connection.query(
      `INSERT INTO public_form_fields (
         form_id, field_key, field_type, label, placeholder, help_text,
         is_required, options_json, validation_json, sort_order, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        formId,
        field.field_key,
        field.field_type,
        field.label,
        field.placeholder,
        field.help_text,
        field.is_required ? 1 : 0,
        assertJsonSize(field.options, "Public form field options"),
        assertJsonSize(field.validation, "Public form field validation"),
        field.sort_order,
      ]
    );
  }
}

async function platformAudit(connection, req, action, formId, metadata) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE public form ${action}`,
    entityType: "public_form",
    entityId: formId,
    actionType: action,
    metadata,
  });
}

async function listForms(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const filters = [];
  const values = [];
  const status = cleanText(options.status, 40).toLowerCase();
  if (status) {
    const allowed = [
      "draft",
      "in_review",
      "approved",
      "scheduled",
      "published",
      "expired",
      "archived",
    ];
    if (!allowed.includes(status)) return { items: [], total: 0, limit, offset };
    filters.push("f.publication_status = ?");
    values.push(status);
  }
  const search = cleanText(options.search, 120);
  if (search) {
    filters.push("(f.name LIKE ? OR f.slug LIKE ? OR f.form_type LIKE ?)");
    const like = `%${search}%`;
    values.push(like, like, like);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [[rows], [countRows]] = await Promise.all([
      pool.query(
        `SELECT f.*,
                (SELECT COUNT(*) FROM public_form_fields ff
                 WHERE ff.form_id = f.id AND ff.is_active = 1) AS field_count,
                latest.id AS latest_version_id,
                latest.version_number AS latest_version_number,
                latest.version_status AS latest_version_status,
                latest.change_summary AS latest_change_summary
         FROM public_forms f
         LEFT JOIN public_content_versions latest
           ON latest.id = (
             SELECT cv.id FROM public_content_versions cv
             WHERE cv.entity_type = ? AND cv.entity_id = f.id
             ORDER BY cv.version_number DESC, cv.id DESC LIMIT 1
           )
         ${where}
         ORDER BY f.updated_at DESC, f.id DESC
         LIMIT ? OFFSET ?`,
        [FORM_ENTITY_TYPE, ...values, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) AS total FROM public_forms f ${where}`, values),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        field_count: Number(row.field_count || 0),
        settings: parseJson(row.settings_json, {}),
        settings_json: undefined,
      })),
      total: Number(countRows[0]?.total || 0),
      limit,
      offset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function getFormDetails(formId) {
  const id = positiveInteger(formId);
  if (!id) {
    throw new ContentStudioError("Invalid public form ID.", {
      code: "INVALID_PUBLIC_FORM_ID",
      statusCode: 400,
    });
  }
  try {
    const [[formRows], [versions], [approvals], fields] = await Promise.all([
      pool.query("SELECT * FROM public_forms WHERE id = ? LIMIT 1", [id]),
      pool.query(
        `SELECT id, version_number, version_status, snapshot_json,
                change_summary, created_by, created_at
         FROM public_content_versions
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY version_number DESC, id DESC`,
        [FORM_ENTITY_TYPE, id]
      ),
      pool.query(
        `SELECT id, content_version_id, request_type, approval_status,
                requested_by, assigned_to, decided_by, request_note,
                decision_note, requested_at, expires_at, decided_at, executed_at
         FROM public_content_approvals
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY requested_at DESC, id DESC`,
        [FORM_ENTITY_TYPE, id]
      ),
      loadFields(pool, id),
    ]);
    if (!formRows[0]) {
      throw new ContentStudioError("Public form not found.", {
        code: "PUBLIC_FORM_NOT_FOUND",
        statusCode: 404,
      });
    }
    return {
      form: formRows[0],
      current_snapshot: snapshotFromRow(formRows[0], fields),
      fields,
      versions: versions.map((row) => ({
        ...row,
        snapshot: parseJson(row.snapshot_json, {}),
        snapshot_json: undefined,
      })),
      approvals,
    };
  } catch (error) {
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  DEFAULT_LIMIT,
  FORM_ENTITY_TYPE,
  MAX_LIMIT,
  clampLimit,
  getFormDetails,
  insertVersion,
  listForms,
  loadFields,
  loadFormForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  normalizeOffset,
  platformAudit,
  replaceFields,
  snapshotFromRow,
};
