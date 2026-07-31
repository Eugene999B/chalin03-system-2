const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const applications = read("frontend", "src", "pages", "EquipmentFinanceApplicationsPage.jsx");
const wizard = read("frontend", "src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const wrapper = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const css = read("frontend", "src", "styles", "equipmentFinancePhaseOne.css");
const layout = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");
const serviceWorker = read("frontend", "public", "sw.js");

test("Finance applications route through the protected credit foundation", () => {
  assert.match(wrapper, /EquipmentFinanceApplicationsPage/);
  assert.match(wrapper, /EquipmentFinanceStartWizardPage/);
  assert.match(applications, /const API = "\/equipment-catalogue\/sales\/credit-applications"/);
  assert.match(applications, /axiosClient\.get\(`\$\{API\}\/readiness`\)/);
  assert.match(applications, /axiosClient\.get\(API\)/);
  assert.match(applications, /kyc\/verify/);
  assert.match(applications, /\/review/);
  assert.match(applications, /\/assess/);
  assert.match(applications, /\/submit/);
});

test("guided start captures the customer, affordability, guarantor and consent", () => {
  for (const field of [
    "customer_name",
    "phone",
    "asset_id",
    "selling_price",
    "deposit",
    "payment_frequency",
    "installment_count",
    "id_number",
    "employment_type",
    "monthly_salary_income",
    "monthly_household_expenses",
    "existing_monthly_debt",
    "guarantor_name",
    "customer_consent_confirmed",
    "credit_assessment_consent_confirmed",
  ]) {
    assert.match(wizard, new RegExp(field));
  }
  assert.match(wizard, /Installment Offer/);
  assert.match(wizard, /created automatically/i);
  assert.doesNotMatch(wizard, /Choose a specific equipment location|Choose a Hire location/);
});

test("credit decision remains separate from agreement activation and reservation", () => {
  assert.match(applications, /Approve credit application/);
  assert.match(applications, /Request changes/);
  assert.doesNotMatch(applications, /axiosClient\.post\([^\n]*\/agreements/);
  assert.doesNotMatch(applications, /ownership-transfer|equipment reserved|terms_accepted/);
});

test("credit interface is phone-first and discoverable only in Finance", () => {
  assert.match(layout, /Applications & Approvals/);
  assert.match(layout, /Start New Installment/);
  assert.match(layout, /No access to Hire jobs or contracts/);
  assert.match(layout, /no Hire-location selection/i);
  assert.doesNotMatch(layout, /Open Equipment Hire Operations/);
  assert.match(css, /\.finance-simple/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(serviceWorker, /chalin03-equipment-division-isolation-v21/);
});
