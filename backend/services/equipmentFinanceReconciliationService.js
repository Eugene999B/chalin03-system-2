const legacy = require("./equipmentFinanceReconciliationLegacyService");
const { pool } = require("../config/db");

async function authoritativeNextDue(connection, agreementId) {
  const [rows] = await connection.query(
    `SELECT MIN(schedule.due_date) AS next_due_date
       FROM equipment_installment_schedule schedule
      WHERE schedule.agreement_id = ?
        AND schedule.schedule_status IN ('upcoming','due','partial','overdue')
        AND schedule.due_date >= CURRENT_DATE
        AND GREATEST(
          schedule.scheduled_amount + schedule.late_charge_amount -
          schedule.waived_charge_amount - schedule.amount_paid,
          0
        ) > 0.01`,
    [agreementId]
  );
  return rows[0]?.next_due_date ? String(rows[0].next_due_date).slice(0, 10) : null;
}

async function reconcileFinanceAgreement(agreementId, options = {}) {
  const connection = options.connection || pool;
  const result = await legacy.reconcileFinanceAgreement(agreementId, options);
  const expectedNextDue = await authoritativeNextDue(connection, result.agreement_id);
  const storedNextDue = result.agreement?.next_due_date
    ? String(result.agreement.next_due_date).slice(0, 10)
    : null;

  result.evidence.next_due_date = expectedNextDue;
  result.calculated.next_due_date = expectedNextDue;
  result.mismatches = result.mismatches.filter((entry) => entry.field !== "next_due_date");
  if (storedNextDue !== expectedNextDue) {
    result.mismatches.push({
      field: "next_due_date",
      stored: storedNextDue,
      expected: expectedNextDue,
      severity: "repairable",
    });
  }
  result.consistent = result.mismatches.length === 0;
  return result;
}

async function reconcileFinancePortfolio(options = {}) {
  const connection = options.connection || pool;
  const results = await legacy.reconcileFinancePortfolio(options);
  const corrected = [];
  for (const result of results) {
    const expectedNextDue = await authoritativeNextDue(connection, result.agreement_id);
    const storedNextDue = result.agreement?.next_due_date
      ? String(result.agreement.next_due_date).slice(0, 10)
      : null;
    result.evidence.next_due_date = expectedNextDue;
    result.calculated.next_due_date = expectedNextDue;
    result.mismatches = result.mismatches.filter((entry) => entry.field !== "next_due_date");
    if (storedNextDue !== expectedNextDue) {
      result.mismatches.push({
        field: "next_due_date",
        stored: storedNextDue,
        expected: expectedNextDue,
        severity: "repairable",
      });
    }
    result.consistent = result.mismatches.length === 0;
    corrected.push(result);
  }
  return corrected;
}

async function refreshFinanceAgreementFromEvidence(connection, agreementId) {
  const before = await reconcileFinanceAgreement(agreementId, { connection, lock: true });
  const critical = before.mismatches.filter((entry) => entry.severity === "critical");
  if (critical.length) {
    const error = new legacy.EquipmentFinanceReconciliationError(
      409,
      "The Finance account has conflicting receipt, allocation or schedule evidence. No balance was changed.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED",
      { agreement_id: before.agreement_id, agreement_number: before.agreement_number, mismatches: critical }
    );
    throw error;
  }

  const values = before.calculated;
  await connection.query(
    `UPDATE equipment_sale_agreements
        SET amount_paid = ?, deposit_received = ?, late_charges_total = ?,
            waived_charges_total = ?, outstanding_balance = ?, overdue_amount = ?,
            next_due_date = ?, agreement_status = ?,
            completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            reconciliation_status = 'reconciled',
            reconciliation_checked_at = NOW(),
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
    const error = new legacy.EquipmentFinanceReconciliationError(
      409,
      "The Finance balance guard did not produce a reconciled account. The transaction was rolled back.",
      "EQUIPMENT_FINANCE_POST_UPDATE_RECONCILIATION_FAILED",
      { agreement_id: after.agreement_id, agreement_number: after.agreement_number, mismatches: after.mismatches }
    );
    throw error;
  }
  return after;
}

async function assertFinanceMutationSafe(agreementId, options = {}) {
  const result = await reconcileFinanceAgreement(agreementId, options);
  const critical = result.mismatches.filter((entry) => entry.severity === "critical");
  if (critical.length) {
    throw new legacy.EquipmentFinanceReconciliationError(
      409,
      "This Finance account does not reconcile with its active receipts, allocations, schedule and ledger. No financial change was saved.",
      "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED",
      { agreement_id: result.agreement_id, agreement_number: result.agreement_number, mismatches: critical }
    );
  }
  if (result.mismatches.length) {
    return refreshFinanceAgreementFromEvidence(options.connection || pool, agreementId);
  }
  return result;
}

module.exports = {
  ...legacy,
  assertFinanceMutationSafe,
  reconcileFinanceAgreement,
  reconcileFinancePortfolio,
  refreshFinanceAgreementFromEvidence,
  authoritativeNextDue,
};
