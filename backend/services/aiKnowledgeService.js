"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { normalizeEvidenceList } = require("./aiEvidenceService");
const { normalizeAiPersona } = require("../security/aiPermissionCatalog");

const SOURCE_TYPES = Object.freeze([
  "policy",
  "manual",
  "catalogue",
  "procedure",
  "faq",
  "public_content",
  "report",
  "other",
]);
const VISIBILITIES = Object.freeze([
  "public",
  "workspace",
  "restricted",
  "executive",
]);
const VERSION_STATUSES = Object.freeze([
  "draft",
  "in_review",
  "approved",
  "published",
  "superseded",
  "archived",
]);
const SOURCE_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MAX_BODY_CHARACTERS = 500000;

class AiKnowledgeError extends Error {
  constructor(message, { code = "AI_KNOWLEDGE_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiKnowledgeError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeSourceKey(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return SOURCE_KEY_PATTERN.test(key) ? key : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString().slice(0, 19).replace("T", " ");
}

function checksum(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
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

function safeJson(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value).slice(0, 32000);
  } catch {
    throw new AiKnowledgeError("Knowledge metadata must be JSON serializable.", {
      code: "AI_KNOWLEDGE_METADATA_INVALID",
    });
  }
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiKnowledgeError(
      "The CHALIN ONE AI knowledge schema is not ready in this environment.",
      { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function sanitizeSource(input = {}, fallback = {}) {
  const sourceKey = normalizeSourceKey(input.source_key ?? fallback.source_key);
  const sourceType = clean(
    input.source_type ?? fallback.source_type ?? "other",
    40
  );
  const visibility = clean(
    input.visibility ?? fallback.visibility ?? "workspace",
    40
  );
  const title = clean(input.title ?? fallback.title, 255);
  const ownerWorkspaceCode = clean(
    input.owner_workspace_code ?? fallback.owner_workspace_code,
    50
  );
  const effectiveFrom = normalizeDate(
    input.effective_from ?? fallback.effective_from
  );
  const expiresAt = normalizeDate(input.expires_at ?? fallback.expires_at);

  if (
    !sourceKey ||
    !SOURCE_TYPES.includes(sourceType) ||
    !VISIBILITIES.includes(visibility) ||
    !title
  ) {
    throw new AiKnowledgeError(
      "Knowledge source key, type, visibility and title are required.",
      { code: "AI_KNOWLEDGE_SOURCE_INVALID" }
    );
  }
  if (
    ["workspace", "restricted"].includes(visibility) &&
    !ownerWorkspaceCode
  ) {
    throw new AiKnowledgeError(
      "Workspace and restricted knowledge require an owner workspace.",
      { code: "AI_KNOWLEDGE_WORKSPACE_REQUIRED" }
    );
  }
  if (
    effectiveFrom &&
    expiresAt &&
    new Date(expiresAt) <= new Date(effectiveFrom)
  ) {
    throw new AiKnowledgeError("Knowledge expiry must be after its effective date.", {
      code: "AI_KNOWLEDGE_DATE_RANGE_INVALID",
    });
  }

  return Object.freeze({
    source_key: sourceKey,
    source_type: sourceType,
    owner_workspace_code: ownerWorkspaceCode,
    visibility,
    title,
    description: clean(input.description ?? fallback.description, 1000),
    source_reference: clean(
      input.source_reference ?? fallback.source_reference,
      500
    ),
    effective_from: effectiveFrom,
    expires_at: expiresAt,
  });
}

function sanitizeVersion(input = {}, fallback = {}) {
  const title = clean(input.title ?? fallback.title, 255);
  const bodyText = String(input.body_text ?? fallback.body_text ?? "").trim();
  const effectiveFrom = normalizeDate(
    input.effective_from ?? fallback.effective_from
  );
  const expiresAt = normalizeDate(input.expires_at ?? fallback.expires_at);

  if (!title || !bodyText) {
    throw new AiKnowledgeError("Knowledge version title and body are required.", {
      code: "AI_KNOWLEDGE_VERSION_INVALID",
    });
  }
  if (bodyText.length > MAX_BODY_CHARACTERS) {
    throw new AiKnowledgeError(
      `Knowledge body may not exceed ${MAX_BODY_CHARACTERS} characters.`,
      { code: "AI_KNOWLEDGE_BODY_TOO_LARGE", statusCode: 413 }
    );
  }
  if (
    effectiveFrom &&
    expiresAt &&
    new Date(expiresAt) <= new Date(effectiveFrom)
  ) {
    throw new AiKnowledgeError("Knowledge expiry must be after its effective date.", {
      code: "AI_KNOWLEDGE_DATE_RANGE_INVALID",
    });
  }

  return Object.freeze({
    title,
    body_text: bodyText,
    checksum_sha256: checksum(bodyText),
    metadata_json: safeJson(input.metadata ?? fallback.metadata ?? null),
    effective_from: effectiveFrom,
    expires_at: expiresAt,
  });
}

async function loadSource(connection, sourceId, forUpdate = false) {
  const id = positiveInteger(sourceId);
  const [rows] = await connection.query(
    `SELECT * FROM ai_knowledge_sources WHERE id = ? LIMIT 1${
      forUpdate ? " FOR UPDATE" : ""
    }`,
    [id]
  );
  if (!rows[0]) {
    throw new AiKnowledgeError("Knowledge source not found.", {
      code: "AI_KNOWLEDGE_SOURCE_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function loadVersion(connection, sourceId, versionId, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT * FROM ai_knowledge_versions
     WHERE id = ? AND source_id = ? LIMIT 1${
       forUpdate ? " FOR UPDATE" : ""
     }`,
    [positiveInteger(versionId), positiveInteger(sourceId)]
  );
  if (!rows[0]) {
    throw new AiKnowledgeError("Knowledge version not found.", {
      code: "AI_KNOWLEDGE_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function createKnowledgeSourceDraft({
  input,
  user,
  req,
  connection = null,
} = {}) {
  const source = sanitizeSource(input);
  const version = sanitizeVersion(input);
  const ownConnection = !connection;
  const db = connection || (await pool.getConnection());
  try {
    if (ownConnection) await db.beginTransaction();
    const [sourceResult] = await db.query(
      `INSERT INTO ai_knowledge_sources (
         source_key, source_type, owner_workspace_code, visibility, title,
         description, source_reference, source_status, effective_from,
         expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        source.source_key,
        source.source_type,
        source.owner_workspace_code,
        source.visibility,
        source.title,
        source.description,
        source.source_reference,
        source.effective_from,
        source.expires_at,
        user?.id || null,
        user?.id || null,
      ]
    );
    const sourceId = Number(sourceResult.insertId);
    const [versionResult] = await db.query(
      `INSERT INTO ai_knowledge_versions (
         source_id, version_number, version_status, title, body_text,
         checksum_sha256, metadata_json, effective_from, expires_at, created_by
       ) VALUES (?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceId,
        version.title,
        version.body_text,
        version.checksum_sha256,
        version.metadata_json,
        version.effective_from,
        version.expires_at,
        user?.id || null,
      ]
    );
    await writeAuditEvent({
      connection: db,
      req,
      action: "AI_KNOWLEDGE_SOURCE_CREATED",
      details: "CHALIN ONE AI knowledge source and draft version created",
      entityType: "ai_knowledge_source",
      entityId: sourceId,
      metadata: {
        source_key: source.source_key,
        version_id: Number(versionResult.insertId),
        visibility: source.visibility,
      },
    });
    if (ownConnection) await db.commit();
    return Object.freeze({
      source_id: sourceId,
      version_id: Number(versionResult.insertId),
      version_number: 1,
    });
  } catch (error) {
    if (ownConnection) await db.rollback();
    if (error instanceof AiKnowledgeError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new AiKnowledgeError(
        "A knowledge source with this key already exists.",
        { code: "AI_KNOWLEDGE_SOURCE_DUPLICATE", statusCode: 409 }
      );
    }
    throw schemaError(error);
  } finally {
    if (ownConnection) db.release();
  }
}

async function createKnowledgeVersion({ sourceId, input, user, req } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const source = await loadSource(connection, sourceId, true);
    if (source.source_status === "archived") {
      throw new AiKnowledgeError(
        "Archived knowledge cannot receive a new version.",
        { code: "AI_KNOWLEDGE_SOURCE_ARCHIVED", statusCode: 409 }
      );
    }
    const [latestRows] = await connection.query(
      `SELECT * FROM ai_knowledge_versions
       WHERE source_id = ? ORDER BY version_number DESC, id DESC
       LIMIT 1 FOR UPDATE`,
      [source.id]
    );
    const latest = latestRows[0] || {};
    const version = sanitizeVersion(input, {
      title: latest.title || source.title,
      body_text: latest.body_text,
      metadata: parseJson(latest.metadata_json, null),
      effective_from: latest.effective_from || source.effective_from,
      expires_at: latest.expires_at || source.expires_at,
    });
    const nextNumber = Number(latest.version_number || 0) + 1;
    const [result] = await connection.query(
      `INSERT INTO ai_knowledge_versions (
         source_id, version_number, version_status, title, body_text,
         checksum_sha256, metadata_json, effective_from, expires_at, created_by
       ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        nextNumber,
        version.title,
        version.body_text,
        version.checksum_sha256,
        version.metadata_json,
        version.effective_from,
        version.expires_at,
        user?.id || null,
      ]
    );
    await connection.query(
      `UPDATE ai_knowledge_sources
       SET updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, source.id]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_KNOWLEDGE_VERSION_CREATED",
      details: "CHALIN ONE AI knowledge draft version created",
      entityType: "ai_knowledge_source",
      entityId: source.id,
      metadata: {
        version_id: Number(result.insertId),
        version_number: nextNumber,
      },
    });
    await connection.commit();
    return Object.freeze({
      source_id: source.id,
      version_id: Number(result.insertId),
      version_number: nextNumber,
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiKnowledgeError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function updateKnowledgeDraft({ sourceId, versionId, input, user, req } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const source = await loadSource(connection, sourceId, true);
    const existing = await loadVersion(connection, source.id, versionId, true);
    if (existing.version_status !== "draft") {
      throw new AiKnowledgeError(
        "Only a draft knowledge version may be edited.",
        { code: "AI_KNOWLEDGE_VERSION_NOT_EDITABLE", statusCode: 409 }
      );
    }

    const nextSource = sanitizeSource(
      {
        source_key: source.source_key,
        source_type: input.source_type ?? source.source_type,
        owner_workspace_code:
          input.owner_workspace_code ?? source.owner_workspace_code,
        visibility: input.visibility ?? source.visibility,
        title: input.title ?? source.title,
        description: input.description ?? source.description,
        source_reference: input.source_reference ?? source.source_reference,
        effective_from: input.effective_from ?? source.effective_from,
        expires_at: input.expires_at ?? source.expires_at,
      },
      source
    );
    const version = sanitizeVersion(input, {
      title: existing.title,
      body_text: existing.body_text,
      metadata: parseJson(existing.metadata_json, null),
      effective_from: existing.effective_from,
      expires_at: existing.expires_at,
    });

    await connection.query(
      `UPDATE ai_knowledge_versions
       SET title = ?, body_text = ?, checksum_sha256 = ?, metadata_json = ?,
           effective_from = ?, expires_at = ?
       WHERE id = ?`,
      [
        version.title,
        version.body_text,
        version.checksum_sha256,
        version.metadata_json,
        version.effective_from,
        version.expires_at,
        existing.id,
      ]
    );
    await connection.query(
      `UPDATE ai_knowledge_sources
       SET source_type = ?, owner_workspace_code = ?, visibility = ?,
           title = ?, description = ?, source_reference = ?,
           effective_from = ?, expires_at = ?, updated_by = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        nextSource.source_type,
        nextSource.owner_workspace_code,
        nextSource.visibility,
        nextSource.title,
        nextSource.description,
        nextSource.source_reference,
        nextSource.effective_from,
        nextSource.expires_at,
        user?.id || null,
        source.id,
      ]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_KNOWLEDGE_DRAFT_UPDATED",
      details: "CHALIN ONE AI knowledge draft updated",
      entityType: "ai_knowledge_source",
      entityId: source.id,
      metadata: {
        version_id: existing.id,
        checksum_sha256: version.checksum_sha256,
        visibility: nextSource.visibility,
        owner_workspace_code: nextSource.owner_workspace_code,
      },
    });
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiKnowledgeError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function submitKnowledgeVersion({
  sourceId,
  versionId,
  assignedTo,
  note,
  user,
  req,
} = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const source = await loadSource(connection, sourceId, true);
    const version = await loadVersion(connection, source.id, versionId, true);
    if (version.version_status !== "draft") {
      throw new AiKnowledgeError(
        "Only a draft knowledge version may be submitted.",
        { code: "AI_KNOWLEDGE_VERSION_NOT_DRAFT", statusCode: 409 }
      );
    }
    const reviewerId = positiveInteger(assignedTo);
    if (!reviewerId || reviewerId === Number(user?.id)) {
      throw new AiKnowledgeError("Choose a different independent reviewer.", {
        code: "AI_KNOWLEDGE_INDEPENDENT_REVIEW_REQUIRED",
        statusCode: 409,
      });
    }
    const [pending] = await connection.query(
      `SELECT id FROM ai_knowledge_approvals
       WHERE version_id = ? AND approval_status = 'pending'
       LIMIT 1 FOR UPDATE`,
      [version.id]
    );
    if (pending[0]) {
      throw new AiKnowledgeError(
        "This knowledge version already awaits review.",
        { code: "AI_KNOWLEDGE_REVIEW_ALREADY_PENDING", statusCode: 409 }
      );
    }
    const [result] = await connection.query(
      `INSERT INTO ai_knowledge_approvals (
         source_id, version_id, approval_status, requested_by, assigned_to,
         request_note
       ) VALUES (?, ?, 'pending', ?, ?, ?)`,
      [
        source.id,
        version.id,
        user?.id || null,
        reviewerId,
        clean(note, 2000),
      ]
    );
    await connection.query(
      `UPDATE ai_knowledge_versions
       SET version_status = 'in_review'
       WHERE id = ?`,
      [version.id]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_KNOWLEDGE_REVIEW_REQUESTED",
      details: "CHALIN ONE AI knowledge review requested",
      entityType: "ai_knowledge_source",
      entityId: source.id,
      metadata: {
        version_id: version.id,
        approval_id: Number(result.insertId),
        assigned_to: reviewerId,
      },
    });
    await connection.commit();
    return Object.freeze({ approval_id: Number(result.insertId) });
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiKnowledgeError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function decideKnowledgeApproval({
  approvalId,
  decision,
  note,
  user,
  req,
} = {}) {
  const normalizedDecision = clean(decision, 20)?.toLowerCase();
  if (
    !positiveInteger(approvalId) ||
    !["approved", "rejected"].includes(normalizedDecision)
  ) {
    throw new AiKnowledgeError("Choose Approve or Reject for a valid request.", {
      code: "AI_KNOWLEDGE_DECISION_INVALID",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT * FROM ai_knowledge_approvals
       WHERE id = ? LIMIT 1 FOR UPDATE`,
      [positiveInteger(approvalId)]
    );
    const approval = rows[0];
    if (!approval || approval.approval_status !== "pending") {
      throw new AiKnowledgeError(
        "Knowledge approval is unavailable or already decided.",
        { code: "AI_KNOWLEDGE_APPROVAL_NOT_PENDING", statusCode: 409 }
      );
    }
    if (Number(approval.requested_by) === Number(user?.id)) {
      throw new AiKnowledgeError(
        "The submitter cannot approve their own knowledge version.",
        { code: "AI_KNOWLEDGE_SELF_APPROVAL_BLOCKED", statusCode: 409 }
      );
    }
    if (
      approval.assigned_to &&
      Number(approval.assigned_to) !== Number(user?.id)
    ) {
      throw new AiKnowledgeError("This review is assigned to another reviewer.", {
        code: "AI_KNOWLEDGE_REVIEW_ASSIGNED_ELSEWHERE",
        statusCode: 403,
      });
    }
    const source = await loadSource(connection, approval.source_id, true);
    const version = await loadVersion(
      connection,
      approval.source_id,
      approval.version_id,
      true
    );
    if (version.version_status !== "in_review") {
      throw new AiKnowledgeError(
        "The exact knowledge version is no longer in review.",
        { code: "AI_KNOWLEDGE_APPROVAL_STATE_MISMATCH", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE ai_knowledge_approvals
       SET approval_status = ?, decided_by = ?, decision_note = ?,
           decided_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [normalizedDecision, user?.id || null, clean(note, 2000), approval.id]
    );
    await connection.query(
      `UPDATE ai_knowledge_versions
       SET version_status = ? WHERE id = ?`,
      [normalizedDecision === "approved" ? "approved" : "draft", version.id]
    );
    await writeAuditEvent({
      connection,
      req,
      action:
        normalizedDecision === "approved"
          ? "AI_KNOWLEDGE_REVIEW_APPROVED"
          : "AI_KNOWLEDGE_REVIEW_REJECTED",
      details: `CHALIN ONE AI knowledge review ${normalizedDecision}`,
      entityType: "ai_knowledge_source",
      entityId: source.id,
      metadata: { version_id: version.id, approval_id: approval.id },
    });
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiKnowledgeError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function publishKnowledgeVersion({ sourceId, versionId, user, req } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const source = await loadSource(connection, sourceId, true);
    const version = await loadVersion(connection, source.id, versionId, true);
    if (version.version_status !== "approved") {
      throw new AiKnowledgeError(
        "Only an approved knowledge version may be published.",
        { code: "AI_KNOWLEDGE_VERSION_NOT_APPROVED", statusCode: 409 }
      );
    }
    const [approvals] = await connection.query(
      `SELECT * FROM ai_knowledge_approvals
       WHERE source_id = ? AND version_id = ?
         AND approval_status = 'approved'
       ORDER BY decided_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [source.id, version.id]
    );
    const approval = approvals[0];
    if (!approval) {
      throw new AiKnowledgeError(
        "Publishing requires an approved review record.",
        { code: "AI_KNOWLEDGE_APPROVED_REVIEW_REQUIRED", statusCode: 409 }
      );
    }
    if (
      Number(approval.requested_by) === Number(user?.id) ||
      Number(approval.decided_by) === Number(user?.id)
    ) {
      throw new AiKnowledgeError(
        "Knowledge publication requires a publisher different from the submitter and reviewer.",
        { code: "AI_KNOWLEDGE_INDEPENDENT_PUBLISHER_REQUIRED", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE ai_knowledge_versions
       SET version_status = 'superseded'
       WHERE source_id = ? AND id <> ? AND version_status = 'published'`,
      [source.id, version.id]
    );
    await connection.query(
      `UPDATE ai_knowledge_versions
       SET version_status = 'published', published_by = ?,
           published_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [user?.id || null, version.id]
    );
    await connection.query(
      `UPDATE ai_knowledge_sources
       SET source_status = 'active', title = ?, effective_from = ?,
           expires_at = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        version.title,
        version.effective_from || source.effective_from,
        version.expires_at || source.expires_at,
        user?.id || null,
        source.id,
      ]
    );
    await connection.query(
      `UPDATE ai_knowledge_approvals
       SET executed_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [approval.id]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_KNOWLEDGE_VERSION_PUBLISHED",
      details: "CHALIN ONE AI knowledge version published",
      entityType: "ai_knowledge_source",
      entityId: source.id,
      metadata: {
        version_id: version.id,
        version_number: version.version_number,
        approval_id: approval.id,
        checksum_sha256: version.checksum_sha256,
      },
    });
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiKnowledgeError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function listKnowledgeSources({
  status = null,
  visibility = null,
  workspaceCode = null,
  search = null,
  limit = 50,
  offset = 0,
} = {}) {
  const filters = ["1 = 1"];
  const params = [];
  if (status && ["draft", "active", "archived"].includes(status)) {
    filters.push("s.source_status = ?");
    params.push(status);
  }
  if (visibility && VISIBILITIES.includes(visibility)) {
    filters.push("s.visibility = ?");
    params.push(visibility);
  }
  if (workspaceCode) {
    filters.push("s.owner_workspace_code = ?");
    params.push(clean(workspaceCode, 50));
  }
  if (search) {
    filters.push(
      "(s.title LIKE ? OR s.description LIKE ? OR s.source_key LIKE ?)"
    );
    const term = `%${clean(search, 120)}%`;
    params.push(term, term, term);
  }
  params.push(Math.max(1, Math.min(100, positiveInteger(limit) || 50)));
  params.push(Math.max(0, Number(offset || 0)));

  try {
    const [rows] = await pool.query(
      `SELECT s.*,
              latest.id AS latest_version_id,
              latest.version_number AS latest_version_number,
              latest.version_status AS latest_version_status
       FROM ai_knowledge_sources s
       LEFT JOIN ai_knowledge_versions latest
         ON latest.id = (
           SELECT v.id FROM ai_knowledge_versions v
           WHERE v.source_id = s.id
           ORDER BY v.version_number DESC, v.id DESC LIMIT 1
         )
       WHERE ${filters.join(" AND ")}
       ORDER BY s.updated_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return rows.map((row) => ({
      id: Number(row.id),
      source_key: row.source_key,
      source_type: row.source_type,
      owner_workspace_code: row.owner_workspace_code,
      visibility: row.visibility,
      title: row.title,
      description: row.description,
      source_reference: row.source_reference,
      source_status: row.source_status,
      effective_from: row.effective_from,
      expires_at: row.expires_at,
      latest_version_id: row.latest_version_id
        ? Number(row.latest_version_id)
        : null,
      latest_version_number: row.latest_version_number
        ? Number(row.latest_version_number)
        : null,
      latest_version_status: row.latest_version_status || null,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    throw schemaError(error);
  }
}

async function getKnowledgeSourceDetails(sourceId) {
  try {
    const [sources] = await pool.query(
      `SELECT * FROM ai_knowledge_sources WHERE id = ? LIMIT 1`,
      [positiveInteger(sourceId)]
    );
    if (!sources[0]) {
      throw new AiKnowledgeError("Knowledge source not found.", {
        code: "AI_KNOWLEDGE_SOURCE_NOT_FOUND",
        statusCode: 404,
      });
    }
    const [versions] = await pool.query(
      `SELECT id, version_number, version_status, title, body_text,
              checksum_sha256, metadata_json, effective_from, expires_at,
              created_by, published_by, published_at, created_at
       FROM ai_knowledge_versions
       WHERE source_id = ? ORDER BY version_number DESC, id DESC`,
      [positiveInteger(sourceId)]
    );
    const [approvals] = await pool.query(
      `SELECT id, version_id, approval_status, requested_by, assigned_to,
              decided_by, request_note, decision_note, requested_at,
              decided_at, executed_at
       FROM ai_knowledge_approvals
       WHERE source_id = ? ORDER BY requested_at DESC, id DESC`,
      [positiveInteger(sourceId)]
    );
    return Object.freeze({
      source: sources[0],
      versions: versions.map((version) => ({
        ...version,
        metadata: parseJson(version.metadata_json, null),
        metadata_json: undefined,
      })),
      approvals,
    });
  } catch (error) {
    if (error instanceof AiKnowledgeError) throw error;
    throw schemaError(error);
  }
}

function retrievalVisibility(persona, workspaceCode) {
  const normalizedPersona = normalizeAiPersona(persona);
  if (normalizedPersona === "guide") {
    return { sql: "s.visibility = 'public'", params: [] };
  }
  if (normalizedPersona === "executive") {
    return {
      sql: "s.visibility IN ('public', 'workspace', 'executive')",
      params: [],
    };
  }
  return {
    sql: `(s.visibility = 'public' OR
           (s.visibility = 'workspace' AND s.owner_workspace_code = ?))`,
    params: [clean(workspaceCode, 50)],
  };
}

async function searchApprovedKnowledge({
  query,
  persona,
  workspaceCode = null,
  limit = 8,
} = {}) {
  const term = clean(query, 240);
  const normalizedPersona = normalizeAiPersona(persona);
  if (!term || !normalizedPersona) return Object.freeze([]);
  const visibility = retrievalVisibility(normalizedPersona, workspaceCode);
  const safeLimit = Math.max(1, Math.min(20, positiveInteger(limit) || 8));

  try {
    const [rows] = await pool.query(
      `SELECT s.source_key, s.source_type, s.owner_workspace_code,
              s.visibility, s.title AS source_title, s.source_reference,
              v.id AS version_id, v.version_number, v.title, v.body_text,
              v.checksum_sha256, v.effective_from, v.expires_at,
              v.published_at
       FROM ai_knowledge_sources s
       JOIN ai_knowledge_versions v
         ON v.source_id = s.id AND v.version_status = 'published'
       WHERE s.source_status = 'active'
         AND ${visibility.sql}
         AND COALESCE(v.effective_from, s.effective_from, UTC_TIMESTAMP())
             <= UTC_TIMESTAMP()
         AND (COALESCE(v.expires_at, s.expires_at) IS NULL OR
              COALESCE(v.expires_at, s.expires_at) > UTC_TIMESTAMP())
         AND (INSTR(LOWER(v.title), LOWER(?)) > 0 OR
              INSTR(LOWER(v.body_text), LOWER(?)) > 0)
       ORDER BY
         CASE WHEN INSTR(LOWER(v.title), LOWER(?)) > 0 THEN 0 ELSE 1 END,
         v.published_at DESC, v.id DESC
       LIMIT ?`,
      [...visibility.params, term, term, term, safeLimit]
    );

    return normalizeEvidenceList(
      rows.map((row) => ({
        source_type: `knowledge.${row.source_type}`,
        source_ref: row.source_key,
        source_version: String(row.version_number),
        label: row.title || row.source_title,
        excerpt_text: String(row.body_text || "").slice(0, 1200),
        as_of_at: row.published_at,
        classification:
          row.visibility === "public" ? "public" : "internal",
        workspace_code: row.owner_workspace_code,
        metadata: {
          checksum_sha256: row.checksum_sha256,
          source_reference: row.source_reference,
          visibility: row.visibility,
        },
      }))
    );
  } catch (error) {
    throw schemaError(error);
  }
}

module.exports = {
  AiKnowledgeError,
  MAX_BODY_CHARACTERS,
  SOURCE_KEY_PATTERN,
  SOURCE_TYPES,
  VERSION_STATUSES,
  VISIBILITIES,
  checksum,
  createKnowledgeSourceDraft,
  createKnowledgeVersion,
  decideKnowledgeApproval,
  getKnowledgeSourceDetails,
  listKnowledgeSources,
  loadSource,
  loadVersion,
  normalizeDate,
  normalizeSourceKey,
  parseJson,
  positiveInteger,
  publishKnowledgeVersion,
  retrievalVisibility,
  safeJson,
  sanitizeSource,
  sanitizeVersion,
  schemaError,
  searchApprovedKnowledge,
  submitKnowledgeVersion,
  updateKnowledgeDraft,
};
