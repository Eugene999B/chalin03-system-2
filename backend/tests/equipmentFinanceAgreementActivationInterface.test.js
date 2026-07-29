const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read(
  "frontend/src/pages/EquipmentFinanceAgreementActivationPage.jsx"
);
const workspace = read("frontend/src/pages/EquipmentSalesWorkspacePage.jsx");
const layout = read("frontend/src/layouts/InstallmentFinanceLayout.jsx");
const css = read("frontend/src/styles/equipmentFinanceAgreementActivation.css");
const serviceWorker = read("frontend/public/sw.js");

test("Finance applications and agreement activation remain separate interface stages", () => {
  assert.match(workspace, /new URLSearchParams\(location\.search\)/);
  assert.match(workspace, /stage === "activation"/);
  assert.match(workspace, /EquipmentCreditApplicationsPage/);
  assert.match(workspace, /EquipmentFinanceAgreementActivationPage/);

  assert.match(layout, /Credit Applications & Approval/);
  assert.match(layout, /Agreement Activation/);
  assert.match(layout, /applications\?stage=activation/);
  assert.match(layout, /matchSearch: true/);
  assert.match(layout, /No access to Hire jobs or contracts/);
});

test("activation UI is restricted to Finance Manager, Finance Accountant or protected System Administrator", () => {
  assert.match(page, /finance_manager/);
  assert.match(page, /finance_accountant/);
  assert.match(page, /is_original_system_administrator/);
  assert.match(page, /canActivate/);
  assert.match(page, /Manager or accountant required/);
  assert.doesNotMatch(page, /hire_officer|dispatcher|fleet_officer/);
});

test("activation UI calls only the protected Finance activation API", () => {
  assert.match(
    page,
    /const API = "\/equipment-catalogue\/sales\/agreement-activations"/
  );
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/readiness`\)/);
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/candidates`\)/);
  assert.match(
    page,
    /axiosClient\.post\(`\$\{API\}\/\$\{selectedCandidate\.id\}`/
  );
  assert.doesNotMatch(page, /\/equipment-hire|\/hire-commercial/);
});

test("activation confirmation keeps payment, Hire work and equipment commitment outside the action", () => {
  for (const text of [
    "does not collect money",
    "create a Hire job",
    "No Hire job",
    "No payment",
    "No machine lock",
    "No SMS",
    "Machine remains unreserved",
    "creates no Hire work",
  ]) {
    assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  assert.match(page, /terms_accepted/);
  assert.match(page, /first_due_date/);
  assert.match(page, /grace_days/);
  assert.doesNotMatch(
    page,
    /equipment_sale_payments|equipment_asset_sale_locks|fleet_assets\.sale_status|sendSms/i
  );
});

test("activation interface is responsive and advances the application shell cache", () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /finance-activation__drawer/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(serviceWorker, /chalin03-finance-agreement-activation-v22/);
  assert.match(serviceWorker, /networkNavigation/);
  assert.doesNotMatch(serviceWorker, /url\.pathname\.startsWith\("\/api"\)[\s\S]{0,120}cache\.put/);
});
