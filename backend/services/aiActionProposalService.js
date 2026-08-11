"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { isFeatureEnabled } = require("./featureFlagService");
const { writeAuditEvent } = require("./auditTrailService");
const {
  hasEveryAiPermission,
  normalizeAiPersona,
  normalizeAiWorkspace,
} = require("../security/aiPermissionCatalog");
const { hasEveryPermission } = require("../security/permissionCatalog");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { assertAiRiskAuthorized } = require("./aiCapabilityService");
const { normalizeEvidenceList } = require("./aiEvidenceService");
const { aiActionRegistry } = require("./aiActionRegistry");
const {
  executeActionDefinition,
  validateActionPayload,
} = require("./aiActionExecutorService");

const MAX_PAYLOAD_BYTES = 64000;
const MAX_EVIDENCE_BYTES = 64000;
const REVIEWABLE_STATUSES = Object.freeze(["pending_review"]);
const CANCELLABLE_STATUSES = Object.freeze([
  "draft",
  "pending_review",
  "approved",
]);
const EXECUTABLE_STATUSES = Object.freeze(["approved"]);

class AiActionProposalError extends Error {
  constructor(
    message,
    {
      code = "AI_ACTION_PROPOSAL_ERROR",
      statusCode = 400,
      details = [],
    } = {}
  ) {
    super(message);
    this.name = "AiActionProposalError";
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

function canonicalValue(value, depth = 0) {
  if (depth > 30) {
    throw new AiActionProposalError(
      "Action payload nesting is too deep.",
      { code: "AI_ACTION_PAYLOAD_TOO_DEEP", statusCode: 413 }
    );
  }
  if (value === null) return null;
  if (["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AiActionProposalError(
        "Action payload numbers must be finite.",
        { code: "AI_ACTION_PAYLOAD_INVALID" }
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key)) {
        throw new AiActionProposalError(
          "Action payload contains an invalid field name.",
          { code: "AI_ACTION_PAYLOAD_INVALID" }
        );
      }
      const item = value[key];
      if (["undefined", "function", "symbol", "bigint"].includes(typeof item)) {
        throw new AiActionProposalError(
          "Action payload contains an unsupported value.",
          { code: "AI_ACTION_PAYLOAD_INVALID" }
        );
      }
      output[key] = canonicalValue(item, depth + 1);
    }
    return output;
  }
  throw new AiActionProposalError(
    "Action payload must contain JSON-compatible values only.",
    { code: "AI_ACTION_PAYLOAD_INVALID" }
  );
}

function canonicalJson(value) {
  const json = JSON.stringify(canonicalValue(value));
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new AiActionProposalError(
      `Action payload may not exceed ${MAX_PAYLOAD_BYTES} bytes.`,
      { code: "AI_ACTION_PAYLOAD_TOO_LARGE", statusCode: 413 }
    );
  }
  return json;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function proposalKey() {
  return `ap_${crypto.randomUUID().replaceAll("-", "")}`;
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

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiActionProposalError(
      "The CHALIN ONE AI action-governance schema is not ready in this environment.",
      { code: "AI_ACTION_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function assertActionFeatureEnabled() {
  if (!isFeatureEnabled("aiActions")) {
    throw new AiActionProposalError(
      "AI action proposals and execution are disabled in this environment.",
      { code: "AI_ACTIONS_DISABLED", statusCode: 404 }
    );
  }
}

function normalizeScope(input = {}) {
  const workspaceCode = normalizeAiWorkspace(input.workspace_code);
  if (!workspaceCode) {
    throw new AiActionProposalError(
      "Action proposals require an explicit supported workspace.",
      { code: "AI_ACTION_WORKSPACE_REQUIRED" }
    );
  }
  return Object.freeze({
    workspace_code: workspaceCode,
    branch_id: positiveInteger(input.branch_id),
    mining_site_id: positiveInteger(input.mining_site_id),
    hire_location_id: positiveInteger(input.hire_location_id),
  });
}

function normalizeExpiry(value, maximumHours) {
  const now = Date.now();
  const requested = value ? new Date(value).getTime() : now + 60 * 60 * 1000;
  if (!Number.isFinite(requested) || requested <= now) {
    throw new AiActionProposalError(
      "Action proposal expiry must be in the future.",
      { code: "AI_ACTION_EXPIRY_INVALID" }
    );
  }
  const maximum = now + Number(maximumHours || 24) * 60 * 60 * 1000;
  if (requested > maximum) {
    throw new AiActionProposalError(
      `Action proposal expiry may not exceed ${maximumHours} hours.`,
      { code: "AI_ACTION_EXPIRY_TOO_LONG" }
    );
  }
  return new Date(requested).toISOString().slice(0, 19).replace("T", " ");
}

function visibleProposalFilter(user, workspaceCode) {
  if (isOriginalSystemAdministrator(user)) {
    return { sql: "1 = 1", params: [] };
  }
  const workspace = normalizeAiWorkspace(workspaceCode || user?.workspace_code);
  if (!workspace) {
    return { sql: "1 = 0", params: [] };
  }
  return {
    sql: `(p.workspace_code = ? AND
           (p.requested_by = ? OR p.assigned_to = ? OR p.approved_by = ?))`,
    params: [workspace, user?.id || 0, user?.id || 0, user?.id || 0],
  };
}

function definitionForRow(row, registry = aiActionRegistry) {
  const definition = registry.get(row.action_key);
  if (!definition || definition.version !== row.action_version) {
    throw new AiActionProposalError(
      "The approved action definition is no longer registered at the proposal version.",
      { code: "AI_ACTION_DEFINITION_VERSION_MISMATCH", statusCode: 409 }
    );
  }
  return definition;
}

function proposalPublicShape(row, registry = aiActionRegistry) {
  const definition = registry.get(row.action_key);
  const executorAvailable = Boolean(definition?.executor_key);
  return Object.freeze({
    key: row.proposal_key,
    action_key: row.action_key,
    action_version: row.action_version,
    persona: row.persona,
    risk_level: Number(row.risk_level),
    workspace_code: row.workspace_code,
    branch_id: row.branch_id ? Number(row.branch_id) : null,
    mining_site_id: row.mining_site_id ? Number(row.mining_site_id) : null,
    hire_location_id: row.hire_location_id
      ? Number(row.hire_location_id)
      : null,
    status: row.proposal_status,
    title: row.title,
    summary: row.summary_text,
    payload: parseJson(row.payload_json, {}),
    payload_sha256: row.payload_sha256,
    evidence: parseJson(row.evidence_json, []),
    evidence_count: Number(row.evidence_count || 0),
    requested_by: Number(row.requested_by),
    assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
    approved_by: row.approved_by ? Number(row.approved_by) : null,
    request_note: row.request_note,
    decision_note: row.decision_note,
    expires_at: row.expires_at,
    decided_at: row.decided_at,
    executed_at: row.executed_at || null,
    result_summary: row.result_summary || null,
    error_code: row.error_code || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    review_mode: definition?.review_mode || null,
    confirmation_mode: definition?.confirmation_mode || null,
    execution_available:
      executorAvailable && isFeatureEnabled("aiActions"),
  });
}

async function expireOverdueProposals(connection = pool) {
  const [result] = await connection.query(
    `UPDATE ai_action_proposals
     SET proposal_status = 'expired', updated_at = UTC_TIMESTAMP()
     WHERE proposal_status IN ('draft','pending_review','approved')
       AND expires_at <= UTC_TIMESTAMP()`
  );
  await connection.query(
    `UPDATE ai_action_reviews r
     JOIN ai_action_proposals p ON p.id = r.proposal_id
     SET r.review_status = 'expired', r.decided_at = UTC_TIMESTAMP()
     WHERE r.review_status = 'pending' AND p.proposal_status = 'expired'`
  );
  return Number(result.affectedRows || 0);
}

async function loadProposal(connection, key, { forUpdate = false } = {}) {
  const proposal = clean(key, 40);
  const [rows] = await connection.query(
    `SELECT * FROM ai_action_proposals
     WHERE proposal_key = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [proposal]
  );
  if (!rows[0]) {
    throw new AiActionProposalError("AI action proposal not found.", {
      code: "AI_ACTION_PROPOSAL_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

function assertProposalVisible(row, user) {
  if (isOriginalSystemAdministrator(user)) return true;
  const workspace = normalizeAiWorkspace(user?.workspace_code);
  const participant = [row.requested_by, row.assigned_to, row.approved_by]
    .filter(Boolean)
    .some((id) => Number(id) === Number(user?.id));
  if (row.workspace_code !== workspace || !participant) {
    throw new AiActionProposalError("AI action proposal not found.", {
      code: "AI_ACTION_PROPOSAL_NOT_FOUND",
      statusCode: 404,
    });
  }
  return true;
}

function assertPayloadIntegrity(row) {
  const payload = parseJson(row.payload_json, null);
  if (!payload || sha256(canonicalJson(payload)) !== row.payload_sha256) {
    throw new AiActionProposalError(
      "The action proposal payload integrity check failed.",
      { code: "AI_ACTION_PAYLOAD_INTEGRITY_FAILED", statusCode: 409 }
    );
  }
  return payload;
}

function assertDefinitionAuthority({ definition, user, persona, workspaceCode, phase }) {
  assertAiRiskAuthorized(user, definition.risk_level);
  if (definition.system_admin_only && !isOriginalSystemAdministrator(user)) {
    throw new AiActionProposalError(
      "This Risk Level 5 enterprise action is reserved for the protected System Administrator.",
      { code: "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED", statusCode: 403 }
    );
  }
  const phasePermission = {
    propose: "ai.actions.propose",
    review: "ai.actions.review",
    execute: "ai.actions.execute",
  }[phase];
  if (!hasEveryAiPermission(user, [phasePermission, ...definition.required_permissions].filter(Boolean))) {
    throw new AiActionProposalError(
      `This account cannot ${phase} the requested AI action.`,
      { code: `AI_ACTION_${String(phase).toUpperCase()}_PERMISSION_DENIED`, statusCode: 403 }
    );
  }
  if (!hasEveryPermission(user, definition.required_business_permissions || [])) {
    throw new AiActionProposalError(
      "This account lacks the required business permission for the requested AI action.",
      {
        code: "AI_ACTION_BUSINESS_PERMISSION_DENIED",
        statusCode: 403,
        details: definition.required_business_permissions || [],
      }
    );
  }
  const normalizedPersona = normalizeAiPersona(persona);
  const normalizedWorkspace = normalizeAiWorkspace(workspaceCode);
  if (!normalizedPersona || !definition.personas.includes(normalizedPersona)) {
    throw new AiActionProposalError("The action persona is not allowed.", {
      code: "AI_ACTION_PERSONA_DENIED",
      statusCode: 403,
    });
  }
  if (!normalizedWorkspace || !definition.allowed_workspaces.includes(normalizedWorkspace)) {
    throw new AiActionProposalError("The action workspace is not allowed.", {
      code: "AI_ACTION_WORKSPACE_DENIED",
      statusCode: 403,
    });
  }
  if (
    !isOriginalSystemAdministrator(user) &&
    normalizeAiWorkspace(user?.workspace_code) !== normalizedWorkspace
  ) {
    throw new AiActionProposalError(
      "AI actions cannot cross the logged-in account's active workspace.",
      { code: "AI_ACTION_SCOPE_MISMATCH", statusCode: 403 }
    );
  }
  return true;
}

function normalizedEvidenceJson(inputEvidence, definition) {
  const evidence = normalizeEvidenceList(inputEvidence || []);
  if (definition.evidence_required && evidence.length === 0) {
    throw new AiActionProposalError(
      "This action proposal requires approved evidence.",
      { code: "AI_ACTION_EVIDENCE_REQUIRED" }
    );
  }
  const evidenceJson = JSON.stringify(evidence);
  if (Buffer.byteLength(evidenceJson, "utf8") > MAX_EVIDENCE_BYTES) {
    throw new AiActionProposalError(
      "Action proposal evidence is too large.",
      { code: "AI_ACTION_EVIDENCE_TOO_LARGE", statusCode: 413 }
    );
  }
  return Object.freeze({ evidence, evidenceJson });
}

async function createActionProposal({
  input,
  user,
  req,
  registry = aiActionRegistry,
} = {}) {
  assertActionFeatureEnabled();
  const definition = registry.get(input?.action_key);
  if (!definition) {
    throw new AiActionProposalError(
      "The requested AI action definition is not registered.",
      { code: "AI_ACTION_DEFINITION_NOT_FOUND", statusCode: 404 }
    );
  }
  const persona = normalizeAiPersona(input?.persona);
  const scope = normalizeScope(input?.scope || input || {});
  assertDefinitionAuthority({
    definition,
    user,
    persona,
    workspaceCode: scope.workspace_code,
    phase: "propose",
  });

  let validatedPayload;
  try {
    validatedPayload = validateActionPayload(definition, input?.payload || {});
  } catch (error) {
    if (String(error?.code || "").startsWith("AI_ACTION_")) throw error;
    throw new AiActionProposalError(error?.message || "Action payload is invalid.", {
      code: "AI_ACTION_PAYLOAD_INVALID",
    });
  }
  const payloadJson = canonicalJson(validatedPayload);
  const evidenceState = normalizedEvidenceJson(input?.evidence, definition);
  const key = proposalKey();
  const expiresAt = normalizeExpiry(input?.expires_at, definition.maximum_expiry_hours);
  const reviewMode = definition.review_mode || "independent";
  const autoApproved = reviewMode === "auto";
  let reviewerId = positiveInteger(input?.assigned_to);

  if (reviewMode === "independent") {
    if (!reviewerId || reviewerId === Number(user?.id)) {
      throw new AiActionProposalError(
        "Choose a different independent reviewer for this controlled action.",
        { code: "AI_ACTION_INDEPENDENT_REVIEW_REQUIRED", statusCode: 409 }
      );
    }
  } else if (reviewMode === "system_admin") {
    if (!isOriginalSystemAdministrator(user)) {
      throw new AiActionProposalError(
        "This Risk Level 5 action may be proposed only by the protected System Administrator.",
        { code: "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED", statusCode: 403 }
      );
    }
    reviewerId = Number(user.id);
  } else {
    reviewerId = null;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO ai_action_proposals (
         proposal_key, action_key, action_version, persona, risk_level,
         workspace_code, branch_id, mining_site_id, hire_location_id,
         proposal_status, title, summary_text, payload_json, payload_sha256,
         evidence_json, evidence_count, requested_by, assigned_to, approved_by,
         request_note, request_id, expires_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        definition.key,
        definition.version,
        persona,
        definition.risk_level,
        scope.workspace_code,
        scope.branch_id,
        scope.mining_site_id,
        scope.hire_location_id,
        autoApproved ? "approved" : "pending_review",
        clean(input?.title, 255) || definition.title,
        clean(input?.summary, 4000) || definition.description || definition.title,
        payloadJson,
        sha256(payloadJson),
        evidenceState.evidence.length > 0 ? evidenceState.evidenceJson : null,
        evidenceState.evidence.length,
        user?.id || null,
        reviewerId,
        autoApproved ? user?.id || null : null,
        clean(input?.note, 2000),
        clean(req?.requestId, 120),
        expiresAt,
        autoApproved ? new Date() : null,
      ]
    );
    const proposalId = Number(result.insertId);
    if (!autoApproved) {
      await connection.query(
        `INSERT INTO ai_action_reviews (
           proposal_id, review_status, requested_by, assigned_to, request_note
         ) VALUES (?, 'pending', ?, ?, ?)`,
        [proposalId, user?.id || null, reviewerId, clean(input?.note, 2000)]
      );
    }
    await writeAuditEvent({
      connection,
      req,
      action: autoApproved
        ? "AI_ACTION_PROPOSAL_AUTO_APPROVED"
        : "AI_ACTION_PROPOSAL_CREATED",
      details: autoApproved
        ? "Low-risk CHALIN Intelligence action proposal validated and approved by policy"
        : "CHALIN Intelligence action proposal created for governed review",
      entityType: "ai_action_proposal",
      entityId: proposalId,
      metadata: {
        proposal_key: key,
        action_key: definition.key,
        action_version: definition.version,
        risk_level: definition.risk_level,
        workspace_code: scope.workspace_code,
        payload_sha256: sha256(payloadJson),
        evidence_count: evidenceState.evidence.length,
        review_mode: reviewMode,
        execution_available: Boolean(definition.executor_key),
      },
    });
    await connection.commit();
    return Object.freeze({
      proposal_key: key,
      status: autoApproved ? "approved" : "pending_review",
      payload_sha256: sha256(payloadJson),
      evidence_count: evidenceState.evidence.length,
      expires_at: expiresAt,
      review_mode: reviewMode,
      confirmation_mode: definition.confirmation_mode,
      execution_available: Boolean(definition.executor_key),
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve original error.
    }
    if (error instanceof AiActionProposalError || String(error?.code || "").startsWith("AI_ACTION_")) {
      throw error;
    }
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function listActionProposals({
  user,
  workspaceCode = null,
  status = null,
  limit = 50,
  offset = 0,
} = {}) {
  assertActionFeatureEnabled();
  const visibility = visibleProposalFilter(user, workspaceCode);
  const filters = [visibility.sql];
  const params = [...visibility.params];
  if (
    status &&
    [
      "draft",
      "pending_review",
      "approved",
      "rejected",
      "cancelled",
      "expired",
      "executed",
      "failed",
    ].includes(status)
  ) {
    filters.push("p.proposal_status = ?");
    params.push(status);
  }
  params.push(Math.max(1, Math.min(100, positiveInteger(limit) || 50)));
  params.push(Math.max(0, Number(offset || 0)));
  try {
    await expireOverdueProposals(pool);
    const [rows] = await pool.query(
      `SELECT p.* FROM ai_action_proposals p
       WHERE ${filters.join(" AND ")}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return rows.map((row) => proposalPublicShape(row));
  } catch (error) {
    if (error instanceof AiActionProposalError) throw error;
    throw schemaError(error);
  }
}

async function getActionProposal({ proposalKey: key, user } = {}) {
  assertActionFeatureEnabled();
  const connection = await pool.getConnection();
  try {
    await expireOverdueProposals(connection);
    const row = await loadProposal(connection, key);
    assertProposalVisible(row, user);
    assertPayloadIntegrity(row);
    const [reviews] = await connection.query(
      `SELECT id, review_status, requested_by, assigned_to, decided_by,
              request_note, decision_note, requested_at, decided_at
       FROM ai_action_reviews
       WHERE proposal_id = ? ORDER BY id DESC`,
      [row.id]
    );
    return Object.freeze({
      proposal: proposalPublicShape(row),
      reviews,
    });
  } catch (error) {
    if (error instanceof AiActionProposalError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function decideActionProposal({
  proposalKey: key,
  decision,
  note,
  user,
  req,
} = {}) {
  assertActionFeatureEnabled();
  const normalizedDecision = clean(decision, 20)?.toLowerCase();
  if (!["approved", "rejected"].includes(normalizedDecision)) {
    throw new AiActionProposalError("Choose Approve or Reject.", {
      code: "AI_ACTION_DECISION_INVALID",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await expireOverdueProposals(connection);
    const row = await loadProposal(connection, key, { forUpdate: true });
    assertProposalVisible(row, user);
    assertPayloadIntegrity(row);
    const definition = definitionForRow(row);
    assertDefinitionAuthority({
      definition,
      user,
      persona: row.persona,
      workspaceCode: row.workspace_code,
      phase: "review",
    });
    if (!REVIEWABLE_STATUSES.includes(row.proposal_status)) {
      throw new AiActionProposalError(
        "This action proposal is no longer awaiting review.",
        { code: "AI_ACTION_PROPOSAL_NOT_REVIEWABLE", statusCode: 409 }
      );
    }
    if (
      Number(row.requested_by) === Number(user?.id) &&
      !(definition.review_mode === "system_admin" && isOriginalSystemAdministrator(user))
    ) {
      throw new AiActionProposalError(
        "The proposer cannot approve their own action proposal.",
        { code: "AI_ACTION_SELF_APPROVAL_BLOCKED", statusCode: 409 }
      );
    }
    if (
      row.assigned_to &&
      Number(row.assigned_to) !== Number(user?.id) &&
      !isOriginalSystemAdministrator(user)
    ) {
      throw new AiActionProposalError(
        "This action proposal is assigned to another reviewer.",
        { code: "AI_ACTION_REVIEW_ASSIGNED_ELSEWHERE", statusCode: 403 }
      );
    }
    const [reviews] = await connection.query(
      `SELECT * FROM ai_action_reviews
       WHERE proposal_id = ? AND review_status = 'pending'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [row.id]
    );
    const review = reviews[0];
    if (!review) {
      throw new AiActionProposalError(
        "The pending governed review record is missing.",
        { code: "AI_ACTION_REVIEW_RECORD_REQUIRED", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE ai_action_reviews
       SET review_status = ?, decided_by = ?, decision_note = ?,
           decided_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [normalizedDecision, user?.id || null, clean(note, 2000), review.id]
    );
    await connection.query(
      `UPDATE ai_action_proposals
       SET proposal_status = ?, approved_by = ?, decision_note = ?,
           decided_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        normalizedDecision,
        normalizedDecision === "approved" ? user?.id || null : null,
        clean(note, 2000),
        row.id,
      ]
    );
    await writeAuditEvent({
      connection,
      req,
      action:
        normalizedDecision === "approved"
          ? "AI_ACTION_PROPOSAL_APPROVED"
          : "AI_ACTION_PROPOSAL_REJECTED",
      details: `CHALIN Intelligence action proposal ${normalizedDecision} by governed reviewer`,
      entityType: "ai_action_proposal",
      entityId: row.id,
      metadata: {
        proposal_key: row.proposal_key,
        action_key: row.action_key,
        payload_sha256: row.payload_sha256,
        decision: normalizedDecision,
        risk_level: Number(row.risk_level),
        review_mode: definition.review_mode,
        execution_available: Boolean(definition.executor_key),
      },
    });
    await connection.commit();
    return Object.freeze({
      proposal_key: row.proposal_key,
      status: normalizedDecision,
      confirmation_mode: definition.confirmation_mode,
      execution_available: Boolean(definition.executor_key),
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve original error.
    }
    if (error instanceof AiActionProposalError || String(error?.code || "").startsWith("AI_ACTION_")) {
      throw error;
    }
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

function expectedActionConfirmation(row, definition) {
  if (definition.confirmation_mode === "risk5_exact") {
    return `EXECUTE ${row.proposal_key}`;
  }
  if (definition.confirmation_mode === "explicit") {
    return `CONFIRM ${row.proposal_key}`;
  }
  return null;
}

async function markExecutionFailure(row, error) {
  if (!row?.id) return;
  try {
    await pool.query(
      `UPDATE ai_action_proposals
       SET proposal_status = 'failed', error_code = ?, result_summary = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND proposal_status = 'approved'`,
      [
        clean(error?.code || "AI_ACTION_EXECUTION_FAILED", 120),
        clean(error?.message || "Action execution failed safely.", 8000),
        Number(row.id),
      ]
    );
  } catch {
    // Preserve the business action failure.
  }
}

async function executeActionProposal({
  proposalKey: key,
  confirmation,
  user,
  req,
} = {}) {
  assertActionFeatureEnabled();
  if (!hasEveryAiPermission(user, ["ai.actions.execute"])) {
    throw new AiActionProposalError("This account cannot execute AI actions.", {
      code: "AI_ACTION_EXECUTE_PERMISSION_DENIED",
      statusCode: 403,
    });
  }

  const lockName = `chalin03:ai-action:${clean(key, 40) || "unknown"}`;
  const connection = await pool.getConnection();
  let row = null;
  let executionStarted = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
    if (Number(lock?.acquired || 0) !== 1) {
      throw new AiActionProposalError("This AI action is already being processed.", {
        code: "AI_ACTION_EXECUTION_LOCKED",
        statusCode: 409,
      });
    }
    await expireOverdueProposals(connection);
    row = await loadProposal(connection, key);
    assertProposalVisible(row, user);
    const payload = assertPayloadIntegrity(row);
    const definition = definitionForRow(row);
    if (!definition.executor_key || !definition.execution_available) {
      throw new AiActionProposalError("This action remains proposal-only and has no approved executor.", {
        code: "AI_ACTION_EXECUTION_NOT_AVAILABLE",
        statusCode: 409,
      });
    }
    assertDefinitionAuthority({
      definition,
      user,
      persona: row.persona,
      workspaceCode: row.workspace_code,
      phase: "execute",
    });
    if (!EXECUTABLE_STATUSES.includes(row.proposal_status)) {
      throw new AiActionProposalError("Only an approved AI action proposal can be executed.", {
        code: "AI_ACTION_PROPOSAL_NOT_EXECUTABLE",
        statusCode: 409,
      });
    }
    const expected = expectedActionConfirmation(row, definition);
    if (expected && clean(confirmation, 120) !== expected) {
      throw new AiActionProposalError(
        `This action requires the exact confirmation: ${expected}`,
        {
          code: "AI_ACTION_CONFIRMATION_REQUIRED",
          statusCode: 409,
          details: { expected_confirmation: expected },
        }
      );
    }

    executionStarted = true;
    const result = await executeActionDefinition({
      definition,
      payload,
      user,
      proposal: proposalPublicShape(row),
      req,
    });
    const resultSummary = clean(JSON.stringify(result), 8000) || "Action completed successfully.";
    const [update] = await connection.query(
      `UPDATE ai_action_proposals
       SET proposal_status = 'executed', executed_at = UTC_TIMESTAMP(),
           result_summary = ?, error_code = NULL, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND proposal_status = 'approved'`,
      [resultSummary, Number(row.id)]
    );
    if (Number(update.affectedRows || 0) !== 1) {
      throw new AiActionProposalError("The approved proposal changed state during execution.", {
        code: "AI_ACTION_EXECUTION_STATE_RACE",
        statusCode: 409,
      });
    }
    await writeAuditEvent({
      req,
      action: "AI_ACTION_EXECUTED",
      details: "CHALIN Intelligence executed an approved governed action",
      entityType: "ai_action_proposal",
      entityId: row.id,
      severity: Number(row.risk_level) >= 5 ? "critical" : "notice",
      metadata: {
        proposal_key: row.proposal_key,
        action_key: row.action_key,
        risk_level: Number(row.risk_level),
        payload_sha256: row.payload_sha256,
        confirmation_mode: definition.confirmation_mode,
        executor_key: definition.executor_key,
        result,
      },
    });
    return Object.freeze({
      proposal_key: row.proposal_key,
      action_key: row.action_key,
      risk_level: Number(row.risk_level),
      status: "executed",
      result,
    });
  } catch (error) {
    if (executionStarted) await markExecutionFailure(row, error);
    if (error instanceof AiActionProposalError || String(error?.code || "").startsWith("AI_ACTION_")) {
      throw error;
    }
    throw schemaError(error);
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } catch {
      // Connection closure also releases the named lock.
    }
    connection.release();
  }
}

async function cancelActionProposal({ proposalKey: key, note, user, req } = {}) {
  assertActionFeatureEnabled();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await expireOverdueProposals(connection);
    const row = await loadProposal(connection, key, { forUpdate: true });
    assertProposalVisible(row, user);
    if (
      Number(row.requested_by) !== Number(user?.id) &&
      !isOriginalSystemAdministrator(user)
    ) {
      throw new AiActionProposalError(
        "Only the proposer or protected administrator may cancel this proposal.",
        { code: "AI_ACTION_CANCEL_PERMISSION_DENIED", statusCode: 403 }
      );
    }
    if (!CANCELLABLE_STATUSES.includes(row.proposal_status)) {
      throw new AiActionProposalError(
        "This action proposal cannot be cancelled in its current state.",
        { code: "AI_ACTION_PROPOSAL_NOT_CANCELLABLE", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE ai_action_proposals
       SET proposal_status = 'cancelled', decision_note = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [clean(note, 2000), row.id]
    );
    await connection.query(
      `UPDATE ai_action_reviews
       SET review_status = 'cancelled', decided_at = UTC_TIMESTAMP(),
           decision_note = ?
       WHERE proposal_id = ? AND review_status = 'pending'`,
      [clean(note, 2000), row.id]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_ACTION_PROPOSAL_CANCELLED",
      details: "CHALIN Intelligence action proposal cancelled without execution",
      entityType: "ai_action_proposal",
      entityId: row.id,
      metadata: {
        proposal_key: row.proposal_key,
        action_key: row.action_key,
        payload_sha256: row.payload_sha256,
      },
    });
    await connection.commit();
    return Object.freeze({
      proposal_key: row.proposal_key,
      status: "cancelled",
      execution_available: false,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve original error.
    }
    if (error instanceof AiActionProposalError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  AiActionProposalError,
  CANCELLABLE_STATUSES,
  EXECUTABLE_STATUSES,
  MAX_EVIDENCE_BYTES,
  MAX_PAYLOAD_BYTES,
  REVIEWABLE_STATUSES,
  assertActionFeatureEnabled,
  assertDefinitionAuthority,
  assertPayloadIntegrity,
  assertProposalVisible,
  cancelActionProposal,
  canonicalJson,
  canonicalValue,
  createActionProposal,
  decideActionProposal,
  definitionForRow,
  executeActionProposal,
  expectedActionConfirmation,
  expireOverdueProposals,
  getActionProposal,
  listActionProposals,
  loadProposal,
  markExecutionFailure,
  normalizeExpiry,
  normalizeScope,
  normalizedEvidenceJson,
  parseJson,
  positiveInteger,
  proposalKey,
  proposalPublicShape,
  schemaError,
  sha256,
  visibleProposalFilter,
};
