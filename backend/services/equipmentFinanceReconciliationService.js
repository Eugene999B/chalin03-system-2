const base = require("./equipmentFinanceReconciliationServiceBase");
const { pool } = require("../config/db");
const { dateOnly } = require("./equipmentFinanceDateOnlyService");
const {
  getAgreementScheduleTruth,
  getPortfolioScheduleTruth,
} = require("./equipmentFinanceScheduleTruthService");

function toDateText(value) {
  return dateOnly(value);
}

// Finance due dates must come from actual schedule or agreement evidence.
// Inventing a due date 30 days after creation can misstate collections,
// trigger reminders, and conceal incomplete installment schedules.
function firstValidDate(candidates) {
  return candidates.map(toDateText).find(Boolean) || null;
}

async function getDirectScheduleNextDue(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT s.due_date
       FROM equipment_installment_schedule s
      WHERE s.agreement_id = ?
        AND s.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
        AND COALESCE(s.due_date, '') <> ''
        AND GREATEST(
          COALESCE(s.scheduled_amount, 0)
          + COALESCE(s.late_charge_amount, 0)
          - COALESCE(s.waived_charge_amount, 0)
          - COALESCE(s.amount_paid, 0), 0
        ) > 0.009
      ORDER BY s.due_date, s.sequence_number
      LIMIT 1`,
    [Number(agreementId)]
  );
  return toDateText(rows[0]?.due_date);
}

function operationalize(result, truth = {}, directNextDue = null) {
  const agreement = result?.agreement || {};
  const firstDue = firstValidDate([
    truth.first_due_date,
    result?.calculated?.first_schedule_due_date,
    result?.evidence?.first_schedule_due_date,
    agreement.first_due_date,
  ]);
  const finalDue = firstValidDate([
    truth.final_due_date,
    result?.calculated?.final_schedule_due_date,
    result?.evidence?.final_schedule_due_date,
    agreement.final_due_date,
  ]);
  const terminal = ["completed", "cancelled", "defaulted"].includes(
    String(result?.calculated?.agreement_status || agreement.agreement_status || "")
  );
  const nextDue = terminal ? null : firstValidDate([
    directNextDue,
    truth.next_due_date,
    result?.calculated?.next_due_date,
    result?.evidence?.next_due_date,
    agreement.next_due_date,
  ]);

  return {
    ...result,
    consistent: Boolean(result?.consistent),
    collection_operational: Boolean(result?.consistent),
    next_due_date: nextDue,
    next_installment_due_date: nextDue,
    first_due_date: firstDue,
    final_due_date: finalDue,
    calculated: {
      ...(result?.calculated || {}),
      first_schedule_due_date: firstDue,
      next_due_date: nextDue,
      next_installment_due_date: nextDue,
      final_schedule_due_date: finalDue,
    },
  };
}

async function reconcileFinanceAgreement(agreementId, options = {}) {
  const result = await base.reconcileFinanceAgreement(agreementId, options);
  const db = options.connection || pool;
  const [truth, directNextDue] = await Promise.all([
    getAgreementScheduleTruth(db, result.agreement_id),
    getDirectScheduleNextDue(db, result.agreement_id),
  ]);
  return operationalize(result, truth, directNextDue);
}

async function reconcileFinancePortfolio(options = {}) {
  const rows = await base.reconcileFinancePortfolio(options);
  const connection = options.connection || pool;
  const truthMap = await getPortfolioScheduleTruth(connection);
  return rows.map((row) => operationalize(row, truthMap.get(Number(row.agreement_id)) || {}, truthMap.get(Number(row.agreement_id))?.next_due_date || null));
}

async function assertFinanceMutationSafe(agreementId, options = {}) {
  // The base guard rejects critical evidence mismatches before any mutation
  // and repairs only recoverable fields under the existing transaction.
  // Never treat a merely readable account as safe for payment or delivery.
  await base.assertFinanceMutationSafe(agreementId, options);
  return reconcileFinanceAgreement(agreementId, options);
}

async function refreshFinanceAgreementFromEvidence(connection, agreementId) {
  const reconciliation = await reconcileFinanceAgreement(agreementId, { connection, lock: true });
  const critical = (reconciliation.mismatches || [])
    .filter((item) => item.severity === "critical");
  if (critical.length) {
    throw new base.EquipmentFinanceReconciliationError(
      409,
      "This Finance agreement has critical schedule, allocation or ledger inconsistencies. No balance was changed.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED",
      { agreement_id: reconciliation.agreement_id, mismatches: critical }
    );
  }
  const values = reconciliation.calculated || {};
  await connection.query(
    `UPDATE equipment_sale_agreements
        SET amount_paid = ?,
            deposit_received = ?,
            late_charges_total = ?,
            waived_charges_total = ?,
            outstanding_balance = ?,
            overdue_amount = ?,
            first_due_date = ?,
            next_due_date = ?,
            final_due_date = ?,
            agreement_status = ?,
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
      values.first_schedule_due_date,
      values.next_due_date,
      values.final_schedule_due_date,
      values.agreement_status,
      values.agreement_status,
      reconciliation.agreement_id,
    ]
  );
  const after = await reconcileFinanceAgreement(agreementId, { connection, lock: false });
  if (!after.consistent) {
    throw new base.EquipmentFinanceReconciliationError(
      409,
      "The Finance account could not be reconciled. The transaction must be rolled back.",
      "EQUIPMENT_FINANCE_POST_UPDATE_RECONCILIATION_FAILED",
      { agreement_id: after.agreement_id, mismatches: after.mismatches }
    );
  }
  return after;
}

module.exports = {
  ...base,
  operationalize,
  assertFinanceMutationSafe,
  reconcileFinanceAgreement,
  reconcileFinancePortfolio,
  refreshFinanceAgreementFromEvidence,
};
