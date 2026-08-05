"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  cleanText,
  insertContentAudit,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");

const SUBMISSION_STATUSES = Object.freeze([
  "new",
  "in_review",
  "awaiting_customer",
  "resolved",
  "rejected",
  "spam",
  "archived",
]);
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_REVIEW_NOTE_LENGTH = 5000;

const STATUS_TRANSITIONS = Object.freeze({
  new: Object.freeze([
    "in_review",
    "awaiting_customer",
    "resolved",
    "rejected",
    "spam",
    "archived",
  ]),
  in_review: Object.freeze([
    "awaiting_customer",
    "resolved",
    "rejected",
    "spam",
    "archived",
  ]),
  awaiting_customer: Object.freeze([
    "in_review",
    "resolved",
    "rejected",
    "spam",
    "archived",
  ]),
  resolved: Object.freeze(["in_review", "archived"]),
  rejected: Object.freeze(["in_review", "archived"]),
  spam: Object.freeze(["in_review", "archived"]),
  archived: Object.freeze(["in_review"]),
});

function normalizeSubmissionStatus(value) {
  const status = cleanText(value, 40).toLowerCase();
  return SUBMISSION_STATUSES.includes(status) ? status : null;
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, MAX_LIMIT);
}

function normalizeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function assertStatusTransition(currentStatus, nextStatus) {
  const current = normalizeSubmissionStatus(currentStatus);
  const next = normalizeSubmissionStatus(nextStatus);

  if (!current || !next) {
    throw new ContentStudioError("Choose a valid enquiry status.", {
      code: "INVALID_SUBMISSION_STATUS",
      statusCode: 400,
    });
  }

  if (current === next) return true;

  if (!(STATUS_TRANSITIONS[current] || []).includes(next)) {
    throw new ContentStudioError(
      `An enquiry cannot move directly from ${current} to ${next}.`,
      {
        code: "INVALID_SUBMISSION_STATUS_TRANSITION",
        statusCode: 409,
      }
    );
  }

  return true;
}

function redactSubmissionFile(row) {
  return {
    id: row.id,
    field_key: row.field_key || null,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    file_size_bytes: Number(row.file_size_bytes || 0),
    checksum_sha256: row.checksum_sha256 || null,
    security_status: row.security_status,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
  };
}

async function listSubmissions({
  status,
  formId,
  assignedTo,
  search,
  limit,
  offset,
} = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const filters = [];
  const values = [];

  if (status) {
    const safeStatus = normalizeSubmissionStatus(status);
    if (!safeStatus) {
      throw new ContentStudioError("Choose a valid enquiry status.", {
        code: "INVALID_SUBMISSION_STATUS",
        statusCode: 400,
      });
    }
    filters.push("s.submission_status = ?");
    values.push(safeStatus);
  }

  if (formId) {
    const safeFormId = positiveInteger(formId);
    if (!safeFormId) {
      throw new ContentStudioError("Invalid form ID.", {
        code: "INVALID_FORM_ID",
        statusCode: 400,
      });
    }
    filters.push("s.form_id = ?");
    values.push(safeFormId);
  }

  if (assignedTo) {
    const safeAssignedTo = positiveInteger(assignedTo);
    if (!safeAssignedTo) {
      throw new ContentStudioError("Invalid assigned user ID.", {
        code: "INVALID_ASSIGNED_USER",
        statusCode: 400,
      });
    }
    filters.push("s.assigned_to = ?");
    values.push(safeAssignedTo);
  }

  const searchText = cleanText(search, 120);
  if (searchText) {
    const like = `%${searchText}%`;
    filters.push(
      "(s.reference_code LIKE ? OR s.full_name LIKE ? OR s.email LIKE ? OR s.phone LIKE ? OR s.company_name LIKE ?)"
    );
    values.push(like, like, like, like, like);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [rowsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           s.id,
           s.reference_code,
           s.submission_status,
           s.full_name,
           s.email,
           s.phone,
           s.company_name,
           s.consent_given,
           s.source_page_slug,
           s.assigned_to,
           s.reviewed_by,
           s.reviewed_at,
           s.resolved_at,
           s.created_at,
           s.updated_at,
           f.id AS form_id,
           f.form_key,
           f.name AS form_name,
           f.form_type,
           assignee.full_name AS assigned_to_name,
           reviewer.full_name AS reviewed_by_name,
           (SELECT COUNT(*)
            FROM public_form_submission_files sf
            WHERE sf.submission_id = s.id) AS file_count
         FROM public_form_submissions s
         JOIN public_forms f ON f.id = s.form_id
         LEFT JOIN users assignee ON assignee.id = s.assigned_to
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         ${where}
         ORDER BY
           FIELD(s.submission_status, 'new', 'in_review', 'awaiting_customer', 'resolved', 'rejected', 'spam', 'archived'),
           s.created_at DESC,
           s.id DESC
         LIMIT ? OFFSET ?`,
        [...values, safeLimit, safeOffset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM public_form_submissions s
         JOIN public_forms f ON f.id = s.form_id
         ${where}`,
        values
      ),
    ]);

    return {
      items: rowsResult[0].map((row) => ({
        ...row,
        consent_given: Number(row.consent_given) === 1,
        file_count: Number(row.file_count || 0),
      })),
      total: Number(countResult[0][0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function getSubmissionDetails(submissionId) {
  const id = positiveInteger(submissionId);
  if (!id) {
    throw new ContentStudioError("Invalid enquiry ID.", {
      code: "INVALID_SUBMISSION_ID",
      statusCode: 400,
    });
  }

  try {
    const [submissionResult, filesResult, auditResult] = await Promise.all([
      pool.query(
        `SELECT
           s.*,
           f.form_key,
           f.name AS form_name,
           f.form_type,
           assignee.full_name AS assigned_to_name,
           reviewer.full_name AS reviewed_by_name
         FROM public_form_submissions s
         JOIN public_forms f ON f.id = s.form_id
         LEFT JOIN users assignee ON assignee.id = s.assigned_to
         LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
         WHERE s.id = ?
         LIMIT 1`,
        [id]
      ),
      pool.query(
        `SELECT
           id,
           field_key,
           original_filename,
           mime_type,
           file_size_bytes,
           checksum_sha256,
           security_status,
           reviewed_by,
           reviewed_at,
           created_at
         FROM public_form_submission_files
         WHERE submission_id = ?
         ORDER BY created_at, id`,
        [id]
      ),
      pool.query(
        `SELECT
           id,
           action_key,
           actor_user_id,
           request_id,
           metadata_json,
           created_at
         FROM public_content_audit_log
         WHERE entity_type = 'form_submission'
           AND entity_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [id]
      ),
    ]);

    const submission = submissionResult[0][0];
    if (!submission) {
      throw new ContentStudioError("Enquiry not found.", {
        code: "CONTENT_SUBMISSION_NOT_FOUND",
        statusCode: 404,
      });
    }

    return {
      submission: {
        ...submission,
        response_json: parseJson(submission.response_json, {}),
        consent_given: Number(submission.consent_given) === 1,
        ip_hash: undefined,
        user_agent: undefined,
      },
      files: filesResult[0].map(redactSubmissionFile),
      history: auditResult[0].map((row) => ({
        ...row,
        metadata_json: parseJson(row.metadata_json, {}),
      })),
    };
  } catch (error) {
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  }
}

async function loadSubmissionForUpdate(connection, submissionId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_form_submissions
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [submissionId]
  );

  if (!rows[0]) {
    throw new ContentStudioError("Enquiry not found.", {
      code: "CONTENT_SUBMISSION_NOT_FOUND",
      statusCode: 404,
    });
  }

  return rows[0];
}

async function writeSubmissionPlatformAudit(
  connection,
  req,
  action,
  submissionId,
  metadata
) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE Content Studio ${action}`,
    entityType: "public_form_submission",
    entityId: submissionId,
    actionType: action,
    metadata,
  });
}

async function assignSubmission({ submissionId, assignedTo, user, req }) {
  const id = positiveInteger(submissionId);
  const assigneeId = positiveInteger(assignedTo);
  if (!id || !assigneeId) {
    throw new ContentStudioError("A valid enquiry and staff member are required.", {
      code: "INVALID_SUBMISSION_ASSIGNMENT",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const submission = await loadSubmissionForUpdate(connection, id);

    await connection.query(
      `UPDATE public_form_submissions
       SET assigned_to = ?,
           submission_status = CASE
             WHEN submission_status = 'new' THEN 'in_review'
             ELSE submission_status
           END,
           updated_at = NOW()
       WHERE id = ?`,
      [assigneeId, id]
    );

    await insertContentAudit(connection, {
      entityType: "form_submission",
      entityId: id,
      actionKey: "submission_assigned",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        assigned_to: submission.assigned_to,
        submission_status: submission.submission_status,
      },
      after: {
        assigned_to: assigneeId,
        submission_status:
          submission.submission_status === "new"
            ? "in_review"
            : submission.submission_status,
      },
    });
    await writeSubmissionPlatformAudit(
      connection,
      req,
      "PUBLIC_SUBMISSION_ASSIGNED",
      id,
      { assigned_to: assigneeId }
    );

    await connection.commit();
    return getSubmissionDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function addSubmissionReview({
  submissionId,
  note,
  nextStatus = "in_review",
  user,
  req,
}) {
  const id = positiveInteger(submissionId);
  const reviewNote = cleanText(note, MAX_REVIEW_NOTE_LENGTH);
  const status = normalizeSubmissionStatus(nextStatus);

  if (!id || !reviewNote || !status) {
    throw new ContentStudioError(
      "A valid enquiry, review note and status are required.",
      {
        code: "INVALID_SUBMISSION_REVIEW",
        statusCode: 400,
      }
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const submission = await loadSubmissionForUpdate(connection, id);
    assertStatusTransition(submission.submission_status, status);

    const resolvedAt = ["resolved", "rejected", "spam"].includes(status)
      ? new Date()
      : null;

    await connection.query(
      `UPDATE public_form_submissions
       SET submission_status = ?,
           reviewed_by = ?,
           review_notes = ?,
           reviewed_at = NOW(),
           resolved_at = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [status, user?.id || null, reviewNote, resolvedAt, id]
    );

    await insertContentAudit(connection, {
      entityType: "form_submission",
      entityId: id,
      actionKey: "submission_review_recorded",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        submission_status: submission.submission_status,
        reviewed_by: submission.reviewed_by,
      },
      after: {
        submission_status: status,
        reviewed_by: user?.id || null,
        review_note: reviewNote,
        resolved_at: resolvedAt,
      },
    });
    await writeSubmissionPlatformAudit(
      connection,
      req,
      "PUBLIC_SUBMISSION_REVIEW_RECORDED",
      id,
      { submission_status: status }
    );

    await connection.commit();
    return getSubmissionDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function changeSubmissionStatus({ submissionId, status, reason, user, req }) {
  const id = positiveInteger(submissionId);
  const nextStatus = normalizeSubmissionStatus(status);
  const cleanReason = cleanText(reason, MAX_REVIEW_NOTE_LENGTH);

  if (!id || !nextStatus) {
    throw new ContentStudioError("A valid enquiry status is required.", {
      code: "INVALID_SUBMISSION_STATUS",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const submission = await loadSubmissionForUpdate(connection, id);
    assertStatusTransition(submission.submission_status, nextStatus);

    const resolvedAt = ["resolved", "rejected", "spam"].includes(nextStatus)
      ? new Date()
      : null;

    await connection.query(
      `UPDATE public_form_submissions
       SET submission_status = ?,
           reviewed_by = COALESCE(reviewed_by, ?),
           review_notes = CASE
             WHEN ? IS NULL OR ? = '' THEN review_notes
             ELSE ?
           END,
           reviewed_at = COALESCE(reviewed_at, NOW()),
           resolved_at = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        nextStatus,
        user?.id || null,
        cleanReason || null,
        cleanReason || null,
        cleanReason || null,
        resolvedAt,
        id,
      ]
    );

    await insertContentAudit(connection, {
      entityType: "form_submission",
      entityId: id,
      actionKey: "submission_status_changed",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { submission_status: submission.submission_status },
      after: {
        submission_status: nextStatus,
        reason: cleanReason || null,
        resolved_at: resolvedAt,
      },
    });
    await writeSubmissionPlatformAudit(
      connection,
      req,
      "PUBLIC_SUBMISSION_STATUS_CHANGED",
      id,
      { submission_status: nextStatus, reason: cleanReason || null }
    );

    await connection.commit();
    return getSubmissionDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_REVIEW_NOTE_LENGTH,
  STATUS_TRANSITIONS,
  SUBMISSION_STATUSES,
  addSubmissionReview,
  assertStatusTransition,
  assignSubmission,
  changeSubmissionStatus,
  clampLimit,
  getSubmissionDetails,
  listSubmissions,
  normalizeOffset,
  normalizeSubmissionStatus,
  parseJson,
  redactSubmissionFile,
};
