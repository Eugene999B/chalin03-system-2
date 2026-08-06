"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { isFeatureEnabled } = require("./featureFlagService");
const {
  hasEveryAiPermission,
  normalizeAiPersona,
  normalizeAiWorkspace,
} = require("../security/aiPermissionCatalog");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { normalizeEvidenceList } = require("./aiEvidenceService");
const { aiScheduledJobRegistry } = require("./aiScheduledJobRegistry");

const SUPPORTED_FREQUENCIES = Object.freeze([
  "hourly",
  "daily",
  "weekly",
  "monthly",
]);
const SUPPORTED_TIMEZONES = Object.freeze(["Africa/Accra", "UTC"]);
const MAX_JSON_BYTES = 64000;

class AiScheduledGovernanceError extends Error {
  constructor(
    message,
    {
      code = "AI_SCHEDULED_GOVERNANCE_ERROR",
      statusCode = 400,
      details = [],
    } = {}
  ) {
    super(message);
    this.name = "AiScheduledGovernanceError";
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

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function canonicalValue(value, depth = 0) {
  if (depth > 30) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence input nesting is too deep.",
      { code: "AI_SCHEDULED_INPUT_TOO_DEEP", statusCode: 413 }
    );
  }
  if (value === null) return null;
  if (["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AiScheduledGovernanceError(
        "Scheduled intelligence numbers must be finite.",
        { code: "AI_SCHEDULED_INPUT_INVALID" }
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
        throw new AiScheduledGovernanceError(
          "Scheduled intelligence input contains an invalid field name.",
          { code: "AI_SCHEDULED_INPUT_INVALID" }
        );
      }
      const item = value[key];
      if (["undefined", "function", "symbol", "bigint"].includes(typeof item)) {
        throw new AiScheduledGovernanceError(
          "Scheduled intelligence input contains an unsupported value.",
          { code: "AI_SCHEDULED_INPUT_INVALID" }
        );
      }
      output[key] = canonicalValue(item, depth + 1);
    }
    return output;
  }
  throw new AiScheduledGovernanceError(
    "Scheduled intelligence input must be JSON compatible.",
    { code: "AI_SCHEDULED_INPUT_INVALID" }
  );
}

function canonicalJson(value) {
  const json = JSON.stringify(canonicalValue(value));
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    throw new AiScheduledGovernanceError(
      `Scheduled intelligence JSON may not exceed ${MAX_JSON_BYTES} bytes.`,
      { code: "AI_SCHEDULED_INPUT_TOO_LARGE", statusCode: 413 }
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

function scheduleKey() {
  return `sj_${crypto.randomUUID().replaceAll("-", "")}`;
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

function assertScheduledFeatureEnabled() {
  if (!isFeatureEnabled("aiScheduledJobs")) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence is disabled in this environment.",
      { code: "AI_SCHEDULED_JOBS_DISABLED", statusCode: 404 }
    );
  }
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiScheduledGovernanceError(
      "The scheduled-intelligence governance schema is not ready in this environment.",
      { code: "AI_SCHEDULED_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function normalizeScope(input = {}) {
  const workspaceCode = normalizeAiWorkspace(input.workspace_code);
  if (!workspaceCode) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence requires an explicit supported workspace.",
      { code: "AI_SCHEDULED_WORKSPACE_REQUIRED" }
    );
  }
  return Object.freeze({
    workspace_code: workspaceCode,
    branch_id: positiveInteger(input.branch_id),
    mining_site_id: positiveInteger(input.mining_site_id),
    hire_location_id: positiveInteger(input.hire_location_id),
  });
}

function normalizeSchedule(input = {}, minimumIntervalMinutes = 1440) {
  const frequency = clean(input.frequency, 20)?.toLowerCase();
  const timezone = clean(input.timezone || "Africa/Accra", 80);
  if (!SUPPORTED_FREQUENCIES.includes(frequency)) {
    throw new AiScheduledGovernanceError(
      "Choose hourly, daily, weekly or monthly frequency.",
      { code: "AI_SCHEDULED_FREQUENCY_INVALID" }
    );
  }
  if (!SUPPORTED_TIMEZONES.includes(timezone)) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence currently supports Africa/Accra or UTC time.",
      { code: "AI_SCHEDULED_TIMEZONE_INVALID" }
    );
  }

  const minute = boundedInteger(input.minute, 0, 59, 0);
  const hour = boundedInteger(input.hour, 0, 23, 8);
  let intervalMinutes;
  const schedule = { frequency, timezone, minute };

  if (frequency === "hourly") {
    const intervalHours = boundedInteger(input.interval_hours, 1, 24, 1);
    schedule.interval_hours = intervalHours;
    intervalMinutes = intervalHours * 60;
  } else if (frequency === "daily") {
    schedule.hour = hour;
    intervalMinutes = 1440;
  } else if (frequency === "weekly") {
    const weekdays = [
      ...new Set(
        (Array.isArray(input.weekdays) ? input.weekdays : [])
          .map((day) => boundedInteger(day, 1, 7, null))
          .filter(Boolean)
      ),
    ].sort((left, right) => left - right);
    if (weekdays.length === 0) {
      throw new AiScheduledGovernanceError(
        "Weekly schedules require at least one weekday from 1 to 7.",
        { code: "AI_SCHEDULED_WEEKDAY_REQUIRED" }
      );
    }
    schedule.hour = hour;
    schedule.weekdays = weekdays;
    intervalMinutes = Math.max(1440, Math.floor(10080 / weekdays.length));
  } else {
    const daysOfMonth = [
      ...new Set(
        (Array.isArray(input.days_of_month) ? input.days_of_month : [])
          .map((day) => boundedInteger(day, 1, 28, null))
          .filter(Boolean)
      ),
    ].sort((left, right) => left - right);
    if (daysOfMonth.length === 0) {
      throw new AiScheduledGovernanceError(
        "Monthly schedules require at least one day from 1 to 28.",
        { code: "AI_SCHEDULED_MONTH_DAY_REQUIRED" }
      );
    }
    schedule.hour = hour;
    schedule.days_of_month = daysOfMonth;
    intervalMinutes = Math.max(1440, Math.floor(40320 / daysOfMonth.length));
  }

  if (intervalMinutes < Number(minimumIntervalMinutes || 60)) {
    throw new AiScheduledGovernanceError(
      `This scheduled job may not run more frequently than every ${minimumIntervalMinutes} minutes.`,
      { code: "AI_SCHEDULED_FREQUENCY_TOO_HIGH" }
    );
  }

  return Object.freeze({
    schedule: Object.freeze(schedule),
    interval_minutes: intervalMinutes,
  });
}

function visibleFilter(user, workspaceCode) {
  if (isOriginalSystemAdministrator(user)) {
    return { sql: "1 = 1", params: [] };
  }
  const workspace = normalizeAiWorkspace(workspaceCode || user?.workspace_code);
  if (!workspace) return { sql: "1 = 0", params: [] };
  return {
    sql: `(s.workspace_code = ? AND
           (s.requested_by = ? OR s.assigned_to = ? OR s.approved_by = ?))`,
    params: [workspace, user?.id || 0, user?.id || 0, user?.id || 0],
  };
}

function publicShape(row) {
  return Object.freeze({
    key: row.schedule_key,
    job_key: row.job_key,
    job_version: row.job_version,
    persona: row.persona,
    workspace_code: row.workspace_code,
    branch_id: row.branch_id ? Number(row.branch_id) : null,
    mining_site_id: row.mining_site_id ? Number(row.mining_site_id) : null,
    hire_location_id: row.hire_location_id
      ? Number(row.hire_location_id)
      : null,
    status: row.schedule_status,
    title: row.title,
    description: row.description,
    schedule: parseJson(row.schedule_json, {}),
    schedule_sha256: row.schedule_sha256,
    input: parseJson(row.input_json, {}),
    input_sha256: row.input_sha256,
    evidence: parseJson(row.evidence_json, []),
    evidence_count: Number(row.evidence_count || 0),
    requested_by: Number(row.requested_by),
    assigned_to: row.assigned_to ? Number(row.assigned_to) : null,
    approved_by: row.approved_by ? Number(row.approved_by) : null,
    request_note: row.request_note,
    decision_note: row.decision_note,
    requested_at: row.requested_at,
    decided_at: row.decided_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    runner_available: false,
    delivery_available: false,
  });
}

async function loadSchedule(connection, key, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM ai_scheduled_job_definitions
     WHERE schedule_key = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [clean(key, 40)]
  );
  if (!rows[0]) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence definition not found.",
      { code: "AI_SCHEDULED_DEFINITION_NOT_FOUND", statusCode: 404 }
    );
  }
  return rows[0];
}

function assertVisible(row, user) {
  if (isOriginalSystemAdministrator(user)) return true;
  const workspace = normalizeAiWorkspace(user?.workspace_code);
  const participant = [row.requested_by, row.assigned_to, row.approved_by]
    .filter(Boolean)
    .some((id) => Number(id) === Number(user?.id));
  if (row.workspace_code !== workspace || !participant) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence definition not found.",
      { code: "AI_SCHEDULED_DEFINITION_NOT_FOUND", statusCode: 404 }
    );
  }
  return true;
}

function assertIntegrity(row) {
  const schedule = parseJson(row.schedule_json, null);
  const input = parseJson(row.input_json, null);
  if (
    !schedule ||
    !input ||
    sha256(canonicalJson(schedule)) !== row.schedule_sha256 ||
    sha256(canonicalJson(input)) !== row.input_sha256
  ) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence integrity verification failed.",
      { code: "AI_SCHEDULED_INTEGRITY_FAILED", statusCode: 409 }
    );
  }
  return true;
}

async function createScheduledDefinition({
  input,
  user,
  req,
  registry = aiScheduledJobRegistry,
} = {}) {
  assertScheduledFeatureEnabled();
  const definition = registry.get(input?.job_key);
  if (!definition) {
    throw new AiScheduledGovernanceError(
      "The requested scheduled intelligence job is not registered.",
      { code: "AI_SCHEDULED_JOB_NOT_FOUND", statusCode: 404 }
    );
  }
  if (definition.runner_available !== false || definition.delivery_available !== false) {
    throw new AiScheduledGovernanceError(
      "This release accepts schedule definitions only.",
      { code: "AI_SCHEDULED_RUNNER_PROHIBITED", statusCode: 409 }
    );
  }
  const persona = normalizeAiPersona(input?.persona);
  const scope = normalizeScope(input?.scope || input || {});
  if (!persona || !definition.personas.includes(persona)) {
    throw new AiScheduledGovernanceError(
      "The scheduled intelligence persona is not allowed.",
      { code: "AI_SCHEDULED_PERSONA_DENIED", statusCode: 403 }
    );
  }
  if (!definition.allowed_workspaces.includes(scope.workspace_code)) {
    throw new AiScheduledGovernanceError(
      "The scheduled intelligence workspace is not allowed.",
      { code: "AI_SCHEDULED_WORKSPACE_DENIED", statusCode: 403 }
    );
  }
  if (!hasEveryAiPermission(user, definition.required_permissions)) {
    throw new AiScheduledGovernanceError(
      "This account cannot create the requested schedule.",
      { code: "AI_SCHEDULED_PERMISSION_DENIED", statusCode: 403 }
    );
  }
  if (
    !isOriginalSystemAdministrator(user) &&
    normalizeAiWorkspace(user?.workspace_code) !== scope.workspace_code
  ) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence cannot cross the active workspace.",
      { code: "AI_SCHEDULED_SCOPE_MISMATCH", statusCode: 403 }
    );
  }
  const reviewerId = positiveInteger(input?.assigned_to);
  if (!reviewerId || reviewerId === Number(user?.id)) {
    throw new AiScheduledGovernanceError(
      "Choose a different independent reviewer.",
      { code: "AI_SCHEDULED_INDEPENDENT_REVIEW_REQUIRED", statusCode: 409 }
    );
  }

  const normalizedSchedule = normalizeSchedule(
    input?.schedule || {},
    definition.minimum_interval_minutes
  );
  const scheduleJson = canonicalJson(normalizedSchedule.schedule);
  const inputJson = canonicalJson(input?.job_input || {});
  const evidence = normalizeEvidenceList(input?.evidence || []);
  if (definition.evidence_required && evidence.length === 0) {
    throw new AiScheduledGovernanceError(
      "This schedule requires approved evidence.",
      { code: "AI_SCHEDULED_EVIDENCE_REQUIRED" }
    );
  }
  const evidenceJson = JSON.stringify(evidence);
  if (Buffer.byteLength(evidenceJson, "utf8") > MAX_JSON_BYTES) {
    throw new AiScheduledGovernanceError(
      "Scheduled intelligence evidence is too large.",
      { code: "AI_SCHEDULED_EVIDENCE_TOO_LARGE", statusCode: 413 }
    );
  }

  const key = scheduleKey();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO ai_scheduled_job_definitions (
         schedule_key, job_key, job_version, persona, workspace_code,
         branch_id, mining_site_id, hire_location_id, schedule_status,
         title, description, schedule_json, schedule_sha256, input_json,
         input_sha256, evidence_json, evidence_count, requested_by,
         assigned_to, request_note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        definition.key,
        definition.version,
        persona,
        scope.workspace_code,
        scope.branch_id,
        scope.mining_site_id,
        scope.hire_location_id,
        clean(input?.title, 255) || definition.title,
        clean(input?.description, 2000) || definition.description,
        scheduleJson,
        sha256(scheduleJson),
        inputJson,
        sha256(inputJson),
        evidence.length > 0 ? evidenceJson : null,
        evidence.length,
        user?.id || null,
        reviewerId,
        clean(input?.note, 2000),
      ]
    );
    const scheduleId = Number(result.insertId);
    await connection.query(
      `INSERT INTO ai_scheduled_job_reviews (
         schedule_id, review_status, requested_by, assigned_to, request_note
       ) VALUES (?, 'pending', ?, ?, ?)`,
      [scheduleId, user?.id || null, reviewerId, clean(input?.note, 2000)]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_SCHEDULED_DEFINITION_CREATED",
      details: "CHALIN ONE scheduled intelligence definition created for human review",
      entityType: "ai_scheduled_job_definition",
      entityId: scheduleId,
      metadata: {
        schedule_key: key,
        job_key: definition.key,
        job_version: definition.version,
        workspace_code: scope.workspace_code,
        schedule_sha256: sha256(scheduleJson),
        input_sha256: sha256(inputJson),
        evidence_count: evidence.length,
        runner_available: false,
        delivery_available: false,
      },
    });
    await connection.commit();
    return Object.freeze({
      schedule_key: key,
      status: "pending_review",
      schedule_sha256: sha256(scheduleJson),
      input_sha256: sha256(inputJson),
      interval_minutes: normalizedSchedule.interval_minutes,
      runner_available: false,
      delivery_available: false,
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiScheduledGovernanceError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function listScheduledDefinitions({
  user,
  workspaceCode = null,
  status = null,
  limit = 50,
  offset = 0,
} = {}) {
  assertScheduledFeatureEnabled();
  const visibility = visibleFilter(user, workspaceCode);
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
      "archived",
    ].includes(status)
  ) {
    filters.push("s.schedule_status = ?");
    params.push(status);
  }
  params.push(Math.max(1, Math.min(100, positiveInteger(limit) || 50)));
  params.push(Math.max(0, Number(offset || 0)));
  try {
    const [rows] = await pool.query(
      `SELECT s.* FROM ai_scheduled_job_definitions s
       WHERE ${filters.join(" AND ")}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return rows.map(publicShape);
  } catch (error) {
    throw schemaError(error);
  }
}

async function getScheduledDefinition({ scheduleKey: key, user } = {}) {
  assertScheduledFeatureEnabled();
  const connection = await pool.getConnection();
  try {
    const row = await loadSchedule(connection, key);
    assertVisible(row, user);
    assertIntegrity(row);
    const [reviews] = await connection.query(
      `SELECT id, review_status, requested_by, assigned_to, decided_by,
              request_note, decision_note, requested_at, decided_at
       FROM ai_scheduled_job_reviews
       WHERE schedule_id = ? ORDER BY id DESC`,
      [row.id]
    );
    return Object.freeze({ schedule: publicShape(row), reviews });
  } catch (error) {
    if (error instanceof AiScheduledGovernanceError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function decideScheduledDefinition({
  scheduleKey: key,
  decision,
  note,
  user,
  req,
} = {}) {
  assertScheduledFeatureEnabled();
  const normalizedDecision = clean(decision, 20)?.toLowerCase();
  if (!["approved", "rejected"].includes(normalizedDecision)) {
    throw new AiScheduledGovernanceError("Choose Approve or Reject.", {
      code: "AI_SCHEDULED_DECISION_INVALID",
    });
  }
  if (!hasEveryAiPermission(user, ["ai.actions.review"])) {
    throw new AiScheduledGovernanceError(
      "This account cannot review scheduled intelligence.",
      { code: "AI_SCHEDULED_REVIEW_PERMISSION_DENIED", statusCode: 403 }
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await loadSchedule(connection, key, { forUpdate: true });
    assertVisible(row, user);
    assertIntegrity(row);
    if (row.schedule_status !== "pending_review") {
      throw new AiScheduledGovernanceError(
        "This schedule is no longer awaiting review.",
        { code: "AI_SCHEDULED_NOT_REVIEWABLE", statusCode: 409 }
      );
    }
    if (Number(row.requested_by) === Number(user?.id)) {
      throw new AiScheduledGovernanceError(
        "The requester cannot approve their own schedule.",
        { code: "AI_SCHEDULED_SELF_APPROVAL_BLOCKED", statusCode: 409 }
      );
    }
    if (
      row.assigned_to &&
      Number(row.assigned_to) !== Number(user?.id)
    ) {
      throw new AiScheduledGovernanceError(
        "This schedule is assigned to another reviewer.",
        { code: "AI_SCHEDULED_REVIEW_ASSIGNED_ELSEWHERE", statusCode: 403 }
      );
    }
    const [reviews] = await connection.query(
      `SELECT * FROM ai_scheduled_job_reviews
       WHERE schedule_id = ? AND review_status = 'pending'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [row.id]
    );
    if (!reviews[0]) {
      throw new AiScheduledGovernanceError(
        "The pending schedule review record is missing.",
        { code: "AI_SCHEDULED_REVIEW_RECORD_REQUIRED", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE ai_scheduled_job_reviews
       SET review_status = ?, decided_by = ?, decision_note = ?,
           decided_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [normalizedDecision, user?.id || null, clean(note, 2000), reviews[0].id]
    );
    await connection.query(
      `UPDATE ai_scheduled_job_definitions
       SET schedule_status = ?, approved_by = ?, decision_note = ?,
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
          ? "AI_SCHEDULED_DEFINITION_APPROVED"
          : "AI_SCHEDULED_DEFINITION_REJECTED",
      details: `CHALIN ONE scheduled intelligence definition ${normalizedDecision} by human reviewer`,
      entityType: "ai_scheduled_job_definition",
      entityId: row.id,
      metadata: {
        schedule_key: row.schedule_key,
        job_key: row.job_key,
        schedule_sha256: row.schedule_sha256,
        input_sha256: row.input_sha256,
        decision: normalizedDecision,
        runner_available: false,
        delivery_available: false,
      },
    });
    await connection.commit();
    return Object.freeze({
      schedule_key: row.schedule_key,
      status: normalizedDecision,
      runner_available: false,
      delivery_available: false,
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiScheduledGovernanceError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function archiveScheduledDefinition({
  scheduleKey: key,
  note,
  user,
  req,
} = {}) {
  assertScheduledFeatureEnabled();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await loadSchedule(connection, key, { forUpdate: true });
    assertVisible(row, user);
    if (
      Number(row.requested_by) !== Number(user?.id) &&
      !isOriginalSystemAdministrator(user)
    ) {
      throw new AiScheduledGovernanceError(
        "Only the requester or protected administrator may archive this schedule.",
        { code: "AI_SCHEDULED_ARCHIVE_PERMISSION_DENIED", statusCode: 403 }
      );
    }
    if (["cancelled", "archived"].includes(row.schedule_status)) {
      throw new AiScheduledGovernanceError(
        "This schedule is already closed.",
        { code: "AI_SCHEDULED_ALREADY_CLOSED", statusCode: 409 }
      );
    }
    await connection.query(
      `UPDATE ai_scheduled_job_definitions
       SET schedule_status = 'archived', decision_note = ?,
           archived_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [clean(note, 2000), row.id]
    );
    await connection.query(
      `UPDATE ai_scheduled_job_reviews
       SET review_status = 'cancelled', decision_note = ?,
           decided_at = UTC_TIMESTAMP()
       WHERE schedule_id = ? AND review_status = 'pending'`,
      [clean(note, 2000), row.id]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_SCHEDULED_DEFINITION_ARCHIVED",
      details: "CHALIN ONE scheduled intelligence definition archived without running",
      entityType: "ai_scheduled_job_definition",
      entityId: row.id,
      metadata: {
        schedule_key: row.schedule_key,
        job_key: row.job_key,
        schedule_sha256: row.schedule_sha256,
        input_sha256: row.input_sha256,
        runner_available: false,
        delivery_available: false,
      },
    });
    await connection.commit();
    return Object.freeze({
      schedule_key: row.schedule_key,
      status: "archived",
      runner_available: false,
      delivery_available: false,
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiScheduledGovernanceError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  AiScheduledGovernanceError,
  MAX_JSON_BYTES,
  SUPPORTED_FREQUENCIES,
  SUPPORTED_TIMEZONES,
  archiveScheduledDefinition,
  assertIntegrity,
  assertScheduledFeatureEnabled,
  assertVisible,
  boundedInteger,
  canonicalJson,
  canonicalValue,
  createScheduledDefinition,
  decideScheduledDefinition,
  getScheduledDefinition,
  listScheduledDefinitions,
  loadSchedule,
  normalizeSchedule,
  normalizeScope,
  parseJson,
  positiveInteger,
  publicShape,
  scheduleKey,
  schemaError,
  sha256,
  visibleFilter,
};
