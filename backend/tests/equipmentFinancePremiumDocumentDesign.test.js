const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

require("../services/equipmentFinancePdfBlankPageGuardService");
const {
  TEMPLATES,
  renderCompletionPdf,
  renderCompletionWord,
  templateFor,
  verificationPayload,
} = require("../services/equipmentFinancePremiumDocumentRendererService");

const requiredTypes = [
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "boss_approval_pack",
  "payment_schedule",
  "payment_receipt",
  "customer_statement",
  "machine_annexure",
  "guarantor_undertaking",
  "delivery_handover_note",
  "arrears_notice",
  "amendment_agreement",
  "settlement_confirmation",
  "ownership_transfer",
];

function documentFixture(type) {
  return {
    document_number: "C03-DOC-001",
    document_type: type,
    snapshot_checksum: "a".repeat(64),
    issued_at: "2026-08-06T18:30:00.000Z",
    snapshot: {
      generated_at: "2026-08-06T18:30:00.000Z",
      template_version: "FIN-TERMS-1",
      company: {
        name: "CHALIN 03 COMPANY LIMITED",
        phone: "0249469080",
        email: "agyapongcharles3@gmail.com",
        postal_address: "P. O. Box 187, Dunkwa-On-Offin",
      },
      policy: {
        agreement_terms: "Ownership remains with Chalin 03 Company Limited until full settlement.",
      },
      agreement: {
        agreement_number: "ESA-20260806-001",
        customer_name_snapshot: "Appiah Amankwah Eugene",
        asset_code: "EXG-001",
        asset_name: "BULLDOZER",
        total_amount: 100000,
        deposit_required: 1,
        amount_paid: 0,
        outstanding_balance: 100000,
        payment_frequency: "monthly",
        installment_count: 12,
        first_due_date: "2026-09-04",
        final_due_date: "2027-08-04",
      },
      schedule: [
        {
          sequence_number: 1,
          due_date: "2026-09-04",
          scheduled_amount: 8333.25,
          amount_paid: 0,
          balance: 8333.25,
          schedule_status: "scheduled",
        },
      ],
      payments: [],
      media: [],
      signatures: [],
      reconciliation: { consistent: true, mismatches: [] },
      document_context: { overdue: { amount: 0, count: 0, rows: [] } },
    },
  };
}

function pageCount(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
}

test("every professional Finance document has an explicit premium template", () => {
  assert.deepEqual(Object.keys(TEMPLATES), requiredTypes);
  for (const type of requiredTypes) {
    const template = templateFor(documentFixture(type));
    assert.ok(template.family);
    assert.ok(template.title);
    assert.ok(template.subtitle);
    assert.ok(template.badge);
    assert.ok(template.watermark);
  }
});

test("agreement copies and operational documents are visibly distinguishable", () => {
  assert.equal(TEMPLATES.installment_agreement.badge, "ORIGINAL");
  assert.equal(TEMPLATES.customer_agreement_copy.badge, "CUSTOMER COPY");
  assert.equal(TEMPLATES.company_agreement_copy.badge, "COMPANY COPY");
  assert.equal(TEMPLATES.payment_receipt.family, "receipt");
  assert.equal(TEMPLATES.boss_approval_pack.family, "executive");
  assert.equal(TEMPLATES.machine_annexure.family, "evidence");
  assert.equal(TEMPLATES.settlement_confirmation.family, "certificate");
  assert.notEqual(TEMPLATES.payment_receipt.watermark, TEMPLATES.payment_schedule.watermark);
});

test("all document watermarks are document-specific", () => {
  const watermarks = requiredTypes.map((type) => TEMPLATES[type].watermark);
  assert.equal(new Set(watermarks).size, watermarks.length);
});

test("verification identity binds document, type, agreement and checksum", () => {
  const payload = verificationPayload(documentFixture("payment_receipt"));
  assert.match(payload, /CHALIN03/);
  assert.match(payload, /DOC:C03-DOC-001/);
  assert.match(payload, /TYPE:payment_receipt/);
  assert.match(payload, /AGR:ESA-20260806-001/);
  assert.match(payload, /SHA256:a{64}/);
});

test("premium payment schedule renders as a single protected PDF page", async () => {
  const buffer = await renderCompletionPdf(documentFixture("payment_schedule"));
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 2500);
  assert.equal(pageCount(buffer), 1);
});

test("premium Word output contains watermark, QR verification and distinct title", async () => {
  const buffer = await renderCompletionWord(documentFixture("payment_schedule"));
  const html = buffer.toString("utf8");
  assert.match(html, /OFFICIAL INSTALLMENT SCHEDULE/);
  assert.match(html, /PAYMENT SCHEDULE/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /SYSTEM-GENERATED/);
  assert.match(html, /C03-DOC-001/);
});

test("premium renderer contains official mark, watermark, QR, certificate and distinct body families", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "services", "equipmentFinancePremiumDocumentRendererService.js"),
    "utf8"
  );
  for (const contract of [
    "drawOfficialLogo",
    "drawWatermark",
    "verificationQr",
    "SYSTEM-GENERATED • TAMPER-EVIDENT",
    "drawCertificateFrame",
    "renderExecutivePack",
    "renderReceipt",
    "renderSchedule",
    "renderStatement",
    "renderMachineAnnexure",
    "renderGuarantor",
    "renderDelivery",
    "renderArrears",
    "renderAmendment",
    "renderCertificate",
  ]) {
    assert.ok(source.includes(contract), `Missing premium document contract: ${contract}`);
  }
});
