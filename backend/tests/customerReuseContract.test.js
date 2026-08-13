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
  const source = read("frontend", "src", "pages", "ManualNewSalePage.jsx");
  assert.match(source, /\/sales\/customers/);
  assert.match(source, /Returning Customer Search/);
  assert.match(source, /selectSavedCustomer/);
  assert.match(source, /customer_id: selectedCustomerId/);
  assert.match(source, /Clear & Enter New Customer/);
});

test("Equipment Hire and Equipment Finance continue using reusable customer IDs", () => {
  const hire = read("frontend", "src", "pages", "EquipmentHireOperationsPage.jsx");
  const creditPage = read(
    "frontend",
    "src",
    "pages",
    "EquipmentCreditApplicationsPage.jsx"
  );
  const salesBackend = read("backend", "routes", "equipmentSalesRoutes.js");
  const creditBackend = read(
    "backend",
    "routes",
    "equipmentCreditApplicationRoutes.js"
  );
  assert.match(hire, /customer_id:/);
  assert.match(hire, /Choose hire customer/);
  assert.match(creditPage, /quotation_id/);
  assert.match(creditPage, /customer_name_snapshot/);
  assert.match(creditBackend, /quotation\.customer_id/);
  assert.match(creditBackend, /customer_id, enquiry_id/);
  assert.match(salesBackend, /FROM hire_customers/);
});


test("returning customer search appears below reusable identity fields", () => {
  const source = read("frontend", "src", "pages", "ManualNewSalePage.jsx");
  const css = read("frontend", "src", "index.css");
  const nameIndex = source.indexOf("<label>Customer Name</label>");
  const locationIndex = source.indexOf("<label>Customer Location</label>");
  const searchIndex = source.indexOf("Returning Customer Search");
  const paymentIndex = source.indexOf("<label>Payment Type</label>");

  assert.ok(nameIndex >= 0, "Customer Name field must exist");
  assert.ok(locationIndex > nameIndex, "Customer Location must follow Customer Name");
  assert.ok(searchIndex > locationIndex, "Returning Customer Search must sit below customer identity fields");
  assert.ok(paymentIndex > searchIndex, "Payment controls must follow the returning-customer lookup");
  assert.equal(source.includes("<label>Find Existing Customer</label>"), false);
  assert.match(source, /No saved customer found/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /Clear & Enter New Customer/);
  assert.match(css, /Returning customer search: desktop and mobile/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
