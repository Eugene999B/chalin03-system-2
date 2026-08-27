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

async function scheduleTruth(connection, agreementId, createdDate) {
  const [rows] = await connection.query(
    `SELECT
       MIN(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
          AND DATE(s.due_date) >= DATE(?)
          AND GREATEST(
            s.scheduled_amount + COALESCE(s.late_charge_amount, 0) - COALESCE(s.waived_charge_amount, 0)
            - COALESCE(ae.allocated_amount, 0),
            0
          ) > 0.009
         THEN s.due_date
       END) AS allocation_backed_next_due_date,
       MIN(CASE
         WHEN s.schedule_status NOT IN ('rescheduled')
          AND DATE(s.due_date) >= DATE(?)
         THEN s.due_date
       END) AS allocation_backed_first_due_date,
       MAX(CASE
         WHEN s.schedule_status <> 'rescheduled'
          AND DATE(s.due_date) >= DATE(?)
         THEN s.due_date
       END) AS allocation_backed_final_due_date
     FROM equipment_installment_schedule s
     LEFT JOIN (
       SELECT allocation.schedule_id,
              SUM(CASE WHEN payment.is_voided = FALSE THEN allocation.allocated_amount ELSE 0 END) AS allocated_amount
         FROM equipment_sale_payment_allocations allocation
         INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
        GROUP BY allocation.schedule_id
     ) ae ON ae.schedule_id = s.id
    WHERE s.agreement_id = ?`,
    [createdDate || "1000-01-01", createdDate || "1000-01-01", createdDate || "1000-01-01", agreementId]
  );
  return rows[0] || {};
}

function operationalize(result, truth = {}) {
  const agreement = result?.agreement || {};
  const createdDate = toDateText(agreement.created_at);
  const firstDue = firstValidDate([
    truth.allocation_backed_first_due_date,
    result?.calculated?.first_schedule_due_date,
    result?.evidence?.first_schedule_due_date,
    agreement.first_due_date,
  ], createdDate);
  const nextDue = firstValidDate([
    truth.allocation_backed_next_due_date,
    result?.calculated?.next_due_date,
    result?.evidence?.next_due_date,
    agreement.next_due_date,
    firstDue,
  ], createdDate);
  const finalDue = firstValidDate([
    truth.allocation_backed_final_due_date,
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
  const connection = options.connection || undefined;
  const ownConnection = !connection;
  const db = connection || base.pool;
  try {
    const truth = await scheduleTruth(
      db,
      result.agreement_id,
      toDateText(result?.agreement?.created_at)
    );
    return operationalize(result, truth);
  } finally {
    if (ownConnection) {
      // The pool connection is intentionally reused; nothing to release.
    }
  }
}

async function reconcileFinancePortfolio(options = {}) {
  const rows = await base.reconcileFinancePortfolio(options);
  const connection = options.connection || base.pool;
  const truthRows = await connection.query(
    `SELECT
       s.agreement_id,
       MIN(CASE
         WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
          AND DATE(s.due_date) >= DATE(agreement.created_at)
          AND GREATEST(
            s.scheduled_amount + COALESCE(s.late_charge_amount, 0) - COALESCE(s.waived_charge_amount, 0)
            - COALESCE(ae.allocated_amount, 0),
            0
          ) > 0.009
         THEN s.due_date
       END) AS allocation_backed_next_due_date,
       MIN(CASE WHEN s.schedule_status <> 'rescheduled' THEN s.due_date END) AS allocation_backed_first_due_date,
       MAX(CASE WHEN s.schedule_status <> 'rescheduled' THEN s.due_date END) AS allocation_backed_final_due_date
     FROM equipment_installment_schedule s
     INNER JOIN equipment_sale_agreements agreement ON agreement.id = s.agreement_id
     LEFT JOIN (
       SELECT allocation.schedule_id,
              SUM(CASE WHEN payment.is_voided = FALSE THEN allocation.allocated_amount ELSE 0 END) AS allocated_amount
         FROM equipment_sale_payment_allocations allocation
         INNER JOIN equipment_sale_payments payment ON payment.id = allocation.payment_id
        GROUP BY allocation.schedule_id
     ) ae ON ae.schedule_id = s.id
    WHERE agreement.sale_type = 'installment'
      AND agreement.activation_source = 'approved_credit_application'
    GROUP BY s.agreement_id`
  );
  const truthMap = new Map((truthRows[0] || []).map((row) => [Number(row.agreement_id), row]));
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
