const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { nextDocumentNumber } = require("./groupConfigurationService");
const {
  refreshFinanceAgreementFromEvidence,
} = require("./equipmentFinanceReconciliationService");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const POLICY_ID = 1;
const REQUEST_TYPES = new Set([
  "draft_cancellation",
  "payment_reversal",
  "asset_return",
  "repossession",
  "charge_waiver",
]);
const RETURN_TYPES = new Set(["voluntary_return", "repossession"]);
const RETURN_CONDITIONS = new Set([
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
  "under_inspection",
]);
const REQUIRED_TABLES = Object.freeze([
  "equipment_finance_asset_returns",
  "equipment_finance_correction_policies",
  "equipment_finance_correction_policy_history",
  "equipment_finance_correction_requests",
  "equipment_finance_ledger_entries",
]);

class FinanceCorrectionError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_CORRECTION_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function appError(message, statusCode = 400, code) {
  return new FinanceCorrectionError(statusCode, message, code);
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

function nonNegativeMoney(value, label, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).replaceAll(",", "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw appError(`${label} must be a valid non-negative amount.`);
  }
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 10000000000) {
    throw appError(`${label} is outside the permitted range.`);
  }
  return Number(number.toFixed(2));
}

function percentage(value, label, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw appError(`${label} must be between 0 and 100.`);
  }
  return Number(number.toFixed(4));
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if ([true, 1, "1", "true", "yes", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "no", "off"].includes(value)) return false;
  throw appError("Enter a valid yes or no value.");
}

function dateOnly(value, label = "Date") {
  const text = cleanText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw appError(`${label} must be a valid date.`);
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw appError(`${label} must be a valid date.`);
  return text;
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

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function userId(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function ghanaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function schemaStatus(connection = pool) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    REQUIRED_TABLES
  );
  const present = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));
  return {
    ready: missing.length === 0,
    migration: "20260801_equipment_finance_phase4_corrections_settlements",
    missing_tables: missing,
  };
}

async function assertSchemaReady(connection = pool) {
  const readiness = await schemaStatus(connection);
  if (!readiness.ready) {
    const error = appError(
      "Finance corrections and return settlements are awaiting the approved additive Phase 4 migration.",
      503,
      "EQUIPMENT_FINANCE_PHASE4_MIGRATION_REQUIRED"
    );
    error.readiness = readiness;
    throw error;
  }
  return readiness;
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

async function financeNumber(sequence, prefix, actorId) {
  try {
    return await nextDocumentNumber(sequence, { userId: actorId || null });
  } catch {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `${prefix}-${stamp}-${String(crypto.randomInt(0, 1000000)).padStart(6, "0")}`;
  }
}

function publicPolicy(row) {
  return {
    id: Number(row.id),
    policy_version: row.policy_version,
    return_credit_method: row.return_credit_method,
    default_return_credit_percent: Number(row.default_return_credit_percent || 0),
    refundable_amount_method: row.refundable_amount_method,
    maximum_penalty_percent: Number(row.maximum_penalty_percent || 0),
    maximum_damage_charge_percent: Number(row.maximum_damage_charge_percent || 0),
    allow_customer_refund_due: Boolean(row.allow_customer_refund_due),
    require_independent_approval: Boolean(row.require_independent_approval),
    require_return_evidence: Boolean(row.require_return_evidence),
    require_payment_reversal_evidence: Boolean(row.require_payment_reversal_evidence),
    return_terms: row.return_terms,
    updated_by: userId(row.updated_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getCorrectionPolicy(connection = pool, { lock = false } = {}) {
  await assertSchemaReady(connection);
  const [rows] = await connection.query(
    `SELECT * FROM equipment_finance_correction_policies
     WHERE id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [POLICY_ID]
  );
  if (!rows.length) {
    throw appError(
      "The Finance correction policy was not found.",
      503,
      "EQUIPMENT_FINANCE_CORRECTION_POLICY_MISSING"
    );
  }
  return publicPolicy(rows[0]);
}

async function updateCorrectionPolicy({ input, actorId, req }) {
  const reason = cleanText(input?.change_reason, 1000);
  if (reason.length < 10) throw appError("Enter a policy change reason of at least 10 characters.");

  return withTransaction(async (connection) => {
    await assertSchemaReady(connection);
    const current = await getCorrectionPolicy(connection, { lock: true });
    const next = {
      policy_version: cleanText(input?.policy_version, 60) || current.policy_version,
      return_credit_method: "approved_amount",
      default_return_credit_percent: percentage(
        input?.default_return_credit_percent,
        "Default return credit percent",
        current.default_return_credit_percent
      ),
      refundable_amount_method: "approved_amount",
      maximum_penalty_percent: percentage(
        input?.maximum_penalty_percent,
        "Maximum penalty percent",
        current.maximum_penalty_percent
      ),
      maximum_damage_charge_percent: percentage(
        input?.maximum_damage_charge_percent,
        "Maximum damage charge percent",
        current.maximum_damage_charge_percent
      ),
      allow_customer_refund_due: booleanValue(
        input?.allow_customer_refund_due,
        current.allow_customer_refund_due
      ),
      require_independent_approval: true,
      require_return_evidence: true,
      require_payment_reversal_evidence: true,
      return_terms: cleanText(input?.return_terms, 10000) || current.return_terms,
    };
    if (!next.policy_version || next.return_terms.length < 30) {
      throw appError("Record a policy version and detailed return terms.");
    }

    await connection.query(
      `INSERT INTO equipment_finance_correction_policy_history (
         policy_id, old_snapshot_json, new_snapshot_json, change_reason, changed_by
       ) VALUES (?, ?, ?, ?, ?)`,
      [POLICY_ID, JSON.stringify(current), JSON.stringify(next), reason, actorId || null]
    );
    await connection.query(
      `UPDATE equipment_finance_correction_policies
       SET policy_version = ?, return_credit_method = ?,
           default_return_credit_percent = ?, refundable_amount_method = ?,
           maximum_penalty_percent = ?, maximum_damage_charge_percent = ?,
           allow_customer_refund_due = ?, require_independent_approval = TRUE,
           require_return_evidence = TRUE,
           require_payment_reversal_evidence = TRUE,
           return_terms = ?, updated_by = ?
       WHERE id = ?`,
      [
        next.policy_version,
        next.return_credit_method,
        next.default_return_credit_percent,
        next.refundable_amount_method,
        next.maximum_penalty_percent,
        next.maximum_damage_charge_percent,
        next.allow_customer_refund_due,
        next.return_terms,
        actorId || null,
        POLICY_ID,
      ]
    );
    await writeAuditEvent({
      connection,
      req,
      userId: actorId || null,
      workspaceCode: FINANCE_WORKSPACE,
      action: "EQUIPMENT_FINANCE_CORRECTION_POLICY_UPDATED",
      actionType: "EQUIPMENT_FINANCE_CORRECTION_POLICY_UPDATED",
      entityType: "equipment_finance_correction_policy",
      entityId: POLICY_ID,
      outcome: "updated",
      severity: "warning",
      details: `Updated Finance correction policy to ${next.policy_version}: ${reason}`,
      metadata: { old_policy: current, new_policy: next, change_reason: reason },
    });
    return getCorrectionPolicy(connection);
  });
}

async function loadAgreement(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT
       agreement.*,
       customer.customer_name,
       customer.phone AS customer_phone,
       asset.asset_code,
       asset.asset_name,
       asset.current_meter,
       asset.condition_status AS asset_condition_status,
       asset.sale_status AS asset_sale_status,
       asset.is_active AS asset_is_active,
       delivery.id AS delivery_id,
       delivery.status AS delivery_record_status,
       ownership.id AS ownership_id,
       ownership.status AS ownership_record_status,
       (SELECT COUNT(*) FROM hire_contract_assets hire_asset
         WHERE hire_asset.asset_id = agreement.asset_id
           AND hire_asset.status IN ('assigned','dispatched','active')) AS active_hire_count
     FROM equipment_sale_agreements agreement
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     LEFT JOIN equipment_deliveries delivery ON delivery.agreement_id = agreement.id
     LEFT JOIN equipment_ownership_transfers ownership
       ON ownership.agreement_id = agreement.id AND ownership.status <> 'revoked'
     WHERE agreement.id = ?
       AND agreement.sale_type = 'installment'
       AND agreement.activation_source = 'approved_credit_application'
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [agreementId]
  );
  if (!rows.length) {
    throw appError(
      "The controlled Finance installment agreement was not found.",
      404,
      "EQUIPMENT_FINANCE_AGREEMENT_NOT_FOUND"
    );
  }
  return rows[0];
}

async function loadSchedule(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT * FROM equipment_installment_schedule
     WHERE agreement_id = ? ORDER BY sequence_number, id ${lock ? "FOR UPDATE" : ""}`,
    [agreementId]
  );
  return rows;
}

async function loadPayments(connection, agreementId, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT payment.*, user.full_name AS received_by_name
     FROM equipment_sale_payments payment
     LEFT JOIN users user ON user.id = payment.received_by
     WHERE payment.agreement_id = ?
     ORDER BY payment.payment_date DESC, payment.id DESC ${lock ? "FOR UPDATE" : ""}`,
    [agreementId]
  );
  return rows;
}

async function loadLedger(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT ledger.*, user.full_name AS posted_by_name
     FROM equipment_finance_ledger_entries ledger
     LEFT JOIN users user ON user.id = ledger.posted_by
     WHERE ledger.agreement_id = ?
     ORDER BY ledger.posted_at DESC, ledger.id DESC`,
    [agreementId]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    amount: Number(row.amount || 0),
    balance_before: Number(row.balance_before || 0),
    balance_after: Number(row.balance_after || 0),
    metadata: parseJson(row.metadata_json, {}),
  }));
}

async function loadRequests(connection, agreementId = null, status = null) {
  const where = [];
  const params = [];
  if (agreementId) {
    where.push("request.agreement_id = ?");
    params.push(agreementId);
  }
  if (status && status !== "all") {
    where.push("request.request_status = ?");
    params.push(status);
  }
  const [rows] = await connection.query(
    `SELECT request.*,
            requester.full_name AS requested_by_name,
            decider.full_name AS decided_by_name,
            agreement.agreement_number,
            agreement.customer_name_snapshot,
            agreement.asset_code_snapshot,
            agreement.asset_name_snapshot
     FROM equipment_finance_correction_requests request
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = request.agreement_id
     LEFT JOIN users requester ON requester.id = request.requested_by
     LEFT JOIN users decider ON decider.id = request.decided_by
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY request.created_at DESC, request.id DESC
     `,
    params
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    agreement_id: Number(row.agreement_id),
    payment_id: row.payment_id ? Number(row.payment_id) : null,
    schedule_id: row.schedule_id ? Number(row.schedule_id) : null,
    policy_snapshot: parseJson(row.policy_snapshot_json, {}),
    financial_snapshot: parseJson(row.financial_snapshot_json, {}),
    proposed_entries: parseJson(row.proposed_entries_json, []),
  }));
}

async function loadReturns(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT asset_return.*, received.full_name AS received_by_name,
            approver.full_name AS approved_by_name
     FROM equipment_finance_asset_returns asset_return
     LEFT JOIN users received ON received.id = asset_return.received_by
     LEFT JOIN users approver ON approver.id = asset_return.approved_by
     WHERE asset_return.agreement_id = ?
     ORDER BY asset_return.created_at DESC, asset_return.id DESC`,
    [agreementId]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    approved_return_credit: Number(row.approved_return_credit || 0),
    refundable_amount: Number(row.refundable_amount || 0),
    penalty_amount: Number(row.penalty_amount || 0),
    damage_amount: Number(row.damage_amount || 0),
    settlement_balance: Number(row.settlement_balance || 0),
    refund_due: Number(row.refund_due || 0),
  }));
}

async function balanceComponents(connection, agreementId) {
  const [[paymentRow], [chargeRows], [ledgerRows]] = await Promise.all([
    connection.query(
      `SELECT
         COALESCE(SUM(CASE WHEN is_voided = FALSE THEN amount ELSE 0 END), 0) AS paid,
         COALESCE(SUM(CASE WHEN is_voided = FALSE AND payment_category = 'deposit' THEN amount ELSE 0 END), 0) AS deposits
       FROM equipment_sale_payments WHERE agreement_id = ?`,
      [agreementId]
    ),
    connection.query(
      `SELECT COALESCE(SUM(GREATEST(late_charge_amount - waived_charge_amount, 0)), 0) AS charges
       FROM equipment_installment_schedule
       WHERE agreement_id = ? AND schedule_status <> 'rescheduled'`,
      [agreementId]
    ),
    connection.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) AS debits,
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS credits
       FROM equipment_finance_ledger_entries WHERE agreement_id = ?`,
      [agreementId]
    ),
  ]);
  return {
    paid: Number(paymentRow[0]?.paid || 0),
    deposits: Number(paymentRow[0]?.deposits || 0),
    schedule_charges: Number(chargeRows[0]?.charges || 0),
    ledger_debits: Number(ledgerRows[0]?.debits || 0),
    ledger_credits: Number(ledgerRows[0]?.credits || 0),
  };
}

async function refreshFinanceAgreement(connection, agreementId) {
  const reconciliation = await refreshFinanceAgreementFromEvidence(connection, agreementId);
  const calculated = reconciliation.calculated;
  return {
    paid: calculated.amount_paid,
    deposits: calculated.deposit_received,
    schedule_charges: Number(
      (calculated.late_charges_total - calculated.waived_charges_total).toFixed(2)
    ),
    late_charges: calculated.late_charges_total,
    waived_charges: calculated.waived_charges_total,
    ledger_debits: calculated.ledger_debits,
    ledger_credits: calculated.ledger_credits,
    total: Number(reconciliation.agreement.total_amount || 0),
    balance: calculated.outstanding_balance,
    overdue: calculated.overdue_amount,
    status: calculated.agreement_status,
    next_due_date: calculated.next_due_date,
    reconciliation,
  };
}

async function financialSnapshot(connection, agreementId, { lock = false } = {}) {
  const agreement = await loadAgreement(connection, agreementId, { lock });
  const schedule = await loadSchedule(connection, agreementId, { lock });
  const payments = await loadPayments(connection, agreementId, { lock });
  const components = await balanceComponents(connection, agreementId);
  const values = {
    agreement_id: Number(agreement.id),
    agreement_number: agreement.agreement_number,
    agreement_status: agreement.agreement_status,
    equipment_commitment_status: agreement.equipment_commitment_status,
    asset_id: Number(agreement.asset_id),
    total_amount: Number(agreement.total_amount || 0),
    amount_paid: components.paid,
    outstanding_balance: Number(agreement.outstanding_balance || 0),
    schedule_charges: components.schedule_charges,
    ledger_debits: components.ledger_debits,
    ledger_credits: components.ledger_credits,
    schedule: schedule.map((row) => ({
      id: Number(row.id),
      sequence_number: Number(row.sequence_number),
      scheduled_amount: Number(row.scheduled_amount || 0),
      amount_paid: Number(row.amount_paid || 0),
      late_charge_amount: Number(row.late_charge_amount || 0),
      waived_charge_amount: Number(row.waived_charge_amount || 0),
      schedule_status: row.schedule_status,
    })),
    payments: payments.map((payment) => ({
      id: Number(payment.id),
      amount: Number(payment.amount || 0),
      payment_stage: payment.payment_stage,
      is_voided: Boolean(payment.is_voided),
    })),
  };
  return { agreement, schedule, payments, values: { ...values, fingerprint: stableHash(values) } };
}

function calculateReturnSettlement({
  outstandingBalance,
  approvedReturnCredit = 0,
  refundableAmount = 0,
  penaltyAmount = 0,
  damageAmount = 0,
  allowCustomerRefundDue = true,
}) {
  const outstanding = nonNegativeMoney(outstandingBalance, "Outstanding balance");
  const returnCredit = nonNegativeMoney(approvedReturnCredit, "Approved return credit");
  const refundable = nonNegativeMoney(refundableAmount, "Refundable amount");
  const penalty = nonNegativeMoney(penaltyAmount, "Penalty amount");
  const damage = nonNegativeMoney(damageAmount, "Damage amount");
  const raw = Number((outstanding - returnCredit - refundable + penalty + damage).toFixed(2));
  return {
    outstanding_balance: outstanding,
    approved_return_credit: returnCredit,
    refundable_amount: refundable,
    penalty_amount: penalty,
    damage_amount: damage,
    raw_settlement_balance: raw,
    final_settlement_balance: Number(Math.max(raw, 0).toFixed(2)),
    refund_due: allowCustomerRefundDue ? Number(Math.max(-raw, 0).toFixed(2)) : 0,
    formula:
      "outstanding_balance - approved_return_credit - refundable_amount + penalty_amount + damage_amount",
  };
}

function validateReturnAmounts({ agreement, policy, settlement }) {
  const total = Number(agreement.total_amount || 0);
  const paid = Number(agreement.amount_paid || 0);
  if (settlement.approved_return_credit > total + 0.01) {
    throw appError("Approved return credit cannot exceed the original purchase price.");
  }
  if (settlement.refundable_amount > paid + 0.01) {
    throw appError("Refundable amount cannot exceed the customer's recorded non-void payments.");
  }
  const maximumPenalty = Number(
    (settlement.outstanding_balance * policy.maximum_penalty_percent / 100).toFixed(2)
  );
  if (settlement.penalty_amount > maximumPenalty + 0.01) {
    throw appError(`Penalty exceeds the policy maximum of GHS ${maximumPenalty.toFixed(2)}.`);
  }
  const maximumDamage = Number(
    (total * policy.maximum_damage_charge_percent / 100).toFixed(2)
  );
  if (settlement.damage_amount > maximumDamage + 0.01) {
    throw appError(`Damage charge exceeds the policy maximum of GHS ${maximumDamage.toFixed(2)}.`);
  }
}

async function assertNoPendingRequest(connection, agreementId, requestType) {
  const [rows] = await connection.query(
    `SELECT id FROM equipment_finance_correction_requests
     WHERE agreement_id = ? AND request_type = ? AND request_status = 'pending'
     LIMIT 1 FOR UPDATE`,
    [agreementId, requestType]
  );
  if (rows.length) {
    throw appError(
      "A matching Finance correction request is already awaiting an independent decision.",
      409,
      "EQUIPMENT_FINANCE_CORRECTION_PENDING"
    );
  }
}

async function prepareRequest({ connection, agreementId, requestType, input, policy }) {
  const snapshot = await financialSnapshot(connection, agreementId, { lock: true });
  const { agreement, schedule, payments, values } = snapshot;
  if (agreement.ownership_id || agreement.ownership_record_status === "issued") {
    throw appError(
      "Ownership has already transferred. Use a separately reviewed legal correction process.",
      409,
      "EQUIPMENT_FINANCE_OWNERSHIP_TRANSFERRED"
    );
  }

  const proposedEntries = [];
  let paymentId = null;
  let scheduleId = null;
  const metadata = {};

  if (requestType === "draft_cancellation") {
    if (!["draft", "pending_approval", "approved"].includes(agreement.agreement_status)) {
      throw appError("Only a draft or not-yet-active agreement can be cancelled through draft cancellation.", 409);
    }
    if (payments.some((payment) => !payment.is_voided) || agreement.delivery_id) {
      throw appError("An agreement with payment or delivery evidence cannot be cancelled as a draft.", 409);
    }
    proposedEntries.push({
      entry_type: "draft_cancellation_credit",
      direction: "credit",
      amount: Number(agreement.outstanding_balance || 0),
      description: "Clear the unactivated draft obligation while preserving the agreement record.",
    });
  }

  if (requestType === "payment_reversal") {
    paymentId = positiveId(input?.payment_id, "Payment ID");
    const payment = payments.find((row) => Number(row.id) === paymentId);
    if (!payment) throw appError("The selected payment does not belong to this agreement.", 404);
    if (payment.is_voided) throw appError("This payment was already reversed.", 409);
    const latest = payments.find((row) => !row.is_voided);
    if (!latest || Number(latest.id) !== paymentId) {
      throw appError(
        "Only the latest non-void payment can be reversed. Reverse later receipts first.",
        409,
        "EQUIPMENT_FINANCE_REVERSAL_ORDER_REQUIRED"
      );
    }
    if (policy.require_payment_reversal_evidence && cleanText(input?.evidence_reference, 500).length < 5) {
      throw appError("Record the receipt, bank, MoMo or cashier evidence reference.");
    }
    proposedEntries.push({
      entry_type: "payment_reversal",
      direction: "memo",
      amount: Number(payment.amount || 0),
      payment_id: paymentId,
      description: `Reverse receipt ${payment.receipt_number} without deleting it.`,
    });
    metadata.payment = {
      id: paymentId,
      receipt_number: payment.receipt_number,
      payment_number: payment.payment_number,
      amount: Number(payment.amount || 0),
      payment_category: payment.payment_category,
      payment_stage: payment.payment_stage,
    };
  }

  if (["asset_return", "repossession"].includes(requestType)) {
    if (["cancelled", "completed"].includes(agreement.agreement_status)) {
      throw appError("This agreement is already closed and cannot receive another return settlement.", 409);
    }
    if (Number(agreement.active_hire_count || 0) > 0) {
      throw appError("The financed machine is active on Hire and cannot be returned through Finance.", 409);
    }
    const evidenceReference = cleanText(input?.evidence_reference, 500);
    if (policy.require_return_evidence && evidenceReference.length < 5) {
      throw appError("Record the signed return, inspection, repossession or condition evidence reference.");
    }
    const condition = cleanText(input?.condition_status, 60).toLowerCase();
    if (!RETURN_CONDITIONS.has(condition)) throw appError("Choose the inspected return condition.");
    const returnDate = dateOnly(input?.return_date || ghanaToday(), "Return date");
    const settlement = calculateReturnSettlement({
      outstandingBalance: agreement.outstanding_balance,
      approvedReturnCredit: input?.approved_return_credit,
      refundableAmount: input?.refundable_amount,
      penaltyAmount: input?.penalty_amount,
      damageAmount: input?.damage_amount,
      allowCustomerRefundDue: policy.allow_customer_refund_due,
    });
    validateReturnAmounts({ agreement, policy, settlement });
    if (settlement.approved_return_credit > 0) {
      proposedEntries.push({
        entry_type: "approved_return_credit",
        direction: "credit",
        amount: settlement.approved_return_credit,
        description: "Approved credit for the returned financed equipment.",
      });
    }
    if (settlement.refundable_amount > 0) {
      proposedEntries.push({
        entry_type: "approved_refundable_amount",
        direction: "credit",
        amount: settlement.refundable_amount,
        description: "Approved refundable amount applied to the final settlement.",
      });
    }
    if (settlement.penalty_amount > 0) {
      proposedEntries.push({
        entry_type: "approved_return_penalty",
        direction: "debit",
        amount: settlement.penalty_amount,
        description: "Approved penalty included in the return settlement.",
      });
    }
    if (settlement.damage_amount > 0) {
      proposedEntries.push({
        entry_type: "approved_damage_charge",
        direction: "debit",
        amount: settlement.damage_amount,
        description: "Approved inspected damage charge included in the return settlement.",
      });
    }
    proposedEntries.push({
      entry_type: "return_settlement",
      direction: "memo",
      amount: settlement.final_settlement_balance,
      description: "Final return settlement balance under the recorded policy formula.",
    });
    metadata.return = {
      return_type: requestType === "repossession" ? "repossession" : "voluntary_return",
      return_date: returnDate,
      condition_status: condition,
      meter_reading: input?.meter_reading === "" || input?.meter_reading == null
        ? null
        : nonNegativeMoney(input.meter_reading, "Meter reading"),
      evidence_reference: evidenceReference,
      notes: cleanText(input?.notes, 2000) || null,
      settlement,
    };
  }

  if (requestType === "charge_waiver") {
    scheduleId = positiveId(input?.schedule_id, "Schedule ID");
    const row = schedule.find((item) => Number(item.id) === scheduleId);
    if (!row) throw appError("The selected schedule line does not belong to this agreement.", 404);
    const amount = nonNegativeMoney(input?.amount, "Waiver amount");
    if (amount <= 0) throw appError("Waiver amount must be greater than zero.");
    const available = Number(
      Math.max(Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0), 0).toFixed(2)
    );
    if (amount > available + 0.01) {
      throw appError(`Waiver exceeds the unwaived charge of GHS ${available.toFixed(2)}.`);
    }
    proposedEntries.push({
      entry_type: "late_charge_waiver",
      direction: "memo",
      amount,
      schedule_id: scheduleId,
      description: `Waive GHS ${amount.toFixed(2)} from schedule line ${row.sequence_number}.`,
    });
    metadata.waiver = { schedule_id: scheduleId, sequence_number: row.sequence_number, amount };
  }

  return { agreement, paymentId, scheduleId, snapshot: values, proposedEntries, metadata };
}

async function requestFinanceCorrection({ agreementId, requestType, input, actorId, req }) {
  const id = positiveId(agreementId, "Agreement ID");
  const type = cleanText(requestType || input?.request_type, 60).toLowerCase();
  if (!REQUEST_TYPES.has(type)) throw appError("Choose a valid Finance correction type.");
  const reason = cleanText(input?.reason, 2000);
  if (reason.length < 15) throw appError("Enter a detailed correction reason of at least 15 characters.");
  const evidenceReference = cleanText(input?.evidence_reference, 500);

  const requestId = await withTransaction(async (connection) => {
    await assertSchemaReady(connection);
    const policy = await getCorrectionPolicy(connection, { lock: true });
    await assertNoPendingRequest(connection, id, type);
    const prepared = await prepareRequest({ connection, agreementId: id, requestType: type, input, policy });
    const requestNumber = await financeNumber("EQUIPMENT_FINANCE_CORRECTION", "EFC", actorId);
    const [result] = await connection.query(
      `INSERT INTO equipment_finance_correction_requests (
         request_number, agreement_id, payment_id, schedule_id,
         request_type, request_status, reason, evidence_reference,
         policy_version, policy_snapshot_json, financial_snapshot_json,
         proposed_entries_json, requested_by
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestNumber,
        id,
        prepared.paymentId,
        prepared.scheduleId,
        type,
        reason,
        evidenceReference || null,
        policy.policy_version,
        JSON.stringify(policy),
        JSON.stringify({ ...prepared.snapshot, request_metadata: prepared.metadata }),
        JSON.stringify(prepared.proposedEntries),
        actorId || null,
      ]
    );
    await writeAuditEvent({
      connection,
      req,
      userId: actorId || null,
      workspaceCode: FINANCE_WORKSPACE,
      hireLocationId: prepared.agreement.hire_location_id,
      action: "EQUIPMENT_FINANCE_CORRECTION_REQUESTED",
      actionType: "EQUIPMENT_FINANCE_CORRECTION_REQUESTED",
      entityType: "equipment_sale_agreement",
      entityId: id,
      outcome: "pending",
      severity: ["repossession", "payment_reversal"].includes(type) ? "critical" : "warning",
      details: `Requested ${type.replaceAll("_", " ")} for ${prepared.agreement.agreement_number}: ${reason}`,
      metadata: {
        request_id: result.insertId,
        request_number: requestNumber,
        request_type: type,
        policy_version: policy.policy_version,
        financial_snapshot: prepared.snapshot,
        proposed_entries: prepared.proposedEntries,
        original_records_deleted: false,
        independent_approval_required: true,
      },
    });
    return result.insertId;
  });
  return getCorrectionRequest(requestId);
}

async function getCorrectionRequest(requestId, connection = pool, { lock = false } = {}) {
  const id = positiveId(requestId, "Request ID");
  const [rows] = await connection.query(
    `SELECT request.*, agreement.agreement_number,
            agreement.customer_name_snapshot, agreement.asset_code_snapshot,
            agreement.asset_name_snapshot
     FROM equipment_finance_correction_requests request
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = request.agreement_id
     WHERE request.id = ? LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [id]
  );
  if (!rows.length) throw appError("Finance correction request was not found.", 404);
  const row = rows[0];
  return {
    ...row,
    id: Number(row.id),
    agreement_id: Number(row.agreement_id),
    payment_id: row.payment_id ? Number(row.payment_id) : null,
    schedule_id: row.schedule_id ? Number(row.schedule_id) : null,
    policy_snapshot: parseJson(row.policy_snapshot_json, {}),
    financial_snapshot: parseJson(row.financial_snapshot_json, {}),
    proposed_entries: parseJson(row.proposed_entries_json, []),
  };
}

async function postLedgerEntry({
  connection,
  request,
  entry,
  balanceBefore,
  actorId,
  metadata = {},
}) {
  const amount = Number(entry.amount || 0);
  const balanceAfter = entry.direction === "credit"
    ? Number(Math.max(balanceBefore - amount, 0).toFixed(2))
    : entry.direction === "debit"
      ? Number((balanceBefore + amount).toFixed(2))
      : Number(balanceBefore.toFixed(2));
  const entryNumber = await financeNumber("EQUIPMENT_FINANCE_LEDGER", "EFL", actorId);
  const [result] = await connection.query(
    `INSERT INTO equipment_finance_ledger_entries (
       entry_number, request_id, agreement_id, payment_id, schedule_id,
       entry_type, direction, amount, balance_before, balance_after,
       description, metadata_json, posted_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entryNumber,
      request.id,
      request.agreement_id,
      entry.payment_id || request.payment_id || null,
      entry.schedule_id || request.schedule_id || null,
      entry.entry_type,
      entry.direction,
      amount,
      balanceBefore,
      balanceAfter,
      cleanText(entry.description, 1000),
      JSON.stringify(metadata),
      actorId || null,
    ]
  );
  return { id: result.insertId, entry_number: entryNumber, balance_after: balanceAfter };
}

async function releaseAgreementAsset(connection, agreement, actorId) {
  await connection.query(
    `UPDATE equipment_asset_sale_locks
     SET released_at = COALESCE(released_at, NOW()), released_by = ?,
         release_reason = COALESCE(release_reason, 'Finance Phase 4 approved correction')
     WHERE agreement_id = ? AND released_at IS NULL`,
    [actorId || null, agreement.id]
  );
  await connection.query(
    `UPDATE fleet_assets
     SET sale_status = CASE
           WHEN sale_status IN ('reserved','installment_active','cancelled') THEN 'available'
           ELSE sale_status
         END,
         sale_reserved_until = NULL,
         updated_by = ?
     WHERE id = ?`,
    [actorId || null, agreement.asset_id]
  );
}

async function executeDraftCancellation({ connection, request, agreement, actorId }) {
  const balanceBefore = Number(agreement.outstanding_balance || 0);
  const entry = request.proposed_entries.find((item) => item.entry_type === "draft_cancellation_credit");
  let balanceAfter = balanceBefore;
  if (entry && Number(entry.amount || 0) > 0) {
    const posted = await postLedgerEntry({
      connection,
      request,
      entry,
      balanceBefore,
      actorId,
      metadata: { cancellation_reason: request.reason },
    });
    balanceAfter = posted.balance_after;
  }
  await connection.query(
    `UPDATE equipment_installment_schedule
     SET schedule_status = 'cancelled'
     WHERE agreement_id = ? AND schedule_status IN ('upcoming','due','partial','overdue')`,
    [agreement.id]
  );
  await releaseAgreementAsset(connection, agreement, actorId);
  await connection.query(
    `UPDATE equipment_sale_agreements
     SET agreement_status = 'cancelled', equipment_commitment_status = 'released',
         outstanding_balance = 0, overdue_amount = 0, next_due_date = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [agreement.id]
  );
  return { execution_type: "draft_cancellation", balance_before: balanceBefore, balance_after: balanceAfter };
}

async function reversePaymentAllocations(connection, paymentId) {
  const [allocations] = await connection.query(
    `SELECT allocation.*, schedule.due_date, schedule.scheduled_amount,
            schedule.amount_paid, schedule.late_charge_amount,
            schedule.waived_charge_amount, schedule.schedule_status
     FROM equipment_sale_payment_allocations allocation
     INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
     WHERE allocation.payment_id = ?
     ORDER BY allocation.id DESC FOR UPDATE`,
    [paymentId]
  );
  for (const allocation of allocations) {
    const newPaid = Number(
      Math.max(Number(allocation.amount_paid || 0) - Number(allocation.allocated_amount || 0), 0).toFixed(2)
    );
    const lineTotal = Number(
      (
        Number(allocation.scheduled_amount || 0) +
        Number(allocation.late_charge_amount || 0) -
        Number(allocation.waived_charge_amount || 0)
      ).toFixed(2)
    );
    let status;
    if (newPaid + 0.01 >= lineTotal) status = "paid";
    else if (newPaid > 0.01) status = "partial";
    else {
      const due = String(allocation.due_date || "").slice(0, 10);
      const today = ghanaToday();
      status = due < today ? "overdue" : due === today ? "due" : "upcoming";
    }
    await connection.query(
      `UPDATE equipment_installment_schedule
       SET amount_paid = ?, schedule_status = ?,
           fully_paid_at = CASE WHEN ? = 'paid' THEN fully_paid_at ELSE NULL END
       WHERE id = ?`,
      [newPaid, status, status, allocation.schedule_id]
    );
  }
  return allocations.map((row) => ({
    allocation_id: Number(row.id),
    schedule_id: Number(row.schedule_id),
    allocated_amount: Number(row.allocated_amount || 0),
  }));
}

async function executePaymentReversal({ connection, request, agreement, actorId }) {
  const [rows] = await connection.query(
    `SELECT * FROM equipment_sale_payments
     WHERE id = ? AND agreement_id = ? LIMIT 1 FOR UPDATE`,
    [request.payment_id, agreement.id]
  );
  const payment = rows[0];
  if (!payment || payment.is_voided) throw appError("The original payment is missing or already reversed.", 409);
  const [latestRows] = await connection.query(
    `SELECT id FROM equipment_sale_payments
     WHERE agreement_id = ? AND is_voided = FALSE
     ORDER BY payment_date DESC, id DESC LIMIT 1 FOR UPDATE`,
    [agreement.id]
  );
  if (Number(latestRows[0]?.id || 0) !== Number(payment.id)) {
    throw appError("A later payment exists. Reverse later receipts first.", 409);
  }
  const balanceBefore = Number(agreement.outstanding_balance || 0);
  const allocations = await reversePaymentAllocations(connection, payment.id);
  await connection.query(
    `UPDATE equipment_sale_payments
     SET is_voided = TRUE, void_reason = ?, voided_by = ?, voided_at = NOW()
     WHERE id = ?`,
    [request.reason, actorId || null, payment.id]
  );
  const refreshed = await refreshFinanceAgreement(connection, agreement.id);
  const entry = request.proposed_entries.find((item) => item.entry_type === "payment_reversal");
  await postLedgerEntry({
    connection,
    request,
    entry,
    balanceBefore,
    actorId,
    metadata: {
      original_receipt_number: payment.receipt_number,
      original_payment_number: payment.payment_number,
      balance_after_reversal: refreshed.balance,
      allocations_preserved_and_reversed: allocations,
    },
  });

  if (payment.payment_stage === "opening_deposit" && refreshed.deposits + 0.01 < Number(agreement.deposit_required || 0)) {
    await releaseAgreementAsset(connection, agreement, actorId);
    await connection.query(
      `UPDATE equipment_sale_agreements
       SET agreement_status = 'approved', equipment_commitment_status = 'not_reserved',
           deposit_completed_at = NULL, deposit_completed_by = NULL,
           reservation_activated_at = NULL, reservation_activated_by = NULL
       WHERE id = ?`,
      [agreement.id]
    );
  }
  return {
    execution_type: "payment_reversal",
    payment_id: Number(payment.id),
    receipt_number: payment.receipt_number,
    balance_before: balanceBefore,
    balance_after: refreshed.balance,
  };
}

async function executeReturnSettlement({ connection, request, agreement, actorId }) {
  const returnData = request.financial_snapshot?.request_metadata?.return;
  if (!returnData || !RETURN_TYPES.has(returnData.return_type)) {
    throw appError("The stored return settlement request is incomplete.", 409);
  }
  const balanceBefore = Number(agreement.outstanding_balance || 0);
  let runningBalance = balanceBefore;
  const postedEntries = [];
  for (const entry of request.proposed_entries) {
    const posted = await postLedgerEntry({
      connection,
      request,
      entry,
      balanceBefore: runningBalance,
      actorId,
      metadata: {
        policy_version: request.policy_version,
        settlement_formula: returnData.settlement.formula,
        evidence_reference: request.evidence_reference,
      },
    });
    runningBalance = posted.balance_after;
    postedEntries.push(posted);
  }

  const settlement = returnData.settlement;
  const returnNumber = await financeNumber("EQUIPMENT_FINANCE_RETURN", "EFR", actorId);
  await connection.query(
    `INSERT INTO equipment_finance_asset_returns (
       return_number, request_id, agreement_id, asset_id, return_type,
       return_date, condition_status, meter_reading, approved_return_credit,
       refundable_amount, penalty_amount, damage_amount, settlement_balance,
       refund_due, policy_version, evidence_reference, notes,
       return_status, received_by, approved_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
    [
      returnNumber,
      request.id,
      agreement.id,
      agreement.asset_id,
      returnData.return_type,
      returnData.return_date,
      returnData.condition_status,
      returnData.meter_reading,
      settlement.approved_return_credit,
      settlement.refundable_amount,
      settlement.penalty_amount,
      settlement.damage_amount,
      settlement.final_settlement_balance,
      settlement.refund_due,
      request.policy_version,
      returnData.evidence_reference,
      returnData.notes,
      actorId || null,
      actorId || null,
    ]
  );
  await connection.query(
    `UPDATE equipment_installment_schedule
     SET schedule_status = 'cancelled'
     WHERE agreement_id = ? AND schedule_status IN ('upcoming','due','partial','overdue')`,
    [agreement.id]
  );
  await releaseAgreementAsset(connection, agreement, actorId);
  await connection.query(
    `UPDATE fleet_assets
     SET condition_status = ?,
         current_meter = CASE
           WHEN ? IS NOT NULL AND ? > current_meter THEN ? ELSE current_meter
         END,
         updated_by = ?
     WHERE id = ?`,
    [
      returnData.condition_status,
      returnData.meter_reading,
      returnData.meter_reading,
      returnData.meter_reading,
      actorId || null,
      agreement.asset_id,
    ]
  );
  await connection.query(
    `UPDATE equipment_sale_agreements
     SET agreement_status = ?, equipment_commitment_status = 'released',
         outstanding_balance = ?, overdue_amount = 0, next_due_date = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [settlement.final_settlement_balance <= 0.01 ? "cancelled" : "defaulted", settlement.final_settlement_balance, agreement.id]
  );
  const refreshed = await refreshFinanceAgreement(connection, agreement.id);
  return {
    execution_type: returnData.return_type,
    return_number: returnNumber,
    settlement,
    posted_entries: postedEntries,
    balance_before: balanceBefore,
    balance_after: refreshed.balance,
  };
}

async function executeChargeWaiver({ connection, request, agreement, actorId }) {
  const waiver = request.financial_snapshot?.request_metadata?.waiver;
  if (!waiver) throw appError("The stored charge waiver is incomplete.", 409);
  const [rows] = await connection.query(
    `SELECT * FROM equipment_installment_schedule
     WHERE id = ? AND agreement_id = ? LIMIT 1 FOR UPDATE`,
    [waiver.schedule_id, agreement.id]
  );
  const row = rows[0];
  if (!row) throw appError("The schedule charge was not found.", 404);
  const available = Number(
    Math.max(Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0), 0).toFixed(2)
  );
  if (Number(waiver.amount) > available + 0.01) {
    throw appError("The available charge changed after this waiver request. Create a new request.", 409);
  }
  const balanceBefore = Number(agreement.outstanding_balance || 0);
  await connection.query(
    `UPDATE equipment_installment_schedule
     SET waived_charge_amount = waived_charge_amount + ?
     WHERE id = ?`,
    [waiver.amount, row.id]
  );
  const refreshed = await refreshFinanceAgreement(connection, agreement.id);
  const entry = request.proposed_entries.find((item) => item.entry_type === "late_charge_waiver");
  await postLedgerEntry({
    connection,
    request,
    entry,
    balanceBefore,
    actorId,
    metadata: { balance_after_waiver: refreshed.balance, sequence_number: row.sequence_number },
  });
  return {
    execution_type: "charge_waiver",
    schedule_id: Number(row.id),
    waived_amount: Number(waiver.amount),
    balance_before: balanceBefore,
    balance_after: refreshed.balance,
  };
}

async function decideFinanceCorrection({ requestId, decision, reason, actorId, req }) {
  const id = positiveId(requestId, "Request ID");
  const normalizedDecision = cleanText(decision, 20).toLowerCase();
  if (!["approve", "reject"].includes(normalizedDecision)) throw appError("Choose approve or reject.");
  const decisionReason = cleanText(reason, 1000);
  if (decisionReason.length < 10) throw appError("Enter an independent decision reason of at least 10 characters.");

  const result = await withTransaction(async (connection) => {
    await assertSchemaReady(connection);
    const request = await getCorrectionRequest(id, connection, { lock: true });
    if (request.request_status !== "pending") {
      throw appError(`This request was already ${request.request_status}.`, 409);
    }
    if (Number(request.requested_by || 0) === Number(actorId || 0)) {
      throw appError(
        "The staff member who prepared the correction cannot approve or reject it.",
        409,
        "EQUIPMENT_FINANCE_INDEPENDENT_APPROVER_REQUIRED"
      );
    }
    const current = await financialSnapshot(connection, request.agreement_id, { lock: true });
    const storedFingerprint = request.financial_snapshot?.fingerprint;
    if (!storedFingerprint || storedFingerprint !== current.values.fingerprint) {
      throw appError(
        "The Finance account changed after this request. Reject it and create a new correction from the current account.",
        409,
        "EQUIPMENT_FINANCE_CORRECTION_STALE"
      );
    }

    if (normalizedDecision === "reject") {
      await connection.query(
        `UPDATE equipment_finance_correction_requests
         SET request_status = 'rejected', decided_by = ?, decided_at = NOW(),
             decision_reason = ? WHERE id = ?`,
        [actorId || null, decisionReason, request.id]
      );
      await writeAuditEvent({
        connection,
        req,
        userId: actorId || null,
        workspaceCode: FINANCE_WORKSPACE,
        hireLocationId: current.agreement.hire_location_id,
        action: "EQUIPMENT_FINANCE_CORRECTION_REJECTED",
        actionType: "EQUIPMENT_FINANCE_CORRECTION_REJECTED",
        entityType: "equipment_sale_agreement",
        entityId: request.agreement_id,
        outcome: "rejected",
        severity: "notice",
        details: `Rejected correction request ${request.request_number}: ${decisionReason}`,
        metadata: { request_id: request.id, request_type: request.request_type, original_request_preserved: true },
      });
      return { request_id: request.id, agreement_id: request.agreement_id, status: "rejected" };
    }

    let execution;
    if (request.request_type === "draft_cancellation") {
      execution = await executeDraftCancellation({ connection, request, agreement: current.agreement, actorId });
    } else if (request.request_type === "payment_reversal") {
      execution = await executePaymentReversal({ connection, request, agreement: current.agreement, actorId });
    } else if (["asset_return", "repossession"].includes(request.request_type)) {
      execution = await executeReturnSettlement({ connection, request, agreement: current.agreement, actorId });
    } else if (request.request_type === "charge_waiver") {
      execution = await executeChargeWaiver({ connection, request, agreement: current.agreement, actorId });
    } else {
      throw appError("The stored correction type is not supported.", 409);
    }

    const executionReference = await financeNumber("EQUIPMENT_FINANCE_CORRECTION_EXECUTION", "EFX", actorId);
    await connection.query(
      `UPDATE equipment_finance_correction_requests
       SET request_status = 'approved', decided_by = ?, decided_at = NOW(),
           decision_reason = ?, execution_reference = ? WHERE id = ?`,
      [actorId || null, decisionReason, executionReference, request.id]
    );
    await writeAuditEvent({
      connection,
      req,
      userId: actorId || null,
      workspaceCode: FINANCE_WORKSPACE,
      hireLocationId: current.agreement.hire_location_id,
      action: "EQUIPMENT_FINANCE_CORRECTION_APPROVED",
      actionType: "EQUIPMENT_FINANCE_CORRECTION_APPROVED",
      entityType: "equipment_sale_agreement",
      entityId: request.agreement_id,
      outcome: "approved",
      severity: ["repossession", "payment_reversal"].includes(request.request_type) ? "critical" : "warning",
      details: `Approved correction request ${request.request_number}: ${decisionReason}`,
      metadata: {
        request_id: request.id,
        request_type: request.request_type,
        execution_reference: executionReference,
        execution,
        original_records_deleted: false,
        original_request_preserved: true,
      },
    });
    return {
      request_id: request.id,
      agreement_id: request.agreement_id,
      status: "approved",
      execution_reference: executionReference,
      execution,
    };
  });

  return { ...result, account_file: await getCorrectionAccount(result.agreement_id) };
}

async function listCorrectionAccounts({ search = "", status = "all" } = {}) {
  await assertSchemaReady(pool);
  const term = `%${cleanText(search, 200)}%`;
  const params = [];
  const where = [
    "agreement.sale_type = 'installment'",
    "agreement.activation_source = 'approved_credit_application'",
  ];
  if (cleanText(search, 200)) {
    where.push(`(agreement.agreement_number LIKE ? OR customer.customer_name LIKE ?
      OR customer.phone LIKE ? OR asset.asset_code LIKE ? OR asset.asset_name LIKE ?)`);
    params.push(term, term, term, term, term);
  }
  if (status && status !== "all") {
    where.push("agreement.agreement_status = ?");
    params.push(cleanText(status, 40));
  }
  const [rows] = await pool.query(
    `SELECT agreement.id AS agreement_id, agreement.agreement_number,
            agreement.agreement_status, agreement.equipment_commitment_status,
            agreement.total_amount, agreement.amount_paid, agreement.outstanding_balance,
            agreement.overdue_amount, agreement.next_due_date,
            customer.customer_name, customer.phone AS customer_phone,
            asset.id AS asset_id, asset.asset_code, asset.asset_name,
            asset.sale_status AS asset_sale_status, asset.condition_status,
            (SELECT COUNT(*) FROM equipment_finance_correction_requests request
              WHERE request.agreement_id = agreement.id AND request.request_status = 'pending') AS pending_correction_count,
            (SELECT COUNT(*) FROM equipment_finance_ledger_entries ledger
              WHERE ledger.agreement_id = agreement.id) AS ledger_entry_count
     FROM equipment_sale_agreements agreement
     INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
     INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
     WHERE ${where.join(" AND ")}
     ORDER BY agreement.updated_at DESC, agreement.id DESC`,
    params
  );
  return rows.map((row) => ({
    ...row,
    agreement_id: Number(row.agreement_id),
    asset_id: Number(row.asset_id),
    total_amount: Number(row.total_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
    outstanding_balance: Number(row.outstanding_balance || 0),
    overdue_amount: Number(row.overdue_amount || 0),
    pending_correction_count: Number(row.pending_correction_count || 0),
    ledger_entry_count: Number(row.ledger_entry_count || 0),
  }));
}

async function getCorrectionAccount(agreementId) {
  const id = positiveId(agreementId, "Agreement ID");
  await assertSchemaReady(pool);
  const agreement = await loadAgreement(pool, id);
  const [schedule, payments, ledger, requests, returns, policy] = await Promise.all([
    loadSchedule(pool, id),
    loadPayments(pool, id),
    loadLedger(pool, id),
    loadRequests(pool, id, "all"),
    loadReturns(pool, id),
    getCorrectionPolicy(pool),
  ]);
  return {
    account: {
      agreement_id: Number(agreement.id),
      agreement_number: agreement.agreement_number,
      agreement_status: agreement.agreement_status,
      equipment_commitment_status: agreement.equipment_commitment_status,
      customer_id: Number(agreement.customer_id),
      customer_name: agreement.customer_name_snapshot || agreement.customer_name,
      customer_phone: agreement.customer_phone_snapshot || agreement.customer_phone,
      asset_id: Number(agreement.asset_id),
      asset_code: agreement.asset_code_snapshot || agreement.asset_code,
      asset_name: agreement.asset_name_snapshot || agreement.asset_name,
      asset_sale_status: agreement.asset_sale_status,
      asset_condition_status: agreement.asset_condition_status,
      total_amount: Number(agreement.total_amount || 0),
      amount_paid: Number(agreement.amount_paid || 0),
      outstanding_balance: Number(agreement.outstanding_balance || 0),
      overdue_amount: Number(agreement.overdue_amount || 0),
      deposit_required: Number(agreement.deposit_required || 0),
      deposit_received: Number(agreement.deposit_received || 0),
      next_due_date: agreement.next_due_date,
      delivery_id: agreement.delivery_id ? Number(agreement.delivery_id) : null,
      ownership_id: agreement.ownership_id ? Number(agreement.ownership_id) : null,
      active_hire_count: Number(agreement.active_hire_count || 0),
    },
    schedule,
    payments,
    ledger,
    correction_requests: requests,
    asset_returns: returns,
    policy,
    settlement_formula:
      "outstanding_balance - approved_return_credit - refundable_amount + penalty_amount + damage_amount",
  };
}

async function listCorrectionRequests({ status = "pending" } = {}) {
  await assertSchemaReady(pool);
  return loadRequests(pool, null, status);
}

module.exports = {
  FinanceCorrectionError,
  REQUEST_TYPES,
  REQUIRED_TABLES,
  RETURN_CONDITIONS,
  RETURN_TYPES,
  assertSchemaReady,
  calculateReturnSettlement,
  decideFinanceCorrection,
  getCorrectionAccount,
  getCorrectionPolicy,
  listCorrectionAccounts,
  listCorrectionRequests,
  refreshFinanceAgreement,
  requestFinanceCorrection,
  schemaStatus,
  updateCorrectionPolicy,
};
