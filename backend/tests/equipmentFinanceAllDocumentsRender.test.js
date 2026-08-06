const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DOCUMENT_DEFINITIONS,
} = require("../services/equipmentFinanceDocumentCompletionService");
const {
  renderCompletionPdf,
  renderCompletionWord,
} = require("../services/equipmentFinanceCompletionRendererService");

function snapshot() {
  return {
    generated_at: "2026-08-06T10:30:00.000Z",
    template_version: "v1-approved",
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
      credit_application_id: 501,
      customer_id: 401,
      agreement_number: "ESA-QA-001",
      kyc_customer_name: "Ama Quality Customer",
      kyc_customer_phone: "0240000021",
      customer_address_snapshot: "Dunkwa-on-Offin",
      residential_address: "Dunkwa-on-Offin",
      id_type: "Ghana Card",
      id_number: "GHA-123456789-0",
      asset_code: "EXC-301",
      asset_name: "LiuGong 922E",
      make: "LiuGong",
      model: "922E",
      serial_number: "LG922E-QA",
      chassis_number: "LG922E-CHASSIS",
      engine_number: "LG-ENGINE-001",
      registration_number: "GN-1000-26",
      total_amount: 2500000,
      deposit_required: 1000000,
      deposit_received: 1000000,
      financed_amount: 1500000,
      amount_paid: 1150000,
      outstanding_balance: 0,
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
        payment_number: "ESP-QA-001",
        receipt_number: "ESR-QA-001",
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
        payment_number: "ESP-QA-001",
        receipt_number: "ESR-QA-001",
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
        rows: [
          {
            sequence_number: 2,
            due_date: "2026-07-07",
            scheduled_amount: 150000,
            amount_paid: 0,
            balance: 150000,
            schedule_status: "overdue",
          },
        ],
      },
      delivery: {
        receiving_person: "Ama Quality Customer",
        destination: "Dunkwa-on-Offin",
        condition_status: "good",
        meter_reading: 220,
        fuel_level_percent: 60,
        delivered_at: "2026-08-01T09:00:00.000Z",
      },
      ownership_transfer: {
        transfer_number: "EOT-QA-001",
        transferred_at: "2026-08-06T10:00:00.000Z",
      },
      amendment: {
        amendment_number: "EAM-QA-001",
        amendment_status: "approved",
        amendment_type: "schedule_change",
        effective_date: "2026-08-01",
        requested_by_name: "Finance Manager",
        approved_by_name: "System Administrator",
        reason: "Customer requested an approved schedule adjustment.",
        proposed_changes: { payment_frequency: "monthly" },
      },
    },
  };
}

function document(type) {
  return {
    id: 901,
    document_number: `QA-${type.toUpperCase()}`,
    document_type: type,
    document_format: "pdf",
    snapshot_checksum: "a".repeat(64),
    snapshot: snapshot(),
    issued_at: "2026-08-06T10:30:00.000Z",
  };
}

test("all fourteen professional Finance PDF documents render without errors", async () => {
  const types = Object.keys(DOCUMENT_DEFINITIONS);
  assert.equal(types.length, 14);
  for (const type of types) {
    const pdf = await renderCompletionPdf(document(type), {
      layout: type === "payment_receipt" ? "a4" : "a4",
    });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF", `${type} is not a PDF`);
    assert.ok(pdf.length > 850, `${type} PDF is unexpectedly small`);
  }
});

test("every Word-supported Finance document renders editable branded output", () => {
  for (const [type, definition] of Object.entries(DOCUMENT_DEFINITIONS)) {
    if (!definition.formats.includes("word")) continue;
    const output = renderCompletionWord(document(type)).toString("utf8");
    assert.match(output, /CHALIN 03 COMPANY LIMITED/, type);
    assert.match(output, new RegExp(document(type).document_number), type);
    assert.match(output, /<html|<!DOCTYPE/i, type);
  }
});

test("thermal payment receipt remains a valid compact PDF", async () => {
  const pdf = await renderCompletionPdf(document("payment_receipt"), {
    layout: "thermal",
  });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 700);
});
