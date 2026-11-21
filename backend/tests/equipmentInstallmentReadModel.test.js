const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  agingBucket,
  deriveAccount,
  scheduleOpenCondition,
  scheduleRemainingExpression,
} = require("../services/equipmentInstallmentReadModelService");

function columnMap(entries) {
  return new Map(
    Object.entries(entries).map(([tableName, columns]) => [
      tableName,
      new Set(columns),
    ])
  );
}

test("resilient installment read model does not require optional charge columns", () => {
  const columns = columnMap({
    equipment_installment_schedule: [
      "scheduled_amount",
      "amount_paid",
      "due_date",
      "sequence_number",
    ],
  });

  assert.equal(
    scheduleRemainingExpression(columns),
    "GREATEST(eis.scheduled_amount + 0 - 0 - eis.amount_paid, 0)"
  );
  assert.equal(scheduleOpenCondition(columns), "1 = 1");
});

test("resilient installment read model uses charge and status columns when available", () => {
  const columns = columnMap({
    equipment_installment_schedule: [
      "scheduled_amount",
      "amount_paid",
      "late_charge_amount",
      "waived_charge_amount",
      "schedule_status",
    ],
  });

  assert.equal(
    scheduleRemainingExpression(columns),
    "GREATEST(eis.scheduled_amount + eis.late_charge_amount - eis.waived_charge_amount - eis.amount_paid, 0)"
  );
  assert.match(scheduleOpenCondition(columns), /schedule_status NOT IN/);
});

test("stale active agreement is derived as overdue without mutating balances", () => {
  const account = deriveAccount(
    {
      agreement_status: "active",
      total_amount: 200000,
      amount_paid: 50000,
      outstanding_balance: 150000,
      overdue_amount: 0,
      calculated_overdue_amount: 25000,
      oldest_overdue_date: "2026-07-01",
      next_schedule_due_date: "2026-07-01",
      customer_phone_snapshot: "0240000000",
      customer_id_number: "GHA-000000000-0",
      guarantor_name: "Verified Guarantor",
    },
    "2026-07-29"
  );

  assert.equal(account.agreement_status, "overdue");
  assert.equal(account.outstanding_balance, 150000);
  assert.equal(account.overdue_amount, 25000);
  assert.equal(account.days_past_due, 28);
  assert.equal(agingBucket(account), "8_30_days");
  assert.ok(account.risk_score > 0);
});

test("command routes use the resilient portfolio service", () => {
  const routeSource = fs.readFileSync(
    path.resolve(__dirname, "../routes/equipmentInstallmentCommandRoutes.js"),
    "utf8"
  );
  const arrearsSource = fs.readFileSync(
    path.resolve(__dirname, "../services/equipmentFinanceArrearsService.js"),
    "utf8"
  );

  assert.match(routeSource, /equipmentInstallmentReadModelService/);
  assert.match(routeSource, /getInstallmentPortfolio/);
  assert.match(routeSource, /equipmentFinanceArrearsService/);
  assert.match(routeSource, /listFinanceArrears/);
  assert.match(arrearsSource, /equipmentInstallmentReadModelService/);
  assert.match(arrearsSource, /listInstallmentCollections/);
  assert.match(arrearsSource, /agingBucket/);
});
