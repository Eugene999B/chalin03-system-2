const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DOCUMENT_DEFINITIONS,
} = require("../services/equipmentFinanceDocumentCompletionService");
const {
  renderCompletionPdf,
  renderCompletionWord,
} = require("../services/equipmentFinanceDocumentRendererV2Service");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function financeSnapshot() {
  return {
    generated_at: "2026-08-05T00:00:00.000Z",
    template_version: "v3-approved",
    company: {
      name: "CHALIN 03 COMPANY LIMITED",
      phone: "0249469080",
      email: "agyapongcharles3@gmail.com",
      postal_address: "P. O. Box 187, Dunkwa-on-Offin",
      authorised_seller_name: "Finance Manager",
    },
    policy: {
      legal_review_status: "approved",
      agreement_terms:
        "Ownership remains with Chalin 03 Company Limited until the reconciled account is fully settled.",
      notice_cure_days: 14,
    },
    agreement: {
      id: 601,
      agreement_number: "ESA-DOC-001",
      kyc_customer_name: "Ama Document Customer",
      kyc_customer_phone: "0240000021",
      residential_address: "Dunkwa-on-Offin",
      id_type: "Ghana Card",
      id_number: "GHA-123456789-0",
      asset_code: "EXC-301",
      asset_name: "LiuGong 922E",
      make: "LiuGong",
      model: "922E",
      serial_number: "LG922E-DOC",
      chassis_number: "LG922E-CHASSIS",
      total_amount: 2500000,
      deposit_required: 1000000,
      deposit_received: 1000000,
      financed_amount: 1500000,
      amount_paid: 150000,
      outstanding_balance: 2350000,
      payment_frequency: "fortnightly",
      installment_count: 10,
      first_due_date: "2026-06-23",
      final_due_date: "2026-10-31",
      guarantor_name: "Kojo Guarantor",
      guarantor_phone: "0241000000",
      guarantor_id_number: "GHA-999999999-9",
      guarantor_relationship: "Business partner",
      kyc_status: "verified",
      affordability_status: "eligible",
      risk_band: "medium",
    },
    schedule: [
      {
        id: 801,
        sequence_number: 1,
        due_date: "2026-06-23",
        scheduled_amount: 150000,
        amount_paid: 150000,
        balance: 0,
        schedule_status: "paid",
      },
      {
        id: 802,
        sequence_number: 2,
        due_date: "2026-07-07",
        scheduled_amount: 150000,
        amount_paid: 0,
        balance: 150000,
        schedule_status: "overdue",
      },
    ],
    payments: [
      {
        id: 701,
        payment_number: "ESP-DOC-001",
        receipt_number: "ESR-DOC-001",
        payment_date: "2026-06-23T10:30:00.000Z",
        amount: 150000,
        payment_method: "cash",
        reference_number: "CASH-001",
        received_by_name: "Finance Cashier",
      },
    ],
    media: [],
    signatures: [],
    reconciliation: { consistent: true, mismatches: [] },
    document_context: {
      payment: {
        id: 701,
        payment_number: "ESP-DOC-001",
        receipt_number: "ESR-DOC-001",
        payment_date: "2026-06-23T10:30:00.000Z",
        amount: 150000,
        payment_method: "cash",
        reference_number: "CASH-001",
        received_by_name: "Finance Cashier",
      },
      payment_allocations: [
        {
          schedule_id: 801,
          sequence_number: 1,
          due_date: "2026-06-23",
          allocated_amount: 150000,
        },
      ],
      overdue: {
        amount: 150000,
        count: 1,
        oldest_due_date: "2026-07-07",
        rows: [],
      },
      delivery: null,
      ownership_transfer: null,
      amendment: null,
    },
  };
}

function issuedDocument(type, number) {
  return {
    id: 901,
    document_number: number,
    document_type: type,
    document_format: "pdf",
    snapshot_checksum: "a".repeat(64),
    snapshot: financeSnapshot(),
    issued_at: "2026-08-05T00:00:00.000Z",
  };
}

test("completion pack exposes every required professional document", () => {
  assert.deepEqual(Object.keys(DOCUMENT_DEFINITIONS), [
    "installment_agreement",
    "customer_agreement_copy",
    "company_agreement_copy",
    "boss_approval_pack",
    "payment_schedule",
    "machine_annexure",
    "guarantor_undertaking",
    "payment_receipt",
    "customer_statement",
    "delivery_handover_note",
    "arrears_notice",
    "amendment_agreement",
    "settlement_confirmation",
    "ownership_transfer",
  ]);
  assert.deepEqual(DOCUMENT_DEFINITIONS.payment_receipt.formats, [
    "pdf",
    "thermal",
    "print",
  ]);
});

test("logo-led V3 renderer creates branded A4 and thermal PDFs", async () => {
  const schedulePdf = await renderCompletionPdf(
    issuedDocument("payment_schedule", "EFSC-DOC-001")
  );
  assert.equal(schedulePdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(schedulePdf.length > 3500);

  const thermalPdf = await renderCompletionPdf(
    issuedDocument("payment_receipt", "EFR-DOC-001"),
    { layout: "thermal" }
  );
  assert.equal(thermalPdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(thermalPdf.length > 1200);
});

test("logo-led V3 renderer creates editable Word-compatible output", async () => {
  const html = (
    await renderCompletionWord(
      issuedDocument("customer_statement", "EFST-DOC-001")
    )
  ).toString("utf8");
  assert.match(html, /CHALIN 03 COMPANY LIMITED/);
  assert.match(html, /CUSTOMER INSTALLMENT STATEMENT/);
  assert.match(html, /CUSTOMER STATEMENT/);
  assert.match(html, /EFST-DOC-001/);
  assert.match(html, /watermark-logo/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /SECURE • VERIFIED • SYSTEM-GENERATED/);
});

test("service preserves reconciliation, legal, payment and lifecycle controls", () => {
  const service = source("services/equipmentFinanceDocumentCompletionService.js");
  for (const contract of [
    "EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED",
    "EQUIPMENT_FINANCE_TERMS_APPROVAL_REQUIRED",
    "Choose the exact committed payment",
    "No approved or applied amendment",
    "Full settlement is required",
    "controlled ownership transfer",
    "equipment_sale_payment_allocations",
    "equipment_deliveries",
    "equipment_ownership_transfers",
    "equipment_finance_case_amendments",
    'createHash("sha256")',
    "equipment_finance_issued_documents",
  ]) {
    assert.ok(service.includes(contract), `Missing completion-document contract: ${contract}`);
  }
});

test("routes own authenticated options, issue and V3 format-specific downloads", () => {
  const routes = source("routes/equipmentFinanceDocumentCompletionRoutes.js");
  const independent = source("routes/equipmentFinanceIndependentRoutes.js");
  assert.match(routes, /const PREFIX = "\/professional\/completion-documents"/);
  assert.match(routes, /`\$\{PREFIX\}\/options`/);
  assert.match(routes, /`\$\{PREFIX\}\/issue`/);
  assert.match(routes, /`\$\{PREFIX\}\/:documentId\/download`/);
  assert.match(routes, /requirePermission\("fleet.assets.manage"\)/);
  assert.match(routes, /requirePermission\("fleet.assets.view"\)/);
  assert.match(routes, /application\/msword/);
  assert.match(routes, /application\/pdf/);
  assert.match(routes, /layout: thermal \? "thermal" : "a4"/);
  assert.match(routes, /X-Chalin03-Snapshot-Checksum/);
  assert.match(routes, /equipmentFinanceDocumentRendererV2Service/);
  assert.match(routes, /professional-logo-led-v3/);
  assert.match(routes, /official_logo_cached_in_backend/);
  assert.match(routes, /integrated_logo_and_document_watermark/);
  assert.ok(
    independent.indexOf("router.use(equipmentFinanceDocumentCompletionRoutes)") <
      independent.indexOf("router.use(equipmentFinanceProfessionalRoutes)")
  );
});
