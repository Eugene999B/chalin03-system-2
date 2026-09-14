const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FinanceScheduleError,
  buildFinanceSchedule,
  monthlyEquivalent,
} = require("../services/equipmentFinanceScheduleService");
const {
  evaluateCreditApplication,
  termMonths,
} = require("../services/equipmentCreditApplicationPolicy");

function verifiedKyc() {
  return {
    customer_name_snapshot: "Ama Customer",
    customer_phone_snapshot: "0240000000",
    customer_address_snapshot: "Dunkwa-on-Offin",
    residential_address: "Dunkwa-on-Offin",
    id_type: "Ghana Card",
    id_number: "GHA-000000000-0",
    employment_type: "self_employed",
    occupation: "Mining contractor",
    customer_consent_confirmed: true,
    credit_assessment_consent_confirmed: true,
    identity_verified: true,
    address_verified: true,
    income_verified: true,
  };
}

test("weekly and custom schedules calculate every exact collection date", () => {
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

test("monthly schedules preserve the selected day and clamp short months", () => {
  const schedule = buildFinanceSchedule({
    selling_price: 1200,
    deposit: 100,
    payment_frequency: "monthly",
    installment_count: 4,
    first_due_date: "2026-01-31",
  });
  assert.deepEqual(
    schedule.schedule.map((row) => row.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
  );
});

test("weekend movement is deterministic and keeps the installment count", () => {
  const next = buildFinanceSchedule({
    selling_price: 200,
    deposit: 10,
    payment_frequency: "weekly",
    installment_count: 2,
    first_due_date: "2026-08-01",
    non_working_day_rule: "next_weekday",
  });
  assert.deepEqual(next.schedule.map((row) => row.due_date), [
    "2026-08-03",
    "2026-08-10",
  ]);

  const previous = buildFinanceSchedule({
    selling_price: 200,
    deposit: 10,
    payment_frequency: "weekly",
    installment_count: 2,
    first_due_date: "2026-08-01",
    non_working_day_rule: "previous_weekday",
  });
  assert.deepEqual(previous.schedule.map((row) => row.due_date), [
    "2026-07-31",
    "2026-08-07",
  ]);
});

test("schedule cents add back to the exact financed amount", () => {
  const schedule = buildFinanceSchedule({
    selling_price: 1000,
    deposit: 123.45,
    payment_frequency: "custom",
    custom_interval_days: 21,
    installment_count: 7,
    first_due_date: "2026-08-05",
  });
  const totalCents = schedule.schedule.reduce(
    (sum, row) => sum + Math.round(Number(row.scheduled_amount) * 100),
    0
  );
  assert.equal(totalCents, 87655);
  assert.equal(totalCents, Math.round(schedule.financed_amount * 100));
  assert.equal(schedule.schedule.length, 7);
});

test("affordability preserves established weekly conversions and supports custom days", () => {
  assert.equal(monthlyEquivalent(100, "weekly"), 433.33);
  assert.equal(monthlyEquivalent(100, "fortnightly"), 216.67);
  assert.equal(monthlyEquivalent(100, "custom", 10), 304.37);
  assert.equal(termMonths(12, "custom", 10), 3.9);

  const assessment = evaluateCreditApplication(
    {
      quoted_total: 10000,
      proposed_deposit: 1000,
      proposed_frequency: "custom",
      proposed_interval_days: 10,
      proposed_installment_count: 12,
      monthly_salary_income: 10000,
      monthly_household_expenses: 1000,
      existing_monthly_debt: 0,
    },
    verifiedKyc()
  );
  assert.equal(assessment.proposed_interval_days, 10);
  assert.equal(assessment.periodic_installment_amount, 750);
  assert.equal(assessment.proposed_installment_amount, 2282.77);
  assert.equal(assessment.term_months, 3.9);
});

test("invalid dates, deposits and custom intervals fail before any write", () => {
  const invalidInputs = [
    {
      selling_price: 1000,
      deposit: 0,
      payment_frequency: "custom",
      custom_interval_days: 0,
      installment_count: 12,
      first_due_date: "2026-08-01",
    },
    {
      selling_price: 500,
      deposit: 500,
      payment_frequency: "monthly",
      installment_count: 12,
      first_due_date: "2026-08-01",
    },
    {
      selling_price: 500,
      deposit: 10,
      payment_frequency: "monthly",
      installment_count: 12,
      first_due_date: "2026-02-30",
    },
  ];

  for (const input of invalidInputs) {
    assert.throws(() => buildFinanceSchedule(input), FinanceScheduleError);
  }
});

test("schedule preview is protected, mounted and read-only", () => {
  const backendDir = path.resolve(__dirname, "..");
  const routeSource = fs.readFileSync(
    path.join(backendDir, "routes", "equipmentFinanceScheduleRoutes.js"),
    "utf8"
  );
  const parentSource = fs.readFileSync(
    path.join(backendDir, "routes", "equipmentFinanceIndependentRoutes.js"),
    "utf8"
  );

  assert.match(routeSource, /\/phase-one\/schedule-preview/);
  assert.match(routeSource, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(routeSource, /buildFinanceSchedule/);
  assert.doesNotMatch(routeSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
  assert.doesNotMatch(routeSource, /pool\.query|beginTransaction|getConnection/);
  assert.match(parentSource, /router\.use\(equipmentFinanceScheduleRoutes\)/);
  assert.match(parentSource, /exact_schedule_preview_enabled:\s*true/);
  assert.match(parentSource, /custom_interval_days_enabled:\s*true/);
});
