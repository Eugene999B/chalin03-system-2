const test = require("node:test");
const assert = require("node:assert/strict");
const { documentScheduleStatus } = require("../services/equipmentFinanceDocumentScheduleStatus");

test("Unpaid past-due weekly installment displays overdue even if stored label is upcoming", () => {
  const row = { due_date: "2026-10-27", scheduled_amount: 325000, amount_paid: 0, late_charge_amount: 0, waived_charge_amount: 0, schedule_status: "upcoming" };
  assert.equal(documentScheduleStatus(row, "2026-10-29"), "overdue");
});

test("An installment that falls due today displays due", () => {
  assert.equal(documentScheduleStatus({ due_date: new Date("2026-10-29T00:00:00.000Z"), scheduled_amount: 50000, amount_paid: 0, schedule_status: "upcoming" }, "2026-10-29"), "due");
});

test("Paid and future installments keep their evidence-backed statuses", () => {
  assert.equal(documentScheduleStatus({ due_date: "2026-10-20", scheduled_amount: 50000, amount_paid: 50000, schedule_status: "paid" }, "2026-10-29"), "paid");
  assert.equal(documentScheduleStatus({ due_date: "2026-11-05", scheduled_amount: 50000, amount_paid: 0, schedule_status: "upcoming" }, "2026-10-29"), "upcoming");
  assert.equal(documentScheduleStatus({ due_date: "2026-10-20", scheduled_amount: 50000, amount_paid: 10000, schedule_status: "partial" }, "2026-10-29"), "partial");
});
