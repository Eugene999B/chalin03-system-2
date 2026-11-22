const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isWeeklySendWindow,
  isMonthEndSendWindow,
  reportPeriodDate,
  buildMessage,
} = require("../services/executiveBusinessReportService");

test("Saturday evening and Sunday catch-up both permit the weekly report", () => {
  assert.equal(isWeeklySendWindow(new Date("2026-11-21T22:00:00Z")), true);
  assert.equal(isWeeklySendWindow(new Date("2026-11-22T08:00:00Z")), true);
  assert.equal(isWeeklySendWindow(new Date("2026-11-22T15:00:00Z")), false);
  assert.equal(reportPeriodDate("weekly", new Date("2026-11-22T08:00:00Z")).toISOString().slice(0, 10), "2026-11-21");
});

test("monthly catch-up reports the just-closed month, not a new empty month", () => {
  assert.equal(isMonthEndSendWindow(new Date("2026-11-30T22:00:00Z")), true);
  assert.equal(isMonthEndSendWindow(new Date("2026-12-01T08:00:00Z")), true);
  assert.equal(isMonthEndSendWindow(new Date("2026-12-01T15:00:00Z")), false);
  assert.equal(reportPeriodDate("monthly", new Date("2026-12-01T08:00:00Z")).toISOString().slice(0, 10), "2026-11-30");
});

test("executive SMS provides action, collections, debt, expenses and stock risk", () => {
  const message = buildMessage(
    "weekly",
    { start: "2026-11-16", end: "2026-11-21" },
    {
      salesTotal: 1000,
      salesCount: 4,
      paymentsReceived: 700,
      expensesTotal: 220,
      estimatedOperatingResult: 780,
      outstandingDebt: 330,
      debtAccounts: 2,
      lowStockCount: 3,
      absoluteVariance: 0,
      awaitingVerification: 0,
      seriousIncidents: 0,
    },
    "Management",
    { salesTotal: 800, expensesTotal: 200 }
  );
  assert.match(message.sms, /SPARE PARTS WEEKLY/);
  assert.match(message.sms, /Sales GHS/);
  assert.match(message.sms, /collected GHS/);
  assert.match(message.sms, /expenses GHS/);
  assert.match(message.sms, /open debt GHS/);
  assert.match(message.sms, /low stock 3/);
  assert.match(message.sms, /ACTION/);
  assert.ok(message.sms.length <= 420);
});
