import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");

const layout = read("src", "layouts", "InstallmentFinanceLayout.jsx");
const workspace = read("src", "pages", "EquipmentSalesWorkspacePage.jsx");
const home = read("src", "pages", "EquipmentInstallmentCommandPage.jsx");
const wizard = read("src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const customers = read("src", "pages", "EquipmentFinanceCustomerCentrePage.jsx");
const excavators = read("src", "pages", "EquipmentFinanceExcavatorsPage.jsx");
const applications = read("src", "pages", "EquipmentFinanceApplicationsPage.jsx");
const activation = read("src", "pages", "EquipmentFinanceAgreementActivationPage.jsx");
const deposit = read("src", "pages", "EquipmentFinanceDepositReservationPage.jsx");
const reports = read("src", "pages", "EquipmentSalesReportsPage.jsx");
const guide = read("src", "pages", "EquipmentFinanceGuidePage.jsx");
const css = read("src", "styles", "equipmentFinancePhaseOne.css");

for (const stage of ["start", "customers", "machines", "guide"]) {
  assert.match(workspace, new RegExp(`stage === "${stage}"`));
}
assert.match(workspace, /EquipmentFinanceApplicationsPage/);
assert.doesNotMatch(workspace, /EquipmentCreditApplicationsPage/);

for (const title of [
  "Finance Home",
  "Start New Installment",
  "Customers",
  "Excavators",
  "Applications & Approvals",
  "Active Installments",
  "Payments & Arrears",
  "Documents & Reports",
  "Help & Guide",
]) {
  assert.match(layout, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(layout, /Finance Equipment Reference/);

for (const phrase of [
  "What do you need to do today?",
  "Customer → Excavator → Price &amp; Plan",
  "Start New Installment",
  "Finance is company-wide",
]) {
  assert.match(home, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const phrase of [
  "Select existing customer",
  "Create new customer",
  "Select the exact excavator",
  "Installment Offer is created automatically",
  "Create Installment Draft",
  "Draft saved automatically",
]) {
  assert.match(wizard, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(wizard, /localStorage/);
assert.match(wizard, /customer_consent_confirmed/);
assert.match(wizard, /credit_assessment_consent_confirmed/);
assert.doesNotMatch(wizard, /selectedContextId|useWorkspaceContext/);

assert.match(customers, /Finance Customer Centre/);
assert.match(customers, /Add Customer/);
assert.match(customers, /Start Installment/);
assert.doesNotMatch(customers, /useWorkspaceContext/);

assert.match(excavators, /One source of truth/);
assert.match(excavators, /Edit details/);
assert.match(excavators, /Editing locked/);
assert.match(excavators, /finance-simple__machine-image/);
assert.match(excavators, /finance-simple__photo-viewer/);
assert.doesNotMatch(excavators, /useWorkspaceContext/);

assert.match(applications, /Applications and approvals/i);
assert.match(applications, /Installment Offer/);
assert.match(applications, /No Hire-location selection/);
assert.doesNotMatch(applications, /selectedContextId|useWorkspaceContext/);

for (const page of [activation, deposit, reports]) {
  assert.match(page, /company-wide|Company-wide/);
  assert.doesNotMatch(page, /selectedContextId|useWorkspaceContext/);
}

assert.match(guide, /What should I do first/);
assert.match(guide, /What is an Installment Offer/);
assert.match(guide, /Common problems/);
assert.doesNotMatch(guide, /workspace="equipment_hire"/);

assert.match(css, /@media \(max-width: 720px\)/);
assert.match(css, /@media \(max-width: 390px\)/);
assert.match(css, /object-fit:\s*contain/);
assert.match(css, /overflow-wrap:\s*anywhere/);
assert.match(css, /white-space:\s*normal/);
assert.match(css, /position:\s*sticky/);
assert.match(css, /min-height:\s*44px/);

console.log("Equipment Finance Phase 1 usability contract passed.");
