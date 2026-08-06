"use strict";

const { pool } = require("../config/db");
const {
  ContentStudioError,
  cleanText,
  insertContentAudit,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  FORM_ENTITY_TYPE,
  clampLimit,
  getFormDetails,
  loadFormForUpdate,
  loadVersionForUpdate,
  normalizeOffset,
} = require("./contentStudioFormStore");

async function submitFormVersion({ formId, versionId, assignedTo, note, user, req }) {
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
      throw new ContentStudioError("Only a draft form version may be submitted.", {
        code: "PUBLIC_FORM_VERSION_NOT_DRAFT",
        statusCode: 409,
      });
    }
    const [pendingRows] = await connection.query(
      `SELECT id FROM public_content_approvals
       WHERE entity_type = ? AND entity_id = ? AND content_version_id = ?
         AND approval_status = 'pending'
       LIMIT 1 FOR UPDATE`,
      [FORM_ENTITY_TYPE, id, draftId]
    );
    if (pendingRows[0]) {
      throw new ContentStudioError(
        "This form version already has a pending review.",
        { code: "PUBLIC_FORM_REVIEW_PENDING", statusCode: 409 }
      );
    }
    const [result] = await connection.query(
      `INSERT INTO public_content_approvals (
         entity_type, entity_id, content_version_id, request_type,
         approval_status, requested_by, assigned_to, request_note
       ) VALUES (?, ?, ?, 'review', 'pending', ?, ?, ?)`,
      [
        FORM_ENTITY_TYPE,
        id,
        draftId,
        user?.id || null,
        positiveInteger(assignedTo),
        cleanText(note, 2000) || null,
      ]
    );
    const approvalId = Number(result.insertId);
    await connection.query(
      "UPDATE public_content_versions SET version_status = 'in_review' WHERE id = ?",
      [draftId]
    );
    await connection.query(
      `UPDATE public_forms
       SET publication_status = CASE
             WHEN publication_status IN ('published','scheduled') THEN publication_status
             ELSE 'in_review'
           END,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: id,
      actionKey: "public_form_review_requested",
      actorUserId: user?.id,
      approvalId,
      requestId: req?.requestId,
      after: { version_id: draftId, approval_id: approvalId },
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

async function decideFormApproval({ approvalId, decision, note, user, req }) {
  const id = positiveInteger(approvalId);
  const normalizedDecision = cleanText(decision, 20).toLowerCase();
  if (!id || !["approved", "rejected"].includes(normalizedDecision)) {
    throw new ContentStudioError(
      "Choose Approve or Reject for a valid form request.",
      { code: "INVALID_APPROVAL_DECISION", statusCode: 400 }
    );
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT * FROM public_content_approvals WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    const approval = rows[0];
    if (!approval || approval.entity_type !== FORM_ENTITY_TYPE) {
      throw new ContentStudioError("Public form approval request not found.", {
        code: "CONTENT_APPROVAL_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (approval.approval_status !== "pending") {
      throw new ContentStudioError("This approval has already been decided.", {
        code: "CONTENT_APPROVAL_ALREADY_DECIDED",
        statusCode: 409,
      });
    }
    if (Number(approval.requested_by) === Number(user?.id)) {
      throw new ContentStudioError(
        "The form submitter cannot approve the same version.",
        { code: "CONTENT_SELF_APPROVAL_BLOCKED", statusCode: 409 }
      );
    }
    if (
      approval.assigned_to &&
      Number(approval.assigned_to) !== Number(user?.id)
    ) {
      throw new ContentStudioError(
        "This form review is assigned to another reviewer.",
        { code: "CONTENT_APPROVAL_ASSIGNED_ELSEWHERE", statusCode: 403 }
      );
    }
    const versionId = positiveInteger(approval.content_version_id);
    if (!versionId) {
      throw new ContentStudioError("Approval version link is incomplete.", {
        code: "CONTENT_APPROVAL_STATE_MISMATCH",
        statusCode: 409,
      });
    }
    const form = await loadFormForUpdate(connection, approval.entity_id);
    const version = await loadVersionForUpdate(
      connection,
      approval.entity_id,
      versionId
    );
    if (version.version_status !== "in_review") {
      throw new ContentStudioError(
        "The linked form version is no longer awaiting review.",
        { code: "CONTENT_APPROVAL_STATE_MISMATCH", statusCode: 409 }
      );
    }
    const nextStatus = normalizedDecision === "approved" ? "approved" : "draft";
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = ?, decided_by = ?, decision_note = ?,
           decided_at = UTC_TIMESTAMP() WHERE id = ?`,
      [
        normalizedDecision,
        user?.id || null,
        cleanText(note, 2000) || null,
        id,
      ]
    );
    await connection.query(
      "UPDATE public_content_versions SET version_status = ? WHERE id = ?",
      [nextStatus, versionId]
    );
    await connection.query(
      `UPDATE public_forms
       SET publication_status = CASE
             WHEN publication_status IN ('published','scheduled') THEN publication_status
             ELSE ?
           END,
           approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        nextStatus,
        normalizedDecision,
        user?.id || null,
        user?.id || null,
        approval.entity_id,
      ]
    );
    await insertContentAudit(connection, {
      entityType: FORM_ENTITY_TYPE,
      entityId: approval.entity_id,
      actionKey:
        normalizedDecision === "approved"
          ? "public_form_review_approved"
          : "public_form_review_rejected",
      actorUserId: user?.id,
      approvalId: id,
      requestId: req?.requestId,
      before: { publication_status: form.publication_status },
      after: { approval_status: normalizedDecision, version_status: nextStatus },
    });
    await connection.commit();
    return getFormDetails(approval.entity_id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function listFormApprovals(options = {}) {
  const limit = clampLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const values = [FORM_ENTITY_TYPE];
  let assigneeSql = "";
  const assignedTo = positiveInteger(options.assignedTo);
  if (assignedTo) {
    assigneeSql = "AND a.assigned_to = ?";
    values.push(assignedTo);
  }
  try {
    const [rows] = await pool.query(
      `SELECT a.*, cv.version_number, cv.change_summary, cv.snapshot_json
       FROM public_content_approvals a
       JOIN public_content_versions cv ON cv.id = a.content_version_id
       WHERE a.entity_type = ? AND a.approval_status = 'pending'
         ${assigneeSql}
       ORDER BY a.requested_at, a.id
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );
    return rows.map((row) => ({
      ...row,
      snapshot: parseJson(row.snapshot_json, {}),
      snapshot_json: undefined,
    }));
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

module.exports = {
  decideFormApproval,
  listFormApprovals,
  submitFormVersion,
};
