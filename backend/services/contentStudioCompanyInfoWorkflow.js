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
const {
  configFor,
  sanitizeSnapshot,
} = require("./contentStudioCompanyInfoSchema");
const {
  applyPublishedSnapshot,
  assertReferences,
  clampLimit,
  getEntityDetails,
  insertBaseEntity,
  insertVersion,
  loadEntityForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  normalizeOffset,
  platformAudit,
  snapshotFromRow,
} = require("./contentStudioCompanyInfoStore");

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
      throw new ContentStudioError(`${label} key, slug or reference already exists.`, {
        code: "COMPANY_INFO_ENTITY_DUPLICATE",
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
      code: "INVALID_COMPANY_INFO_ENTITY_ID",
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
    throw new ContentStudioError("Invalid company information entity or version ID.", {
      code: "INVALID_COMPANY_INFO_VERSION_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadEntityForUpdate(connection, kind, id);
    const version = await loadVersionForUpdate(connection, kind, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft version may be edited.", {
        code: "COMPANY_INFO_VERSION_NOT_EDITABLE",
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
        assertJsonSize(snapshot, "Company information snapshot"),
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
    throw new ContentStudioError("Invalid company information entity or version ID.", {
      code: "INVALID_COMPANY_INFO_VERSION_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await loadEntityForUpdate(connection, kind, id);
    const version = await loadVersionForUpdate(connection, kind, id, draftId);
    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft version may be submitted.", {
        code: "COMPANY_INFO_VERSION_NOT_DRAFT",
        statusCode: 409,
      });
    }
    const [pendingRows] = await connection.query(
      `SELECT id FROM public_content_approvals
       WHERE entity_type = ? AND entity_id = ? AND content_version_id = ?
         AND approval_status = 'pending'
       LIMIT 1 FOR UPDATE`,
      [entityType, id, draftId]
    );
    if (pendingRows[0]) {
      throw new ContentStudioError("This version already has a pending review.", {
        code: "COMPANY_INFO_REVIEW_ALREADY_PENDING",
        statusCode: 409,
      });
    }
    const [result] = await connection.query(
      `INSERT INTO public_content_approvals (
         entity_type, entity_id, content_version_id, request_type,
         approval_status, requested_by, assigned_to, request_note
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
           updated_by = ?, updated_at = UTC_TIMESTAMP()
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
      after: { version_id: draftId, approval_id: approvalId },
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

async function decideEntityApproval({ kind, approvalId, decision, note, user, req }) {
  const id = positiveInteger(approvalId);
  const normalizedDecision = cleanText(decision, 20).toLowerCase();
  const { entityType, table } = configFor(kind);
  if (!id || !["approved", "rejected"].includes(normalizedDecision)) {
    throw new ContentStudioError("Choose Approve or Reject for a valid request.", {
      code: "INVALID_APPROVAL_DECISION",
      statusCode: 400,
    });
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
      throw new ContentStudioError("Approval request not found for this manager.", {
        code: "CONTENT_APPROVAL_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (approval.approval_status !== "pending") {
      throw new ContentStudioError("This approval request has already been decided.", {
        code: "CONTENT_APPROVAL_ALREADY_DECIDED",
        statusCode: 409,
      });
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
      throw new ContentStudioError("The linked version is no longer awaiting review.", {
        code: "CONTENT_APPROVAL_STATE_MISMATCH",
        statusCode: 409,
      });
    }
    const nextStatus = normalizedDecision === "approved" ? "approved" : "draft";
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = ?, decided_by = ?, decision_note = ?,
           decided_at = UTC_TIMESTAMP() WHERE id = ?`,
      [normalizedDecision, user?.id || null, cleanText(note, 2000) || null, id]
    );
    await connection.query(
      "UPDATE public_content_versions SET version_status = ? WHERE id = ?",
      [nextStatus, versionId]
    );
    await connection.query(
      `UPDATE ${table}
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
      after: { version_status: nextStatus, approval_status: normalizedDecision },
    });
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

async function listCompanyInfoApprovals({ kind, assignedTo, limit, offset } = {}) {
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
      "a.entity_type IN ('business_division','location','company_statistic','testimonial','faq','job_vacancy','tender')"
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
    throw new ContentStudioError("Invalid company information entity or version ID.", {
      code: "INVALID_COMPANY_INFO_VERSION_ID",
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
        { code: "COMPANY_INFO_VERSION_NOT_APPROVED", statusCode: 409 }
      );
    }
    const [approvalRows] = await connection.query(
      `SELECT * FROM public_content_approvals
       WHERE entity_type = ? AND entity_id = ? AND content_version_id = ?
         AND approval_status = 'approved'
       ORDER BY decided_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [entityType, id, approvedVersionId]
    );
    const approval = approvalRows[0];
    if (!approval) {
      throw new ContentStudioError(
        "Publishing requires an approved human review record.",
        { code: "APPROVED_REVIEW_REQUIRED", statusCode: 409 }
      );
    }
    const snapshot = sanitizeSnapshot(kind, parseJson(version.snapshot_json, {}));
    if (publishAt !== undefined) snapshot.publish_at = normalizeDateTime(publishAt);
    if (expiresAt !== undefined) snapshot.expires_at = normalizeDateTime(expiresAt);
    validatePublishingWindow(snapshot.publish_at, snapshot.expires_at);
    await assertReferences(connection, kind, snapshot, { publicReady: true });
    if (snapshot.publish_at && new Date(snapshot.publish_at).getTime() > Date.now()) {
      throw new ContentStudioError(
        "Scheduled company-information publication remains disabled until the version-aware scheduler is accepted.",
        { code: "COMPANY_INFO_SCHEDULING_NOT_READY", statusCode: 409 }
      );
    }
    snapshot.publish_at = snapshot.publish_at || new Date();
    await applyPublishedSnapshot(
      connection,
      kind,
      id,
      snapshot,
      approval,
      user?.id
    );
    await connection.query(
      `UPDATE public_content_versions SET version_status = 'superseded'
       WHERE entity_type = ? AND entity_id = ? AND id <> ?
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
      after: { publication_status: "published", version_id: approvedVersionId },
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
      throw new ContentStudioError(`${label} key, slug or reference already exists.`, {
        code: "COMPANY_INFO_ENTITY_DUPLICATE",
        statusCode: 409,
      });
    }
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function restoreEntityVersion({ kind, entityId, versionId, reason, user, req }) {
  const id = positiveInteger(entityId);
  const sourceVersionId = positiveInteger(versionId);
  const { entityType } = configFor(kind);
  if (!id || !sourceVersionId) {
    throw new ContentStudioError("Invalid company information entity or version ID.", {
      code: "INVALID_COMPANY_INFO_VERSION_ID",
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
    const snapshot = sanitizeSnapshot(kind, parseJson(source.snapshot_json, {}));
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
      cleanText(reason, 500) || `Restored from version ${source.version_number}`,
      user?.id
    );
    await insertContentAudit(connection, {
      entityType,
      entityId: id,
      actionKey: `${entityType}_version_restored_as_draft`,
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { source_version_id: sourceVersionId },
      after: { version_id: newVersionId, version_number: nextVersion },
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

async function assertArchiveDependencies(connection, kind, entityId) {
  if (kind === "division") {
    const activeQueries = [
      ["public_locations", "division_id"],
      ["public_projects", "division_id"],
      ["public_equipment_catalogue", "division_id"],
      ["public_job_vacancies", "division_id"],
      ["public_tenders", "division_id"],
    ];
    for (const [table, column] of activeQueries) {
      const [rows] = await connection.query(
        `SELECT id FROM ${table}
         WHERE ${column} = ? AND publication_status <> 'archived'
         LIMIT 1 FOR UPDATE`,
        [entityId]
      );
      if (rows[0]) {
        throw new ContentStudioError(
          "This division is still used by active public content and cannot be archived.",
          { code: "PUBLIC_DIVISION_IN_USE", statusCode: 409 }
        );
      }
    }
    const [versionRows] = await connection.query(
      `SELECT id FROM public_content_versions
       WHERE entity_type IN ('location','project','equipment','job_vacancy','tender')
         AND version_status IN ('draft','in_review','approved','published')
         AND JSON_CONTAINS(snapshot_json, JSON_OBJECT('division_id', ?))
       LIMIT 1 FOR UPDATE`,
      [entityId]
    );
    if (versionRows[0]) {
      throw new ContentStudioError(
        "This division is still referenced by an unpublished content version.",
        { code: "PUBLIC_DIVISION_IN_USE", statusCode: 409 }
      );
    }
  }
  if (kind === "location") {
    const [rows] = await connection.query(
      `SELECT id FROM public_job_vacancies
       WHERE location_id = ? AND publication_status <> 'archived'
       LIMIT 1 FOR UPDATE`,
      [entityId]
    );
    if (rows[0]) {
      throw new ContentStudioError(
        "This location is still used by an active vacancy and cannot be archived.",
        { code: "PUBLIC_LOCATION_IN_USE", statusCode: 409 }
      );
    }
    const [versionRows] = await connection.query(
      `SELECT id FROM public_content_versions
       WHERE entity_type = 'job_vacancy'
         AND version_status IN ('draft','in_review','approved','published')
         AND JSON_CONTAINS(snapshot_json, JSON_OBJECT('location_id', ?))
       LIMIT 1 FOR UPDATE`,
      [entityId]
    );
    if (versionRows[0]) {
      throw new ContentStudioError(
        "This location is still referenced by an unpublished vacancy version.",
        { code: "PUBLIC_LOCATION_IN_USE", statusCode: 409 }
      );
    }
  }
}

async function archiveEntity({ kind, entityId, reason, user, req }) {
  const id = positiveInteger(entityId);
  const { entityType, table, label } = configFor(kind);
  if (!id) {
    throw new ContentStudioError(`Invalid ${label.toLowerCase()} ID.`, {
      code: "INVALID_COMPANY_INFO_ENTITY_ID",
      statusCode: 400,
    });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const entity = await loadEntityForUpdate(connection, kind, id);
    await assertArchiveDependencies(connection, kind, id);
    await connection.query(
      `UPDATE ${table}
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
      [entityType, id]
    );
    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = 'cancelled', decided_by = ?,
           decision_note = COALESCE(decision_note, ?),
           decided_at = COALESCE(decided_at, UTC_TIMESTAMP())
       WHERE entity_type = ? AND entity_id = ? AND approval_status = 'pending'`,
      [
        user?.id || null,
        cleanText(reason, 500) || `${label} archived`,
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
  assertArchiveDependencies,
  createEntityDraft,
  createEntityVersion,
  decideEntityApproval,
  listCompanyInfoApprovals,
  publishEntityVersion,
  restoreEntityVersion,
  submitEntityVersion,
  updateEntityDraft,
};
