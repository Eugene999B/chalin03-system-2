const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const page = read(
  "frontend",
  "src",
  "pages",
  "EquipmentCreditApplicationsPage.jsx"
);
const wrapper = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesWorkspacePage.jsx"
);
const css = read(
  "frontend",
  "src",
  "styles",
  "equipmentCreditApplications.css"
);
const layout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);
const serviceWorker = read("frontend", "public", "sw.js");

test("Finance applications route through the protected credit foundation", () => {
  assert.match(wrapper, /EquipmentCreditApplicationsPage/);
  assert.match(
    page,
    /const API = "\/equipment-catalogue\/sales\/credit-applications"/
  );
  assert.match(page, /axiosClient\.get\(`\$\{API\}\/readiness`\)/);
  assert.match(page, /axiosClient\.get\(API\)/);
  assert.match(page, /axiosClient\.post\(API, payload\)/);
  assert.match(page, /axiosClient\.put\(`\$\{API\}\/\$\{editingId\}`, payload\)/);
  assert.match(page, /kyc\/verify/);
  assert.match(page, /"review"/);
  assert.match(page, /"assess"/);
  assert.match(page, /"submit"/);
});

test("credit form captures KYC, affordability, guarantor evidence and consent", () => {
  for (const field of [
    "id_number",
    "date_of_birth",
    "employment_type",
    "residential_address",
    "emergency_contact_name",
    "monthly_salary_income",
    "monthly_business_income",
    "monthly_business_costs",
    "monthly_household_expenses",
    "existing_monthly_debt",
    "guarantor_name",
    "identity_document_url",
    "income_evidence_url",
    "customer_consent_confirmed",
    "credit_assessment_consent_confirmed",
  ]) {
    assert.match(page, new RegExp(field));
  }
  assert.match(page, /Choose a specific equipment location/);
  assert.match(page, /Foundation awaiting controlled migration/);
  assert.match(page, /Approve credit application/);
  assert.match(page, /Request application changes/);
});

test("credit approval interface cannot activate an agreement or reserve equipment", () => {
  assert.match(page, /An approved application is a credit decision only/);
  assert.match(page, /Agreement activation remains a separate controlled release/);
  assert.doesNotMatch(page, /axiosClient\.post\([^\n]*\/agreements/);
  assert.doesNotMatch(page, /ownership-transfer|equipment reserved|terms_accepted/);
  assert.doesNotMatch(
    page,
    /CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE equipment_|DELETE FROM/i
  );
});

test("credit interface is responsive and discoverable in Finance navigation", () => {
  assert.match(layout, /Credit Applications & Approval/);
  assert.match(layout, /KYC, affordability, manager review and credit decisions/);
  assert.match(css, /\.credit-app__metrics/);
  assert.match(css, /\.credit-app__drawer/);
  assert.match(css, /\.credit-app__form-grid/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(serviceWorker, /chalin03-credit-application-interface-v20/);
});
