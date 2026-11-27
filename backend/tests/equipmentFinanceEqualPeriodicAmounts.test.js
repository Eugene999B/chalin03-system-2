const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildFinanceSchedule } = require("../services/equipmentFinanceScheduleService");
const { planUnpaidScheduleVariation } = require("../services/equipmentFinancePriceVariationService");

const rows = (amounts) => amounts.map((scheduled_amount, index) => ({
  id: index + 1,
  sequence_number: index + 1,
  scheduled_amount,
  amount_paid: 0,
  schedule_status: "upcoming",
}));

test("GHS 120 split into eight initial instalments is exactly GHS 15 in every period", () => {
  const result = buildFinanceSchedule({
    selling_price: 120,
    deposit: 0,
    installment_count: 8,
    payment_frequency: "monthly",
    first_due_date: "2026-11-01",
  });
  assert.equal(result.periodic_amount, 15);
  assert.deepEqual(result.schedule.map(period => period.scheduled_amount), Array(8).fill(15));
});

test("editing 8 x GHS 15 from GHS 120 to GHS 160 yields eight identical GHS 20 instalments", () => {
  const plan = planUnpaidScheduleVariation({
    oldPrice: 120,
    newPrice: 160,
    depositRequired: 0,
    paymentsReceived: 0,
    schedule: rows(Array(8).fill(15)),
  });
  assert.equal(plan.unpaid_period_count, 8);
  assert.equal(plan.typical_remaining_period_principal, 20);
  assert.deepEqual(plan.schedule_updates.map(period => period.after), Array(8).fill(20));
});

test("saving the same price rebalances eight existing unequal instalments to GHS 15 each", () => {
  const unequal = rows([10, 10, 10, 10, 10, 10, 10, 50]);
  const plan = planUnpaidScheduleVariation({
    oldPrice: 120,
    newPrice: 120,
    depositRequired: 0,
    paymentsReceived: 0,
    schedule: unequal,
    allowSamePriceRebalance: true,
  });
  assert.equal(plan.new_total, 120);
  assert.deepEqual(plan.schedule_updates.map(period => period.after), Array(8).fill(15));
  assert.equal(unequal[7].scheduled_amount, 50, "original schedule snapshots must not be mutated");
});

test("already equal eight-payment schedule is a no-op for same-price save", () => {
  const plan = planUnpaidScheduleVariation({
    oldPrice: 120,
    newPrice: 120,
    depositRequired: 0,
    paymentsReceived: 0,
    schedule: rows(Array(8).fill(15)),
    allowSamePriceRebalance: true,
  });
  assert.equal(plan.schedule_updates.length, 0);
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 120, newPrice: 120,
    depositRequired: 0, paymentsReceived: 0, schedule: rows(Array(8).fill(15)),
  }), /already the agreement price/);
});

test("partial receipts stay allocated while each remaining UNPAID amount is evenly divided", () => {
  const original = rows(Array(8).fill(15));
  original[0].schedule_status = "paid";
  original[0].amount_paid = 15;
  original[1].schedule_status = "partial";
  original[1].amount_paid = 5;
  const plan = planUnpaidScheduleVariation({
    oldPrice: 120, newPrice: 160, depositRequired: 0,
    paymentsReceived: 20, schedule: original,
  });
  assert.equal(plan.unpaid_period_count, 7);
  const projected = original.map(row => {
    const updated = plan.schedule_updates.find(line => line.id === row.id);
    return (updated?.after ?? row.scheduled_amount) - row.amount_paid;
  });
  assert.equal(projected[0], 0);
  const unpaidCents = projected.slice(1).map(value => Math.round(value * 100));
  assert.ok(Math.max(...unpaidCents) - Math.min(...unpaidCents) <= 1);
  assert.equal(unpaidCents.reduce((a,b) => a+b,0), 14000);
  assert.equal(original[0].amount_paid, 15);
  assert.equal(original[1].amount_paid, 5);
});

test("new price scheduling divides net-of-deposit principal across periods", () => {
  const result = buildFinanceSchedule({
    selling_price: 120, deposit: 40,
    installment_count: 8,
    payment_frequency: "monthly",
    first_due_date: "2026-11-01",
  });
  assert.deepEqual(result.schedule.map(row => row.scheduled_amount), Array(8).fill(10));
});

test("machine save can rebalance same-price terms but does not rewrite receipts", () => {
  const service = fs.readFileSync(path.join(__dirname, "../services/equipmentFinancePriceVariationService.js"), "utf8");
  assert.match(service, /allowSamePriceRebalance: true/);
  assert.match(service, /if \(!plan\.schedule_updates\.length && cents\(agreement\.total_amount\) === cents\(newPrice\)\) return null/);
  assert.doesNotMatch(service, /UPDATE equipment_sale_payments|UPDATE equipment_sale_payment_allocations/);
});
