const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  getFinanceArrearsAccount,
  listFinanceArrears,
} = require("./equipmentFinanceArrearsService");
const {
  assertFinanceMutationSafe,
  refreshFinanceAgreementFromEvidence,
} = require("./equipmentFinanceReconciliationService");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const MINIMUM_DEFAULT_DAYS = 30;
const MAX_PLAN_INSTALLMENTS = 60;
const MAX_GOVERNANCE_EVENTS = 4000;

const RESCHEDULE_REQUESTED = "EQUIPMENT_FINANCE_RESCHEDULE_REQUESTED";
const RESCHEDULE_APPROVED = "EQUIPMENT_FINANCE_RESCHEDULE_APPROVED";
const RESCHEDULE_REJECTED = "EQUIPMENT_FINANCE_RESCHEDULE_REJECTED";
const DEFAULT_REQUESTED = "EQUIPMENT_FINANCE_DEFAULT_REVIEW_REQUESTED";
const DEFAULT_APPROVED = "EQUIPMENT_FINANCE_DEFAULT_DECLARED";
const DEFAULT_REJECTED = "EQUIPMENT_FINANCE_DEFAULT_REJECTED";
const RECOVERY_ACTION_RECORDED = "EQUIPMENT_FINANCE_RECOVERY_ACTION_RECORDED";

const REQUEST_ACTIONS = new Set([RESCHEDULE_REQUESTED, DEFAULT_REQUESTED]);
const DECISION_ACTIONS = new Set([
  RESCHEDULE_APPROVED,
  RESCHEDULE_REJECTED,
  DEFAULT_APPROVED,
  DEFAULT_REJECTED,
]);
const ALL_ACTIONS = new Set([
  ...REQUEST_ACTIONS,
  ...DECISION_ACTIONS,
  RECOVERY_ACTION_RECORDED,
]);

const PAYMENT_FREQUENCIES = new Set(["weekly", "fortnightly", "monthly"]);
const RECOVERY_ACTION_TYPES = new Set([
  "customer_demand",
  "guarantor_demand",
  "settlement_review",
  "voluntary_surrender_review",
  "repossession_review",
  "legal_referral",
  "asset_condition_check",
  "recovery_note",
]);
const GOVERNANCE_QUEUES = new Set([
  "all",
  "pending_reschedules",
  "pending_defaults",
  "eligible_for_default",
  "defaulted",
  "recovery_due",
  "recent_reschedules",
]);

function appError(message, statusCode = 400, code = "FINANCE_GOVERNANCE_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw appError(`${label} must be a positive whole number.`, 400, "INVALID_IDENTIFIER");
  }
  return number;
}

function wholeNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw appError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function dateOnly(value, label = "Date") {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw appError(`${label} must be a valid date.`);
  }
  return text;
}

function dateText(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function ghanaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dayDifference(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function addSchedulePeriod(dateValue, frequency, periods) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + periods * 7);
  else if (frequency === "fortnightly") date.setUTCDate(date.getUTCDate() + periods * 14);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + periods);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

function buildSchedule(totalAmount, count, firstDueDate, frequency) {
  const totalCents = Math.round(Number(totalAmount || 0) * 100);
  const baseCents = Math.floor(totalCents / count);
  let assignedCents = 0;
  const schedule = [];
  for (let index = 0; index < count; index += 1) {
    const cents = index === count - 1 ? totalCents - assignedCents : baseCents;
    assignedCents += cents;
    schedule.push({
      sequence_offset: index + 1,
      due_date: addSchedulePeriod(firstDueDate, frequency, index),
      scheduled_amount: Number((cents / 100).toFixed(2)),
    });
  }
  return schedule;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function governancePolicy() {
  return {
    division: "installment_finance",
    scope: "company_wide",
    hire_location_selection_required: false,
    hire_workflow_access: false,
    automatic_sms_enabled: false,
    minimum_default_days: MINIMUM_DEFAULT_DAYS,
    request_approval_separation: true,
    schedule_replacement_method: "preserve_paid_and_mark_open_lines_rescheduled",
    governance_evidence: "append_only_activity_log",
    balance_mutation_allowed: false,
    payment_mutation_allowed: false,
    fleet_recovery_mutation_allowed: false,
  };
}

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function loadAgreement(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT
       agreement.*,
       location.name AS finance_location_name,
       location.code AS finance_location_code,
       business_unit.id AS business_unit_id,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.address AS customer_address,
       asset.asset_code,
       asset.asset_name,
       asset.main_image_url,
       asset.sale_status AS asset_sale_status,
       asset.current_status AS asset_current_status,
       asset.operational_purpose,
       ownership.id AS ownership_transfer_id,
       ownership.status AS ownership_transfer_status,
       COALESCE((
         SELECT DATEDIFF(CURDATE(), MIN(schedule.due_date))
         FROM equipment_installment_schedule schedule
         WHERE schedule.agreement_id = agreement.id
           AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
           AND schedule.due_date < CURDATE()
           AND GREATEST(
             schedule.scheduled_amount + schedule.late_charge_amount -
             schedule.waived_charge_amount - schedule.amount_paid,
             0
           ) > 0.01
       ), 0) AS days_past_due,
       (SELECT COUNT(*)
          FROM hire_contract_assets hire_asset
         WHERE hire_asset.asset_id = agreement.asset_id
           AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
     FROM equipment_sale_agreements agreement
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
     LEFT JOIN business_units business_unit ON business_unit.id = location.business_unit_id
     LEFT JOIN equipment_ownership_transfers ownership
       ON ownership.agreement_id = agreement.id
      AND ownership.status <> 'revoked'
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [Number(agreementId)]
  );
  if (!rows.length) {
    throw appError(
      "The approved Finance installment agreement was not found.",
      404,
      "FINANCE_AGREEMENT_NOT_FOUND"
    );
  }
  return rows[0];
}

function assertGovernableAgreement(agreement) {
  if (["completed", "cancelled"].includes(agreement.agreement_status)) {
    throw appError(
      "Completed or cancelled Finance agreements cannot enter governance review.",
      409,
      "FINANCE_AGREEMENT_CLOSED"
    );
  }
  if (agreement.ownership_transfer_id || agreement.ownership_status === "transferred") {
    throw appError(
      "Ownership has already transferred, so the account cannot be rescheduled or defaulted.",
      409,
      "FINANCE_OWNERSHIP_ALREADY_TRANSFERRED"
    );
  }
  if (Number(agreement.outstanding_balance || 0) <= 0.01) {
    throw appError(
      "The account has no outstanding balance requiring governance action.",
      409,
      "FINANCE_NO_OUTSTANDING_BALANCE"
    );
  }
}

async function loadSchedule(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT *
     FROM equipment_installment_schedule
     WHERE agreement_id = ?
     ORDER BY sequence_number, id ${lock ? "FOR UPDATE" : ""}`,
    [Number(agreementId)]
  );
  return rows;
}

function openScheduleRows(rows) {
  return (rows || []).filter((row) =>
    ["upcoming", "due", "partial", "overdue"].includes(row.schedule_status)
  );
}

function financialSnapshot(agreement, schedule) {
  const openSchedule = openScheduleRows(schedule).map((row) => ({
    id: Number(row.id),
    sequence_number: Number(row.sequence_number),
    due_date: dateText(row.due_date),
    scheduled_amount: Number(row.scheduled_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
    late_charge_amount: Number(row.late_charge_amount || 0),
    waived_charge_amount: Number(row.waived_charge_amount || 0),
    schedule_status: row.schedule_status,
  }));
  const values = {
    agreement_id: Number(agreement.id),
    agreement_status: agreement.agreement_status,
    amount_paid: Number(agreement.amount_paid || 0),
    outstanding_balance: Number(agreement.outstanding_balance || 0),
    overdue_amount: Number(agreement.overdue_amount || 0),
    open_schedule: openSchedule,
  };
  return { ...values, fingerprint: stableHash(values) };
}

async function loadGovernanceEvents(connection, agreementIds) {
  const ids = [...new Set((agreementIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const idPlaceholders = ids.map(() => "?").join(",");
  const actionPlaceholders = [...ALL_ACTIONS].map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT
       activity.id,
       activity.action,
       activity.details,
       activity.outcome,
       activity.severity,
       activity.entity_id,
       activity.metadata_json,
       activity.created_at,
       activity.user_id,
       user.full_name AS recorded_by_name,
       user.username AS recorded_by_username
     FROM activity_log activity
     LEFT JOIN users user ON user.id = activity.user_id
     WHERE activity.workspace_code = ?
       AND activity.entity_type = 'equipment_sale_agreement'
       AND activity.entity_id IN (${idPlaceholders})
       AND activity.action IN (${actionPlaceholders})
     ORDER BY activity.created_at ASC, activity.id ASC
     LIMIT ${MAX_GOVERNANCE_EVENTS}`,
    [FINANCE_WORKSPACE, ...ids.map(String), ...ALL_ACTIONS]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    details: row.details,
    outcome: row.outcome,
    severity: row.severity,
    agreement_id: Number(row.entity_id),
    metadata: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
    user_id: Number(row.user_id || 0) || null,
    recorded_by_name:
      row.recorded_by_name || row.recorded_by_username || "System",
  }));
}

function governanceProfile(events = []) {
  const decisionsByRequest = new Map();
  for (const event of events) {
    if (!DECISION_ACTIONS.has(event.action)) continue;
    const requestId = Number(event.metadata.request_activity_id || 0);
    if (requestId) decisionsByRequest.set(requestId, event);
  }

  const requests = events
    .filter((event) => REQUEST_ACTIONS.has(event.action))
    .map((event) => ({
      ...event,
      request_type:
        event.action === RESCHEDULE_REQUESTED ? "reschedule" : "default",
      decision: decisionsByRequest.get(event.id) || null,
      request_status: decisionsByRequest.has(event.id)
        ? decisionsByRequest.get(event.id).outcome
        : "pending",
    }))
    .sort((left, right) => right.id - left.id);

  const pendingReschedule = requests.find(
    (request) => request.request_type === "reschedule" && request.request_status === "pending"
  );
  const pendingDefault = requests.find(
    (request) => request.request_type === "default" && request.request_status === "pending"
  );
  const recoveryActions = events
    .filter((event) => event.action === RECOVERY_ACTION_RECORDED)
    .sort((left, right) => right.id - left.id);
  const approvedReschedules = events
    .filter((event) => event.action === RESCHEDULE_APPROVED)
    .sort((left, right) => right.id - left.id);

  return {
    requests,
    pending_reschedule_request: pendingReschedule || null,
    pending_default_request: pendingDefault || null,
    recovery_actions: recoveryActions,
    latest_recovery_action: recoveryActions[0] || null,
    latest_approved_reschedule: approvedReschedules[0] || null,
  };
}

function enrichGovernanceAccount(account, events) {
  const profile = governanceProfile(events);
  const nextRecoveryDate = dateText(
    profile.latest_recovery_action?.metadata?.next_action_date
  );
  const today = ghanaToday();
  const recoveryDifference = nextRecoveryDate
    ? dayDifference(nextRecoveryDate, today)
    : null;
  return {
    ...account,
    ...profile,
    eligible_for_default:
      !["defaulted", "completed", "cancelled"].includes(account.agreement_status) &&
      Number(account.outstanding_balance || 0) > 0.01 &&
      Number(account.days_past_due || 0) >= MINIMUM_DEFAULT_DAYS,
    recovery_next_action_date: nextRecoveryDate,
    recovery_next_action_status:
      recoveryDifference === null
        ? "none"
        : recoveryDifference < 0
          ? "overdue"
          : recoveryDifference === 0
            ? "due_today"
            : "upcoming",
    governance_status: profile.pending_reschedule_request
      ? "reschedule_pending"
      : profile.pending_default_request
        ? "default_review_pending"
        : account.agreement_status === "defaulted"
          ? "defaulted_recovery"
          : "monitored",
  };
}

function queueMatches(account, queue) {
  if (queue === "all") return true;
  if (queue === "pending_reschedules") return Boolean(account.pending_reschedule_request);
  if (queue === "pending_defaults") return Boolean(account.pending_default_request);
  if (queue === "eligible_for_default") return Boolean(account.eligible_for_default);
  if (queue === "defaulted") return account.agreement_status === "defaulted";
  if (queue === "recovery_due") {
    return ["due_today", "overdue"].includes(account.recovery_next_action_status);
  }
  if (queue === "recent_reschedules") return Boolean(account.latest_approved_reschedule);
  return true;
}

function buildSummary(accounts) {
  return accounts.reduce(
    (summary, account) => {
      summary.accounts += 1;
      summary.outstanding_amount += Number(account.outstanding_balance || 0);
      if (account.pending_reschedule_request) summary.pending_reschedules += 1;
      if (account.pending_default_request) summary.pending_defaults += 1;
      if (account.eligible_for_default) summary.eligible_for_default += 1;
      if (account.agreement_status === "defaulted") summary.defaulted_accounts += 1;
      if (["due_today", "overdue"].includes(account.recovery_next_action_status)) {
        summary.recovery_actions_due += 1;
      }
      return summary;
    },
    {
      accounts: 0,
      pending_reschedules: 0,
      pending_defaults: 0,
      eligible_for_default: 0,
      defaulted_accounts: 0,
      recovery_actions_due: 0,
      outstanding_amount: 0,
    }
  );
}

async function listFinanceGovernance({
  search = "",
  queue = "all",
  limit = 400,
} = {}) {
  const cleanQueue = cleanText(queue, 40).toLowerCase() || "all";
  if (!GOVERNANCE_QUEUES.has(cleanQueue)) {
    throw appError("Choose a valid Finance governance queue.");
  }
  const arrears = await listFinanceArrears({ search, limit: 500 });
  const baseAccounts = arrears.accounts || [];
  const events = await loadGovernanceEvents(
    pool,
    baseAccounts.map((account) => account.id)
  );
  const byAgreement = new Map();
  for (const event of events) {
    const list = byAgreement.get(event.agreement_id) || [];
    list.push(event);
    byAgreement.set(event.agreement_id, list);
  }
  const enriched = baseAccounts.map((account) =>
    enrichGovernanceAccount(account, byAgreement.get(Number(account.id)) || [])
  );
  const filtered = enriched.filter((account) => queueMatches(account, cleanQueue));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 400, 500));
  return {
    generated_at: new Date().toISOString(),
    summary: buildSummary(enriched),
    filtered_summary: buildSummary(filtered),
    count: filtered.length,
    accounts: filtered.slice(0, safeLimit),
    options: {
      queues: [...GOVERNANCE_QUEUES],
      payment_frequencies: [...PAYMENT_FREQUENCIES],
      recovery_action_types: [...RECOVERY_ACTION_TYPES],
      minimum_default_days: MINIMUM_DEFAULT_DAYS,
      maximum_plan_installments: MAX_PLAN_INSTALLMENTS,
    },
    policy: governancePolicy(),
  };
}

async function getFinanceGovernanceAccount(agreementId) {
  const id = positiveId(agreementId, "Agreement ID");
  const [arrears, events] = await Promise.all([
    getFinanceArrearsAccount(id),
    loadGovernanceEvents(pool, [id]),
  ]);
  return {
    ...arrears,
    account: enrichGovernanceAccount(arrears.account, events),
    governance_events: [...events].sort((left, right) => right.id - left.id),
    governance: governanceProfile(events),
    options: {
      ...(arrears.options || {}),
      payment_frequencies: [...PAYMENT_FREQUENCIES],
      recovery_action_types: [...RECOVERY_ACTION_TYPES],
      minimum_default_days: MINIMUM_DEFAULT_DAYS,
      maximum_plan_installments: MAX_PLAN_INSTALLMENTS,
    },
    policy: governancePolicy(),
  };
}

async function assertNoPendingRequest(connection, agreementId, requestAction) {
  const events = await loadGovernanceEvents(connection, [agreementId]);
  const profile = governanceProfile(events);
  const pending = requestAction === RESCHEDULE_REQUESTED
    ? profile.pending_reschedule_request
    : profile.pending_default_request;
  if (pending) {
    throw appError(
      `A ${pending.request_type} request is already awaiting an independent decision.`,
      409,
      "FINANCE_GOVERNANCE_REQUEST_PENDING"
    );
  }
}

async function requestFinanceReschedule({ agreementId, input, userId, req }) {
  const id = positiveId(agreementId, "Agreement ID");
  const frequency = cleanText(input?.payment_frequency, 30).toLowerCase();
  if (!PAYMENT_FREQUENCIES.has(frequency)) {
    throw appError("Choose weekly, fortnightly or monthly payments.");
  }
  const count = wholeNumber(
    input?.installment_count,
    1,
    MAX_PLAN_INSTALLMENTS,
    "Installment count"
  );
  const firstDueDate = dateOnly(input?.first_due_date, "First due date");
  const today = ghanaToday();
  const dueInDays = dayDifference(today, firstDueDate);
  if (dueInDays === null || dueInDays < 0 || dueInDays > 730) {
    throw appError("First due date must be between today and two years from today.");
  }
  const reason = cleanText(input?.reason, 2000);
  const customerConsentReference = cleanText(
    input?.customer_consent_reference,
    500
  );
  const affordabilityNotes = cleanText(input?.affordability_notes, 1500);
  if (reason.length < 15) {
    throw appError("Enter a detailed rescheduling reason of at least 15 characters.");
  }
  if (customerConsentReference.length < 5) {
    throw appError("Record the customer's consent or meeting reference.");
  }

  const result = await withTransaction(async (connection) => {
    const agreement = await loadAgreement(connection, id, { lock: true });
    assertGovernableAgreement(agreement);
    await assertNoPendingRequest(connection, id, RESCHEDULE_REQUESTED);
    const schedule = await loadSchedule(connection, id, { lock: true });
    const snapshot = financialSnapshot(agreement, schedule);
    const proposedSchedule = buildSchedule(
      agreement.outstanding_balance,
      count,
      firstDueDate,
      frequency
    );
    const activityId = await writeAuditEvent({
      connection,
      req,
      userId,
      workspaceCode: FINANCE_WORKSPACE,
      businessUnitId: agreement.business_unit_id,
      hireLocationId: agreement.hire_location_id,
      action: RESCHEDULE_REQUESTED,
      actionType: RESCHEDULE_REQUESTED,
      entityType: "equipment_sale_agreement",
      entityId: id,
      outcome: "pending",
      severity: "warning",
      details: `Requested a controlled ${frequency} reschedule for ${agreement.agreement_number}: ${reason}`,
      metadata: {
        agreement_number: agreement.agreement_number,
        customer_name: agreement.customer_name_snapshot || agreement.customer_name,
        customer_phone: agreement.customer_phone_snapshot || agreement.customer_phone,
        asset_code: agreement.asset_code_snapshot || agreement.asset_code,
        asset_name: agreement.asset_name_snapshot || agreement.asset_name,
        reason,
        customer_consent_reference: customerConsentReference,
        affordability_notes: affordabilityNotes || null,
        proposed_payment_frequency: frequency,
        proposed_installment_count: count,
        proposed_first_due_date: firstDueDate,
        proposed_final_due_date: proposedSchedule.at(-1)?.due_date || firstDueDate,
        proposed_schedule: proposedSchedule,
        financial_snapshot: snapshot,
        financial_values_changed: false,
        payment_record_created: false,
        automatic_sms_sent: false,
        hire_work_created: false,
        independent_approval_required: true,
      },
    });
    if (!activityId) {
      throw appError(
        "The governance request could not be stored in the protected activity ledger.",
        503,
        "FINANCE_GOVERNANCE_LEDGER_UNAVAILABLE"
      );
    }
    return activityId;
  });

  return { request_activity_id: result, ...(await getFinanceGovernanceAccount(id)) };
}

async function requestFinanceDefaultReview({ agreementId, input, userId, req }) {
  const id = positiveId(agreementId, "Agreement ID");
  const reason = cleanText(input?.reason, 2000);
  const evidenceReference = cleanText(input?.evidence_reference, 500);
  const customerDemandSummary = cleanText(input?.customer_demand_summary, 1500);
  const guarantorContactSummary = cleanText(input?.guarantor_contact_summary, 1500);
  if (reason.length < 15) {
    throw appError("Enter a detailed default-review reason of at least 15 characters.");
  }
  if (evidenceReference.length < 5) {
    throw appError("Record the supporting demand, visit or evidence reference.");
  }

  const result = await withTransaction(async (connection) => {
    const agreement = await loadAgreement(connection, id, { lock: true });
    assertGovernableAgreement(agreement);
    if (agreement.agreement_status === "defaulted") {
      throw appError("This agreement is already classified as defaulted.", 409);
    }
    if (Number(agreement.days_past_due || 0) < MINIMUM_DEFAULT_DAYS) {
      throw appError(
        `Default review requires at least ${MINIMUM_DEFAULT_DAYS} days past due.`,
        409,
        "FINANCE_DEFAULT_THRESHOLD_NOT_REACHED"
      );
    }
    await assertNoPendingRequest(connection, id, DEFAULT_REQUESTED);
    const schedule = await loadSchedule(connection, id, { lock: true });
    const snapshot = financialSnapshot(agreement, schedule);
    const activityId = await writeAuditEvent({
      connection,
      req,
      userId,
      workspaceCode: FINANCE_WORKSPACE,
      businessUnitId: agreement.business_unit_id,
      hireLocationId: agreement.hire_location_id,
      action: DEFAULT_REQUESTED,
      actionType: DEFAULT_REQUESTED,
      entityType: "equipment_sale_agreement",
      entityId: id,
      outcome: "pending",
      severity: "critical",
      details: `Requested independent default review for ${agreement.agreement_number}: ${reason}`,
      metadata: {
        agreement_number: agreement.agreement_number,
        customer_name: agreement.customer_name_snapshot || agreement.customer_name,
        customer_phone: agreement.customer_phone_snapshot || agreement.customer_phone,
        reason,
        evidence_reference: evidenceReference,
        customer_demand_summary: customerDemandSummary || null,
        guarantor_contact_summary: guarantorContactSummary || null,
        days_past_due_snapshot: Number(agreement.days_past_due || 0),
        financial_snapshot: snapshot,
        agreement_status_changed: false,
        balance_changed: false,
        schedule_changed: false,
        fleet_status_changed: false,
        automatic_sms_sent: false,
        independent_approval_required: true,
      },
    });
    if (!activityId) {
      throw appError(
        "The governance request could not be stored in the protected activity ledger.",
        503,
        "FINANCE_GOVERNANCE_LEDGER_UNAVAILABLE"
      );
    }
    return activityId;
  });

  return { request_activity_id: result, ...(await getFinanceGovernanceAccount(id)) };
}

async function loadRequestForDecision(connection, requestId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM activity_log
     WHERE id = ?
       AND workspace_code = ?
       AND entity_type = 'equipment_sale_agreement'
       AND action IN (?, ?)
     LIMIT 1 FOR UPDATE`,
    [Number(requestId), FINANCE_WORKSPACE, RESCHEDULE_REQUESTED, DEFAULT_REQUESTED]
  );
  if (!rows.length) {
    throw appError(
      "The Finance governance request was not found.",
      404,
      "FINANCE_GOVERNANCE_REQUEST_NOT_FOUND"
    );
  }
  return {
    ...rows[0],
    id: Number(rows[0].id),
    agreement_id: positiveId(rows[0].entity_id, "Agreement ID"),
    metadata: parseJson(rows[0].metadata_json, {}),
  };
}

async function assertRequestPending(connection, request) {
  const events = await loadGovernanceEvents(connection, [request.agreement_id]);
  const decision = events.find(
    (event) =>
      DECISION_ACTIONS.has(event.action) &&
      Number(event.metadata.request_activity_id || 0) === Number(request.id)
  );
  if (decision) {
    throw appError(
      `This request was already ${decision.outcome}.`,
      409,
      "FINANCE_GOVERNANCE_REQUEST_ALREADY_DECIDED"
    );
  }
}

function assertIndependentApprover(request, approverUserId) {
  if (Number(request.user_id || 0) === Number(approverUserId || 0)) {
    throw appError(
      "The staff member who prepared the request cannot approve or reject it.",
      409,
      "FINANCE_GOVERNANCE_INDEPENDENT_APPROVER_REQUIRED"
    );
  }
}

async function approveReschedule(connection, request, agreement, userId, req, decisionReason) {
  const reconciliation = await assertFinanceMutationSafe(agreement.id, {
    connection,
    lock: false,
  });
  agreement = { ...agreement, ...reconciliation.calculated };
  assertGovernableAgreement(agreement);
  const schedule = await loadSchedule(connection, agreement.id, { lock: true });
  const currentSnapshot = financialSnapshot(agreement, schedule);
  const requestSnapshot = request.metadata.financial_snapshot || {};
  if (!requestSnapshot.fingerprint || requestSnapshot.fingerprint !== currentSnapshot.fingerprint) {
    throw appError(
      "The account changed after this reschedule request. Create a new request from the current balances and schedule.",
      409,
      "FINANCE_RESCHEDULE_REQUEST_STALE"
    );
  }

  const frequency = cleanText(request.metadata.proposed_payment_frequency, 30);
  const count = Number(request.metadata.proposed_installment_count || 0);
  const firstDueDate = dateText(request.metadata.proposed_first_due_date);
  if (!PAYMENT_FREQUENCIES.has(frequency) || !count || !firstDueDate) {
    throw appError("The stored reschedule request is incomplete.", 409);
  }
  const proposedSchedule = buildSchedule(
    agreement.outstanding_balance,
    count,
    firstDueDate,
    frequency
  );
  const openRows = openScheduleRows(schedule);
  if (!openRows.length) {
    throw appError("There are no open schedule lines to reschedule.", 409);
  }
  const maxSequence = Math.max(0, ...schedule.map((row) => Number(row.sequence_number || 0)));

  await connection.query(
    `UPDATE equipment_installment_schedule
     SET schedule_status = 'rescheduled'
     WHERE agreement_id = ?
       AND schedule_status IN ('upcoming','due','partial','overdue')`,
    [agreement.id]
  );
  for (const row of proposedSchedule) {
    await connection.query(
      `INSERT INTO equipment_installment_schedule (
         agreement_id, sequence_number, due_date, scheduled_amount,
         amount_paid, late_charge_amount, waived_charge_amount, schedule_status
       ) VALUES (?, ?, ?, ?, 0, 0, 0,
         CASE WHEN ? = CURDATE() THEN 'due' ELSE 'upcoming' END)`,
      [
        agreement.id,
        maxSequence + row.sequence_offset,
        row.due_date,
        row.scheduled_amount,
        row.due_date,
      ]
    );
  }

  const finalDueDate = proposedSchedule.at(-1)?.due_date || firstDueDate;
  await connection.query(
    `UPDATE equipment_sale_agreements
     SET payment_frequency = ?,
         installment_count = ?,
         first_due_date = ?,
         next_due_date = ?,
         final_due_date = ?,
         overdue_amount = 0,
         agreement_status = CASE
           WHEN outstanding_balance <= 0.01 THEN 'completed'
           ELSE 'active'
         END
     WHERE id = ?`,
    [frequency, count, firstDueDate, firstDueDate, finalDueDate, agreement.id]
  );

  const refreshed = await refreshFinanceAgreementFromEvidence(connection, agreement.id);

  await writeAuditEvent({
    connection,
    req,
    userId,
    workspaceCode: FINANCE_WORKSPACE,
    businessUnitId: agreement.business_unit_id,
    hireLocationId: agreement.hire_location_id,
    action: RESCHEDULE_APPROVED,
    actionType: RESCHEDULE_APPROVED,
    entityType: "equipment_sale_agreement",
    entityId: agreement.id,
    outcome: "approved",
    severity: "warning",
    details: `Approved controlled reschedule request #${request.id} for ${agreement.agreement_number}.`,
    metadata: {
      request_activity_id: request.id,
      decision_reason: decisionReason,
      previous_schedule: currentSnapshot.open_schedule,
      replacement_schedule: proposedSchedule.map((row) => ({
        sequence_number: maxSequence + row.sequence_offset,
        due_date: row.due_date,
        scheduled_amount: row.scheduled_amount,
      })),
      previous_agreement_status: agreement.agreement_status,
      new_agreement_status:
        refreshed.calculated.agreement_status,
      outstanding_balance_preserved: refreshed.calculated.outstanding_balance,
      amount_paid_preserved: refreshed.calculated.amount_paid,
      paid_schedule_lines_preserved: true,
      payment_records_changed: false,
      balance_changed: false,
      automatic_sms_sent: false,
      hire_work_created: false,
      original_request_preserved: true,
    },
  });
}

async function approveDefault(connection, request, agreement, userId, req, decisionReason) {
  const reconciliation = await assertFinanceMutationSafe(agreement.id, {
    connection,
    lock: false,
  });
  agreement = { ...agreement, ...reconciliation.calculated };
  assertGovernableAgreement(agreement);
  if (agreement.agreement_status === "defaulted") {
    throw appError("This agreement is already classified as defaulted.", 409);
  }
  if (Number(agreement.days_past_due || 0) < MINIMUM_DEFAULT_DAYS) {
    throw appError(
      `The account no longer meets the ${MINIMUM_DEFAULT_DAYS}-day default threshold.`,
      409,
      "FINANCE_DEFAULT_THRESHOLD_NOT_REACHED"
    );
  }
  const schedule = await loadSchedule(connection, agreement.id, { lock: true });
  const currentSnapshot = financialSnapshot(agreement, schedule);
  const requestSnapshot = request.metadata.financial_snapshot || {};
  if (!requestSnapshot.fingerprint || requestSnapshot.fingerprint !== currentSnapshot.fingerprint) {
    throw appError(
      "The account changed after this default request. Create a new review from the current account position.",
      409,
      "FINANCE_DEFAULT_REQUEST_STALE"
    );
  }

  await connection.query(
    `UPDATE equipment_sale_agreements
     SET agreement_status = 'defaulted'
     WHERE id = ?`,
    [agreement.id]
  );
  await refreshFinanceAgreementFromEvidence(connection, agreement.id);
  await writeAuditEvent({
    connection,
    req,
    userId,
    workspaceCode: FINANCE_WORKSPACE,
    businessUnitId: agreement.business_unit_id,
    hireLocationId: agreement.hire_location_id,
    action: DEFAULT_APPROVED,
    actionType: DEFAULT_APPROVED,
    entityType: "equipment_sale_agreement",
    entityId: agreement.id,
    outcome: "approved",
    severity: "critical",
    details: `Declared ${agreement.agreement_number} defaulted after independent review of request #${request.id}.`,
    metadata: {
      request_activity_id: request.id,
      decision_reason: decisionReason,
      previous_agreement_status: agreement.agreement_status,
      new_agreement_status: "defaulted",
      days_past_due: Number(agreement.days_past_due || 0),
      outstanding_balance_preserved: Number(agreement.outstanding_balance || 0),
      overdue_amount_preserved: Number(agreement.overdue_amount || 0),
      schedule_changed: false,
      payment_records_changed: false,
      balance_changed: false,
      fleet_status_changed: false,
      ownership_status_changed: false,
      automatic_sms_sent: false,
      repossession_created: false,
      legal_action_created: false,
      original_request_preserved: true,
    },
  });
}

async function decideFinanceGovernanceRequest({
  requestId,
  decision,
  reason,
  userId,
  req,
}) {
  const id = positiveId(requestId, "Request ID");
  const normalizedDecision = cleanText(decision, 20).toLowerCase();
  if (!["approve", "reject"].includes(normalizedDecision)) {
    throw appError("Choose approve or reject.");
  }
  const decisionReason = cleanText(reason, 1000);
  if (decisionReason.length < 10) {
    throw appError("Enter an independent decision reason of at least 10 characters.");
  }

  const result = await withTransaction(async (connection) => {
    const request = await loadRequestForDecision(connection, id);
    assertIndependentApprover(request, userId);
    await assertRequestPending(connection, request);
    const agreement = await loadAgreement(connection, request.agreement_id, { lock: true });

    if (normalizedDecision === "approve") {
      if (request.action === RESCHEDULE_REQUESTED) {
        await approveReschedule(
          connection,
          request,
          agreement,
          userId,
          req,
          decisionReason
        );
      } else {
        await approveDefault(
          connection,
          request,
          agreement,
          userId,
          req,
          decisionReason
        );
      }
    } else {
      const action = request.action === RESCHEDULE_REQUESTED
        ? RESCHEDULE_REJECTED
        : DEFAULT_REJECTED;
      await writeAuditEvent({
        connection,
        req,
        userId,
        workspaceCode: FINANCE_WORKSPACE,
        businessUnitId: agreement.business_unit_id,
        hireLocationId: agreement.hire_location_id,
        action,
        actionType: action,
        entityType: "equipment_sale_agreement",
        entityId: agreement.id,
        outcome: "rejected",
        severity: "notice",
        details: `Rejected governance request #${request.id} for ${agreement.agreement_number}: ${decisionReason}`,
        metadata: {
          request_activity_id: request.id,
          decision_reason: decisionReason,
          agreement_status_changed: false,
          schedule_changed: false,
          payment_records_changed: false,
          balance_changed: false,
          original_request_preserved: true,
          automatic_sms_sent: false,
        },
      });
    }
    return request.agreement_id;
  });

  return getFinanceGovernanceAccount(result);
}

async function recordFinanceRecoveryAction({ agreementId, input, userId, req }) {
  const id = positiveId(agreementId, "Agreement ID");
  const actionType = cleanText(input?.action_type, 60).toLowerCase();
  if (!RECOVERY_ACTION_TYPES.has(actionType)) {
    throw appError("Choose a valid Finance recovery action.");
  }
  const notes = cleanText(input?.notes, 2500);
  const nextActionDate = cleanText(input?.next_action_date, 20)
    ? dateOnly(input.next_action_date, "Next action date")
    : null;
  const evidenceReference = cleanText(input?.evidence_reference, 500);
  const contactPerson = cleanText(input?.contact_person, 200);
  const contactPhone = cleanText(input?.contact_phone, 50);
  const actionLocation = cleanText(input?.action_location, 300);
  if (notes.length < 10) {
    throw appError("Enter a recovery note of at least 10 characters.");
  }
  if (
    ["settlement_review", "voluntary_surrender_review", "repossession_review", "legal_referral"].includes(actionType) &&
    !nextActionDate
  ) {
    throw appError("Choose the next review date for this recovery action.");
  }

  await withTransaction(async (connection) => {
    const agreement = await loadAgreement(connection, id, { lock: true });
    assertGovernableAgreement(agreement);
    if (agreement.agreement_status !== "defaulted") {
      throw appError(
        "Recovery governance actions are available only after an independent default decision.",
        409,
        "FINANCE_DEFAULT_REQUIRED"
      );
    }
    await writeAuditEvent({
      connection,
      req,
      userId,
      workspaceCode: FINANCE_WORKSPACE,
      businessUnitId: agreement.business_unit_id,
      hireLocationId: agreement.hire_location_id,
      action: RECOVERY_ACTION_RECORDED,
      actionType: RECOVERY_ACTION_RECORDED,
      entityType: "equipment_sale_agreement",
      entityId: id,
      outcome: "recorded",
      severity: ["repossession_review", "legal_referral"].includes(actionType)
        ? "critical"
        : "warning",
      details: `${actionType.replaceAll("_", " ")}: ${notes}`,
      metadata: {
        action_type: actionType,
        notes,
        next_action_date: nextActionDate,
        evidence_reference: evidenceReference || null,
        contact_person: contactPerson || null,
        contact_phone: contactPhone || null,
        action_location: actionLocation || null,
        agreement_number: agreement.agreement_number,
        customer_name: agreement.customer_name_snapshot || agreement.customer_name,
        asset_code: agreement.asset_code_snapshot || agreement.asset_code,
        outstanding_balance_snapshot: Number(agreement.outstanding_balance || 0),
        overdue_amount_snapshot: Number(agreement.overdue_amount || 0),
        balance_changed: false,
        schedule_changed: false,
        payment_records_changed: false,
        fleet_status_changed: false,
        ownership_status_changed: false,
        automatic_sms_sent: false,
        hire_work_created: false,
        legal_case_created: false,
        repossession_executed: false,
      },
    });
  });

  return getFinanceGovernanceAccount(id);
}

module.exports = {
  DEFAULT_APPROVED,
  DEFAULT_REJECTED,
  DEFAULT_REQUESTED,
  GOVERNANCE_QUEUES,
  MAX_PLAN_INSTALLMENTS,
  MINIMUM_DEFAULT_DAYS,
  PAYMENT_FREQUENCIES,
  RECOVERY_ACTION_RECORDED,
  RECOVERY_ACTION_TYPES,
  RESCHEDULE_APPROVED,
  RESCHEDULE_REJECTED,
  RESCHEDULE_REQUESTED,
  decideFinanceGovernanceRequest,
  getFinanceGovernanceAccount,
  governancePolicy,
  listFinanceGovernance,
  recordFinanceRecoveryAction,
  requestFinanceDefaultReview,
  requestFinanceReschedule,
};