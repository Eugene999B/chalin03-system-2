const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = read("frontend", "src", "App.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const startRedirect = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinancePhaseThreeStartRedirectPage.jsx"
);
const operationalStart = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceOperationalStartImmediatePage.jsx"
);
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
    "EquipmentFinancePhaseThreeStartRedirectPage",
    "EquipmentFinanceOperationalPolishPage",
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
  assert.match(startRedirect, /EquipmentFinanceOperationalStartImmediatePage/);
  assert.match(startRedirect, /START_INSTALLMENT_PATH/);
  assert.match(startRedirect, /navigate\(safeNextPath\(response\)/);
  assert.match(operationalStart, /EquipmentFinanceStartWizardPage/);
  assert.match(operationalStart, /recoverInBackground/);
  assert.match(operationalStart, /Server recovery never blocks this screen/);
});

test("new applications use the protected automatic Offer path", () => {
  assert.match(wizard, /const API = "\/equipment-catalogue\/sales\/phase-one"/);
  assert.match(wizard, /`\$\{API\}\/start-installment`/);
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
