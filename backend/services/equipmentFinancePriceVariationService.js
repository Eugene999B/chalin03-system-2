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
  const unpaid = lines.filter(row => ["upcoming", "due", "partial", "overdue"].includes(row.schedule_status))
    .sort((a, b) => b.sequence_number - a.sequence_number);
  if (!unpaid.length) throw new PriceVariationError(409, "There are no unpaid instalments to amend. A separate settlement review is needed.");
  if (delta > 0) {
    unpaid[0].after += delta;
  } else {
    let remainder = -delta;
    for (const row of unpaid) {
      // Preserve every existing receipt allocation and a strictly positive schedule line.
      const capacity = Math.max(0, row.after - Math.max(row.paid, 1));
      const reduction = Math.min(remainder, capacity);
      row.after -= reduction;
      remainder -= reduction;
      if (remainder === 0) break;
    }
    if (remainder > 0) throw new PriceVariationError(
      409, "The reduction exceeds unpaid schedule principal. Use a separate overpayment/settlement correction."
    );
  }
  const newFinanced = newTotal - deposit;
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

module.exports = {
  PriceVariationError,
  planUnpaidScheduleVariation,
  applyApprovedPriceVariation,
};
