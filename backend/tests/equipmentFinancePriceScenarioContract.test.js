"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { priceScenario, summarizePriceScenario } = require("../services/equipmentFinancePriceScenarioService");

function source() {
  return {
    company: { name: "Chalin 03", authorised_seller_signature_data_url: "DATA-ORIGINAL" },
    agreement: {
      id: 91, agreement_number: "AG-91", total_amount: 400000,
      sale_price: 400000, subtotal: 400000,
      deposit_required: 100000, deposit_received: 100000,
      financed_amount: 300000, scheduled_total: 300000,
      amount_paid: 180000, outstanding_balance: 220000,
      asset_code: "EX-01", asset_name: "Excavator",
    },
    schedule: [
      { sequence_number: 1, due_date: "2026-11-01", scheduled_amount: 150000,
        amount_paid: 80000, balance: 70000, schedule_status: "part_paid" },
      { sequence_number: 2, due_date: "2026-12-01", scheduled_amount: 150000,
        amount_paid: 0, balance: 150000, schedule_status: "pending" },
    ],
    policy: { agreement_terms: "Original untouched terms" },
    payments: [{ id: 5, amount: 80000 }],
    signatures: [{ signer_role: "seller", signature_data_url: "DATA-ORIGINAL" }],
    media: [{ evidence_type: "main", file_url: "protected-machine" }],
  };
}

test("different excavator price recalculates finance and each due payment without changing source", () => {
  const original = source();
  const copy = priceScenario(original, 450000);
  assert.equal(copy.agreement.total_amount, 450000);
  assert.equal(copy.agreement.financed_amount, 350000);
  assert.equal(copy.agreement.outstanding_balance, 270000);
  assert.equal(copy.schedule[0].scheduled_amount, 175000);
  assert.equal(copy.schedule[1].scheduled_amount, 175000);
  assert.equal(copy.schedule[0].amount_paid, 80000);
  assert.equal(copy.schedule[0].due_date, "2026-11-01");
  assert.equal(copy.agreement.amount_paid, 180000);
  assert.equal(copy.policy.agreement_terms, "Original untouched terms");
  assert.equal(original.agreement.total_amount, 400000);
  assert.equal(original.schedule[0].scheduled_amount, 150000);
  assert.equal(original.signatures.length, 1);
  assert.deepEqual(original.payments, [{ id: 5, amount: 80000 }]);
  assert.deepEqual(copy.signatures, []);
  assert.equal(copy.company.authorised_seller_signature_data_url, null);
  assert.equal(copy.price_scenario.is_official_agreement, false);
});

test("alternate price keeps contractual deposit, receipts and due dates unchanged", () => {
  const copy = priceScenario(source(), 500000);
  assert.equal(copy.agreement.deposit_required, 100000);
  assert.equal(copy.agreement.deposit_received, 100000);
  assert.equal(copy.agreement.financed_amount, 400000);
  assert.equal(copy.schedule.reduce((s, r) => s + r.scheduled_amount, 0), 400000);
  assert.equal(copy.schedule[0].amount_paid, 80000);
  assert.equal(copy.schedule[1].due_date, "2026-12-01");
  assert.equal(summarizePriceScenario(copy).scenario_price, 500000);
});

test("scenario accepts same price and refuses invalid or impossible prices", () => {
  assert.equal(priceScenario(source(), 400000).schedule[0].scheduled_amount, 150000);
  assert.throws(() => priceScenario(source(), -1), /valid excavator price/);
  assert.throws(() => priceScenario(source(), 100000), /below payments already recorded/);
  assert.throws(() => priceScenario(source(), 90000), /original required deposit/);
  assert.throws(() => priceScenario({ ...source(), schedule: [] }, 500000), /no installment schedule/);
});

test("alternative PDF cannot overwrite issued agreement, signatures or payment records", () => {
  const root = path.resolve(__dirname, "..");
  const routes = fs.readFileSync(path.join(root, "routes/equipmentFinancePriceScenarioRoutes.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "services/equipmentFinanceProfessionalService.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "../frontend/src/App.jsx"), "utf8");
  assert.match(routes, /canApplySaleDiscount/);
  assert.match(routes, /loadAgreementSnapshot/);
  assert.match(routes, /renderAgreementPdf/);
  assert.match(routes, /res\.send\(pdf\)/);
  assert.doesNotMatch(routes, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|equipment_)/i);
  assert.match(renderer, /PRICING COPY ONLY - NOT AN ISSUED OR SIGNED AGREEMENT/);
  assert.match(renderer, /if \(snapshot\.price_scenario\)/);
  assert.match(app, /path="price-documents"/);
});
