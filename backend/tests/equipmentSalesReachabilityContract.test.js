const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = read("frontend", "src", "App.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const applications = read("frontend", "src", "pages", "EquipmentFinanceApplicationsPage.jsx");
const wizard = read("frontend", "src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const backend = read("backend", "routes", "equipmentFinancePhaseOneRoutes.js");

test("all simplified Finance routes resolve through the protected Finance layout", () => {
  assert.match(app, /path="\/equipment-installment-finance"/);
  assert.match(app, /path="applications"/);
  assert.match(app, /path="reports"/);
  assert.match(app, /path="change-password"/);
  assert.match(app, /InstallmentFinanceLayout/);
});

test("workspace query stages resolve to explicit Finance pages", () => {
  for (const pageName of [
    "EquipmentFinanceStartWizardPage",
    "EquipmentFinanceCustomerCentrePage",
    "EquipmentFinanceExcavatorsPage",
    "EquipmentFinanceApplicationsPage",
    "EquipmentFinanceAgreementActivationPage",
    "EquipmentFinanceDepositReservationPage",
    "EquipmentFinanceArrearsPage",
    "EquipmentFinanceRecoveryGovernancePage",
    "EquipmentFinanceFinalLifecyclePage",
  ]) {
    assert.match(workspace, new RegExp(pageName));
  }
});

test("new applications use the protected automatic Offer path", () => {
  assert.match(wizard, /\/equipment-finance\/professional\/phase-one\/start-installment/);
  assert.match(backend, /\/phase-one\/start-installment/);
  assert.match(backend, /equipment_sales_quotations/);
  assert.match(backend, /equipment_credit_applications/);
  assert.match(backend, /created_automatically:\s*true/);
  assert.match(applications, /Approve credit application/);
});

test("application pages cannot silently finalize a sale", () => {
  assert.doesNotMatch(applications, /ownership-transfer|deliveries\/complete/);
  assert.doesNotMatch(wizard, /ownership-transfer|deliveries\/complete/);
  assert.match(workspace, /stage === "activation"/);
  assert.match(workspace, /stage === "deposit"/);
});
