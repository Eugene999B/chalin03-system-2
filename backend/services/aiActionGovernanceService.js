"use strict";

const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { isFeatureEnabled } = require("./featureFlagService");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  aiActionRegistry,
  assertActionAuthority,
  AiActionRegistryError,
} = require("./aiActionRegistryService");
const { writeAiAuditEvent } = require("./aiAuditService");

const DEFAULT_PROPOSAL_TTL_MINUTES = 30;
const MAX_PROPOSAL_TTL_MINUTES = 1440;
const MAX_LIST_LIMIT = 100;

class AiActionGovernanceError extends Error {
  constructor(message, { code = "AI_ACTION_GOVERNANCE_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiActionGovernanceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashPayload(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function proposalKey() {
  return `act_${crypto.randomUUID()}`;
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiActionGovernanceError(
      "The CHALIN Intelligence action-governance schema is not ready in this environment.",
      { code: "AI_ACTION_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function normalizedEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : [])
    .slice(0, 32)
    .map((item) => ({
      citation: clean(item?.citation, 32) || null,
      label: clean(item?.label, 200) || null,
      source_type: clean(item?.source_type, 120) || null,
      source_ref: clean(item?.source_ref, 300) || null,
      source_version: clean(item?.source_version, 100) || null,
      as_of_at: clean(item?.as_of_at, 80) || null,
      classification: clean(item?.classification, 80) || null,
    }));
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicProposal(row = {}) {
  return Object.freeze({
    key: row.proposal_key,
    action_key: row.action_key,
    action_version: row.action_version,
    persona: row.persona,
    risk_level: Number(row.risk_level || 0),
    workspace_code: row.workspace_code,
    branch_id: row.branch_id || null,
    mining_site_id: row.mining_site_id || null,
    hire_location_id: row.hire_location_id || null,
    status: row.proposal_status,
    title: row.title,
    summary: row.summary_text,
    payload: parseJson(row.payload_json, {}),
    payload_sha256: row.payload_sha256,
    evidence: parseJson(row.evidence_json, []),
    evidence_count: Number(row.evidence_count || 0),
    requested_by: row.requested_by ? Number(row.requested_by) : null,
    assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
    approved_by: row.approved_by ? Number(row.approved_by) : null,
    request_note: row.request_note || null,
    decision_note: row.decision_note || null,
    request_id: row.request_id || null,
    expires_at: row.expires_at || null,
    decided_at: row.decided_at || null,
    executed_at: row.executed_at || null,
    result_summary: row.result_summary || null,
    error_code: row.error_code || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  });
}

function summaryForAction(action, input) {
  if (action.key === "intelligence.conversation.rename") {
    return `Rename conversation ${input.conversation_key} to “${input.title}”.`;
  }
  if (action.key === "system.user.deactivate") {
    return `Securely deactivate user #${input.target_user_id}; preserve identity/history and revoke active access.`;
  }
  return action.description;
}

async function selectProposalByKey(connection, key, { forUpdate = false } = {}) {
  try {
    const [rows] = await connection.query(
      `SELECT * FROM ai_action_proposals WHERE proposal_key = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [clean(key, 40)]
    );
    if (!rows[0]) {
      throw new AiActionGovernanceError("AI action proposal not found.", {
        code: "AI_ACTION_PROPOSAL_NOT_FOUND",
        statusCode: 404,
      });
    }
    return rows[0];
  } catch (error) {
    throw schemaError(error);
  }
}

function assertNotExpired(row) {
  const expiresAt = new Date(row.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw new AiActionGovernanceError("This AI action proposal has expired and must be proposed again.", {
      code: "AI_ACTION_PROPOSAL_EXPIRED",
      statusCode: 409,
    });
  }
}

async function createActionProposal({
  actionKey,
  input = {},
  user,
  persona,
  scope = {},
  assignedTo = null,
  requestNote = null,
  evidence = [],
  requestId = null,
  ttlMinutes = DEFAULT_PROPOSAL_TTL_MINUTES,
  req = null,
} = {}) {
  const action = aiActionRegistry.get(actionKey);
  assertActionAuthority({
    action,
    user,
    persona,
    workspaceCode: scope.workspace_code,
    phase: "propose",
  });
  const validatedInput = action.validate_input(input);
  const encoded = Buffer.from(canonicalJson(validatedInput), "utf8");
  if (encoded.length > action.max_payload_bytes) {
    throw new AiActionGovernanceError("AI action payload exceeded its safe size limit.", {
      code: "AI_ACTION_PAYLOAD_TOO_LARGE",
      statusCode: 413,
    });
  }

  const key = proposalKey();
  const riskLevel = Number(action.risk_level);
  const needsReview = riskLevel >= 4;
  const assignment = positiveInteger(assignedTo) || (needsReview && isOriginalSystemAdministrator(user) ? Number(user.id) : null);
  if (needsReview && !assignment) {
    throw new AiActionGovernanceError("Risk-4 and Risk-5 actions require an assigned reviewer.", {
      code: "AI_ACTION_REVIEWER_REQUIRED",
      statusCode: 400,
    });
  }
  const ttl = Math.max(5, Math.min(MAX_PROPOSAL_TTL_MINUTES, Number(ttlMinutes) || DEFAULT_PROPOSAL_TTL_MINUTES));
  const payloadSha = hashPayload(validatedInput);
  const evidenceRows = normalizedEvidence(evidence);
  const status = needsReview ? "pending_review" : "approved";
  const approvedBy = needsReview ? null : Number(user.id);
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
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), ?)`,
      [
        key,
        action.key,
        action.version,
        persona,
        riskLevel,
        clean(scope.workspace_code || user?.workspace_code || "spare_parts", 50) || "spare_parts",
        scope.branch_id || null,
        scope.mining_site_id || null,
        scope.hire_location_id || null,
        status,
        action.title,
        summaryForAction(action, validatedInput),
        JSON.stringify(validatedInput),
        payloadSha,
        evidenceRows.length ? JSON.stringify(evidenceRows) : null,
        evidenceRows.length,
        Number(user.id),
        assignment,
        approvedBy,
        clean(requestNote, 4000) || null,
        clean(requestId || req?.requestId, 120) || null,
        ttl,
        needsReview ? null : new Date(),
      ]
    );

    if (needsReview) {
      await connection.query(
        `INSERT INTO ai_action_reviews (
           proposal_id, review_status, requested_by, assigned_to, request_note
         ) VALUES (?, 'pending', ?, ?, ?)`,
        [Number(result.insertId), Number(user.id), assignment, clean(requestNote, 4000) || null]
      );
    }
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve original error.
    }
    throw schemaError(error);
  } finally {
    connection.release();
  }

  const proposal = await getActionProposal({ proposalKey: key, user });
  await writeAiAuditEvent({
    req,
    userId: user.id,
    conversationId: null,
    eventType: "AI_ACTION_PROPOSED",
    outcome: "success",
    severity: riskLevel >= 5 ? "high" : "info",
    persona,
    scope,
    metadata: {
      proposal_key: key,
      action_key: action.key,
      risk_level: riskLevel,
      payload_sha256: payloadSha,
      status,
      assigned_to: assignment,
    },
  }).catch(() => null);
  return proposal;
}

async function getActionProposal({ proposalKey, user } = {}) {
  const connection = await pool.getConnection();
  try {
    const row = await selectProposalByKey(connection, proposalKey);
    const isOwner = Number(row.requested_by) === Number(user?.id);
    const isAssignee = Number(row.assigned_to) === Number(user?.id);
    if (!isOwner && !isAssignee && !isOriginalSystemAdministrator(user)) {
      throw new AiActionGovernanceError("This AI action proposal is not visible to the logged-in account.", {
        code: "AI_ACTION_PROPOSAL_ACCESS_DENIED",
        statusCode: 403,
      });
    }
    return publicProposal(row);
  } finally {
    connection.release();
  }
}

async function listActionProposals({ user, status = null, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_LIST_LIMIT, Number(limit) || 50));
  const params = [];
  const clauses = [];
  if (!isOriginalSystemAdministrator(user)) {
    clauses.push("(requested_by = ? OR assigned_to = ?)");
    params.push(Number(user.id), Number(user.id));
  }
  if (status) {
    clauses.push("proposal_status = ?");
    params.push(clean(status, 30));
  }
  try {
    const [rows] = await pool.query(
      `SELECT * FROM ai_action_proposals${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, safeLimit]
    );
    return Object.freeze(rows.map(publicProposal));
  } catch (error) {
    throw schemaError(error);
  }
}

async function decideActionProposal({ proposalKey, decision, note, user, req = null } = {}) {
  const normalizedDecision = clean(decision, 20).toLowerCase();
  if (!["approve", "reject"].includes(normalizedDecision)) {
    throw new AiActionGovernanceError("Action review decision must be approve or reject.", {
      code: "AI_ACTION_REVIEW_DECISION_INVALID",
    });
  }
  const connection = await pool.getConnection();
  let publicRow;
  try {
    await connection.beginTransaction();
    const row = await selectProposalByKey(connection, proposalKey, { forUpdate: true });
    assertNotExpired(row);
    if (row.proposal_status !== "pending_review") {
      throw new AiActionGovernanceError("This AI action proposal is not awaiting review.", {
        code: "AI_ACTION_REVIEW_STATE_INVALID",
        statusCode: 409,
      });
    }
    const action = aiActionRegistry.get(row.action_key);
    assertActionAuthority({
      action,
      user,
      persona: row.persona,
      workspaceCode: row.workspace_code,
      phase: "review",
    });
    if (Number(row.assigned_to) !== Number(user.id) && !isOriginalSystemAdministrator(user)) {
      throw new AiActionGovernanceError("This AI action review is assigned to another user.", {
        code: "AI_ACTION_REVIEW_ASSIGNEE_DENIED",
        statusCode: 403,
      });
    }
    if (
      Number(action.risk_level) === 4 &&
      Number(row.requested_by) === Number(user.id) &&
      !isOriginalSystemAdministrator(user)
    ) {
      throw new AiActionGovernanceError("Risk-4 actions require an independent reviewer.", {
        code: "AI_ACTION_INDEPENDENT_REVIEW_REQUIRED",
        statusCode: 403,
      });
    }
    const approved = normalizedDecision === "approve";
    await connection.query(
      `UPDATE ai_action_proposals
       SET proposal_status = ?, approved_by = ?, decision_note = ?, decided_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [approved ? "approved" : "rejected", approved ? Number(user.id) : null, clean(note, 4000) || null, Number(row.id)]
    );
    await connection.query(
      `UPDATE ai_action_reviews
       SET review_status = ?, decided_by = ?, decision_note = ?, decided_at = UTC_TIMESTAMP()
       WHERE proposal_id = ? AND review_status = 'pending'`,
      [approved ? "approved" : "rejected", Number(user.id), clean(note, 4000) || null, Number(row.id)]
    );
    await connection.commit();
    publicRow = await getActionProposal({ proposalKey, user });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve original error.
    }
    throw schemaError(error);
  } finally {
    connection.release();
  }

  await writeAiAuditEvent({
    req,
    userId: user.id,
    eventType: "AI_ACTION_REVIEWED",
    outcome: "success",
    severity: Number(publicRow.risk_level) >= 5 ? "high" : "info",
    persona: publicRow.persona,
    scope: publicRow,
    metadata: {
      proposal_key: publicRow.key,
      action_key: publicRow.action_key,
      decision: normalizedDecision,
      risk_level: publicRow.risk_level,
    },
  }).catch(() => null);
  return publicRow;
}

function expectedConfirmation(row, action) {
  if (action.confirmation_mode === "risk5_exact") return `EXECUTE ${row.proposal_key}`;
  if (action.confirmation_mode === "explicit") return `CONFIRM ${row.proposal_key}`;
  return "";
}

async function executeActionProposal({ proposalKey, confirmation = "", user, req = null } = {}) {
  if (!isFeatureEnabled("aiActions")) {
    throw new AiActionGovernanceError("AI action execution is disabled in this environment.", {
      code: "AI_ACTIONS_DISABLED",
      statusCode: 404,
    });
  }
  const lockName = `chalin03:ai-action:${clean(proposalKey, 40)}`;
  const connection = await pool.getConnection();
  let row;
  let action;
  let validatedInput;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [lockName]);
    if (Number(lock?.acquired || 0) !== 1) {
      throw new AiActionGovernanceError("This AI action is already being processed.", {
        code: "AI_ACTION_EXECUTION_LOCKED",
        statusCode: 409,
      });
    }
    row = await selectProposalByKey(connection, proposalKey);
    assertNotExpired(row);
    if (row.proposal_status !== "approved") {
      throw new AiActionGovernanceError("Only an approved AI action proposal can be executed.", {
        code: "AI_ACTION_EXECUTION_STATE_INVALID",
        statusCode: 409,
      });
    }
    action = aiActionRegistry.get(row.action_key);
    assertActionAuthority({
      action,
      user,
      persona: row.persona,
      workspaceCode: row.workspace_code,
      phase: "execute",
    });
    const payload = parseJson(row.payload_json, {});
    validatedInput = action.validate_input(payload);
    if (hashPayload(validatedInput) !== row.payload_sha256) {
      throw new AiActionGovernanceError("The approved AI action payload no longer matches its signed hash.", {
        code: "AI_ACTION_PAYLOAD_INTEGRITY_FAILED",
        statusCode: 409,
      });
    }
    const expected = expectedConfirmation(row, action);
    if (expected && clean(confirmation, 120) !== expected) {
      throw new AiActionGovernanceError(
        `This action requires the exact confirmation: ${expected}`,
        { code: "AI_ACTION_CONFIRMATION_REQUIRED", statusCode: 409, details: { expected_confirmation: expected } }
      );
    }

    const result = await action.execute({
      input: validatedInput,
      actor: Object.freeze({ id: Number(user.id), username: user.username || null, role: user.role || null }),
      proposal: publicProposal(row),
      req,
    });
    const resultSummary = clean(JSON.stringify(result), 8000);
    await connection.query(
      `UPDATE ai_action_proposals
       SET proposal_status = 'executed', executed_at = UTC_TIMESTAMP(),
           result_summary = ?, error_code = NULL
       WHERE id = ? AND proposal_status = 'approved'`,
      [resultSummary || "Action completed successfully.", Number(row.id)]
    );
    await writeAiAuditEvent({
      req,
      userId: user.id,
      eventType: "AI_ACTION_EXECUTED",
      outcome: "success",
      severity: Number(row.risk_level) >= 5 ? "critical" : "info",
      persona: row.persona,
      scope: row,
      metadata: {
        proposal_key: row.proposal_key,
        action_key: row.action_key,
        risk_level: Number(row.risk_level),
        payload_sha256: row.payload_sha256,
        result_summary: result,
      },
    }).catch(() => null);
    return Object.freeze({ proposal: await getActionProposal({ proposalKey, user }), result });
  } catch (error) {
    if (row?.id && row?.proposal_status === "approved" && !["AI_ACTION_CONFIRMATION_REQUIRED", "AI_ACTIONS_DISABLED"].includes(error?.code)) {
      try {
        await connection.query(
          `UPDATE ai_action_proposals
           SET proposal_status = 'failed', error_code = ?, result_summary = ?
           WHERE id = ? AND proposal_status = 'approved'`,
          [clean(error?.code || "AI_ACTION_EXECUTION_FAILED", 120), clean(error?.message || "Action failed safely.", 8000), Number(row.id)]
        );
      } catch {
        // Preserve the executor error.
      }
    }
    throw schemaError(error);
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } catch {
      // Connection closure releases the named lock.
    }
    connection.release();
  }
}

module.exports = {
  AiActionGovernanceError,
  DEFAULT_PROPOSAL_TTL_MINUTES,
  MAX_LIST_LIMIT,
  MAX_PROPOSAL_TTL_MINUTES,
  canonicalJson,
  clean,
  createActionProposal,
  decideActionProposal,
  executeActionProposal,
  expectedConfirmation,
  getActionProposal,
  hashPayload,
  listActionProposals,
  normalizedEvidence,
  parseJson,
  positiveInteger,
  proposalKey,
  publicProposal,
  schemaError,
  selectProposalByKey,
  summaryForAction,
};
