const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const repair = read("backend", "scripts", "runDebtCustomerIdentityReconciliationStartup.js");
const packageJson = JSON.parse(read("backend", "package.json"));
const debtRoutes = read("backend", "routes", "debtRoutes.js");

test("debt identity repair is scoped to debt-linked sales and never changes debt amounts", () => {
  assert.match(repair, /INNER JOIN debts d/);
  assert.match(repair, /s\.customer_id IS NOT NULL/);
  assert.match(repair, /UPDATE sales s/);
  assert.match(repair, /s\.customer_name = c\.name/);
  assert.match(repair, /s\.customer_phone = c\.phone/);
  assert.doesNotMatch(repair, /UPDATE debts/);
  assert.doesNotMatch(repair, /UPDATE debt_payments/);
  assert.doesNotMatch(repair, /DELETE FROM/);
});

test("production starts with the debt identity repair before the API server", () => {
  assert.match(
    packageJson.scripts.start,
    /^node scripts\/runDebtCustomerIdentityReconciliationStartup\.js && /
  );
});

test("Debt Desk still retains the original debt/customer snapshots separately from current identity", () => {
  assert.match(debtRoutes, /debt_customer_name_snapshot/);
  assert.match(debtRoutes, /sale_customer_name/);
  assert.match(debtRoutes, /effective_customer_id/);
});
