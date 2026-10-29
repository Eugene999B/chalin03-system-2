const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const route = fs.readFileSync(
  path.join(projectRoot, "backend/routes/equipmentFinanceFinalLifecycleRoutes.js"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(projectRoot, "frontend/src/pages/EquipmentFinanceActiveInstallmentsPage.jsx"),
  "utf8"
);

test("list and detail account queries load the current excavator-register price", () => {
  const count = route.split("asset.target_selling_price AS machine_register_price").length - 1;
  assert.equal(count, 2, "both single-account and account-list queries must expose the edited register price");
  assert.match(route, /machine_register_price:\s*account\.machine_register_price/);
  assert.match(route, /total_amount:\s*Number\(account\.total_amount/);
});

test("Active Installments shows edited purchase price separately from signed agreement", () => {
  assert.match(page, /<span>Purchase price<\/span><strong>\{money\(registerPurchasePrice\(account\)\)\}/);
  assert.match(page, /<span>Signed agreement price<\/span><strong>\{money\(account\.total_amount\)\}/);
  assert.match(page, /Updated excavator purchase price/);
  assert.match(page, /update the effective agreement price, unpaid installments and/);
  assert.match(page, /Open excavators to sync price/);
});

test("payment progress, balance and portfolio accounting remain based on agreement totals", () => {
  assert.match(page, /const total = Number\(account\.total_amount \|\| 0\)/);
  assert.match(page, /result\.sales \+= Number\(account\.total_amount \|\| 0\)/);
  assert.match(page, /<span>Balance<\/span><strong>\{money\(account\.outstanding_balance\)\}/);
  assert.doesNotMatch(route.slice(route.indexOf("function publicAccount("), route.indexOf("async function nextFinanceNumber(")), /total_amount:\s*Number\(account\.machine_register_price/);
});
