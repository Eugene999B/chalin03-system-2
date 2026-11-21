const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  agingBucket,
  listInstallmentCollections,
} = require("./equipmentInstallmentReadModelService");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const LEGACY_FOLLOW_UP_ACTION = "EQUIPMENT_INSTALLMENT_FOLLOW_UP_RECORDED";
const FOLLOW_UP_ACTION = "EQUIPMENT_FINANCE_COLLECTION_FOLLOW_UP_RECORDED";
const CORRECTION_ACTION = "EQUIPMENT_FINANCE_COLLECTION_FOLLOW_UP_CORRECTED";
const MAX_EVENTS = 3000;

const FOLLOW_UP_TYPES = new Set([
  "phone_call",
  "field_visit",
  "promise_to_pay",
  "guarantor_contact",
  "recovery_review",
  "account_note",
]);

const FOLLOW_UP_OUTCOMES = new Set([
  "reached",
  "not_reached",
  "promised_payment",
  "paid_or_settled",
  "disputed",
  "reschedule_requested",
  "guarantor_engaged",
  "escalated",
  "note_only",
]);

const QUEUES = new Set([
  "all",
  "due_today",
  "overdue",
  "broken_promises",
  "follow_up_due",
  "never_contacted",
  "high_risk",
]);

function appError(message, statusCode = 400, code = "FINANCE_ARREARS_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value, label = "ID") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw appError(`${label} must be a positive whole number.`, 400, "INVALID_IDENTIFIER");
  }
  return number;
}

function moneyValue(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Number(number.toFixed(2))
    : undefined;
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
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

function dateCompare(left, right) {
  if (!left || !right) return null;
  const a = new Date(`${left}T00:00:00Z`);
  const b = new Date(`${right}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function financePolicy() {
  return {
    division: "installment_finance",
    scope: "company_wide",
    hire_location_selection_required: false,
    hire_workflow_access: false,
    automatic_sms_enabled: false,
    financial_values_mutable: false,
    correction_method: "append_only_audit_evidence",
    statement_source: "existing_finance_agreement_documents",
  };
}

async function loadFinanceAccounts() {
  const result = await listInstallmentCollections();
  return (result.accounts || []).filter(
    (account) =>
      account.sale_type === "installment" &&
      account.activation_source === "approved_credit_application"
  );
}

async function requireFinanceAgreement(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT
       agreement.*,
       location.name AS finance_location_name,
       location.code AS finance_location_code,
       business_unit.id AS business_unit_id,
       customer.customer_name,
       customer.phone AS customer_phone,
       customer.email AS customer_email,
       customer.address AS customer_address,
       customer.customer_type,
       asset.asset_code,
       asset.asset_name,
       asset.main_image_url,
       asset.registration_number,
       asset.serial_number,
       asset.chassis_number,
       asset.engine_number
     FROM equipment_sale_agreements agreement
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
     LEFT JOIN business_units business_unit ON business_unit.id = location.business_unit_id
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1`,
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

async function loadActivityEvents(connection, agreementIds) {
  const ids = [...new Set((agreementIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT
       activity.id,
       activity.action,
       activity.details,
       activity.outcome,
       activity.severity,
       activity.metadata_json,
       activity.entity_id,
       activity.created_at,
       activity.user_id,
       user.full_name AS recorded_by_name,
       user.username AS recorded_by_username
     FROM activity_log activity
     LEFT JOIN users user ON user.id = activity.user_id
     WHERE activity.entity_type = 'equipment_sale_agreement'
       AND activity.entity_id IN (${placeholders})
       AND activity.action IN (?, ?, ?)
       AND activity.workspace_code = ?
     ORDER BY activity.created_at ASC, activity.id ASC
     LIMIT ${MAX_EVENTS}`,
    [
      ...ids.map(String),
      FOLLOW_UP_ACTION,
      CORRECTION_ACTION,
      LEGACY_FOLLOW_UP_ACTION,
      FINANCE_WORKSPACE,
    ]
  );
  return rows.map((row) => ({
    ...row,
    agreement_id: Number(row.entity_id),
    metadata: parseJson(row.metadata_json, {}),
  }));
}

function effectiveFollowUps(events) {
  const originals = new Map();
  const corrections = [];

  for (const event of events) {
    if (event.action === CORRECTION_ACTION) corrections.push(event);
    else {
      originals.set(Number(event.id), {
        id: Number(event.id),
        agreement_id: Number(event.agreement_id),
        action: event.action,
        details: event.details,
        outcome: event.outcome,
        severity: event.severity,
        created_at: event.created_at,
        recorded_by_name: event.recorded_by_name || event.recorded_by_username || "System",
        metadata: { ...event.metadata },
        corrections: [],
      });
    }
  }

  for (const correction of corrections) {
    const originalId = Number(
      correction.metadata.original_activity_id ||
        correction.metadata.corrects_activity_id ||
        0
    );
    const original = originals.get(originalId);
    if (!original) continue;
    const corrected = correction.metadata.corrected_follow_up || {};
    original.metadata = { ...original.metadata, ...corrected };
    original.outcome = corrected.outcome || original.outcome;
    original.details = corrected.notes
      ? `${cleanText(corrected.follow_up_type || original.metadata.follow_up_type, 50).replaceAll("_", " ")}: ${cleanText(corrected.notes, 2000)}`
      : original.details;
    original.corrected_at = correction.created_at;
    original.corrected_by_name =
      correction.recorded_by_name || correction.recorded_by_username || "System";
    original.correction_reason = correction.metadata.correction_reason || null;
    original.corrections.push({
      id: Number(correction.id),
      created_at: correction.created_at,
      recorded_by_name:
        correction.recorded_by_name || correction.recorded_by_username || "System",
      correction_reason: correction.metadata.correction_reason || null,
      corrected_follow_up: corrected,
    });
  }

  return [...originals.values()].sort((left, right) => {
    const leftTime = new Date(left.corrected_at || left.created_at).getTime();
    const rightTime = new Date(right.corrected_at || right.created_at).getTime();
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.id - left.id;
  });
}

async function loadPaymentEvidence(connection, agreementIds) {
  const ids = [...new Set((agreementIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT payment.agreement_id, payment.id, payment.amount,
            payment.payment_date, payment.created_at
       FROM equipment_sale_payments payment
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
      WHERE payment.agreement_id IN (${placeholders})
        AND payment.is_voided = FALSE
        AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
      ORDER BY payment.payment_date, payment.id`,
    ids
  );
  const byAgreement = new Map();
  for (const row of rows) {
    const agreementId = Number(row.agreement_id);
    if (!byAgreement.has(agreementId)) byAgreement.set(agreementId, []);
    byAgreement.get(agreementId).push(row);
  }
  return byAgreement;
}

function promiseProfile(account, followUps, payments = [], today = ghanaToday()) {
  const promise = followUps.find(
    (entry) => dateText(entry.metadata.promise_date) && Number(entry.metadata.promise_amount || 0) > 0
  );
  if (!promise) {
    return {
      promise_status: "none",
      promise_date: null,
      promise_amount: 0,
      promise_recorded_at: null,
    };
  }

  const promiseDate = dateText(promise.metadata.promise_date);
  const promiseAmount = Number(promise.metadata.promise_amount || 0);
  const snapshot = Number(
    promise.metadata.outstanding_balance_snapshot ??
      promise.metadata.outstanding_balance ??
      account.outstanding_balance ??
      0
  );
  const outstanding = Number(account.outstanding_balance || 0);
  const promiseRecordedAt = new Date(promise.corrected_at || promise.created_at).getTime();
  const paymentBackedAmount = Number(
    payments
      .filter((payment) => {
        const paidAt = new Date(payment.created_at || payment.payment_date).getTime();
        return Number.isFinite(paidAt) && paidAt > promiseRecordedAt;
      })
      .reduce((total, payment) => total + Number(payment.amount || 0), 0)
      .toFixed(2)
  );

  let status = "pending";
  if (outstanding <= 0.01) status = "settled";
  else if (paymentBackedAmount + 0.01 >= promiseAmount) status = "kept";
  else {
    const difference = dateCompare(promiseDate, today);
    if (difference === 0) status = "due_today";
    else if (difference !== null && difference < 0) status = "broken";
  }

  return {
    promise_status: status,
    promise_date: promiseDate,
    promise_amount: promiseAmount,
    promise_recorded_at: promise.created_at,
    promise_activity_id: promise.id,
    promise_payment_backed_amount: paymentBackedAmount,
    promise_balance_snapshot: snapshot,
  };
}

function nextActionProfile(followUps, today = ghanaToday()) {
  const action = followUps.find((entry) => dateText(entry.metadata.next_action_date));
  if (!action) {
    return {
      next_action_status: "none",
      next_action_date: null,
      next_action_activity_id: null,
    };
  }
  const actionDate = dateText(action.metadata.next_action_date);
  const difference = dateCompare(actionDate, today);
  let status = "upcoming";
  if (difference === 0) status = "due_today";
  else if (difference !== null && difference < 0) status = "overdue";
  return {
    next_action_status: status,
    next_action_date: actionDate,
    next_action_activity_id: action.id,
  };
}

function enrichAccount(account, followUps = [], payments = []) {
  const latest = followUps[0] || null;
  return {
    ...account,
    aging_bucket: agingBucket(account),
    latest_follow_up: latest,
    last_follow_up_at: latest?.corrected_at || latest?.created_at || null,
    last_follow_up_type: latest?.metadata?.follow_up_type || null,
    last_follow_up_outcome: latest?.metadata?.outcome || latest?.outcome || null,
    ...promiseProfile(account, followUps, payments),
    ...nextActionProfile(followUps),
    statement_url: `/equipment-catalogue/sales/agreements/${account.id}/documents/statement.pdf`,
    overdue_notice_url: `/equipment-catalogue/sales/agreements/${account.id}/documents/overdue.pdf`,
  };
}

function queueMatches(account, queue) {
  if (queue === "all") return true;
  if (queue === "due_today") return Number(account.days_until_due) === 0;
  if (queue === "overdue") {
    return Number(account.days_past_due || 0) > 0 || Number(account.overdue_amount || 0) > 0.01;
  }
  if (queue === "broken_promises") return account.promise_status === "broken";
  if (queue === "follow_up_due") {
    return ["due_today", "overdue"].includes(account.next_action_status);
  }
  if (queue === "never_contacted") return !account.last_follow_up_at;
  if (queue === "high_risk") return ["high", "critical"].includes(account.risk_band);
  return true;
}

function buildSummary(accounts) {
  return accounts.reduce(
    (summary, account) => {
      summary.accounts += 1;
      summary.outstanding_amount += Number(account.outstanding_balance || 0);
      summary.overdue_amount += Number(account.overdue_amount || 0);
      if (Number(account.days_until_due) === 0) summary.due_today += 1;
      if (Number(account.days_past_due || 0) > 0) summary.overdue_accounts += 1;
      if (account.promise_status === "broken") summary.broken_promises += 1;
      if (account.promise_status === "due_today") summary.promises_due_today += 1;
      if (["due_today", "overdue"].includes(account.next_action_status)) {
        summary.follow_ups_due += 1;
      }
      if (!account.last_follow_up_at) summary.never_contacted += 1;
      if (["high", "critical"].includes(account.risk_band)) summary.high_risk += 1;
      return summary;
    },
    {
      accounts: 0,
      due_today: 0,
      overdue_accounts: 0,
      broken_promises: 0,
      promises_due_today: 0,
      follow_ups_due: 0,
      never_contacted: 0,
      high_risk: 0,
      outstanding_amount: 0,
      overdue_amount: 0,
    }
  );
}

async function listFinanceArrears({
  search = "",
  status = "",
  risk = "",
  aging = "",
  queue = "all",
  limit = 300,
} = {}) {
  const cleanQueue = cleanText(queue, 40).toLowerCase() || "all";
  if (!QUEUES.has(cleanQueue)) {
    throw appError("Choose a valid Finance collections queue.");
  }

  const accounts = await loadFinanceAccounts();
  const agreementIds = accounts.map((account) => account.id);
  const [events, paymentsByAgreement] = await Promise.all([
    loadActivityEvents(pool, agreementIds).then(effectiveFollowUps),
    loadPaymentEvidence(pool, agreementIds),
  ]);
  const eventsByAgreement = new Map();
  for (const event of events) {
    const list = eventsByAgreement.get(event.agreement_id) || [];
    list.push(event);
    eventsByAgreement.set(event.agreement_id, list);
  }

  const term = cleanText(search, 150).toLowerCase();
  const cleanStatus = cleanText(status, 40).toLowerCase();
  const cleanRisk = cleanText(risk, 20).toLowerCase();
  const cleanAging = cleanText(aging, 30).toLowerCase();
  const enriched = accounts.map((account) =>
    enrichAccount(
      account,
      eventsByAgreement.get(Number(account.id)) || [],
      paymentsByAgreement.get(Number(account.id)) || []
    )
  );

  const filtered = enriched.filter((account) => {
    if (cleanStatus && account.agreement_status !== cleanStatus) return false;
    if (cleanRisk && account.risk_band !== cleanRisk) return false;
    if (cleanAging && account.aging_bucket !== cleanAging) return false;
    if (!queueMatches(account, cleanQueue)) return false;
    if (!term) return true;
    return [
      account.agreement_number,
      account.customer_name_snapshot,
      account.customer_phone_snapshot,
      account.asset_code_snapshot,
      account.asset_name_snapshot,
      account.finance_location_name,
      account.hire_location_name,
      account.guarantor_name,
      account.guarantor_phone,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  filtered.sort((left, right) => {
    const queueRank = (account) => {
      if (account.promise_status === "broken") return 0;
      if (account.next_action_status === "overdue") return 1;
      if (Number(account.days_past_due || 0) > 0) return 2;
      if (Number(account.days_until_due) === 0) return 3;
      return 4;
    };
    const rank = queueRank(left) - queueRank(right);
    if (rank !== 0) return rank;
    return Number(right.risk_score || 0) - Number(left.risk_score || 0);
  });

  const safeLimit = Number(limit) > 0 ? Number(limit) : filtered.length;
  return {
    generated_at: new Date().toISOString(),
    count: filtered.length,
    accounts: filtered.slice(0, safeLimit),
    summary: buildSummary(enriched),
    queue: cleanQueue,
    options: {
      queues: [...QUEUES],
      follow_up_types: [...FOLLOW_UP_TYPES],
      follow_up_outcomes: [...FOLLOW_UP_OUTCOMES],
    },
    policy: financePolicy(),
  };
}

async function getFinanceArrearsAccount(agreementId) {
  const id = positiveId(agreementId, "Agreement ID");
  const agreement = await requireFinanceAgreement(pool, id);
  const accounts = await loadFinanceAccounts();
  const derived = accounts.find((account) => Number(account.id) === id) || agreement;
  const followUps = effectiveFollowUps(await loadActivityEvents(pool, [id]));
  const paymentEvidence = await loadPaymentEvidence(pool, [id]);

  const [[schedule], [payments], [deliveries], [ownership]] = await Promise.all([
    pool.query(
      `SELECT *
       FROM equipment_installment_schedule
       WHERE agreement_id = ?
       ORDER BY sequence_number`,
      [id]
    ),
    pool.query(
      `SELECT payment.*, user.full_name AS received_by_name
       FROM equipment_sale_payments payment
       LEFT JOIN users user ON user.id = payment.received_by
       WHERE payment.agreement_id = ?
       ORDER BY payment.payment_date DESC, payment.id DESC`,
      [id]
    ),
    pool.query(
      `SELECT *
       FROM equipment_deliveries
       WHERE agreement_id = ?
       ORDER BY created_at DESC, id DESC`,
      [id]
    ),
    pool.query(
      `SELECT *
       FROM equipment_ownership_transfers
       WHERE agreement_id = ?
       ORDER BY created_at DESC, id DESC`,
      [id]
    ),
  ]);

  return {
    account: enrichAccount({ ...agreement, ...derived }, followUps, paymentEvidence.get(id) || []),
    schedule,
    payments,
    deliveries,
    ownership_transfers: ownership,
    follow_ups: followUps,
    options: {
      follow_up_types: [...FOLLOW_UP_TYPES],
      follow_up_outcomes: [...FOLLOW_UP_OUTCOMES],
    },
    policy: financePolicy(),
  };
}

function validateFollowUp(input, agreement, existing = {}) {
  const followUpType = cleanText(
    input.follow_up_type ?? existing.follow_up_type,
    50
  ).toLowerCase();
  const outcome = cleanText(input.outcome ?? existing.outcome, 50).toLowerCase();
  const notes = cleanText(input.notes ?? existing.notes, 2000);
  const promiseDate = dateOnly(input.promise_date ?? existing.promise_date);
  const promiseAmount = moneyValue(
    input.promise_amount ?? existing.promise_amount,
    0
  );
  const nextActionDate = dateOnly(
    input.next_action_date ?? existing.next_action_date
  );

  if (!FOLLOW_UP_TYPES.has(followUpType)) {
    throw appError("Choose a valid Finance collection follow-up type.");
  }
  if (!FOLLOW_UP_OUTCOMES.has(outcome)) {
    throw appError("Choose a valid Finance collection outcome.");
  }
  if (notes.length < 3) {
    throw appError("Enter a clear Finance collection note.");
  }
  if (promiseDate === undefined || nextActionDate === undefined || promiseAmount === undefined) {
    throw appError("Check the promise amount and follow-up dates.");
  }
  if (outcome === "promised_payment") {
    if (!promiseDate || Number(promiseAmount || 0) <= 0) {
      throw appError("A promise to pay requires both a date and an amount.");
    }
    if (Number(promiseAmount) > Number(agreement.outstanding_balance || 0) + 0.01) {
      throw appError("Promise amount cannot exceed the current outstanding balance.");
    }
  }
  if (
    ["not_reached", "promised_payment", "disputed", "reschedule_requested", "guarantor_engaged", "escalated"].includes(outcome) &&
    !nextActionDate
  ) {
    throw appError("Choose the next Finance follow-up date for this outcome.");
  }

  return {
    follow_up_type: followUpType,
    outcome,
    notes,
    promise_date: promiseDate,
    promise_amount: Number(promiseAmount || 0),
    next_action_date: nextActionDate,
  };
}

async function recordFinanceCollectionFollowUp({
  agreementId,
  input,
  userId,
  req,
}) {
  const id = positiveId(agreementId, "Agreement ID");
  const agreement = await requireFinanceAgreement(pool, id);
  const validated = validateFollowUp(input || {}, agreement);

  await writeAuditEvent({
    connection: pool,
    req,
    userId,
    workspaceCode: FINANCE_WORKSPACE,
    businessUnitId: agreement.business_unit_id,
    hireLocationId: agreement.hire_location_id,
    action: FOLLOW_UP_ACTION,
    actionType: FOLLOW_UP_ACTION,
    entityType: "equipment_sale_agreement",
    entityId: id,
    outcome: validated.outcome,
    severity: ["escalated", "disputed"].includes(validated.outcome)
      ? "warning"
      : "notice",
    details: `${validated.follow_up_type.replaceAll("_", " ")}: ${validated.notes}`,
    metadata: {
      ...validated,
      agreement_number: agreement.agreement_number,
      customer_name: agreement.customer_name_snapshot || agreement.customer_name,
      customer_phone: agreement.customer_phone_snapshot || agreement.customer_phone,
      outstanding_balance_snapshot: Number(agreement.outstanding_balance || 0),
      overdue_amount_snapshot: Number(agreement.overdue_amount || 0),
      finance_location_id: agreement.hire_location_id || null,
      finance_location_name: agreement.finance_location_name || null,
      financial_values_changed: false,
      automatic_sms_sent: false,
      hire_work_created: false,
    },
  });

  return getFinanceArrearsAccount(id);
}

async function correctFinanceCollectionFollowUp({
  agreementId,
  followUpId,
  input,
  userId,
  req,
}) {
  const id = positiveId(agreementId, "Agreement ID");
  const activityId = positiveId(followUpId, "Follow-up ID");
  const agreement = await requireFinanceAgreement(pool, id);
  const followUps = effectiveFollowUps(await loadActivityEvents(pool, [id]));
  const original = followUps.find((entry) => Number(entry.id) === activityId);
  if (!original) {
    throw appError(
      "The Finance collection follow-up was not found.",
      404,
      "FINANCE_FOLLOW_UP_NOT_FOUND"
    );
  }

  const correctionReason = cleanText(input?.correction_reason, 500);
  if (correctionReason.length < 5) {
    throw appError("Enter a correction reason of at least 5 characters.");
  }

  const corrected = validateFollowUp(
    input?.corrected_follow_up || input || {},
    agreement,
    original.metadata
  );

  await writeAuditEvent({
    connection: pool,
    req,
    userId,
    workspaceCode: FINANCE_WORKSPACE,
    businessUnitId: agreement.business_unit_id,
    hireLocationId: agreement.hire_location_id,
    action: CORRECTION_ACTION,
    actionType: CORRECTION_ACTION,
    entityType: "equipment_sale_agreement",
    entityId: id,
    outcome: "corrected",
    severity: "notice",
    details: `Corrected Finance collection follow-up #${activityId}: ${correctionReason}`,
    metadata: {
      original_activity_id: activityId,
      correction_reason: correctionReason,
      corrected_follow_up: corrected,
      previous_follow_up: {
        follow_up_type: original.metadata.follow_up_type,
        outcome: original.metadata.outcome || original.outcome,
        notes: original.metadata.notes,
        promise_date: original.metadata.promise_date,
        promise_amount: original.metadata.promise_amount,
        next_action_date: original.metadata.next_action_date,
      },
      agreement_number: agreement.agreement_number,
      financial_values_changed: false,
      automatic_sms_sent: false,
      original_record_preserved: true,
    },
  });

  return getFinanceArrearsAccount(id);
}

module.exports = {
  CORRECTION_ACTION,
  FOLLOW_UP_ACTION,
  FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_TYPES,
  QUEUES,
  correctFinanceCollectionFollowUp,
  effectiveFollowUps,
  financePolicy,
  getFinanceArrearsAccount,
  listFinanceArrears,
  recordFinanceCollectionFollowUp,
};
