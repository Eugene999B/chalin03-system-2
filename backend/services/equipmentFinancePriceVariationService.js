// Approved Finance price variations adjust only future/unpaid instalment principal.
// Historic signed documents, receipts, allocations, ledger events and paid schedule
// rows remain immutable. This module must be invoked within the amendment transaction.
const { reconcileFinanceAgreement, refreshFinanceAgreementFromEvidence } = require("./equipmentFinanceReconciliationService");

class PriceVariationError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = "FINANCE_PRICE_VARIATION_BLOCKED";
  }
}

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 99999999999.99 ||
      Math.abs(Math.round(n * 100) - n * 100) > 0.0001) {
    throw new PriceVariationError(400, "Use a valid Ghana cedi amount with no more than two decimals.");
  }
  return Math.round(n * 100);
}

function planUnpaidScheduleVariation({ oldPrice, newPrice, depositRequired, paymentsReceived, schedule }) {
  const oldTotal = cents(oldPrice);
  const newTotal = cents(newPrice);
  const deposit = cents(depositRequired);
  const received = cents(paymentsReceived);
  if (newTotal < 1 || newTotal <= deposit || newTotal < received) {
    throw new PriceVariationError(409, "The revised price must exceed the deposit, cover all receipts and leave a valid financed amount.");
  }
  const delta = newTotal - oldTotal;
  if (!delta) throw new PriceVariationError(409, "The proposed price is already the agreement price.");
  const lines = schedule.map(row => ({
    id: Number(row.id),
    sequence_number: Number(row.sequence_number),
    schedule_status: String(row.schedule_status || ""),
    before: cents(row.scheduled_amount),
    paid: cents(row.amount_paid),
    after: cents(row.scheduled_amount),
  }));
  if (lines.some(row => !Number.isSafeInteger(row.id) || row.id < 1 || row.paid > row.before)) {
    throw new PriceVariationError(409, "Schedule evidence is inconsistent. No agreement was changed.");
  }
  const originalFinanced = oldTotal - deposit;
  const scheduledPrincipal = lines.filter(row => row.schedule_status !== "rescheduled")
    .reduce((sum, row) => sum + row.before, 0);
  if (originalFinanced !== scheduledPrincipal) {
    throw new PriceVariationError(409, "The agreement's instalment schedule does not match the financed amount.");
  }
  // Every settled or otherwise closed line is historical evidence and remains
  // untouched. Spread the new outstanding *principal* across all remaining
  // active periods, rather than adding the difference only to the final bill.
  // For partially paid periods retain their allocation, then add their new
  // share of the unpaid principal to that existing paid amount.
  const openStatuses = new Set(["upcoming", "due", "partial", "overdue"]);
  const unpaid = lines.filter(row => openStatuses.has(row.schedule_status))
    .sort((a, b) => a.sequence_number - b.sequence_number);
  if (!unpaid.length) throw new PriceVariationError(409, "There are no unpaid instalments to amend. A separate settlement review is needed.");
  const newFinanced = newTotal - deposit;
  const protectedPrincipal = lines
    .filter(row => row.schedule_status !== "rescheduled" && !openStatuses.has(row.schedule_status))
    .reduce((sum, row) => sum + row.before, 0);
  const alreadyAllocatedToOpen = unpaid.reduce((sum, row) => sum + row.paid, 0);
  const remainingPrincipal = newFinanced - protectedPrincipal - alreadyAllocatedToOpen;
  if (remainingPrincipal < unpaid.length) {
    throw new PriceVariationError(409,
      "The revised price cannot cover already-paid instalments and leave a positive amount in every remaining period. Use a settlement correction.");
  }
  const basePeriodBalance = Math.floor(remainingPrincipal / unpaid.length);
  const roundingCents = remainingPrincipal % unpaid.length;
  for (const [index, row] of unpaid.entries()) {
    // The last remaining payment absorbs any rounding; all earlier remaining
    // principal balances are identical to the cent.
    row.after = row.paid + basePeriodBalance + (index === unpaid.length - 1 ? roundingCents : 0);
  }
  const finalPrincipal = lines.filter(row => row.schedule_status !== "rescheduled")
    .reduce((sum, row) => sum + row.after, 0);
  if (finalPrincipal !== newFinanced || lines.some(row => row.after <= 0 || row.after < row.paid)) {
    throw new PriceVariationError(409, "The amended schedule could not be reconciled. Nothing was changed.");
  }
  return {
    old_total: oldTotal / 100,
    new_total: newTotal / 100,
    deposit_required: deposit / 100,
    old_financed: originalFinanced / 100,
    new_financed: newFinanced / 100,
    unpaid_period_count: unpaid.length,
    remaining_principal_to_schedule: remainingPrincipal / 100,
    typical_remaining_period_principal: basePeriodBalance / 100,
    schedule_updates: lines.filter(row => row.after !== row.before).map(row => ({
      id: row.id,
      sequence_number: row.sequence_number,
      before: row.before / 100,
      after: row.after / 100,
      paid: row.paid / 100,
    })),
  };
}

async function applyApprovedPriceVariation({ connection, amendment, proposed }) {
  const fields = Object.keys(proposed || {}).sort();
  if (amendment.amendment_type !== "commercial_variation" ||
      fields.join(",") !== "customer_acceptance_document_id,purchase_price" ||
      !amendment.agreement_id || !amendment.approved_by ||
      Number(amendment.approved_by) === Number(amendment.requested_by)) {
    throw new PriceVariationError(409, "A price change needs an independently approved commercial variation and verified customer acceptance.");
  }
  const agreementId = Number(amendment.agreement_id);
  const acceptanceId = Number(proposed.customer_acceptance_document_id);
  if (!Number.isSafeInteger(acceptanceId) || acceptanceId < 1) {
    throw new PriceVariationError(400, "Attach the verified customer-signed variation before applying the new price.");
  }
  const [agreementRows] = await connection.query(
    `SELECT agreement.*, asset.target_selling_price AS machine_register_price
       FROM equipment_sale_agreements agreement
       INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
       WHERE agreement.id = ? AND agreement.sale_type = 'installment'
         AND agreement.activation_source = 'approved_credit_application'
       LIMIT 1 FOR UPDATE`, [agreementId]
  );
  const agreement = agreementRows[0];
  if (!agreement || ["cancelled","completed","defaulted"].includes(agreement.agreement_status)) {
    throw new PriceVariationError(409, "Only an active, outstanding instalment agreement can receive this variation.");
  }
  const [documentRows] = await connection.query(
    `SELECT id, document_status, document_category, checksum_sha256, verified_by
       FROM equipment_finance_case_documents
       WHERE id = ? AND agreement_id = ? AND document_status = 'verified'
         AND document_category IN ('signed_price_amendment', 'customer_signed_price_variation')
       LIMIT 1 FOR UPDATE`,
    [acceptanceId, agreementId]
  );
  const signed = documentRows[0];
  if (!signed || !signed.verified_by || Number(signed.verified_by) === Number(amendment.requested_by)) {
    throw new PriceVariationError(409, "The customer-signed price amendment must be independently verified in the private document vault.");
  }
  const newPriceCents = cents(proposed.purchase_price);
  if (newPriceCents !== cents(agreement.machine_register_price)) {
    throw new PriceVariationError(409, "The excavator register price changed again. Review and submit a fresh amendment.");
  }
  const before = JSON.parse(amendment.before_snapshot_json || "{}");
  if (cents(before.total_amount) !== cents(agreement.total_amount)) {
    throw new PriceVariationError(409, "The original agreement price has changed since the amendment request. Submit a fresh request.");
  }
  const recon = await reconcileFinanceAgreement(agreementId, { connection, lock: false });
  if (!recon.consistent) throw new PriceVariationError(409,
    "This agreement has unresolved payment, balance or schedule discrepancies. Resolve them before adjusting the price.");
  const [schedule] = await connection.query(
    "SELECT id, sequence_number, scheduled_amount, amount_paid, schedule_status FROM equipment_installment_schedule WHERE agreement_id = ? ORDER BY sequence_number FOR UPDATE",
    [agreementId]
  );
  const plan = planUnpaidScheduleVariation({
    oldPrice: agreement.total_amount,
    newPrice: proposed.purchase_price,
    depositRequired: agreement.deposit_required,
    paymentsReceived: recon.calculated.amount_paid,
    schedule,
  });
  for (const row of plan.schedule_updates) {
    await connection.query(
      "UPDATE equipment_installment_schedule SET scheduled_amount = ?, updated_at = NOW() WHERE id = ? AND agreement_id = ?",
      [row.after, row.id, agreementId]
    );
  }
  await connection.query(
    "UPDATE equipment_sale_agreements SET total_amount = ?, financed_amount = ?, updated_at = NOW() WHERE id = ?",
    [plan.new_total, plan.new_financed, agreementId]
  );
  const revised = await refreshFinanceAgreementFromEvidence(connection, agreementId);
  return {
    ...plan,
    revised_outstanding_balance: revised.calculated.outstanding_balance,
    verified_customer_acceptance_document_id: acceptanceId,
    customer_acceptance_checksum: signed.checksum_sha256,
    original_issued_signed_documents_preserved: true,
    receipts_and_payment_allocations_preserved: true,
  };
}


/**
 * Automatically reconcile ONE active agreement when an authorised Finance
 * machine-register editor explicitly saves that machine's selling price.
 *
 * Called by updateFinanceMachine() inside its existing transaction. An invalid
 * or underpaid schedule throws and rolls back BOTH the catalog edit and the
 * financial correction. Original signed/issued documents and paid receipts
 * are deliberately NOT rewritten.
 */
async function syncActiveAgreementPriceFromMachine({
  connection, assetId, newPrice, correctionReason, activeAgreementCount = 0,
}) {
  if (String(correctionReason || "").trim().length < 12) {
    throw new PriceVariationError(400, "Record a reason for the financial correction.");
  }
  const [rows] = await connection.query(
    `SELECT agreement.*
       FROM equipment_sale_agreements agreement
      WHERE agreement.asset_id = ? AND agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND agreement.agreement_status NOT IN ('cancelled','completed','defaulted')
      FOR UPDATE`,
    [assetId]
  );
  if (!rows.length) {
    if (Number(activeAgreementCount) > 0) {
      throw new PriceVariationError(409,
        "This excavator has a protected agreement that cannot be automatically repriced. No account or machine price was changed.");
    }
    return null;
  }
  if (rows.length !== 1) {
    throw new PriceVariationError(409,
      "The excavator is linked to multiple active agreements. No price or balance was changed.");
  }
  const agreement = rows[0];
  if (cents(agreement.total_amount) === cents(newPrice)) return null;

  const reconciled = await reconcileFinanceAgreement(agreement.id, { connection, lock: false });
  if (!reconciled.consistent) {
    throw new PriceVariationError(409,
      "The existing installment balance, receipts and schedule do not reconcile. Correct them before editing the agreed price.");
  }
  const [schedule] = await connection.query(
    `SELECT id, sequence_number, scheduled_amount, amount_paid, schedule_status
       FROM equipment_installment_schedule WHERE agreement_id = ?
       ORDER BY sequence_number FOR UPDATE`,
    [agreement.id]
  );
  const plan = planUnpaidScheduleVariation({
    oldPrice: agreement.total_amount,
    newPrice,
    depositRequired: agreement.deposit_required,
    paymentsReceived: reconciled.calculated.amount_paid,
    schedule,
  });
  const projectedBalance = cents(plan.new_total) + cents(reconciled.calculated.late_charges_total)
    - cents(reconciled.calculated.waived_charges_total)
    + cents(reconciled.calculated.ledger_debits)
    - cents(reconciled.calculated.amount_paid)
    - cents(reconciled.calculated.ledger_credits);
  if (projectedBalance <= 0) {
    throw new PriceVariationError(409,
      "A revised price must leave a positive, fully reconciled outstanding balance. Use a settlement correction for fully paid accounts.");
  }
  if (cents(plan.new_total) <= cents(reconciled.calculated.amount_paid)) {
    throw new PriceVariationError(409,
      "The corrected price must leave an outstanding instalment balance. Use a settlement correction if receipts already cover the revised price.");
  }
  for (const line of plan.schedule_updates) {
    await connection.query(
      `UPDATE equipment_installment_schedule
          SET scheduled_amount = ?, updated_at = NOW()
        WHERE id = ? AND agreement_id = ?`,
      [line.after, line.id, agreement.id]
    );
  }
  await connection.query(
    `UPDATE equipment_sale_agreements
        SET total_amount = ?, financed_amount = ?, updated_at = NOW()
      WHERE id = ?`,
    [plan.new_total, plan.new_financed, agreement.id]
  );
  const after = await refreshFinanceAgreementFromEvidence(connection, agreement.id);
  if (!after.consistent) {
    throw new PriceVariationError(409, "Post-correction reconciliation failed. The entire edit was rolled back.");
  }
  return {
    agreement_id: Number(agreement.id),
    agreement_number: agreement.agreement_number,
    previous_agreement_price: plan.old_total,
    effective_agreement_price: plan.new_total,
    previous_outstanding_balance: reconciled.calculated.outstanding_balance,
    effective_outstanding_balance: after.calculated.outstanding_balance,
    installment_schedule_changes: plan.schedule_updates,
    original_signed_documents_preserved: true,
    existing_receipts_and_allocations_preserved: true,
    financial_correction_reason: String(correctionReason).trim(),
  };
}

module.exports = {
  PriceVariationError,
  planUnpaidScheduleVariation,
  applyApprovedPriceVariation,
  syncActiveAgreementPriceFromMachine,
};
