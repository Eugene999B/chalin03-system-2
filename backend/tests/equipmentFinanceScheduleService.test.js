const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFinanceSchedule,
  normalizeScheduleInput,
} = require("../services/equipmentFinanceScheduleService");

const approvedTerms = {
  selling_price: 100000,
  deposit: 1,
  payment_frequency: "monthly",
  installment_count: 12,
  non_working_day_rule: "exact",
};

test("accepts a MySQL DATE returned as a JavaScript Date during agreement activation", () => {
  const schedule = buildFinanceSchedule({
    ...approvedTerms,
    first_due_date: new Date("2026-09-04T00:00:00.000Z"),
  });

  assert.equal(schedule.first_due_date, "2026-09-04");
  assert.equal(schedule.final_due_date, "2027-08-04");
  assert.equal(schedule.financed_amount, 99999);
  assert.equal(schedule.periodic_amount, 8333.25);
  assert.equal(schedule.schedule.length, 12);
});

test("accepts ISO and MySQL datetime strings while preserving the calendar date", () => {
  for (const firstDueDate of [
    "2026-09-04T00:00:00.000Z",
    "2026-09-04 00:00:00",
  ]) {
    const normalized = normalizeScheduleInput({
      ...approvedTerms,
      first_due_date: firstDueDate,
    });
    assert.equal(normalized.first_due_date, "2026-09-04");
  }
});

test("rejects impossible calendar dates with a field-specific message", () => {
  assert.throws(
    () =>
      normalizeScheduleInput({
        ...approvedTerms,
        first_due_date: "2026-02-30",
      }),
    /first due date/
  );
});
