"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  canApplySaleDiscount,
  hasVerifiedBossIdentity,
  discountApprovalRequired,
} = require("../services/saleDiscountAuthorizationService");
const { hasPositiveDiscountField } = require("../middleware/restrictedDiscountMiddleware");

const fakeDB = (rows) => ({
  async query(query, values) {
    assert.match(query, /FROM users/);
    assert.deepEqual(values, ["agyapong charles"]);
    return [rows];
  },
});
const boss = { id: 65, full_name: "Agyapong Charles", role: "admin" };
const matching = { id: 65, full_name: "Agyapong Charles", role: "admin", is_active: 1 };

test("the real original System Administrator retains positive discount authority", async () => {
  const admin = { id: Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
    username: process.env.SYSTEM_ADMIN_USERNAME || "admin", role: "admin" };
  assert.equal(await canApplySaleDiscount(admin, fakeDB([])), true);
});

test("only the unique active boss administrator row may discount", async () => {
  assert.equal(await canApplySaleDiscount(boss, fakeDB([matching])), true);
  assert.equal(hasVerifiedBossIdentity(boss, [matching]), true);
  assert.equal(await canApplySaleDiscount({ ...boss, id: 66 }, fakeDB([matching])), false);
  assert.equal(await canApplySaleDiscount({ ...boss, role: "manager" }, fakeDB([matching])), false);
  assert.equal(await canApplySaleDiscount({ ...boss, role: "cashier" }, fakeDB([matching])), false);
  assert.equal(await canApplySaleDiscount(boss, fakeDB([])), false);
  assert.equal(await canApplySaleDiscount(boss, fakeDB([matching, { ...matching, id: 67 }])), false);
  assert.equal(await canApplySaleDiscount(boss, fakeDB([{ ...matching, is_active: 0 }])), false);
  assert.equal(await canApplySaleDiscount(boss, fakeDB([{ ...matching, full_name: "Someone Else" }])), false);
});

test("discount guard refuses nonpositive differences and finds nested positive discounts", () => {
  assert.equal(discountApprovalRequired(0), false);
  assert.equal(discountApprovalRequired(-5), false);
  assert.equal(discountApprovalRequired(10), true);
  assert.equal(hasPositiveDiscountField({ discount_amount: 0 }), false);
  assert.equal(hasPositiveDiscountField({ discount_amount: 25 }), true);
  assert.equal(hasPositiveDiscountField({ items: [{ discount_amount: 25 }] }), true);
  assert.equal(hasPositiveDiscountField({ items: [{ discount_amount: 0 }] }), false);
});

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("sale APIs enforce real permission on new and edited discounts", () => {
  const sales = read("routes/saleRoutes.js");
  const approval = read("routes/operationalApprovalRoutes.js");
  const auth = read("routes/authRoutes.js");
  assert.equal((sales.match(/DISCOUNT_BOSS_ONLY/g) || []).length, 3);
  assert.match(sales, /router\.get\("\/discount-permission"/);
  assert.match(approval, /DISCOUNT_BOSS_ONLY/);
  assert.match(auth, /router\.get\("\/discount-permission"/);
});

test("hire, equipment sales and commercial quote routes also enforce discounts", () => {
  for (const route of ["routes/equipmentSalesRoutes.js", "routes/equipmentHireRoutes.js", "routes/hireCommercialRoutes.js"]) {
    assert.match(read(route), /router\.use\(requireBossForPositiveDiscount\)/, route);
  }
});

test("boss view cannot show inventory markup as sales profit or truncate revenue to 250 sales", () => {
  const dash = fs.readFileSync(path.join(root, "../frontend/src/pages/DashboardPage.jsx"), "utf8");
  const reports = read("routes/reportRoutes.js");
  const bossView = dash.slice(dash.indexOf("Boss View — Verified Business Figures"));
  assert.match(dash, /axiosClient\.get\("\/reports\/summary"\)/);
  assert.match(bossView, /financialSummary\.net_profit/);
  assert.match(bossView, /financialSummary\.total_sales_amount/);
  assert.doesNotMatch(bossView, /dashboardData\.estimatedProfit/);
  assert.match(reports, /total_refunds: totalRefunds/);
  const profitCalculator = read("services/sparePartsProfitSummaryService.js");
  assert.match(reports, /calculateSparePartsProfitSummary\(\{/);
  assert.match(profitCalculator, /grossProfit - totalExpenses - totalRefunds \+ recoveredReturnCost/);
});
