const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DOCUMENT_TEMPLATES,
  findOfficialLogoPath,
  templateFor,
  verificationPayload,
} = require("../services/equipmentFinanceDocumentDesignV2Service");
const {
  renderCompletionPdf,
  renderCompletionWord,
} = require("../services/equipmentFinanceDocumentRendererV2Service");

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
    id: 301,
    document_number: "C03-DOC-V3-001",
    document_type: type,
    snapshot_checksum: "a".repeat(64),
    issued_at: "2026-08-06T18:30:00.000Z",
    snapshot: {
      generated_at: "2026-08-06T18:30:00.000Z",
      template_version: "FIN-TERMS-V3",
      company: {
        name: "CHALIN 03 COMPANY LIMITED",
        phone: "0249469080",
        email: "agyapongcharles3@gmail.com",
        postal_address: "P. O. Box 187, Dunkwa-On-Offin",
      },
      policy: {
        agreement_terms:
          "Ownership remains with Chalin 03 Company Limited until full settlement.",
      },
      agreement: {
        agreement_number: "ESA-20260806-001",
        customer_name_snapshot: "Appiah Amankwah Eugene",
        asset_code: "EXG-001",
        asset_name: "BULLDOZER",
        total_amount: 100000,
        deposit_required: 1,
        financed_amount: 99999,
        amount_paid: 0,
        outstanding_balance: 100000,
        payment_frequency: "monthly",
        installment_count: 12,
        first_due_date: "2026-09-04",
        final_due_date: "2027-08-04",
        kyc_status: "complete",
        affordability_status: "manual_review",
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

test("every Finance document has an explicit logo-led V3 identity", () => {
  assert.deepEqual(Object.keys(DOCUMENT_TEMPLATES), requiredTypes);
  const watermarks = [];
  const motifs = [];
  for (const type of requiredTypes) {
    const template = templateFor(documentFixture(type));
    assert.ok(template.family);
    assert.ok(template.title);
    assert.ok(template.subtitle);
    assert.ok(template.classification);
    assert.ok(template.watermark);
    assert.ok(template.accent);
    assert.ok(template.motif);
    assert.equal(template.design_version, "logo-led-v3");
    watermarks.push(template.watermark);
    motifs.push(template.motif);
  }
  assert.equal(new Set(watermarks).size, requiredTypes.length);
  assert.ok(new Set(motifs).size >= 9);
});

test("agreement copies and operational documents remain unmistakably different", () => {
  assert.equal(DOCUMENT_TEMPLATES.installment_agreement.classification, "ORIGINAL");
  assert.equal(DOCUMENT_TEMPLATES.customer_agreement_copy.classification, "CUSTOMER COPY");
  assert.equal(DOCUMENT_TEMPLATES.company_agreement_copy.classification, "COMPANY COPY");
  assert.equal(DOCUMENT_TEMPLATES.payment_receipt.motif, "receipt");
  assert.equal(DOCUMENT_TEMPLATES.boss_approval_pack.motif, "executive");
  assert.equal(DOCUMENT_TEMPLATES.machine_annexure.motif, "evidence");
  assert.equal(DOCUMENT_TEMPLATES.settlement_confirmation.motif, "certificate");
});

test("V3 verification QR opens the Chalin 03 online verification centre and binds the issuance fingerprint", () => {
  const payload = verificationPayload(documentFixture("payment_receipt"));
  assert.match(
    payload,
    /^https:\/\/chalin03\.com\/api\/finance-verification\/301\/[a-f0-9]{64}$/
  );
  assert.doesNotMatch(payload, /CHALIN03-FINANCE-LOGO-LED-V3/);
  assert.doesNotMatch(payload, /SHA256:/);
});

test("the exact official public logo is copied into backend document assets", () => {
  const logoPath = findOfficialLogoPath();
  assert.ok(logoPath, "Expected the official Chalin 03 logo to be available");
  assert.match(
    logoPath.replaceAll("\\", "/"),
    /(?:backend\/assets|frontend\/public)\/chalin03-logo\.png$/
  );
  assert.ok(fs.statSync(logoPath).size > 1000);
});

test("V3 schedule is a single protected PDF page without a trailing blank page", async () => {
  const buffer = await renderCompletionPdf(documentFixture("payment_schedule"));
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.ok(buffer.length > 3500);
  assert.equal(pageCount(buffer), 1);
});

test("V3 Word output contains the official logo, integrated watermark and QR", async () => {
  const html = (
    await renderCompletionWord(documentFixture("payment_schedule"))
  ).toString("utf8");
  assert.match(html, /OFFICIAL INSTALLMENT SCHEDULE/);
  assert.match(html, /PAYMENT SCHEDULE/);
  assert.match(html, /watermark-logo/);
  assert.match(html, /watermark-text/);
  assert.match(html, /alt="Official Chalin 03 logo"/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /SECURE • VERIFIED • SYSTEM-GENERATED/);
  assert.match(html, /C03-DOC-V3-001/);
});

test("V3 source uses the logo as architecture with a subtle background watermark", () => {
  const design = fs.readFileSync(
    path.join(__dirname, "..", "services", "equipmentFinanceDocumentDesignV2Service.js"),
    "utf8"
  );
  const pages = fs.readFileSync(
    path.join(__dirname, "..", "services", "equipmentFinancePdfV2PageService.js"),
    "utf8"
  );
  const flow = fs.readFileSync(
    path.join(__dirname, "..", "services", "equipmentFinancePdfV2FlowWidgetService.js"),
    "utf8"
  );
  const accountBodies = fs.readFileSync(
    path.join(__dirname, "..", "services", "equipmentFinancePdfV2AccountBodies.js"),
    "utf8"
  );
  const renderer = fs.readFileSync(
    path.join(__dirname, "..", "services", "equipmentFinanceDocumentRendererV2Service.js"),
    "utf8"
  );
  assert.match(design, /path\.resolve\(__dirname, "\.\.", "assets", "chalin03-logo\.png"\)/);
  assert.match(pages, /drawBrandWave/);
  assert.match(pages, /drawGuilloche/);
  assert.match(pages, /fillOpacity\(0\.048\)/);
  assert.doesNotMatch(pages, /drawVisibleOverlayWatermark/);
  assert.match(pages, /drawOfficialLogo/);
  assert.match(flow, /drawSecuritySeal/);
  assert.match(accountBodies, /AGREEMENT AT A GLANCE/);
  assert.match(accountBodies, /AMOUNT PAID/);
  assert.match(renderer, /autoFirstPage: false/);
  assert.match(renderer, /logo-led-v3/);
  assert.match(renderer, /drawIdentityAnnex/);
  assert.match(renderer, /drawVerificationPanel/);
  assert.match(renderer, /drawFooters/);
});
