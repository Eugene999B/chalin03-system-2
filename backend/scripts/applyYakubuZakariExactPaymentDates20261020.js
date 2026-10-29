"use strict";
require("dotenv").config();

const { pool } = require("../config/db");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  reconcileFinanceAgreement,
  refreshFinanceAgreementFromEvidence,
} = require("../services/equipmentFinanceReconciliationService");
const { issueDocument } = require("../services/equipmentFinanceProfessionalService");

const TARGET = Object.freeze({
  agreement: "ESA-20261001141345-5331",
  customer: "YAKUBU ZAKARI",
  asset: "EXC-018",
  original_document: "EFA-20261020082404-0410",
  original_checksum: "351f093019ca3fc955d17bfedb59f8a7bd9f260eeffc016cf81a4fd772bbc30a",
  before: ["2026-10-31", "2026-11-14"],
  after: ["2026-10-15", "2026-10-29"],
  amounts: [425000, 425000],
  price: 2050000,
  deposit: 1200000,
  financed: 850000,
  revision_reference: "YAKUBU-ZAKARI-EXACT-DATES-20261020",
});

function iso(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ""));
  return match ? match[1] : null;
}
function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Non-numeric agreement money evidence.");
  return Math.round(number * 100);
}
function requireExact(ok, message) {
  if (!ok) throw new Error(`Yakubu-only correction refused: ${message}`);
}

async function applyYakubuDates({ connection, apply = false } = {}) {
  const [matches] = await connection.query(
    `SELECT a.id, a.agreement_number, a.customer_name_snapshot, a.asset_id,
            a.agreement_status, a.sale_type, a.activation_source,
            a.total_amount, a.deposit_required, a.financed_amount,
            a.amount_paid, a.outstanding_balance, a.created_at,
            a.first_due_date, a.final_due_date,
            asset.asset_code, asset.serial_number
       FROM equipment_sale_agreements a
       INNER JOIN fleet_assets asset ON asset.id = a.asset_id
      WHERE a.agreement_number = ? AND UPPER(TRIM(a.customer_name_snapshot)) = ?
        AND asset.asset_code = ? AND a.sale_type = 'installment'
        AND a.activation_source = 'approved_credit_application'
      FOR UPDATE`,
    [TARGET.agreement, TARGET.customer, TARGET.asset]
  );
  requireExact(matches.length === 1, "agreement number, exact buyer and machine must identify one record.");
  const agreement = matches[0];
  requireExact(["active", "overdue", "payment_due", "approved"].includes(String(agreement.agreement_status)),
    "closed, defaulted or cancelled agreements cannot be rewritten.");
  requireExact(iso(agreement.created_at) <= TARGET.after[0],
    "requested first payment precedes creation of the agreement.");
  requireExact(cents(agreement.total_amount) === cents(TARGET.price) &&
    cents(agreement.deposit_required) === cents(TARGET.deposit) &&
    cents(agreement.financed_amount) === cents(TARGET.financed),
    "the customer's financial terms no longer match the uploaded document.");

  const [issued] = await connection.query(
    `SELECT id, document_number, snapshot_checksum
       FROM equipment_finance_issued_documents
      WHERE agreement_id = ? AND document_number = ?
        AND document_type = 'installment_agreement'
      FOR UPDATE`,
    [agreement.id, TARGET.original_document]
  );
  requireExact(issued.length === 1 && issued[0].snapshot_checksum === TARGET.original_checksum,
    "the exact verified historical source document must exist unchanged.");

  const [lines] = await connection.query(
    `SELECT id, sequence_number, CAST(due_date AS CHAR) AS due_date_text,
            scheduled_amount, amount_paid, late_charge_amount, waived_charge_amount,
            schedule_status
       FROM equipment_installment_schedule
      WHERE agreement_id = ? AND schedule_status <> 'rescheduled'
      ORDER BY sequence_number FOR UPDATE`,
    [agreement.id]
  );
  requireExact(lines.length === 2 && lines.every((row, index) =>
    Number(row.sequence_number) === index + 1 && cents(row.scheduled_amount) === cents(TARGET.amounts[index])),
    "this must be the original two-payment, GHS 425,000-per-period schedule.");
  requireExact(lines.every((row) => cents(row.amount_paid) === 0 &&
    cents(row.late_charge_amount) === 0 && cents(row.waived_charge_amount) === 0 &&
    ["upcoming","due","overdue"].includes(String(row.schedule_status))),
    "an instalment is partly paid, has charges or has been closed; manual review required.");
  const [allocated] = await connection.query(
    `SELECT COUNT(*) AS allocation_count
       FROM equipment_sale_payment_allocations x
       INNER JOIN equipment_installment_schedule s ON s.id = x.schedule_id
      WHERE s.agreement_id = ?`,
    [agreement.id]
  );
  requireExact(Number(allocated[0]?.allocation_count || 0) === 0,
    "a payment was already allocated to an instalment.");

  const current = lines.map((row) => iso(row.due_date_text));
  const alreadyCorrect = current.every((due, index) => due === TARGET.after[index]);
  const matchesSource = current.every((due, index) => due === TARGET.before[index]);
  requireExact(alreadyCorrect || matchesSource, "the live schedule differs from the supplied PDF or requested dates.");

  const [priorCopies] = await connection.query(
    `SELECT id, document_number FROM equipment_finance_issued_documents
      WHERE agreement_id = ? AND document_type = 'installment_agreement'
        AND JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, '$.document_revision.reference')) = ?
      LIMIT 2 FOR UPDATE`,
    [agreement.id, TARGET.revision_reference]
  );
  requireExact(priorCopies.length <= 1, "ambiguous prior corrected documents.");
  requireExact(!alreadyCorrect || priorCopies.length === 1,
    "dates were altered outside the approved one-customer repair; refusing to guess.");

  const planned = {
    agreement: TARGET.agreement,
    buyer: TARGET.customer,
    asset: TARGET.asset,
    previous_document: TARGET.original_document,
    previous_dates: current,
    corrected_dates: TARGET.after,
    amount_per_installment: TARGET.amounts,
    dry_run: !apply,
    already_corrected: alreadyCorrect,
    corrected_document_number: priorCopies[0]?.document_number || null,
  };
  if (!apply || alreadyCorrect) return planned;

  const before = await reconcileFinanceAgreement(agreement.id, { connection, lock: false });
  requireExact(before.consistent, "finance account currently fails reconciliation; nothing changed.");

  for (let index = 0; index < lines.length; index += 1) {
    await connection.query(
      "UPDATE equipment_installment_schedule SET due_date = ?, updated_at = NOW() WHERE id = ? AND agreement_id = ?",
      [TARGET.after[index], lines[index].id, agreement.id]
    );
  }
  await connection.query(
    `UPDATE equipment_sale_agreements
        SET first_due_date = ?, next_due_date = ?, final_due_date = ?, updated_at = NOW()
      WHERE id = ?`,
    [TARGET.after[0], TARGET.after[0], TARGET.after[1], agreement.id]
  );
  const updated = await refreshFinanceAgreementFromEvidence(connection, agreement.id);
  requireExact(updated.consistent, "reconciliation failed after date change; transaction will rollback.");
  requireExact(cents(updated.agreement.total_amount) === cents(TARGET.price) &&
    cents(updated.agreement.financed_amount) === cents(TARGET.financed) &&
    cents(updated.calculated.amount_paid) === cents(before.calculated.amount_paid),
    "unexpected financial value changed during reschedule.");
  requireExact(iso(updated.calculated.first_schedule_due_date) === TARGET.after[0] &&
    iso(updated.calculated.final_schedule_due_date) === TARGET.after[1],
    "corrected schedule dates did not reconcile.");

  await writeAuditEvent({
    connection,
    action: "FINANCE_YAKUBU_ONLY_SCHEDULE_DATE_CORRECTION",
    entityType: "equipment_sale_agreement",
    entityId: agreement.id,
    details: "Corrected Yakubu Zakari's two payment dates only; prior issued contract preserved.",
    metadata: { revision_reference: TARGET.revision_reference,
      buyer: TARGET.customer, agreement_number: TARGET.agreement,
      original_document_number: TARGET.original_document,
      before_dates: TARGET.before, after_dates: TARGET.after,
      paid_before: before.calculated.amount_paid, paid_after: updated.calculated.amount_paid },
  });

  const revision = await issueDocument({
    agreementId: agreement.id,
    documentType: "installment_agreement",
    format: "pdf",
    userId: null,
    connection,
    documentRevision: {
      reference: TARGET.revision_reference,
      original_document_number: TARGET.original_document,
    },
  });
  return {
    ...planned,
    dry_run: false,
    corrected_document_number: revision.document_number,
    corrected_document_id: revision.id,
    historical_document_preserved: true,
    fresh_customer_signature_required: true,
    schedule_payment_amounts_unchanged: true,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  requireExact(!apply || process.argv.includes("--exact-agreement=ESA-20261001141345-5331"),
    "the exact agreement confirmation argument is mandatory.");
  const connection = await pool.getConnection();
  let locked = false;
  let inTransaction = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 20) AS acquired",
      ["chalin03:yakubu:only-dates:20261020"]);
    locked = Number(lock?.acquired) === 1;
    requireExact(locked, "could not acquire the one-customer repair lock.");
    await connection.beginTransaction();
    inTransaction = true;
    const output = await applyYakubuDates({ connection, apply });
    if (apply) {
      await connection.commit();
      inTransaction = false;
    } else {
      await connection.rollback();
      inTransaction = false;
    }
    console.log(JSON.stringify({ ok: true, ...output }, null, 2));
  } finally {
    if (inTransaction) await connection.rollback();
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", ["chalin03:yakubu:only-dates:20261020"]);
    connection.release();
  }
}
if (require.main === module) main().catch((error) => {
  console.error("YAKUBU_ONLY_REPAIR_BLOCKED:", error.message);
  process.exitCode = 1;
});
module.exports = { applyYakubuDates, TARGET };
