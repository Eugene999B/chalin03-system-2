const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const routes = read("backend", "routes", "equipmentFinancePhaseOneRoutes.js");
const page = read("frontend", "src", "pages", "EquipmentFinanceCustomerCentrePage.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const layout = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");

test("Finance Customer Centre creates and reuses company-wide customer records", () => {
  assert.match(routes, /\/phase-one\/customers/);
  assert.match(routes, /POSSIBLE_DUPLICATE_FINANCE_CUSTOMER/);
  assert.match(
    routes,
    /REPLACE\(REPLACE\(REPLACE\(REPLACE\(phone, '\+', ''\), ' ', ''\), '-', ''\), '233', '0'\) = \?/
  );
  assert.match(routes, /OR LOWER\(customer_name\) = LOWER\(\?\)/);
  assert.match(routes, /EQUIPMENT_FINANCE_CUSTOMER_CREATED/);
  assert.match(routes, /EQUIPMENT_FINANCE_CUSTOMER_UPDATED/);
});

test("customer interface is a standalone Finance starting point", () => {
  assert.match(workspace, /EquipmentFinanceCustomerCentrePage/);
  assert.match(workspace, /stage === "customers"/);
  assert.match(layout, /title: "Customers"/);
  assert.match(page, /Customer Centre/);
  assert.match(page, /Start New Installment/);
  assert.match(page, /Search|search/);
});

test("Finance customer work does not reopen the Hire customer workflow", () => {
  assert.doesNotMatch(page, /Choose a Hire location|selectedHireLocationId|requireHireLocationScope/);
  assert.doesNotMatch(layout, /Open Equipment Hire Operations/);
  assert.match(layout, /company-wide Finance customers/i);
});
