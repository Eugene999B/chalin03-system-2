const { pool } = require("../config/db");

const FINANCE_WORKSPACE = "equipment_installment_finance";
const ACTIVE_SCHEDULE_STATUSES = Object.freeze(["upcoming", "due", "partial", "overdue"]);
const MONEY_TOLERANCE = 0.01;

class EquipmentFinanceReconciliationError extends Error {
  constructor(statusCode, message, code = "EQUIPMENT_FINANCE_RECONCILIATION_ERROR", details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function positiveId(value, label = "ID") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new EquipmentFinanceReconciliationError(
      400,
      `${label} must be a positive whole number.`,
      "INVALID_IDENTIFIER"
    );
  }
  return id;
}

function numberValue(value) {
  return Number(Number(value || 0).toFixed(2));
}

function moneyDiff(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0));
}

function financeAgreementScope(alias = "agreement") {
  return `${alias}.sale_type = 'installment' AND ${alias}.activation_source = 'approved_credit_application'`;
}

function activeScheduleCondition(alias = "schedule") {
  return `${alias}.schedule_status IN ('upcoming','due','partial','overdue')`;
}

function emptyEvidence() {
  return {
    amount_paid: 0,
    deposit_received: 0,
    allocatable_payment_amount: 0,
    active_payment_count: 0,
    scheduled_amount: 0,
    schedule_amount_paid: 0,
    late_charges: 0,
    waived_charges: 0,
    overdue_amount: 0,
    next_due_date: null,
    oldest_overdue_date: null,
    first_schedule_due_date: null,
    final_schedule_due_date: null,
    schedule_line_count: 0,
    distinct_sequence_count: 0,
    non_positive_schedule_count: 0,
    rescheduled_line_count: 0,
    active_allocated_amount: 0,
    voided_allocated_amount: 0,
    rescheduled_allocated_amount: 0,
    cross_agreement_allocation_count: 0,
    negative_allocation_count: 0,
    ledger_debits: 0,
    ledger_credits: 0,
  };
}

function normalizeEvidence(input = {}) {
  return {
    ...emptyEvidence(),
    ...input,
    amount_paid: numberValue(input.amount_paid),
    deposit_received: numberValue(input.deposit_received),
    allocatable_payment_amount: numberValue(input.allocatable_payment_amount),
    active_payment_count: Number(input.active_payment_count || 0),
    scheduled_amount: numberValue(input.scheduled_amount),
    schedule_amount_paid: numberValue(input.schedule_amount_paid),
    late_charges: numberValue(input.late_charges),
    waived_charges: numberValue(input.waived_charges),
    overdue_amount: numberValue(input.overdue_amount),
    next_due_date: input.next_due_date || null,
    oldest_overdue_date: input.oldest_overdue_date || null,
    first_schedule_due_date: input.first_schedule_due_date || null,
    final_schedule_due_date: input.final_schedule_due_date || null,
    schedule_line_count: Number(input.schedule_line_count || 0),
    distinct_sequence_count: Number(input.distinct_sequence_count || 0),
    non_positive_schedule_count: Number(input.non_positive_schedule_count || 0),
    rescheduled_line_count: Number(input.rescheduled_line_count || 0),
    active_allocated_amount: numberValue(input.active_allocated_amount),
    voided_allocated_amount: numberValue(input.voided_allocated_amount),
    rescheduled_allocated_amount: numberValue(input.rescheduled_allocated_amount),
    cross_agreement_allocation_count: Number(input.cross_agreement_allocation_count || 0),
    negative_allocation_count: Number(input.negative_allocation_count || 0),
    ledger_debits: numberValue(input.ledger_debits),
    ledger_credits: numberValue(input.ledger_credits),
  };
}

async function loadAgreement(connection, agreementId, { lock = false } = {}) {
  const id = positiveId(agreementId, "Agreement ID");
  const [rows] = await connection.query(
    `SELECT agreement.*
       FROM equipment_sale_agreements agreement
      WHERE agreement.id = ?
        AND ${financeAgreementScope("agreement")}
      LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [id]
  );
  if (!rows.length) {
    throw new EquipmentFinanceReconciliationError(
      404,
      "The approved-credit Installment Finance agreement was not found.",
      "EQUIPMENT_FINANCE_AGREEMENT_NOT_FOUND"
    );
  }
  return rows[0];
}

function scheduleEvidenceSql(groupColumn = null) {
  const prefix = groupColumn ? `${groupColumn},` : "";
  return `SELECT
       ${prefix}
       COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.scheduled_amount ELSE 0 END), 0) AS scheduled_amount,
       COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.amount_paid ELSE 0 END), 0) AS schedule_amount_paid,
       COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.late_charge_amount ELSE 0 END), 0) AS late_charges,
       COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.waived_charge_amount ELSE 0 END), 0) AS waived_charges,
       COALESCE(SUM(CASE WHEN schedule.due_date < CURDATE() AND ${activeScheduleCondition("schedule")} THEN GREATEST(
         schedule.scheduled_amount + schedule.late_charge_amount - schedule.waived_charge_amount - schedule.amount_paid,
         0
       ) ELSE 0 END), 0) AS overdue_amount,
       MIN(CASE WHEN ${activeScheduleCondition("schedule")} THEN schedule.due_date END) AS next_due_date,
       MIN(CASE WHEN schedule.due_date < CURDATE() AND ${activeScheduleCondition("schedule")} THEN schedule.due_date END) AS oldest_overdue_date,
       MIN(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.due_date END) AS first_schedule_due_date,
       MAX(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.due_date END) AS final_schedule_due_date,
       COUNT(CASE WHEN schedule.schedule_status <> 'rescheduled' THEN 1 END) AS schedule_line_count,
       COUNT(DISTINCT CASE WHEN schedule.schedule_status <> 'rescheduled' THEN schedule.sequence_number END) AS distinct_sequence_count,
       COALESCE(SUM(CASE WHEN schedule.schedule_status <> 'rescheduled' AND schedule.scheduled_amount <= 0 THEN 1 ELSE 0 END), 0) AS non_positive_schedule_count,
       COUNT(CASE WHEN schedule.schedule_status = 'rescheduled' THEN 1 END) AS rescheduled_line_count`;
}

async function loadEvidence(connection, agreementId) {
  const id = positiveId(agreementId, "Agreement ID");
  const [paymentRows] = await connection.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment.is_voided = FALSE THEN payment.amount ELSE 0 END), 0) AS amount_paid,
       COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND payment.payment_category = 'deposit' THEN payment.amount ELSE 0 END), 0) AS deposit_received,
       COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND payment.payment_category IN ('installment','settlement') THEN payment.amount ELSE 0 END), 0) AS allocatable_payment_amount,
       COUNT(CASE WHEN payment.is_voided = FALSE THEN 1 END) AS active_payment_count
     FROM equipment_sale_payments payment
     WHERE payment.agreement_id = ?`,
    [id]
  );
  const [scheduleRows] = await connection.query(
    `${scheduleEvidenceSql()}
     FROM equipment_installment_schedule schedule
     WHERE schedule.agreement_id = ?`,
    [id]
  );
  const [allocationRows] = await connection.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND schedule.schedule_status <> 'rescheduled' THEN allocation.allocated_amount ELSE 0 END), 0) AS active_allocated_amount,
       COALESCE(SUM(CASE WHEN payment.is_voided = TRUE THEN allocation.allocated_amount ELSE 0 END), 0) AS voided_allocated_amount,
       COALESCE(SUM(CASE WHEN schedule.schedule_status = 'rescheduled' THEN allocation.allocated_amount ELSE 0 END), 0) AS rescheduled_allocated_amount,
       COALESCE(SUM(CASE WHEN payment.agreement_id <> schedule.agreement_id THEN 1 ELSE 0 END), 0) AS cross_agreement_allocation_count,
       COALESCE(SUM(CASE WHEN allocation.allocated_amount < 0 THEN 1 ELSE 0 END), 0) AS negative_allocation_count
     FROM equipment_sale_payment_allocations allocation
     INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
     INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
     WHERE schedule.agreement_id = ?`,
    [id]
  );
  const [ledgerRows] = await connection.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ledger.direction = 'debit' THEN ledger.amount ELSE 0 END), 0) AS ledger_debits,
       COALESCE(SUM(CASE WHEN ledger.direction = 'credit' THEN ledger.amount ELSE 0 END), 0) AS ledger_credits
     FROM equipment_finance_ledger_entries ledger
     WHERE ledger.agreement_id = ?`,
    [id]
  );

  return normalizeEvidence({
    ...(paymentRows[0] || {}),
    ...(scheduleRows[0] || {}),
    ...(allocationRows[0] || {}),
    ...(ledgerRows[0] || {}),
  });
}

function expectedStatus(agreement, evidence, outstandingBalance) {
  if (["cancelled", "defaulted"].includes(agreement.agreement_status)) {
    return agreement.agreement_status;
  }
  if (
    agreement.equipment_commitment_status === "not_reserved" &&
    evidence.deposit_received + MONEY_TOLERANCE < Number(agreement.deposit_required || 0)
  ) {
    return "approved";
  }
  if (outstandingBalance <= MONEY_TOLERANCE) return "completed";
  if (evidence.overdue_amount > MONEY_TOLERANCE) return "overdue";
  if (evidence.next_due_date) return "active";
  return "payment_due";
}

function mismatch(field, stored, expected, severity = "repairable") {
  return {
    field,
    stored: stored ?? null,
    expected: expected ?? null,
    severity,
  };
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : null;
}

function buildReconciliation(agreement, evidenceInput = {}) {
  const evidence = normalizeEvidence(evidenceInput);
  const outstandingBalance = numberValue(
    Math.max(
      Number(agreement.total_amount || 0) + evidence.late_charges - evidence.waived_charges +
        evidence.ledger_debits - evidence.amount_paid - evidence.ledger_credits,
      0
    )
  );
  const overdueAmount = numberValue(Math.min(evidence.overdue_amount, outstandingBalance));
  const status = expectedStatus(agreement, evidence, outstandingBalance);
  const nextDueDate = ["cancelled", "defaulted", "completed"].includes(status)
    ? null
    : evidence.next_due_date;

  const mismatches = [];
  if (moneyDiff(agreement.amount_paid, evidence.amount_paid) > MONEY_TOLERANCE) {
    mismatches.push(mismatch("amount_paid", numberValue(agreement.amount_paid), evidence.amount_paid));
  }
  if (moneyDiff(agreement.deposit_received, evidence.deposit_received) > MONEY_TOLERANCE) {
    mismatches.push(mismatch("deposit_received", numberValue(agreement.deposit_received), evidence.deposit_received));
  }
  if (moneyDiff(agreement.late_charges_total, evidence.late_charges) > MONEY_TOLERANCE) {
    mismatches.push(mismatch("late_charges_total", numberValue(agreement.late_charges_total), evidence.late_charges));
  }
  if (moneyDiff(agreement.waived_charges_total, evidence.waived_charges) > MONEY_TOLERANCE) {
    mismatches.push(mismatch("waived_charges_total", numberValue(agreement.waived_charges_total), evidence.waived_charges));
  }
  if (moneyDiff(agreement.outstanding_balance, outstandingBalance) > MONEY_TOLERANCE) {
    mismatches.push(mismatch("outstanding_balance", numberValue(agreement.outstanding_balance), outstandingBalance));
  }
  if (moneyDiff(agreement.overdue_amount, overdueAmount) > MONEY_TOLERANCE) {
    mismatches.push(mismatch("overdue_amount", numberValue(agreement.overdue_amount), overdueAmount));
  }
  if (String(agreement.agreement_status || "") !== status) {
    mismatches.push(mismatch("agreement_status", agreement.agreement_status, status));
  }

  const storedNextDue = dateText(agreement.next_due_date);
  const expectedNextDue = dateText(nextDueDate);
  if (storedNextDue !== expectedNextDue) {
    mismatches.push(mismatch("next_due_date", storedNextDue, expectedNextDue));
  }

  const totalAmount = numberValue(agreement.total_amount);
  const financedAmount = numberValue(agreement.financed_amount);
  const depositRequired = numberValue(agreement.deposit_required);
  if (moneyDiff(totalAmount, financedAmount + depositRequired) > MONEY_TOLERANCE) {
    mismatches.push(
      mismatch(
        "agreement_principal_identity",
        totalAmount,
        numberValue(financedAmount + depositRequired),
        "critical"
      )
    );
  }
  if (moneyDiff(evidence.scheduled_amount, financedAmount) > MONEY_TOLERANCE) {
    mismatches.push(
      mismatch(
        "schedule_principal_total",
        evidence.scheduled_amount,
        financedAmount,
        "critical"
      )
    );
  }
  if (evidence.schedule_line_count !== evidence.distinct_sequence_count) {
    mismatches.push(
      mismatch(
        "schedule_sequence_uniqueness",
        evidence.schedule_line_count,
        evidence.distinct_sequence_count,
        "critical"
      )
    );
  }
  if (evidence.non_positive_schedule_count > 0) {
    mismatches.push(
      mismatch(
        "non_positive_schedule_lines",
        evidence.non_positive_schedule_count,
        0,
        "critical"
      )
    );
  }
  const storedFirstDue = dateText(agreement.first_due_date);
  const evidenceFirstDue = dateText(evidence.first_schedule_due_date);
  if (storedFirstDue && evidenceFirstDue && storedFirstDue !== evidenceFirstDue) {
    mismatches.push(
      mismatch("first_due_date_schedule", storedFirstDue, evidenceFirstDue, "critical")
    );
  }
  const storedFinalDue = dateText(agreement.final_due_date);
  const evidenceFinalDue = dateText(evidence.final_schedule_due_date);
  if (storedFinalDue && evidenceFinalDue && storedFinalDue !== evidenceFinalDue) {
    mismatches.push(
      mismatch("final_due_date_schedule", storedFinalDue, evidenceFinalDue, "critical")
    );
  }
  if (evidence.cross_agreement_allocation_count > 0) {
    mismatches.push(
      mismatch(
        "cross_agreement_payment_allocations",
        evidence.cross_agreement_allocation_count,
        0,
        "critical"
      )
    );
  }
  if (evidence.negative_allocation_count > 0) {
    mismatches.push(
      mismatch(
        "negative_payment_allocations",
        evidence.negative_allocation_count,
        0,
        "critical"
      )
    );
  }
  if (evidence.active_allocated_amount - evidence.allocatable_payment_amount > MONEY_TOLERANCE) {
    mismatches.push(
      mismatch(
        "payment_allocations_exceed_receipts",
        evidence.active_allocated_amount,
        evidence.allocatable_payment_amount,
        "critical"
      )
    );
  }
  if (moneyDiff(evidence.schedule_amount_paid, evidence.active_allocated_amount) > MONEY_TOLERANCE) {
    mismatches.push(
      mismatch(
        "schedule_allocation_evidence",
        evidence.schedule_amount_paid,
        evidence.active_allocated_amount,
        "critical"
      )
    );
  }

  return {
    agreement_id: Number(agreement.id),
    agreement_number: agreement.agreement_number,
    workspace_code: FINANCE_WORKSPACE,
    consistent: mismatches.length === 0,
    mismatches,
    agreement,
    evidence,
    calculated: {
      amount_paid: evidence.amount_paid,
      deposit_received: evidence.deposit_received,
      late_charges_total: evidence.late_charges,
      waived_charges_total: evidence.waived_charges,
      ledger_debits: evidence.ledger_debits,
      ledger_credits: evidence.ledger_credits,
      outstanding_balance: outstandingBalance,
      overdue_amount: overdueAmount,
      next_due_date: expectedNextDue,
      agreement_status: status,
      schedule_principal_total: evidence.scheduled_amount,
      first_schedule_due_date: evidenceFirstDue,
      final_schedule_due_date: evidenceFinalDue,
    },
  };
}

async function reconcileFinanceAgreement(
  agreementId,
  { connection = pool, lock = false } = {}
) {
  const agreement = await loadAgreement(connection, agreementId, { lock });
  const evidence = await loadEvidence(connection, agreement.id);
  return buildReconciliation(agreement, evidence);
}

function mapByAgreement(rows = []) {
  return new Map(rows.map((row) => [Number(row.agreement_id), row]));
}

async function reconcileFinancePortfolio({ connection = pool } = {}) {
  const [agreements] = await connection.query(
    `SELECT agreement.id, agreement.agreement_number, agreement.agreement_status,
            agreement.sale_type, agreement.activation_source,
            agreement.equipment_commitment_status, agreement.deposit_required,
            agreement.total_amount, agreement.financed_amount,
            agreement.amount_paid, agreement.deposit_received,
            agreement.late_charges_total, agreement.waived_charges_total,
            agreement.outstanding_balance, agreement.overdue_amount,
            agreement.first_due_date, agreement.next_due_date, agreement.final_due_date,
            agreement.customer_name_snapshot, agreement.customer_phone_snapshot,
            agreement.asset_code_snapshot, agreement.asset_name_snapshot,
            agreement.created_at
       FROM equipment_sale_agreements agreement
      WHERE ${financeAgreementScope("agreement")}
      ORDER BY agreement.created_at DESC, agreement.id DESC`
  );
  if (!agreements.length) return [];

  const [[payments], [schedules], [allocations], [ledgers]] = await Promise.all([
    connection.query(
      `SELECT payment.agreement_id,
              COALESCE(SUM(CASE WHEN payment.is_voided = FALSE THEN payment.amount ELSE 0 END), 0) AS amount_paid,
              COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND payment.payment_category = 'deposit' THEN payment.amount ELSE 0 END), 0) AS deposit_received,
              COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND payment.payment_category IN ('installment','settlement') THEN payment.amount ELSE 0 END), 0) AS allocatable_payment_amount,
              COUNT(CASE WHEN payment.is_voided = FALSE THEN 1 END) AS active_payment_count
         FROM equipment_sale_payments payment
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = payment.agreement_id
        WHERE ${financeAgreementScope("agreement")}
        GROUP BY payment.agreement_id`
    ),
    connection.query(
      `${scheduleEvidenceSql("schedule.agreement_id")}
         FROM equipment_installment_schedule schedule
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
        WHERE ${financeAgreementScope("agreement")}
        GROUP BY schedule.agreement_id`
    ),
    connection.query(
      `SELECT schedule.agreement_id,
              COALESCE(SUM(CASE WHEN payment.is_voided = FALSE AND schedule.schedule_status <> 'rescheduled' THEN allocation.allocated_amount ELSE 0 END), 0) AS active_allocated_amount,
              COALESCE(SUM(CASE WHEN payment.is_voided = TRUE THEN allocation.allocated_amount ELSE 0 END), 0) AS voided_allocated_amount,
              COALESCE(SUM(CASE WHEN schedule.schedule_status = 'rescheduled' THEN allocation.allocated_amount ELSE 0 END), 0) AS rescheduled_allocated_amount,
              COALESCE(SUM(CASE WHEN payment.agreement_id <> schedule.agreement_id THEN 1 ELSE 0 END), 0) AS cross_agreement_allocation_count,
              COALESCE(SUM(CASE WHEN allocation.allocated_amount < 0 THEN 1 ELSE 0 END), 0) AS negative_allocation_count
         FROM equipment_sale_payment_allocations allocation
         INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
         INNER JOIN equipment_installment_schedule schedule ON schedule.id = allocation.schedule_id
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
        WHERE ${financeAgreementScope("agreement")}
        GROUP BY schedule.agreement_id`
    ),
    connection.query(
      `SELECT ledger.agreement_id,
              COALESCE(SUM(CASE WHEN ledger.direction = 'debit' THEN ledger.amount ELSE 0 END), 0) AS ledger_debits,
              COALESCE(SUM(CASE WHEN ledger.direction = 'credit' THEN ledger.amount ELSE 0 END), 0) AS ledger_credits
         FROM equipment_finance_ledger_entries ledger
         INNER JOIN equipment_sale_agreements agreement ON agreement.id = ledger.agreement_id
        WHERE ${financeAgreementScope("agreement")}
        GROUP BY ledger.agreement_id`
    ),
  ]);

  const paymentMap = mapByAgreement(payments);
  const scheduleMap = mapByAgreement(schedules);
  const allocationMap = mapByAgreement(allocations);
  const ledgerMap = mapByAgreement(ledgers);

  return agreements.map((agreement) =>
    buildReconciliation(agreement, {
      ...(paymentMap.get(Number(agreement.id)) || {}),
      ...(scheduleMap.get(Number(agreement.id)) || {}),
      ...(allocationMap.get(Number(agreement.id)) || {}),
      ...(ledgerMap.get(Number(agreement.id)) || {}),
    })
  );
}

async function assertFinanceMutationSafe(agreementId, options = {}) {
  const result = await reconcileFinanceAgreement(agreementId, options);
  const critical = result.mismatches.filter((entry) => entry.severity === "critical");
  if (critical.length) {
    throw new EquipmentFinanceReconciliationError(
      409,
      "This Finance account does not reconcile with its active receipts, allocations, schedule and ledger. No financial change was saved.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED",
      {
        agreement_id: result.agreement_id,
        agreement_number: result.agreement_number,
        mismatches: critical,
      }
    );
  }
  if (result.mismatches.length) {
    return refreshFinanceAgreementFromEvidence(options.connection || pool, agreementId);
  }
  return result;
}

async function refreshFinanceAgreementFromEvidence(connection, agreementId) {
  const before = await reconcileFinanceAgreement(agreementId, { connection, lock: true });
  const critical = before.mismatches.filter((entry) => entry.severity === "critical");
  if (critical.length) {
    throw new EquipmentFinanceReconciliationError(
      409,
      "The Finance account has conflicting receipt, allocation or schedule evidence. No balance was changed.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED",
      {
        agreement_id: before.agreement_id,
        agreement_number: before.agreement_number,
        mismatches: critical,
      }
    );
  }
  const values = before.calculated;
  await connection.query(
    `UPDATE equipment_sale_agreements
        SET amount_paid = ?, deposit_received = ?, late_charges_total = ?,
            waived_charges_total = ?, outstanding_balance = ?, overdue_amount = ?,
            next_due_date = ?, agreement_status = ?,
            completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
      WHERE id = ?`,
    [
      values.amount_paid,
      values.deposit_received,
      values.late_charges_total,
      values.waived_charges_total,
      values.outstanding_balance,
      values.overdue_amount,
      values.next_due_date,
      values.agreement_status,
      values.agreement_status,
      before.agreement_id,
    ]
  );

  const after = await reconcileFinanceAgreement(agreementId, { connection, lock: false });
  if (!after.consistent) {
    throw new EquipmentFinanceReconciliationError(
      409,
      "The Finance balance guard did not produce a reconciled account. The transaction was rolled back.",
      "EQUIPMENT_FINANCE_POST_UPDATE_RECONCILIATION_FAILED",
      {
        agreement_id: after.agreement_id,
        agreement_number: after.agreement_number,
        mismatches: after.mismatches,
      }
    );
  }
  return after;
}

module.exports = {
  ACTIVE_SCHEDULE_STATUSES,
  EquipmentFinanceReconciliationError,
  FINANCE_WORKSPACE,
  MONEY_TOLERANCE,
  activeScheduleCondition,
  assertFinanceMutationSafe,
  buildReconciliation,
  financeAgreementScope,
  numberValue,
  reconcileFinanceAgreement,
  reconcileFinancePortfolio,
  refreshFinanceAgreementFromEvidence,
};
