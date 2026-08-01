const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FinanceScheduleError,
  buildFinanceSchedule,
  monthlyEquivalent,
} = require("../services/equipmentFinanceScheduleService");

test("weekly and custom intervals calculate every exact date", () => {
  const weekly = buildFinanceSchedule({
    selling_price: 1000,
    deposit: 200,
    payment_frequency: "weekly",
    installment_count: 4,
    first_due_date: "2026-08-07",
    non_working_day_rule: "exact",
  });
  assert.deepEqual(
    weekly.schedule.map((row) => row.due_date),
    ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"]
  );
  assert.equal(weekly.custom_interval_days, 7);

  const custom = buildFinanceSchedule({
    selling_price: 1000,
    deposit: 100,
    payment_frequency: "custom",
    custom_interval_days: 10,
    installment_count: 4,
    first_due_date: "2026-08-03",
  });
  assert.deepEqual(
    custom.schedule.map((row) => row.due_date),
    ["2026-08-03", "2026-08-13", "2026-08-23", "2026-09-02"]
  );
  assert.equal(custom.custom_interval_days, 10);
});

test("monthly schedules preserve the selected collection day and clamp short months", () => {
  const schedule = buildFinanceSchedule({
    selling_price: 1200,
    deposit: 0,
    payment_frequency: "monthly",
    installment_count: 4,
    first_due_date: "2026-01-31",
  });
  assert.deepEqual(
    schedule.schedule.map((row) => row.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
  );
});

test("weekend movement is deterministic and does not change the installment count", () => {
  const next = buildFinanceSchedule({
    selling_price: 200,
    deposit: 0,
    payment_frequency: "weekly",
    installment_count: 2,
    first_due_date: "2026-08-01",
    non_working_day_rule: "next_weekday",
  });
  assert.deepEqual(next.schedule.map((row) => row.due_date), ["2026-08-03", "2026-08-10"]);

  const previous = buildFinanceSchedule({
    selling_price: 200,
    deposit: 0,
    payment_frequency: "weekly",
    installment_count: 2,
    first_due_date: "2026-08-01",
    non_working_day_rule: "previous_weekday",
  });
  assert.deepEqual(previous.schedule.map((row) => row.due_date), ["2026-07-31", "2026-08-07"]);
});

test("schedule cents always add back to the exact financed amount", () => {
  const schedule = buildFinanceSchedule({
    selling_price: 1000,
    deposit: 123.45,
    payment_frequency: "custom",
    custom_interval_days: 21,
    installment_count: 7,
    first_due_date: "2026-08-05",
  });
  const total = schedule.schedule.reduce(
    (sum, row) => Number((sum + Number(row.scheduled_amount)).toFixed(2)),
    0
  );
  assert.equal(total, 876.55);
  assert.equal(total, schedule.financed_amount);
  assert.equal(schedule.schedule.length, 7);
  assert.equal(schedule.final_payment_amount, schedule.schedule.at(-1).scheduled_amount);
});

test("custom interval monthly affordability uses the real number of days", () => {
  assert.equal(monthlyEquivalent(100, "custom", 10), 304.37);
  assert.equal(monthlyEquivalent(100, "weekly", 7), 434.81);
  assert.equal(monthlyEquivalent(100, "fortnightly", 14), 217.41);
});

test("invalid custom terms fail before an application can be created", () => {
  assert.throws(
    () =>
      buildFinanceSchedule({
        selling_price: 1000,
        deposit: 0,
        payment_frequency: "custom",
        custom_interval_days: 0,
        installment_count: 12,
        first_due_date: "2026-08-01",
      }),
    FinanceScheduleError
  );
  assert.throws(
    () =>
      buildFinanceSchedule({
        selling_price: 500,
        deposit: 600,
        payment_frequency: "monthly",
        installment_count: 12,
        first_due_date: "2026-08-01",
      }),
    FinanceScheduleError
  );
});
