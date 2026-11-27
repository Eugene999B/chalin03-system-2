const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMessage, previousComparablePeriod } = require("../services/executiveBusinessReportService");
const { deliverCriticalOwnerAlerts } = require("../services/criticalOwnerNotificationSms");

test("Saturday reports compare the same completed weekdays", () => {
  assert.deepEqual(
    previousComparablePeriod("weekly", { start: "2026-11-16", end: "2026-11-22" }, "2026-11-21"),
    { start: "2026-11-09", end: "2026-11-14" }
  );
});

test("weekly report quantifies sales movement and leads the SMS with the priority", () => {
  const metrics = {
    salesTotal: 500, paymentsReceived: 350, expensesTotal: 75, salesCount: 5,
    outstandingDebt: 160, debtAccounts: 2, estimatedOperatingResult: 425,
    awaitingVerification: 0, absoluteVariance: 0, lowStockCount: 0, seriousIncidents: 0,
  };
  const result = buildMessage("weekly", { start: "2026-11-16", end: "2026-11-21" },
    metrics, "Management", { salesTotal: 400, expensesTotal: 60 });
  assert.match(result.message, /25\.0%/);
  assert.match(result.message, /70\.0% of sales/);
  assert.match(result.sms, /Assign collection follow-up/);
  assert.ok(result.sms.length < 480);
});

test("automatic escalation uses the existing SMS approval switch", async () => {
  assert.deepEqual(await deliverCriticalOwnerAlerts({ env: { CRITICAL_OWNER_SMS_ENABLED: "false" } }), { skipped: true });
});
