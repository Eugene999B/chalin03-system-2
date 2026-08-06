const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FINANCE_FOOTER_PREFIX,
  isFinanceFooterText,
} = require("../services/equipmentFinancePdfBlankPageGuardService");
const {
  renderCompletionPdf,
} = require("../services/equipmentFinanceCompletionRendererService");

function pageCount(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
}

function documentFixture(type = "payment_schedule") {
  return {
    id: 901,
    document_number: "EFS-BLANK-PAGE-001",
    document_type: type,
    document_format: "pdf",
    snapshot_checksum: "a".repeat(64),
    issued_at: "2026-08-06T17:50:00.000Z",
    snapshot: {
      generated_at: "2026-08-06T17:50:00.000Z",
      template_version: "FIN-TERMS-1",
      company: {
        name: "CHALIN 03 COMPANY LIMITED",
        phone: "0249469080",
        email: "agyapongcharles3@gmail.com",
        postal_address: "P. O. Box 187, Dunkwa-On-Offin",
      },
      policy: {
        agreement_terms: "Approved test terms.",
        legal_review_status: "approved",
      },
      agreement: {
        agreement_number: "ESA-BLANK-PAGE-001",
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

test("the guard recognises only Chalin 03 Finance page footers", () => {
  assert.equal(isFinanceFooterText(`${FINANCE_FOOTER_PREFIX} EFS-001 | Page 1 of 1`), true);
  assert.equal(isFinanceFooterText("Ordinary agreement body text"), false);
});

test("a one-page generated Finance schedule has no trailing blank PDF page", async () => {
  const buffer = await renderCompletionPdf(documentFixture());
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  assert.equal(pageCount(buffer), 1);
});

test("the completion route installs the guard before loading the premium renderer", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "equipmentFinanceDocumentCompletionRoutes.js"),
    "utf8"
  );
  const guardIndex = source.indexOf("equipmentFinancePdfBlankPageGuardService");
  const rendererIndex = source.indexOf("equipmentFinancePremiumDocumentRendererService");
  assert.ok(guardIndex >= 0);
  assert.ok(rendererIndex > guardIndex);
});
