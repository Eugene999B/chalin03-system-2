const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const service = read(
  "backend",
  "services",
  "equipmentFinanceCustomerPortfolioService.js"
);
const routes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const integrity = read(
  "backend",
  "middleware",
  "equipmentCatalogueIntegrityMiddleware.js"
);
const divisionAccess = read(
  "backend",
  "security",
  "equipmentDivisionAccess.js"
);
const dispatcher = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesWorkspacePage.jsx"
);
const layout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);
const page = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceCustomersPage.jsx"
);

const SQL_MUTATION = /\bINSERT\s+INTO\b|\bUPDATE\s+[A-Za-z0-9_`]+\s+SET\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b|\bDROP\s+TABLE\b/i;

test("Finance customer portfolio is a read-only company-wide read model", () => {
  assert.match(service, /scope: "company_wide"/);
  assert.match(service, /customer_source: "finance_applications_and_agreements_only"/);
  assert.match(service, /master_identity_read_only: true/);
  assert.match(service, /hire_customer_workflow_access: false/);
  assert.match(service, /automatic_sms_enabled: false/);
  assert.doesNotMatch(service, SQL_MUTATION);
});

test("Finance customer profile combines the complete controlled lifecycle", () => {
  for (const tableName of [
    "equipment_credit_applications",
    "equipment_credit_application_kyc",
    "equipment_credit_application_decisions",
    "equipment_sale_agreements",
    "equipment_installment_schedule",
    "equipment_sale_payments",
    "equipment_deliveries",
    "equipment_ownership_transfers",
  ]) {
    assert.match(service, new RegExp(tableName));
  }
  assert.match(service, /listInstallmentCollections/);
  assert.match(service, /getFinanceCustomerPortfolio/);
  assert.match(service, /listFinanceCustomers/);
});

test("Finance customer endpoints remain protected inside the Finance sales router", () => {
  assert.match(routes, /router\.get\(\s*"\/finance-customers"/);
  assert.match(routes, /router\.get\(\s*"\/finance-customers\/:customerId"/);
  assert.match(routes, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(integrity, /equipmentFinanceIndependentRoutes\(req, res/);
  assert.match(divisionAccess, /\^\\\/sales\(\?:\\\/\|\$\)/);
  assert.match(divisionAccess, /return EQUIPMENT_DIVISIONS\.FINANCE/);
});

test("Finance customer interface is routed without reopening the Hire customer page", () => {
  assert.match(dispatcher, /EquipmentFinanceCustomersPage/);
  assert.match(dispatcher, /stage === "customers"/);
  assert.match(layout, /Finance Customers & Portfolio/);
  assert.match(layout, /stage=customers/);
  assert.doesNotMatch(
    layout,
    /BLOCKED_FINANCE_PATHS[\s\S]*"\/equipment-installment-finance\/customers"/
  );
  assert.match(page, /\/equipment-catalogue\/sales\/finance-customers/);
  assert.match(page, /Applications & KYC/);
  assert.match(page, /Delivery & Ownership/);
});

test("Finance customer centre cannot mutate Hire, balances or messaging", () => {
  assert.doesNotMatch(page, /axiosClient\.(?:post|put|patch|delete)\s*\(/);
  assert.doesNotMatch(page, /\/equipment-hire|\/hire-commercial/);
  assert.doesNotMatch(page, /sendSms|automatic.*sms.*true/i);
  assert.match(page, /not open or change Hire enquiries/);
  assert.match(page, /cannot create Hire work, change balances or send automatic SMS/);
});
