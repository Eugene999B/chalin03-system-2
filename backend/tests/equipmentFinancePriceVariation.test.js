const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { planUnpaidScheduleVariation } = require("../services/equipmentFinancePriceVariationService");

const original = [
  { id: 1, sequence_number: 1, scheduled_amount: 3000, amount_paid: 3000, schedule_status: "paid" },
  { id: 2, sequence_number: 2, scheduled_amount: 3000, amount_paid: 1000, schedule_status: "partial" },
  { id: 3, sequence_number: 3, scheduled_amount: 3000, amount_paid: 0, schedule_status: "upcoming" },
];

test("a price increase goes only to an unpaid instalment, preserving all received money", () => {
  const before = structuredClone(original);
  const plan = planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 14000, depositRequired: 3000,
    paymentsReceived: 7000, schedule: original,
  });
  assert.equal(plan.new_financed, 11000);
  assert.deepEqual(plan.schedule_updates, [
    { id: 3, sequence_number: 3, before: 3000, after: 5000, paid: 0 },
  ]);
  assert.deepEqual(original, before);
});

test("price reductions preserve settled payments and reduce unpaid principal", () => {
  const plan = planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 8500, depositRequired: 3000,
    paymentsReceived: 7000, schedule: original,
  });
  assert.equal(plan.new_financed, 5500);
  assert.deepEqual(plan.schedule_updates, [
    { id: 3, sequence_number: 3, before: 3000, after: 0.01, paid: 0 },
    { id: 2, sequence_number: 2, before: 3000, after: 2499.99, paid: 1000 },
  ]);
  assert.equal(original[0].scheduled_amount, 3000);
});

test("reject reduction below receipts, deposit or remaining positive schedule principal", () => {
  for (const price of [6999, 3000, 0, -1]) {
    assert.throws(() => planUnpaidScheduleVariation({
      oldPrice: 12000, newPrice: price, depositRequired: 3000,
      paymentsReceived: 7000, schedule: original,
    }));
  }
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 7000, depositRequired: 3000,
    paymentsReceived: 7000, schedule: original,
  }), /reduction exceeds unpaid schedule principal/);
});

test("no adjustment is permitted without open schedule lines or with inconsistent evidence", () => {
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 13000, depositRequired: 3000,
    paymentsReceived: 3000, schedule: original.map(row => ({ ...row, schedule_status: "paid" })),
  }), /no unpaid instalments/);
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 13000, depositRequired: 3000,
    paymentsReceived: 3000, schedule: original.map((row, i) => i ? row : ({...row, scheduled_amount: 100})),
  }), /schedule does not match/);
});

test("approved variation requires independent approval and verified signed acceptance", () => {
  const file = fs.readFileSync(path.join(__dirname,"../services/equipmentFinancePriceVariationService.js"),"utf8");
  const polished = fs.readFileSync(path.join(__dirname,"../services/equipmentFinanceOperationalPolishService.js"),"utf8");
  assert.match(file, /customer_signed_price_variation/);
  assert.match(file, /document_status = 'verified'/);
  assert.match(file, /Number\(amendment.approved_by\) === Number\(amendment.requested_by\)/);
  assert.match(polished, /person who requested a purchase-price correction cannot approve it/);
  assert.match(polished, /applyApprovedPriceVariation/);
  assert.match(file, /refreshFinanceAgreementFromEvidence/);
  assert.doesNotMatch(file, /DELETE FROM equipment_sale_payments|UPDATE equipment_sale_payments|DELETE FROM equipment_finance_issued_documents/);
});
