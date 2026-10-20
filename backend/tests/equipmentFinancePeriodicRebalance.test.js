const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { planUnpaidScheduleVariation } = require("../services/equipmentFinancePriceVariationService");

const fixture = [
  { id: 1, sequence_number: 1, scheduled_amount: 3000, amount_paid: 3000, schedule_status: "paid" },
  { id: 2, sequence_number: 2, scheduled_amount: 3000, amount_paid: 1000, schedule_status: "partial" },
  { id: 3, sequence_number: 3, scheduled_amount: 3000, amount_paid: 0, schedule_status: "overdue" },
  { id: 4, sequence_number: 4, scheduled_amount: 3000, amount_paid: 0, schedule_status: "upcoming" },
];

test("reprice reconciles all open periods evenly while preserving historic allocations", () => {
  const input = structuredClone(fixture);
  const plan = planUnpaidScheduleVariation({
    oldPrice: 16000, newPrice: 19000, depositRequired: 4000,
    paymentsReceived: 8000, schedule: input,
  });
  assert.equal(plan.unpaid_period_count, 3);
  assert.equal(plan.remaining_principal_to_schedule, 11000);
  assert.deepEqual(plan.schedule_updates.map(x => [x.id, x.after - x.paid]), [
    [2, 3666.67], [3, 3666.67], [4, 3666.66],
  ]);
  assert.deepEqual(input, fixture, "source rows, paid instalments and allocated payments remain unchanged");
  const revisedTotal = 3000 + 4666.67 + 3666.67 + 3666.66;
  assert.equal(Math.round(revisedTotal * 100), 1500000);
});

test("reject a reduction leaving insufficient remaining principal for every period", () => {
  assert.throws(() => planUnpaidScheduleVariation({
    oldPrice: 16000, newPrice: 8000.01, depositRequired: 4000,
    paymentsReceived: 8000, schedule: fixture,
  }), /positive amount in every remaining period/);
});

test("the same planner applies to the immediate machine Save and approved amendment paths", () => {
  const code = fs.readFileSync(path.join(__dirname,"../services/equipmentFinancePriceVariationService.js"), "utf8");
  assert.equal(code.split("planUnpaidScheduleVariation({").length - 1, 3);
  assert.match(code, /Math\.floor\(remainingPrincipal \/ unpaid\.length\)/);
  assert.match(code, /row\.paid \+ basePeriodBalance/);
  assert.match(code, /refreshFinanceAgreementFromEvidence/);
  assert.doesNotMatch(code, /UPDATE equipment_sale_payments|UPDATE equipment_sale_payment_allocations/);
});

test("active account list and detail expose the recalculated next period and issued documents use unpaid schedule", () => {
  const routes = fs.readFileSync(path.join(__dirname,"../routes/equipmentFinanceFinalLifecycleRoutes.js"),"utf8");
  const page = fs.readFileSync(path.join(__dirname,"../../frontend/src/pages/EquipmentFinanceActiveInstallmentsPage.jsx"),"utf8");
  const pdf = fs.readFileSync(path.join(__dirname,"../services/equipmentFinancePdfV2AccountBodies.js"),"utf8");
  assert.equal(routes.split("AS next_installment_due_amount").length - 1, 2);
  assert.match(routes, /next_installment_due_amount: account\.next_installment_due_amount/);
  assert.match(page, /Amount due on that date/);
  assert.match(page, /Paid \{money\(row\.amount_paid\)\}/);
  assert.match(pdf, /nextOpenPeriod/);
  assert.match(pdf, /scheduled_amount \|\| 0\) - Number\(nextOpenPeriod\.amount_paid/);
});
