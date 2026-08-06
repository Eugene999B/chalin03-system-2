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
const { configFor } = require("./contentStudioPortfolioSchema");
const {
  clampLimit,
  getEntityDetails,
  loadEntityForUpdate,
  loadVersionForUpdate,
  normalizeOffset,
  platformAudit,
} = require("./contentStudioPortfolioStore");

async function submitEntityVersion({
  kind,
  entityId,
  versionId,
  assignedTo,
  note,
  user,
  req,
}) {
  const id = positiveInteger(entityId);
  const draftId = positiveInteger(versionId);
  const { entityType, table } = configFor(kind);
  if (!id || !draftId) {
    throw new ContentStudioError("Invalid content entity or version ID.", {
      code: "INVALID_PORTFOLIO_VERSION_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadEntityForUpdate(connection, kind, id);
    const version = await loadVersionForUpdate(connection, kind, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError(
        "Only a draft version may be submitted for review.",
        { code: "PORTFOLIO_VERSION_NOT_DRAFT", statusCode: 409 }
      );
    }

    const [pendingRows] = await connection.query(
      `SELECT id
       FROM public_content_approvals
       WHERE entity_type = ?
         AND entity_id = ?
         AND content_version_id = ?
         AND approval_status = 'pending'
       LIMIT 1
       FOR UPDATE`,
      [entityType, id, draftId]
    );
    if (pendingRows[0]) {
      throw new ContentStudioError(
        "This version already has a pending review request.",
        { code: "PORTFOLIO_REVIEW_ALREADY_PENDING", statusCode: 409 }
      );
    }

    const [result] = await connection.query(
      `INSERT INTO public_content_approvals (
         entity_type,
         entity_id,
         content_version_id,
         request_type,
         approval_status,
         requested_by,
         assigned_to,
         request_note
       ) VALUES (?, ?, ?, 'review', 'pending', ?, ?, ?)`,
      [
        entityType,
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
      `UPDATE ${table}
       SET publication_status = CASE
             WHEN publication_status IN ('published','scheduled') THEN publication_status
             ELSE 'in_review'
           END,
           updated_by = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_review_requested`,
      actorUserId: user?.id,
      approvalId,
      requestId: req?.requestId,
      after: {
        version_id: draftId,
        approval_id: approvalId,
        assigned_to: positiveInteger(assignedTo),
      },
    });
    await platformAudit(
      connection,
      req,
      kind,
      `PUBLIC_${entityType.toUpperCase()}_REVIEW_REQUESTED`,
      id,
      { version_id: draftId, approval_id: approvalId }
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

async function decideEntityApproval({
  kind,
  approvalId,
  decision,
  note,
  user,
  req,
}) {
  const id = positiveInteger(approvalId);
  const normalizedDecision = cleanText(decision, 20).toLowerCase();
  const { entityType, table } = configFor(kind);
  if (!id || !["approved", "rejected"].includes(normalizedDecision)) {
    throw new ContentStudioError(
      "Choose Approve or Reject for a valid request.",
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
    if (!approval || approval.entity_type !== entityType) {
      throw new ContentStudioError(
        "Approval request not found for this manager.",
        { code: "CONTENT_APPROVAL_NOT_FOUND", statusCode: 404 }
      );
    }
    if (approval.approval_status !== "pending") {
      throw new ContentStudioError(
        "This approval request has already been decided.",
        { code: "CONTENT_APPROVAL_ALREADY_DECIDED", statusCode: 409 }
      );
    }
    if (Number(approval.requested_by) === Number(user?.id)) {
      throw new ContentStudioError(
        "The person who submitted this content cannot approve it.",
        { code: "CONTENT_SELF_APPROVAL_BLOCKED", statusCode: 409 }
      );
    }
    if (
      approval.assigned_to &&
      Number(approval.assigned_to) !== Number(user?.id)
    ) {
      throw new ContentStudioError(
        "This approval request is assigned to another reviewer.",
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
    await loadEntityForUpdate(connection, kind, approval.entity_id);
    const version = await loadVersionForUpdate(
      connection,
      kind,
      approval.entity_id,
      versionId
    );
    if (version.version_status !== "in_review") {
      throw new ContentStudioError(
        "The linked version is no longer awaiting review.",
        { code: "CONTENT_APPROVAL_STATE_MISMATCH", statusCode: 409 }
      );
    }

    const versionStatus =
      normalizedDecision === "approved" ? "approved" : "draft";
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = ?,
           decided_by = ?,
           decision_note = ?,
           decided_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        normalizedDecision,
        user?.id || null,
        cleanText(note, 2000) || null,
        id,
      ]
    );
    await connection.query(
      "UPDATE public_content_versions SET version_status = ? WHERE id = ?",
      [versionStatus, versionId]
    );
    await connection.query(
      `UPDATE ${table}
       SET publication_status = CASE
             WHEN publication_status IN ('published','scheduled') THEN publication_status
             ELSE ?
           END,
           approved_by = CASE
             WHEN ? = 'approved' THEN ?
             ELSE approved_by
           END,
           updated_by = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        versionStatus,
        normalizedDecision,
        user?.id || null,
        user?.id || null,
        approval.entity_id,
      ]
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: approval.entity_id,
      actionKey:
        normalizedDecision === "approved"
          ? `${entityType}_review_approved`
          : `${entityType}_review_rejected`,
      actorUserId: user?.id,
      approvalId: id,
      requestId: req?.requestId,
      before: { version_status: version.version_status },
      after: {
        version_status: versionStatus,
        approval_status: normalizedDecision,
        decision_note: cleanText(note, 2000) || null,
      },
    });
    await platformAudit(
      connection,
      req,
      kind,
      normalizedDecision === "approved"
        ? `PUBLIC_${entityType.toUpperCase()}_REVIEW_APPROVED`
        : `PUBLIC_${entityType.toUpperCase()}_REVIEW_REJECTED`,
      approval.entity_id,
      { version_id: versionId, approval_id: id }
    );
    await connection.commit();
    return getEntityDetails(kind, approval.entity_id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function listPortfolioApprovals({
  kind,
  assignedTo,
  limit,
  offset,
} = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const values = [];
  const filters = ["a.approval_status = 'pending'"];

  if (kind) {
    const { entityType } = configFor(kind);
    filters.push("a.entity_type = ?");
    values.push(entityType);
  } else {
    filters.push(
      "a.entity_type IN ('leadership_profile','project','equipment')"
    );
  }

  const assignee = positiveInteger(assignedTo);
  if (assignee) {
    filters.push("a.assigned_to = ?");
    values.push(assignee);
  }

  try {
    const [rows] = await pool.query(
      `SELECT a.*, cv.version_number, cv.change_summary, cv.snapshot_json
       FROM public_content_approvals a
       JOIN public_content_versions cv ON cv.id = a.content_version_id
       WHERE ${filters.join(" AND ")}
       ORDER BY a.requested_at, a.id
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
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
  decideEntityApproval,
  listPortfolioApprovals,
  submitEntityVersion,
};
