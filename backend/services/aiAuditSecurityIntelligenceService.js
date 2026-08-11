"use strict";

const { pool } = require("../config/db");
const { getTableColumns } = require("./auditTrailService");

const SUPPORTED_WORKSPACES = Object.freeze([
  "spare_parts",
  "mining",
  "equipment_hire",
]);
const MAX_WINDOW_DAYS = 366;
const DEFAULT_WINDOW_DAYS = 30;

class AiAuditSecurityIntelligenceError extends Error {
  constructor(message, { code = "AI_AUDIT_SECURITY_FAILED", statusCode = 500 } = {}) {
    super(message);
    this.name = "AiAuditSecurityIntelligenceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value, maximum = 180) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  const text = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function addUtcDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeAuditWindow(input = {}, now = new Date()) {
  let from = dateOnly(input.start_date || input.from);
  let to = dateOnly(input.end_date || input.to);
  const today = utcDate(now);
  if (!from && !to) {
    to = today;
    from = addUtcDays(today, -(DEFAULT_WINDOW_DAYS - 1));
  } else if (!from) {
    from = to;
  } else if (!to) {
    to = from;
  }
  if (from > to) [from, to] = [to, from];
  const span = Math.floor(
    (new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) /
      86400000
  ) + 1;
  if (span > MAX_WINDOW_DAYS) {
    throw new AiAuditSecurityIntelligenceError(
      `Audit intelligence supports at most ${MAX_WINDOW_DAYS} days per request.`,
      { code: "AI_AUDIT_WINDOW_TOO_LARGE", statusCode: 400 }
    );
  }
  return Object.freeze({ start_date: from, end_date: to, days: span });
}

function resolveAuditScope(context = {}, input = {}) {
  const scope = context.scope || {};
  const authority = context.authority || {};
  const original = authority.original_system_administrator === true;
  const requestedGroup = input.group_mode === true;
  if (requestedGroup && !original) {
    throw new AiAuditSecurityIntelligenceError(
      "Enterprise-wide audit intelligence is reserved for the original System Administrator.",
      { code: "AI_AUDIT_ENTERPRISE_SCOPE_DENIED", statusCode: 403 }
    );
  }
  if (requestedGroup) {
    return Object.freeze({
      mode: "enterprise",
      workspace_code: null,
      branch_id: null,
      mining_site_id: null,
      hire_location_id: null,
      original_system_administrator: true,
    });
  }

  const workspace = clean(scope.workspace_code, 60).toLowerCase();
  if (!SUPPORTED_WORKSPACES.includes(workspace)) {
    throw new AiAuditSecurityIntelligenceError(
      "Choose a supported CHALIN workspace before requesting audit intelligence.",
      { code: "AI_AUDIT_WORKSPACE_REQUIRED", statusCode: 409 }
    );
  }

  const resolved = {
    mode: "workspace_context",
    workspace_code: workspace,
    branch_id: workspace === "spare_parts" ? positiveInteger(scope.branch_id) : null,
    mining_site_id: workspace === "mining" ? positiveInteger(scope.mining_site_id) : null,
    hire_location_id:
      workspace === "equipment_hire" ? positiveInteger(scope.hire_location_id) : null,
    original_system_administrator: original,
  };

  const contextId = resolved.branch_id || resolved.mining_site_id || resolved.hire_location_id;
  if (!original && !contextId) {
    throw new AiAuditSecurityIntelligenceError(
      workspace === "spare_parts"
        ? "Choose an authorized Spare Parts branch before requesting audit intelligence."
        : workspace === "mining"
          ? "Choose an authorized Mining site before requesting audit intelligence."
          : "Choose an authorized Equipment Hire location before requesting audit intelligence.",
      { code: "AI_AUDIT_CONTEXT_REQUIRED", statusCode: 409 }
    );
  }

  return Object.freeze(resolved);
}

function compatibilityError(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR"].includes(error?.code);
}

function columnExpression(columns, name, fallback) {
  return columns.has(name) ? name : fallback;
}

function appendActivityScope(where, params, columns, scope) {
  if (scope.mode === "enterprise") return;
  if (columns.has("workspace_code")) {
    if (scope.workspace_code === "spare_parts") {
      where.push("(workspace_code IS NULL OR workspace_code = 'spare_parts')");
    } else {
      where.push("workspace_code = ?");
      params.push(scope.workspace_code);
    }
  }
  if (scope.branch_id && columns.has("branch_id")) {
    where.push("branch_id = ?");
    params.push(scope.branch_id);
  }
  if (scope.mining_site_id && columns.has("mining_site_id")) {
    where.push("mining_site_id = ?");
    params.push(scope.mining_site_id);
  }
  if (scope.hire_location_id && columns.has("hire_location_id")) {
    where.push("hire_location_id = ?");
    params.push(scope.hire_location_id);
  }
}

function classifyAuditGroup(row = {}) {
  const text = `${row.action || ""} ${row.entity_type || ""} ${row.workspace_code || ""}`.toLowerCase();
  if (/login|logout|auth|password|session|token/.test(text)) return "authentication";
  if (/user|role|permission|access|deactivat|offboard/.test(text)) return "users_access";
  if (/backup|restore|export|maintenance|clear[_ -]?data/.test(text)) return "backup_recovery_export";
  if (/ai[_ -]?action|action[_ -]?proposal|risk[_ -]?5/.test(text)) return "ai_action_governance";
  if (/audit|unlock|signoff|sign[_ -]?off|approval|security/.test(text)) return "audit_security_approval";
  if (/void|delete|refund|reverse|adjust|update|edit|approve|reject/.test(text)) return "protected_business_change";
  if (/mining/.test(text)) return "mining_control";
  if (/equipment[_ -]?hire|hire[_ -]?/.test(text)) return "equipment_hire_control";
  return "other_activity";
}

async function loadActivityAggregate({ scope, window, connection = pool }) {
  const columns = await getTableColumns(connection, "activity_log");
  if (!columns.size || !columns.has("action") || !columns.has("created_at")) {
    return Object.freeze({ available: false, groups: Object.freeze([]), summary: Object.freeze({ total_events: 0 }) });
  }
  const where = ["DATE(created_at) BETWEEN ? AND ?"];
  const params = [window.start_date, window.end_date];
  appendActivityScope(where, params, columns, scope);

  const entity = columnExpression(columns, "entity_type", "''");
  const outcome = columnExpression(columns, "outcome", "'success'");
  const severity = columnExpression(columns, "severity", "'info'");
  const workspace = columnExpression(columns, "workspace_code", "'spare_parts'");

  const [rows] = await connection.query(
    `SELECT action,
            ${entity} AS entity_type,
            ${outcome} AS outcome,
            ${severity} AS severity,
            ${workspace} AS workspace_code,
            COUNT(*) AS event_count,
            MAX(created_at) AS last_event_at
       FROM activity_log
      WHERE ${where.join(" AND ")}
      GROUP BY action, entity_type, outcome, severity, workspace_code
      ORDER BY event_count DESC
      LIMIT 1000`,
    params
  );

  const groupMap = new Map();
  const summary = {
    total_events: 0,
    failed_events: 0,
    high_or_critical_events: 0,
    warning_events: 0,
  };
  for (const row of rows) {
    const count = Number(row.event_count || 0);
    const outcomeValue = clean(row.outcome || "success", 40).toLowerCase();
    const severityValue = clean(row.severity || "info", 40).toLowerCase();
    const key = classifyAuditGroup(row);
    const current = groupMap.get(key) || {
      key,
      event_count: 0,
      failed_events: 0,
      high_or_critical_events: 0,
      last_event_at: null,
    };
    current.event_count += count;
    if (!["success", "succeeded", "ok", "completed"].includes(outcomeValue)) {
      current.failed_events += count;
      summary.failed_events += count;
    }
    if (["high", "critical", "danger", "severe"].includes(severityValue)) {
      current.high_or_critical_events += count;
      summary.high_or_critical_events += count;
    } else if (["warning", "warn", "medium"].includes(severityValue)) {
      summary.warning_events += count;
    }
    const last = row.last_event_at ? new Date(row.last_event_at).toISOString() : null;
    if (last && (!current.last_event_at || last > current.last_event_at)) {
      current.last_event_at = last;
    }
    groupMap.set(key, current);
    summary.total_events += count;
  }

  return Object.freeze({
    available: true,
    groups: Object.freeze(
      [...groupMap.values()]
        .sort((a, b) => b.event_count - a.event_count || a.key.localeCompare(b.key))
        .map((item) => Object.freeze(item))
    ),
    summary: Object.freeze(summary),
  });
}

function genericTableScope(scope, { workspaceColumn = "workspace_code", branchColumn = "branch_id", siteColumn = "mining_site_id", hireColumn = "hire_location_id" } = {}) {
  const where = [];
  const params = [];
  if (scope.mode === "enterprise") return { where, params };
  if (workspaceColumn) {
    where.push(`${workspaceColumn} = ?`);
    params.push(scope.workspace_code);
  }
  if (scope.branch_id && branchColumn) {
    where.push(`${branchColumn} = ?`);
    params.push(scope.branch_id);
  }
  if (scope.mining_site_id && siteColumn) {
    where.push(`${siteColumn} = ?`);
    params.push(scope.mining_site_id);
  }
  if (scope.hire_location_id && hireColumn) {
    where.push(`${hireColumn} = ?`);
    params.push(scope.hire_location_id);
  }
  return { where, params };
}

async function loadSharedControlAggregate({ scope, window, connection = pool }) {
  try {
    const columns = await getTableColumns(connection, "shared_control_evidence");
    if (!columns.size) return Object.freeze({ available: false, total: 0, areas: Object.freeze([]) });
    const scoped = genericTableScope(scope);
    const where = [...scoped.where, "DATE(created_at) BETWEEN ? AND ?"];
    const params = [...scoped.params, window.start_date, window.end_date];
    const [rows] = await connection.query(
      `SELECT control_area, action_type, COUNT(*) AS event_count
         FROM shared_control_evidence
        WHERE ${where.join(" AND ")}
        GROUP BY control_area, action_type
        ORDER BY event_count DESC
        LIMIT 200`,
      params
    );
    return Object.freeze({
      available: true,
      total: rows.reduce((sum, row) => sum + Number(row.event_count || 0), 0),
      areas: Object.freeze(
        rows.map((row) => Object.freeze({
          control_area: clean(row.control_area || "shared_control", 80),
          action_type: clean(row.action_type || "view", 60),
          event_count: Number(row.event_count || 0),
        }))
      ),
    });
  } catch (error) {
    if (compatibilityError(error)) return Object.freeze({ available: false, total: 0, areas: Object.freeze([]) });
    throw error;
  }
}

async function loadSignoffAggregate({ scope, window, connection = pool }) {
  if (scope.workspace_code && scope.workspace_code !== "spare_parts") {
    return Object.freeze({ available: false, statuses: Object.freeze({}), total: 0 });
  }
  try {
    const columns = await getTableColumns(connection, "audit_signoffs");
    if (!columns.size) return Object.freeze({ available: false, statuses: Object.freeze({}), total: 0 });
    const where = ["DATE(created_at) BETWEEN ? AND ?"];
    const params = [window.start_date, window.end_date];
    if (scope.mode !== "enterprise" && scope.branch_id) {
      where.push("branch_id = ?");
      params.push(scope.branch_id);
    }
    const [rows] = await connection.query(
      `SELECT COALESCE(period_status, 'draft') AS status, COUNT(*) AS count
         FROM audit_signoffs
        WHERE ${where.join(" AND ")}
        GROUP BY status`,
      params
    );
    const statuses = {};
    let total = 0;
    rows.forEach((row) => {
      const key = clean(row.status || "draft", 40).toLowerCase();
      statuses[key] = Number(row.count || 0);
      total += Number(row.count || 0);
    });
    return Object.freeze({ available: true, statuses: Object.freeze(statuses), total });
  } catch (error) {
    if (compatibilityError(error)) return Object.freeze({ available: false, statuses: Object.freeze({}), total: 0 });
    throw error;
  }
}

async function loadUnlockAggregate({ scope, window, connection = pool }) {
  if (scope.workspace_code && scope.workspace_code !== "spare_parts") {
    return Object.freeze({ available: false, statuses: Object.freeze({}), execution: Object.freeze({}), total: 0 });
  }
  try {
    const columns = await getTableColumns(connection, "audit_unlock_requests");
    if (!columns.size) return Object.freeze({ available: false, statuses: Object.freeze({}), execution: Object.freeze({}), total: 0 });
    const where = ["DATE(created_at) BETWEEN ? AND ?"];
    const params = [window.start_date, window.end_date];
    if (scope.mode !== "enterprise" && scope.branch_id) {
      where.push("branch_id = ?");
      params.push(scope.branch_id);
    }
    const executionExpr = columns.has("execution_status") ? "COALESCE(execution_status, 'not_applicable')" : "'not_applicable'";
    const [rows] = await connection.query(
      `SELECT COALESCE(status, 'pending') AS status,
              ${executionExpr} AS execution_status,
              COUNT(*) AS count
         FROM audit_unlock_requests
        WHERE ${where.join(" AND ")}
        GROUP BY status, execution_status`,
      params
    );
    const statuses = {};
    const execution = {};
    let total = 0;
    rows.forEach((row) => {
      const status = clean(row.status || "pending", 40).toLowerCase();
      const executionStatus = clean(row.execution_status || "not_applicable", 40).toLowerCase();
      const count = Number(row.count || 0);
      statuses[status] = (statuses[status] || 0) + count;
      execution[executionStatus] = (execution[executionStatus] || 0) + count;
      total += count;
    });
    return Object.freeze({
      available: true,
      statuses: Object.freeze(statuses),
      execution: Object.freeze(execution),
      total,
    });
  } catch (error) {
    if (compatibilityError(error)) return Object.freeze({ available: false, statuses: Object.freeze({}), execution: Object.freeze({}), total: 0 });
    throw error;
  }
}

async function loadAiActionAggregate({ scope, window, connection = pool }) {
  try {
    const columns = await getTableColumns(connection, "ai_action_proposals");
    if (!columns.size) return Object.freeze({ available: false, total: 0, statuses: Object.freeze({}), risk_levels: Object.freeze({}) });
    const where = ["DATE(created_at) BETWEEN ? AND ?"];
    const params = [window.start_date, window.end_date];
    if (scope.mode !== "enterprise") {
      where.push("workspace_code = ?");
      params.push(scope.workspace_code);
      if (scope.branch_id && columns.has("branch_id")) {
        where.push("branch_id = ?");
        params.push(scope.branch_id);
      }
      if (scope.mining_site_id && columns.has("mining_site_id")) {
        where.push("mining_site_id = ?");
        params.push(scope.mining_site_id);
      }
      if (scope.hire_location_id && columns.has("hire_location_id")) {
        where.push("hire_location_id = ?");
        params.push(scope.hire_location_id);
      }
    }
    const [rows] = await connection.query(
      `SELECT proposal_status AS status, risk_level, COUNT(*) AS count
         FROM ai_action_proposals
        WHERE ${where.join(" AND ")}
        GROUP BY proposal_status, risk_level`,
      params
    );
    const statuses = {};
    const risks = {};
    let total = 0;
    rows.forEach((row) => {
      const status = clean(row.status || "unknown", 40).toLowerCase();
      const risk = String(Number(row.risk_level || 0));
      const count = Number(row.count || 0);
      statuses[status] = (statuses[status] || 0) + count;
      risks[risk] = (risks[risk] || 0) + count;
      total += count;
    });
    return Object.freeze({ available: true, total, statuses: Object.freeze(statuses), risk_levels: Object.freeze(risks) });
  } catch (error) {
    if (compatibilityError(error)) return Object.freeze({ available: false, total: 0, statuses: Object.freeze({}), risk_levels: Object.freeze({}) });
    throw error;
  }
}

function groupByKey(activity, key) {
  return activity.groups.find((item) => item.key === key) || {
    key,
    event_count: 0,
    failed_events: 0,
    high_or_critical_events: 0,
    last_event_at: null,
  };
}

function buildAuditDrivers({ activity, signoffs, unlocks, aiActions }) {
  const drivers = [];
  const add = (key, category, severity, effect, explanation, evidence) =>
    drivers.push(Object.freeze({ key, category, severity, effect, explanation, evidence: Object.freeze(evidence || {}) }));

  if (activity.summary.failed_events > 0) {
    add(
      "failed_control_events",
      "audit_outcomes",
      "warning",
      "control_review_required",
      `${activity.summary.failed_events} audited event(s) recorded a non-success outcome in the selected period. Review the underlying scoped audit records before assigning cause or intent.`,
      { failed_events: activity.summary.failed_events }
    );
  }
  if (activity.summary.high_or_critical_events > 0) {
    add(
      "high_severity_events",
      "security_control",
      "danger",
      "priority_investigation_signal",
      `${activity.summary.high_or_critical_events} audited event(s) were classified high/critical/danger severity. Severity is a prioritization signal, not proof of compromise, fraud or financial loss.`,
      { high_or_critical_events: activity.summary.high_or_critical_events }
    );
  }

  const auth = groupByKey(activity, "authentication");
  if (auth.failed_events > 0 || auth.high_or_critical_events > 0) {
    add(
      "authentication_control_pressure",
      "authentication",
      "warning",
      "access_security_review",
      `Authentication activity includes ${auth.failed_events} failed and ${auth.high_or_critical_events} high-severity event(s). Review account/session evidence and access context before concluding unauthorized access occurred.`,
      { failed_events: auth.failed_events, high_or_critical_events: auth.high_or_critical_events }
    );
  }

  const access = groupByKey(activity, "users_access");
  if (access.event_count > 0) {
    add(
      "user_access_changes",
      "access_governance",
      "review",
      "permission_change_review",
      `${access.event_count} user/role/permission/access audit event(s) occurred. Confirm material access changes align with authorized administration and expected business need.`,
      { event_count: access.event_count, failed_events: access.failed_events }
    );
  }

  const backup = groupByKey(activity, "backup_recovery_export");
  if (backup.event_count > 0) {
    add(
      "backup_restore_export_activity",
      "recovery_control",
      backup.failed_events > 0 ? "warning" : "review",
      "recovery_or_data_movement_review",
      `${backup.event_count} backup/restore/export/maintenance control event(s) occurred, including ${backup.failed_events} failed event(s). Backup creation, validation, restore and verification are separate controls.`,
      { event_count: backup.event_count, failed_events: backup.failed_events }
    );
  }

  const pendingUnlocks = Number(unlocks.statuses?.pending || 0);
  const rejectedUnlocks = Number(unlocks.statuses?.rejected || 0);
  const failedExecutions = Number(unlocks.execution?.failed || 0);
  if (pendingUnlocks + rejectedUnlocks + failedExecutions > 0) {
    add(
      "protected_exception_pressure",
      "exception_governance",
      failedExecutions > 0 ? "danger" : "warning",
      "protected_correction_review",
      `${pendingUnlocks} unlock/approval request(s) are pending, ${rejectedUnlocks} were rejected and ${failedExecutions} execution(s) failed in the selected period. These are exception-control signals, not proof that source records were fraudulent or incorrect.`,
      { pending: pendingUnlocks, rejected: rejectedUnlocks, failed_executions: failedExecutions }
    );
  }

  const draftSignoffs = Number(signoffs.statuses?.draft || 0);
  const rejectedSignoffs = Number(signoffs.statuses?.rejected || 0);
  if (draftSignoffs + rejectedSignoffs > 0) {
    add(
      "audit_signoff_backlog",
      "period_assurance",
      rejectedSignoffs > 0 ? "warning" : "review",
      "period_review_incomplete",
      `${draftSignoffs} audit sign-off(s) remain draft and ${rejectedSignoffs} were rejected in the selected period. Review checklist/evidence completeness before treating those periods as approved.`,
      { draft: draftSignoffs, rejected: rejectedSignoffs }
    );
  }

  const pendingAi = Number(aiActions.statuses?.pending_review || 0) + Number(aiActions.statuses?.approved || 0);
  const failedAi = Number(aiActions.statuses?.failed || 0);
  const risk5 = Number(aiActions.risk_levels?.["5"] || 0);
  if (pendingAi + failedAi + risk5 > 0) {
    add(
      "governed_ai_action_activity",
      "ai_action_governance",
      failedAi > 0 ? "warning" : "review",
      "ai_action_control_review",
      `${pendingAi} governed AI action proposal(s) remain reviewable/executable, ${failedAi} failed and ${risk5} Risk-5 proposal(s) were recorded. Risk and proposal counts do not bypass review, exact confirmation or business permissions.`,
      { pending_or_approved: pendingAi, failed: failedAi, risk5_proposals: risk5 }
    );
  }

  if (drivers.length === 0) {
    add(
      "no_material_control_pressure_in_aggregate",
      "current_snapshot",
      "information",
      "no_flagged_aggregate_issue",
      "The current aggregate audit-control checks did not surface a material deterministic pressure signal. This does not prove the absence of issues; scoped source-event review may still be required for a specific concern.",
      { total_events: activity.summary.total_events }
    );
  }
  return Object.freeze(drivers);
}

async function loadAuditSecurityIntelligence({
  context,
  input = {},
  connection = pool,
  now = new Date(),
} = {}) {
  const window = normalizeAuditWindow(input, now);
  const scope = resolveAuditScope(context, input);
  try {
    const [activity, sharedControl, signoffs, unlocks, aiActions] = await Promise.all([
      loadActivityAggregate({ scope, window, connection }),
      loadSharedControlAggregate({ scope, window, connection }),
      loadSignoffAggregate({ scope, window, connection }),
      loadUnlockAggregate({ scope, window, connection }),
      loadAiActionAggregate({ scope, window, connection }),
    ]);

    return Object.freeze({
      scope: Object.freeze({ ...scope, ...window }),
      activity,
      shared_control_evidence: sharedControl,
      audit_signoffs: signoffs,
      protected_unlocks_and_approvals: unlocks,
      ai_action_governance: aiActions,
      drivers: buildAuditDrivers({ activity, signoffs, unlocks, aiActions }),
      privacy: Object.freeze({
        aggregate_only: true,
        actor_rows_exposed: false,
        usernames_exposed: false,
        ip_addresses_exposed: false,
        raw_details_exposed: false,
        raw_metadata_exposed: false,
        secret_like_metadata_redacted_at_audit_write: true,
      }),
      certainty: Object.freeze({
        failed_event_is_not_proof_of_wrongdoing: true,
        high_severity_is_not_proof_of_compromise: true,
        unlock_or_approval_event_is_not_proof_source_record_was_wrong: true,
        backup_event_is_not_proof_restore_was_verified: true,
        absence_of_aggregate_signal_is_not_proof_of_absence: true,
        risk5_counts_do_not_bypass_system_admin_governance: true,
        warning:
          "Audit/control aggregates prioritize investigation. They do not establish fraud, malicious intent, security compromise or financial loss without the underlying authorized event/source evidence.",
      }),
      generated_at: new Date().toISOString(),
      execution_authority: "read_only",
    });
  } catch (error) {
    if (error instanceof AiAuditSecurityIntelligenceError) throw error;
    throw new AiAuditSecurityIntelligenceError(
      "Audit, controls and security intelligence could not be loaded safely."
    );
  }
}

module.exports = {
  AiAuditSecurityIntelligenceError,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  SUPPORTED_WORKSPACES,
  appendActivityScope,
  buildAuditDrivers,
  classifyAuditGroup,
  loadActivityAggregate,
  loadAiActionAggregate,
  loadAuditSecurityIntelligence,
  loadSharedControlAggregate,
  loadSignoffAggregate,
  loadUnlockAggregate,
  normalizeAuditWindow,
  resolveAuditScope,
};
