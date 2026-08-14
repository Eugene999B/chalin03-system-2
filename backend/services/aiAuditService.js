"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const {
  getRequestAuditContext,
  sanitizeMetadata,
  writeAuditEvent,
} = require("./auditTrailService");
const {
  groundRelativeDateInput,
  hashJson,
} = require("./aiToolRegistry");

class AiAuditError extends Error {
  constructor(message, { code = "AI_AUDIT_FAILED", statusCode = 503, details = [] } = {}) {
    super(message);
    this.name = "AiAuditError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function eventKey(prefix = "aie") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function jsonValue(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(sanitizeMetadata(value)).slice(0, 16000);
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiAuditError(
      "The CHALIN ONE AI audit schema is not ready in this environment.",
      { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function groundedToolAuditInput({ req = null, tool = null, inputSha256 = null, inputSummary = null } = {}) {
  if (
    !inputSummary ||
    typeof inputSummary !== "object" ||
    Array.isArray(inputSummary) ||
    inputSummary.truncated === true
  ) {
    return Object.freeze({ input_sha256: inputSha256, input_summary: inputSummary });
  }

  const grounded = groundRelativeDateInput({
    tool,
    input: inputSummary,
    req,
  });
  return Object.freeze({
    input_sha256: hashJson(grounded),
    input_summary: grounded,
  });
}

async function writeAiAuditEvent({
  connection = pool,
  req = null,
  userId = req?.user?.id || null,
  conversationId = null,
  messageId = null,
  invocationId = null,
  eventType,
  outcome = "success",
  severity = "info",
  persona = null,
  scope = null,
  metadata = null,
} = {}) {
  const requestContext = getRequestAuditContext(req);
  const effectiveScope = scope || {};
  const key = eventKey("audit");

  try {
    const [result] = await connection.query(
      `INSERT INTO ai_audit_events (
         event_key, user_id, conversation_id, message_id, invocation_id,
         event_type, outcome, severity, persona, workspace_code,
         branch_id, mining_site_id, hire_location_id, request_id, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        userId || null,
        conversationId || null,
        messageId || null,
        invocationId || null,
        clean(eventType || "AI_EVENT", 120),
        ["success", "denied", "blocked", "failed"].includes(outcome)
          ? outcome
          : "failed",
        ["info", "warning", "high", "critical"].includes(severity)
          ? severity
          : "warning",
        clean(persona, 20),
        clean(effectiveScope.workspace_code || requestContext.workspace_code, 50),
        effectiveScope.branch_id || req?.user?.branch_id || null,
        effectiveScope.mining_site_id || requestContext.mining_site_id || null,
        effectiveScope.hire_location_id || requestContext.hire_location_id || null,
        clean(req?.requestId || requestContext.request_id, 100),
        jsonValue(metadata),
      ]
    );

    await writeAuditEvent({
      connection,
      req,
      userId,
      action: clean(eventType || "AI_EVENT", 120),
      details: `CHALIN ONE AI ${clean(eventType || "event", 120)}`,
      workspaceCode: effectiveScope.workspace_code,
      branchId: effectiveScope.branch_id,
      miningSiteId: effectiveScope.mining_site_id,
      hireLocationId: effectiveScope.hire_location_id,
      entityType: "ai_event",
      entityId: Number(result.insertId),
      actionType: clean(eventType || "AI_EVENT", 120),
      outcome,
      severity,
      metadata: { ai_event_key: key, ...sanitizeMetadata(metadata || {}) },
    });

    return Object.freeze({ id: Number(result.insertId), event_key: key });
  } catch (error) {
    throw schemaError(error);
  }
}

async function writePromptSafetyEvent({
  connection = pool,
  req = null,
  userId = req?.user?.id || null,
  conversationId = null,
  messageId = null,
  eventType = "other",
  action = "allowed",
  patternKeys = [],
  redactionCount = 0,
  inputSha256 = null,
  safeSummary = null,
} = {}) {
  const key = eventKey("safety");
  try {
    const [result] = await connection.query(
      `INSERT INTO ai_prompt_safety_events (
         safety_event_key, user_id, conversation_id, message_id,
         event_type, safety_action, pattern_keys_json, redaction_count,
         input_sha256, safe_summary
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        userId || null,
        conversationId || null,
        messageId || null,
        [
          "prompt_injection",
          "secret_request",
          "sensitive_data",
          "output_violation",
          "rate_limit",
          "provider_failure",
          "other",
        ].includes(eventType)
          ? eventType
          : "other",
        ["allowed", "redacted", "blocked"].includes(action)
          ? action
          : "blocked",
        jsonValue([...new Set(patternKeys.filter(Boolean))]),
        Math.max(0, Number(redactionCount || 0)),
        clean(inputSha256, 64),
        clean(safeSummary, 500),
      ]
    );

    return Object.freeze({ id: Number(result.insertId), safety_event_key: key });
  } catch (error) {
    throw schemaError(error);
  }
}

async function startToolInvocation({
  connection = pool,
  req,
  messageId = null,
  tool,
  persona,
  scope,
  inputSha256,
  inputSummary,
  permissionSnapshot,
} = {}) {
  const key = eventKey("tool");
  const groundedAuditInput = groundedToolAuditInput({
    req,
    tool,
    inputSha256,
    inputSummary,
  });
  try {
    const [result] = await connection.query(
      `INSERT INTO ai_tool_invocations (
         invocation_key, message_id, requested_by, tool_key, tool_version,
         persona, risk_level, workspace_code, branch_id, mining_site_id,
         hire_location_id, invocation_status, input_sha256,
         input_summary_json, permission_snapshot_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      [
        key,
        messageId || null,
        req?.user?.id || null,
        clean(tool?.key, 150),
        clean(tool?.version || "1", 40),
        clean(persona, 20),
        Number(tool?.risk_level || 1),
        clean(scope?.workspace_code, 50),
        scope?.branch_id || null,
        scope?.mining_site_id || null,
        scope?.hire_location_id || null,
        clean(groundedAuditInput.input_sha256, 64),
        jsonValue(groundedAuditInput.input_summary),
        jsonValue(permissionSnapshot),
      ]
    );
    return Object.freeze({ id: Number(result.insertId), invocation_key: key });
  } catch (error) {
    throw schemaError(error);
  }
}

async function completeToolInvocation({
  connection = pool,
  invocationId,
  status,
  outputSummary = null,
  evidenceCount = 0,
  latencyMs = null,
  errorCode = null,
  errorMessage = null,
} = {}) {
  if (!Number(invocationId)) {
    throw new AiAuditError("Invalid AI tool invocation ID.", {
      code: "AI_TOOL_INVOCATION_INVALID",
      statusCode: 400,
    });
  }
  try {
    await connection.query(
      `UPDATE ai_tool_invocations
       SET invocation_status = ?, output_summary_json = ?, evidence_count = ?,
           latency_ms = ?, error_code = ?, error_message = ?,
           completed_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        ["succeeded", "failed", "blocked"].includes(status)
          ? status
          : "failed",
        jsonValue(outputSummary),
        Math.max(0, Number(evidenceCount || 0)),
        Number.isFinite(Number(latencyMs)) ? Math.max(0, Number(latencyMs)) : null,
        clean(errorCode, 120),
        clean(errorMessage, 500),
        Number(invocationId),
      ]
    );
    return true;
  } catch (error) {
    throw schemaError(error);
  }
}

module.exports = {
  AiAuditError,
  completeToolInvocation,
  eventKey,
  groundedToolAuditInput,
  jsonValue,
  schemaError,
  startToolInvocation,
  writeAiAuditEvent,
  writePromptSafetyEvent,
};
