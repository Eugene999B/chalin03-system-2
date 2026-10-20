"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { documentBlocks, plainDocumentText, htmlDocumentTerms } = require("../services/equipmentFinanceDocumentTypographyService");
const { nameForRole, SELLER_REPRESENTATIVE_NAME } = require("../services/equipmentFinanceDocumentPartyNamesService");
const { renderCompletionWord, renderCompletionPdf } = require("../services/equipmentFinanceDocumentRendererV2Service");
const { DOCUMENT_TEMPLATES } = require("../services/equipmentFinanceDocumentDesignV2Service");

const root = path.join(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function fixture(type) {
  return {
    id: 72, document_number: "EFA-ORIGINAL-20261020", document_type: type,
    issued_at: "2026-10-20T08:24:04Z", snapshot_checksum: "a".repeat(64),
    snapshot: {
      generated_at: "2026-10-20T08:24:04Z",
      company: { name: "CHALIN 03 COMPANY LIMITED", phone: "0249469080" },
      policy: { agreement_terms: "### 1. **PURCHASE AND OWNERSHIP**\n\nThe buyer accepts **GHS 120**.\n\n### 2. **PAYMENT DATES**\n\nThe two due dates are 15 October and 29 October." },
      agreement: { agreement_number: "ESA-20261020-ORIGINAL",
        customer_name_snapshot: "Yakubu Zakari", asset_name: "Excavator",
        asset_code: "EXC-018", total_amount: 120, deposit_required: 0,
        deposit_received: 0, financed_amount: 120, outstanding_balance: 120,
        amount_paid: 0, first_due_date: "2026-10-15", final_due_date: "2026-10-29" },
      schedule: [
        { id: 1, sequence_number: 1, due_date: "2026-10-15", scheduled_amount: 60, amount_paid: 0, schedule_status: "overdue" },
        { id: 2, sequence_number: 2, due_date: "2026-10-29", scheduled_amount: 60, amount_paid: 0, schedule_status: "upcoming" },
      ],
      payments: [], media: [], signatures: [],
      reconciliation: { consistent: true, mismatches: [] },
      document_context: {},
    },
  };
}
test("original legal markdown displays professional headings and no raw authoring markers", () => {
  const terms = fixture("installment_agreement").snapshot.policy.agreement_terms;
  assert.deepEqual(documentBlocks(terms).map((block) => block.kind), ["heading","body","heading","body"]);
  assert.equal(plainDocumentText("### **PAYMENT DATES**"), "PAYMENT DATES");
  const html = htmlDocumentTerms(terms);
  assert.match(html, /<h4 class="finance-legal-heading">1\. PURCHASE AND OWNERSHIP<\/h4>/);
  assert.match(html, /<p class="finance-legal-paragraph">The buyer accepts GHS 120\.<\/p>/);
  assert.doesNotMatch(html, /\*\*|###/);
});

test("AGYAPONG CHARLES is uppercase on all printable Finance signing cards", () => {
  assert.equal(SELLER_REPRESENTATIVE_NAME, "AGYAPONG CHARLES");
  assert.equal(nameForRole(fixture("installment_agreement").snapshot,"seller"), "AGYAPONG CHARLES");
});

test("every original Finance document type uses a shared template for new downloads", () => {
  assert.equal(Object.keys(DOCUMENT_TEMPLATES).length, 14);
  const legacyDownload = source("routes/equipmentFinanceProfessionalRoutes.js");
  assert.match(legacyDownload, /renderOriginalFinancePdfWithCurrentDesign\(document\)/);
  assert.match(legacyDownload, /renderOriginalFinanceWordWithCurrentDesign\(document\)/);
  assert.match(legacyDownload, /getIssuedDocument\(req\.params\.documentId\)/);
  const integrityCheck = source("services/equipmentFinanceProfessionalService.js");
  assert.match(integrityCheck, /checksum !== row\.snapshot_checksum/);
  assert.doesNotMatch(legacyDownload, /UPDATE equipment_finance_issued_documents|DELETE FROM equipment_finance_issued_documents/);
});

test("all 14 original Word documents render using current logo-led design and historical verification identity", async () => {
  for (const type of Object.keys(DOCUMENT_TEMPLATES)) {
    const doc = fixture(type);
    const bytes = await renderCompletionWord(doc);
    const html = bytes.toString("utf8");
    assert.match(html,/EFA-ORIGINAL-20261020/);
    assert.match(html,/EQUIPMENT FINANCE/);
    assert.match(html,/a{28}/);
    if (["installment_agreement","customer_agreement_copy","company_agreement_copy"].includes(type)) {
      assert.match(html,/AGYAPONG CHARLES/);
      assert.match(html,/PURCHASE AND OWNERSHIP/);
      assert.doesNotMatch(html,/###|\*\*PURCHASE/);
    }
  }
});

test("the same original signed PDF snapshot can be professionally re-rendered without mutating its data", async () => {
  const doc = fixture("installment_agreement");
  const jsonBefore = JSON.stringify(doc);
  const bytes = await renderCompletionPdf(doc);
  assert.equal(bytes.subarray(0,4).toString(), "%PDF");
  assert.ok(bytes.length > 3500);
  assert.equal(JSON.stringify(doc), jsonBefore);
});

test("Finance accounts never show [object Object] as dates and use oldest actually unpaid period", async () => {
  const util = fs.readFileSync(path.join(root, "../frontend/src/utils/financeDisplayDate.js"), "utf8");
  const { financeDateLabel, financeDateOnly, earliestUnpaidFinancePeriod } =
    await import("data:text/javascript," + encodeURIComponent(util));
  assert.equal(financeDateOnly({ due_date: "2026-10-15" }), "2026-10-15");
  assert.equal(financeDateOnly({ broken: true }), null);
  assert.equal(financeDateLabel({ broken: true }), "Not scheduled");
  assert.equal(financeDateOnly(new Date("2026-10-29T00:00:00Z")), "2026-10-29");
  const first = earliestUnpaidFinancePeriod([
    { due_date: "2026-10-01", schedule_status: "paid", scheduled_amount: 100, amount_paid: 100 },
    { due_date: { date: "2026-10-29" }, schedule_status: "upcoming", scheduled_amount: 100, amount_paid: 0 },
    { due_date: { date: "2026-10-15" }, schedule_status: "partial", scheduled_amount: 100, amount_paid: 40 },
  ]);
  assert.equal(financeDateOnly(first.due_date), "2026-10-15");
});
