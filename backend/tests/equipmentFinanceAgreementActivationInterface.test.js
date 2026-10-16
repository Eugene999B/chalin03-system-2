const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const page = read("frontend", "src", "pages", "EquipmentFinanceAgreementActivationPage.jsx");
const applications = read("frontend", "src", "pages", "EquipmentFinanceApplicationsPage.jsx");

test("agreement activation remains a controlled stage inside the simplified workspace", () => {
  assert.match(workspace, /EquipmentFinanceApplicationsPage/);
  assert.match(workspace, /EquipmentFinanceAgreementActivationPage/);
  assert.match(workspace, /stage === "activation"/);
  assert.match(applications, /Approve credit application/);
});

test("activation is limited to authorised Finance management and accounting roles", () => {
  assert.match(page, /ACTIVATION_ROLES/);
  assert.match(page, /finance_manager/);
  assert.match(page, /finance_accountant/);
  assert.match(page, /equipment_business_manager/);
  assert.match(page, /equipment_business_accountant/);
  assert.match(page, /is_original_system_administrator/);
});

test("activation calls only the protected agreement activation API", () => {
  assert.match(page, /const API = "\/equipment-catalogue\/sales\/agreement-activations"/);
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/readiness`\)/);
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/candidates`\)/);
  assert.match(page, /axiosClient\.post\(`\$\{API\}\/\$\{selected\.id\}`, form\)/);
});

test("activation does not post payment, reservation, delivery or ownership actions", () => {
  assert.match(page, /Agreement and schedule only\./);
  assert.match(page, /terms_accepted/);
  assert.doesNotMatch(page, /deposit-payments|ownership-transfer|deliveries\/complete|payment-allocations/);
  assert.doesNotMatch(page, /hire_location_id|activeHireLocation|selectedHireLocation/i);
});
