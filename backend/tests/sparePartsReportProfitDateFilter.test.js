"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculateSparePartsProfitSummary } = require("../services/sparePartsProfitSummaryService.js");

const route = fs.readFileSync(path.join(__dirname, "../routes/reportRoutes.js"), "utf8");
const page = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/ReportsPage.jsx"), "utf8");

test("Sunday or any no-transaction date has zero net profit when all components are zero", () => {
  assert.deepEqual(calculateSparePartsProfitSummary(), {
    gross_profit: 0, total_expenses: 0, total_refunds: 0,
    recovered_return_cost: 0, net_profit: 0,
  });
  assert.equal(calculateSparePartsProfitSummary({
    profit: { gross_profit: 0 },
    expenses: { total_expenses: 0 },
    refunds: { total_refunds: 0, recovered_return_cost: 0 },
  }).net_profit, 0);
});

test("a refund actually processed on a day without sales can legitimately create a loss", () => {
  const result = calculateSparePartsProfitSummary({
    refunds: { total_refunds: 180, recovered_return_cost: 75 },
  });
  assert.equal(result.net_profit, -105);
});

test("profit reconciles in cents with gross profit, expenses, refunds and cost recovery", () => {
  const result = calculateSparePartsProfitSummary({
    profit: { gross_profit: 160.15 },
    expenses: { total_expenses: 20.12 },
    refunds: { total_refunds: 40.01, recovered_return_cost: 10.00 },
  });
  assert.equal(result.net_profit, 110.02);
});

test("summary date filter scopes returns by their returned_at date, not the original sale date", () => {
  assert.match(route, /buildCustomDateFilter\("r", "returned_at", from, to, refundParams\)/);
  assert.match(route, /\$\{refundDateFilter\}/);
  assert.match(route, /FROM returns r/);
  assert.match(route, /INNER JOIN sales s ON s\.id = r\.sale_id AND s\.branch_id = r\.branch_id/);
  assert.match(route, /WHERE r\.branch_id = \?/);
  assert.match(route, /refundParams\s*\)/);
});

test("refund totals are not multiplied by multiple matching sale item rows", () => {
  assert.match(route, /SELECT MAX\(si\.cost_price_at_sale\)/);
  assert.doesNotMatch(
    route.slice(route.indexOf("const [refundRows]"), route.indexOf("const debtParams")),
    /LEFT JOIN sale_items si/,
  );
  assert.match(route, /CASE WHEN r\.return_type = 'refund' THEN r\.refund_amount ELSE 0 END/);
});

test("Profit Pipeline displays its refund and stock recovery components", () => {
  assert.match(page, /label: "Refunds"/);
  assert.match(page, /value: summary\?\.total_refunds/);
  assert.match(page, /label: "Returned Stock Cost"/);
  assert.match(page, /value: summary\?\.recovered_return_cost/);
  assert.match(page, /Sales, expenses and refunds all follow the selected date range/);
});
