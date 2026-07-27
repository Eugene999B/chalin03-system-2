const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("Spare Parts exposes branch-scoped reusable customer search", () => {
  const source = read("backend", "routes", "saleRoutes.js");
  assert.match(source, /router\.get\("\/customers"/);
  assert.match(source, /WHERE c\.branch_id = \?\$\{searchSql\}/);
  assert.match(source, /purchase_count/);
  assert.match(source, /last_purchase_at/);
  assert.match(source, /outstanding_balance/);
});

test("sale creation accepts and verifies an explicit existing customer", () => {
  const route = read("backend", "routes", "saleRoutes.js");
  const validator = read("backend", "validation", "financialRequestValidators.js");
  assert.match(validator, /"customer_id"/);
  assert.match(validator, /customer_id: customerId/);
  assert.match(route, /WHERE id = \? AND branch_id = \?/);
  assert.match(route, /CUSTOMER_NOT_FOUND_IN_STORE/);
  assert.match(route, /customer_id,\n\s+cleanCustomerName/);
});

test("New Sale can search, select and submit a saved customer", () => {
  const source = read("frontend", "src", "pages", "NewSalePage.jsx");
  assert.match(source, /\/sales\/customers/);
  assert.match(source, /Find Existing Customer/);
  assert.match(source, /selectSavedCustomer/);
  assert.match(source, /customer_id: selectedCustomerId/);
  assert.match(source, /Use New Customer Instead/);
});

test("Equipment Hire and Equipment Sales continue using reusable customer IDs", () => {
  const hire = read("frontend", "src", "pages", "EquipmentHireOperationsPage.jsx");
  const sales = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
  const backend = read("backend", "routes", "equipmentSalesRoutes.js");
  assert.match(hire, /customer_id:/);
  assert.match(hire, /Choose hire customer/);
  assert.match(sales, /customer_id:/);
  assert.match(sales, /Choose customer/);
  assert.match(backend, /FROM hire_customers/);
});
