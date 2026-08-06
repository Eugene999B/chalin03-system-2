const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  renderCompletionPdf,
  renderCompletionWord,
} = require("../services/equipmentFinanceDocumentRendererV2Service");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function fixture() {
  return {
    document_number: "C03-WATERMARK-001",
    document_type: "payment_schedule",
    snapshot_checksum: "b".repeat(64),
    issued_at: "2026-08-06T21:30:00.000Z",
    snapshot: {
      generated_at: "2026-08-06T21:30:00.000Z",
      company: {
        name: "CHALIN 03 COMPANY LIMITED",
        phone: "0249469080",
        email: "agyapongcharles3@gmail.com",
      },
      agreement: {
        agreement_number: "ESA-WATERMARK-001",
        customer_name_snapshot: "Watermark Test Customer",
        asset_code: "EXG-001",
        asset_name: "BULLDOZER",
        total_amount: 100000,
        deposit_required: 10000,
        financed_amount: 90000,
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
          scheduled_amount: 8333.33,
          amount_paid: 0,
          balance: 8333.33,
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

test("PDF watermark is drawn below and above the document body for clear visibility", () => {
  const pages = source("services/equipmentFinancePdfV2PageService.js");
  assert.match(pages, /drawVisibleOverlayWatermark/);
  assert.match(pages, /fillOpacity\(0\.16\)/);
  assert.match(pages, /rotate\(-27/);
  assert.match(pages, /310, 310, 0\.085/);
  assert.match(pages, /drawVisibleOverlayWatermark\(doc, document\)/);
});

test("Word watermark is enlarged, rotated and placed above opaque content panels", async () => {
  const html = (await renderCompletionWord(fixture())).toString("utf8");
  assert.match(html, /watermark-logo[^}]*opacity:\.12/);
  assert.match(html, /watermark-text[^}]*transform:rotate\(-26deg\)/);
  assert.match(html, /watermark-text[^}]*opacity:\.16/);
  assert.match(html, /z-index:21/);
});

test("stronger watermark does not create a trailing blank PDF page", async () => {
  const pdf = await renderCompletionPdf(fixture());
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 3500);
  assert.equal(pageCount(pdf), 1);
});
