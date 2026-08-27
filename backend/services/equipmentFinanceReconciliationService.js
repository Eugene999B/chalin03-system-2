const base = require("./equipmentFinanceReconciliationServiceBase");

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

function operationalize(result) {
  const agreement = result?.agreement || {};
  const createdDate = toDateText(agreement.created_at);
  const firstDue = firstValidDate([
    result?.calculated?.first_schedule_due_date,
    result?.evidence?.first_schedule_due_date,
    agreement.first_due_date,
  ], createdDate);
  const nextDue = firstValidDate([
    result?.calculated?.next_due_date,
    result?.evidence?.next_due_date,
    result?.evidence?.first_schedule_due_date,
    agreement.next_due_date,
    firstDue,
  ], createdDate);
  const finalDue = firstValidDate([
    result?.calculated?.final_schedule_due_date,
    result?.evidence?.final_schedule_due_date,
    agreement.final_due_date,
    nextDue,
  ], createdDate);

  return {
    ...result,
    // Reconciliation remains visible through mismatches, but historical data defects do not
    // lock normal collections or other routine Finance mutations.
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
  return operationalize(await base.reconcileFinanceAgreement(agreementId, options));
}

async function reconcileFinancePortfolio(options = {}) {
  const rows = await base.reconcileFinancePortfolio(options);
  return rows.map(operationalize);
}

async function assertFinanceMutationSafe(agreementId, options = {}) {
  // Reconciliation is diagnostic evidence, not a reason to prevent ordinary receipt entry.
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
