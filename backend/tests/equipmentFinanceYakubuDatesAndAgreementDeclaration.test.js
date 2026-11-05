"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { TARGET } = require("../scripts/applyYakubuZakariExactPaymentDates20261020");
const { financeDepositEvidence, buyerDeclaration } = require("../services/equipmentFinanceDepositDeclarationService");
const { buildFinanceSchedule } = require("../services/equipmentFinanceScheduleService");

test("one-customer repair exactly matches uploaded Yakubu agreement and original verification checksum", () => {
  assert.equal(TARGET.agreement, "ESA-20261001141345-5331");
  assert.equal(TARGET.customer, "YAKUBU ZAKARI");
  assert.equal(TARGET.asset, "EXC-018");
  assert.equal(TARGET.original_document, "EFA-20261020082404-0410");
  assert.deepEqual(TARGET.before, ["2026-10-31", "2026-11-14"]);
  assert.deepEqual(TARGET.after, ["2026-10-15", "2026-10-29"]);
  assert.deepEqual(TARGET.amounts, [425000, 425000]);
  assert.equal(TARGET.price, 2050000);
  assert.equal(TARGET.deposit, 1200000);
  assert.equal(TARGET.financed, 850000);
  assert.equal(TARGET.original_checksum.length, 64);
});

test("15 October with two fortnightly instalments produces exactly 15 and 29 October", () => {
  const plan = buildFinanceSchedule({
    selling_price: "2050000", deposit: "1200000",
    payment_frequency: "fortnightly", installment_count: 2,
    first_due_date: "2026-10-15", non_working_day_rule: "exact",
  });
  assert.deepEqual(plan.schedule.map((row) => row.due_date), TARGET.after);
  assert.deepEqual(plan.schedule.map((row) => row.scheduled_amount), [425000, 425000]);
});

test("date repair is fail-closed, transaction-based and never bulk-updates other buyers", () => {
  const file = read("scripts/applyYakubuZakariExactPaymentDates20261020.js");
  assert.match(file, /WHERE a\.agreement_number = \? AND UPPER\(TRIM\(a\.customer_name_snapshot\)\) = \?/);
  assert.match(file, /asset\.asset_code = \?/);
  assert.match(file, /original_checksum/);
  assert.match(file, /lines\.length === 2/);
  assert.match(file, /allocation_count/);
  assert.match(file, /connection\.beginTransaction\(\)/);
  assert.match(file, /connection\.rollback\(\)/);
  assert.match(file, /writeAuditEvent\(/);
  assert.match(file, /refreshFinanceAgreementFromEvidence/);
  assert.match(file, /issueDocument\(/);
  assert.match(file, /if \(!apply \|\| alreadyCorrect\) return planned/);
  assert.doesNotMatch(file, /DELETE FROM|UPDATE equipment_sale_payments|UPDATE equipment_finance_issued_documents|DELETE equipment_finance_issued_documents/);
});

test("deposit date is derived only from real deposit-payment evidence", () => {
  const snapshot = { agreement: { deposit_received: 4 }, payments: [
    { payment_category: "installment", payment_date: "2026-10-09", amount: 15 },
    { payment_category: "opening_deposit", payment_date: "2026-10-15", amount: 4, receipt_number: "R-D-1" },
  ] };
  assert.deepEqual(financeDepositEvidence(snapshot), {
    amount: 4, first_paid_date: "2026-10-15", last_paid_date: "2026-10-15",
    payment_count: 1, references: ["R-D-1"],
  });
  assert.equal(financeDepositEvidence({ agreement: { deposit_received: 4 }, payments: [] }).first_paid_date, null);
});

test("buyer declaration names actual customer and contains terms and acceptance without forging signature", () => {
  const statement = buyerDeclaration({ agreement: { customer_name_snapshot: "YAKUBU ZAKARI" } });
  assert.match(statement, /^I, YAKUBU ZAKARI, declare that I have reviewed/);
  assert.match(statement, /initial deposit/);
  assert.match(statement, /payment dates/);
  assert.match(statement, /signature below/);
});

test("PDF and both Word paths preserve brand while showing deposit date and buyer declaration", () => {
  const pdf = read("services/equipmentFinancePdfV2FlowWidgetService.js");
  const cards = read("services/equipmentFinancePdfV2BasicWidgetService.js");
  const wordV2 = read("services/equipmentFinanceDocumentWordV2Service.js");
  const professional = read("services/equipmentFinanceProfessionalService.js");
  assert.match(pdf, /ensureSpace\(doc, document, 364\)/);
  assert.match(pdf, /BUYER'S DECLARATION/);
  assert.match(cards, /Paid on \$\{dateLabel\(depositEvidence\.first_paid_date\)\}/);
  assert.match(cards, /\["Initial deposit paid", money\(depositEvidence\.amount\)/);
  assert.match(wordV2, /Deposit paid on/);
  assert.match(wordV2, /BUYER'S DECLARATION/);
  assert.match(professional, /Initial deposit payment date/);
  assert.match(professional, /Buyer's Declaration/);
});

test("reissued correction gets a fresh snapshot/checksum and requires new buyer signature", () => {
  const source = read("services/equipmentFinanceProfessionalService.js");
  const header = read("services/equipmentFinancePdfV2PageService.js");
  assert.match(source, /customer_acceptance: "pending_new_signature"/);
  assert.match(source, /signature_data_url: null, signed_at: null/);
  assert.match(source, /snapshot\.company\.authorised_seller_signature_data_url = null/);
  assert.match(header, /CORRECTED COPY - FRESH SIGNATURES REQUIRED/);
  assert.match(source, /crypto\.createHash\("sha256"\)\.update\(snapshotText\)/);
});
