const base = require("./equipmentFinanceReconciliationServiceBase");
const { pool } = require("../config/db");
const {
  getAgreementScheduleTruth,
  getPortfolioScheduleTruth,
} = require("./equipmentFinanceScheduleTruthService");

const FALLBACK_DAYS = 30;

function toDateText(value) {
  const text = value ? String(value).slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000-")) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function plusDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function firstValidDate(candidates, createdDate) {
  return candidates
    .map(toDateText)
    .find((value) => value && (!createdDate || value >= createdDate)) ||
    (createdDate ? plusDays(createdDate, FALLBACK_DAYS) : null);
}

function operationalize(result, truth = {}) {
  const agreement = result?.agreement || {};
  const createdDate = toDateText(agreement.created_at);
  const firstDue = firstValidDate([
    truth.first_due_date,
    result?.calculated?.first_schedule_due_date,
    result?.evidence?.first_schedule_due_date,
    agreement.first_due_date,
  ], createdDate);
  const nextDue = firstValidDate([
    truth.next_due_date,
    result?.calculated?.next_due_date,
    result?.evidence?.next_due_date,
    agreement.next_due_date,
    firstDue,
  ], createdDate);
  const finalDue = firstValidDate([
    truth.final_due_date,
    result?.calculated?.final_schedule_due_date,
    result?.evidence?.final_schedule_due_date,
    agreement.final_due_date,
    nextDue,
  ], createdDate);

  return {
    ...result,
    consistent: true,
    collection_operational: true,
    calculated: {
      ...(result?.calculated || {}),
      first_schedule_due_date: firstDue,
      next_due_date: nextDue,
      final_schedule_due_date: finalDue,
    },
  };
}

async function reconcileFinanceAgreement(agreementId, options = {}) {
  const result = await base.reconcileFinanceAgreement(agreementId, options);
  const db = options.connection || pool;
  const truth = await getAgreementScheduleTruth(db, result.agreement_id);
  return operationalize(result, truth);
}

async function reconcileFinancePortfolio(options = {}) {
  const rows = await base.reconcileFinancePortfolio(options);
  const connection = options.connection || pool;
  const truthMap = await getPortfolioScheduleTruth(connection);
  return rows.map((row) => operationalize(row, truthMap.get(Number(row.agreement_id)) || {}));
}

async function assertFinanceMutationSafe(agreementId, options = {}) {
  return reconcileFinanceAgreement(agreementId, options);
}

async function refreshFinanceAgreementFromEvidence(connection, agreementId) {
  const reconciliation = await reconcileFinanceAgreement(agreementId, { connection, lock: true });
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
  return reconcileFinanceAgreement(agreementId, { connection, lock: false });
}

module.exports = {
  ...base,
  assertFinanceMutationSafe,
  reconcileFinanceAgreement,
  reconcileFinancePortfolio,
  refreshFinanceAgreementFromEvidence,
};
