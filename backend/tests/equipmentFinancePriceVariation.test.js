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
  assert.equal(plan.unpaid_period_count, 2);
  assert.equal(plan.remaining_principal_to_schedule, 7000);
  assert.equal(plan.typical_remaining_period_principal, 3500);
  assert.deepEqual(plan.schedule_updates, [
    { id: 2, sequence_number: 2, before: 3000, after: 4500, paid: 1000 },
    { id: 3, sequence_number: 3, before: 3000, after: 3500, paid: 0 },
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
    { id: 2, sequence_number: 2, before: 3000, after: 1750, paid: 1000 },
    { id: 3, sequence_number: 3, before: 3000, after: 750, paid: 0 },
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
    oldPrice: 12000, newPrice: 7000.01, depositRequired: 3000,
    paymentsReceived: 7000, schedule: original,
  }), /positive amount in every remaining period/);
});

test("no adjustment is permitted without open schedule lines or with inconsistent evidence", () => {
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 13000, depositRequired: 3000,
    paymentsReceived: 3000, schedule: original.map(row => ({ ...row, schedule_status: "paid" })),
  }), /no unpaid instalments/);
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 13000, depositRequired: 3000,
    paymentsReceived: 3000, schedule: original.map((row, i) => i ? row : ({...row, scheduled_amount: 100})),
  }), /Schedule evidence is inconsistent/);
});

test("rounding is shared in single-pesewa steps to keep remaining periods nearly identical", () => {
  const plan = planUnpaidScheduleVariation({
    oldPrice: 12000, newPrice: 12001.01, depositRequired: 3000,
    paymentsReceived: 7000, schedule: original,
  });
  assert.equal(plan.unpaid_period_count, 2);
  assert.deepEqual(plan.schedule_updates, [
    { id: 2, sequence_number: 2, before: 3000, after: 3500.51, paid: 1000 },
    { id: 3, sequence_number: 3, before: 3000, after: 2500.50, paid: 0 },
  ]);
  assert.equal(plan.schedule_updates[0].after + plan.schedule_updates[1].after + 3000, 9001.01);
});

test("remaining principal is spread across all three open periods without changing paid evidence", () => {
  const input = [
    { id: 1, sequence_number: 1, scheduled_amount: 3000, amount_paid: 3000, schedule_status: "paid" },
    { id: 2, sequence_number: 2, scheduled_amount: 3000, amount_paid: 1000, schedule_status: "partial" },
    { id: 3, sequence_number: 3, scheduled_amount: 3000, amount_paid: 0, schedule_status: "overdue" },
    { id: 4, sequence_number: 4, scheduled_amount: 3000, amount_paid: 0, schedule_status: "upcoming" },
  ];
  const plan = planUnpaidScheduleVariation({
    oldPrice: 16000, newPrice: 19000, depositRequired: 4000,
    paymentsReceived: 8000, schedule: input,
  });
  assert.equal(plan.unpaid_period_count, 3);
  assert.equal(plan.new_financed, 15000);
  assert.deepEqual(plan.schedule_updates.map(row => [row.id, row.after, row.paid]), [
    [2, 4666.67, 1000],
    [3, 3666.67, 0],
    [4, 3666.66, 0],
  ]);
  assert.equal(input[0].scheduled_amount, 3000);
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
