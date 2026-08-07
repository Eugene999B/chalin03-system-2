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
const minimalWorkflow = read("src", "pages", "EquipmentFinanceMinimalWorkflowPage.jsx");
const wizard = read("src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const customers = read("src", "pages", "EquipmentFinanceCustomerCentrePage.jsx");
const excavators = read("src", "pages", "EquipmentFinanceExcavatorsPage.jsx");
const applications = read("src", "pages", "EquipmentFinanceApplicationsPage.jsx");
const activation = read("src", "pages", "EquipmentFinanceAgreementActivationPage.jsx");
const deposit = read("src", "pages", "EquipmentFinanceDepositReservationPage.jsx");
const collections = read("src", "pages", "EquipmentFinanceCollectionsMinimalPage.jsx");
const reports = read("src", "pages", "EquipmentSalesReportsPage.jsx");
const guide = read("src", "pages", "EquipmentFinanceGuidePage.jsx");
const css = read("src", "styles", "equipmentFinancePhaseOne.css");
const guideCss = read("src", "styles", "equipmentFinanceGuide.css");

for (const stage of ["start", "customers", "machines", "guide", "activation", "deposit", "collections"]) {
  assert.match(workspace, new RegExp(`stage === "${stage}"`));
}
assert.match(workspace, /EquipmentFinanceApplicationsPage/);
assert.match(workspace, /EquipmentFinanceCollectionsMinimalPage/);
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
assert.match(layout, /Company-wide Finance portfolio/);

assert.match(home, /EquipmentFinanceMinimalWorkflowPage/);
assert.match(home, /EquipmentInstallmentCommandAdvancedPage/);
for (const phrase of [
  "Equipment Installment Workflow",
  "Complete these nine actions",
  "Equipment list",
  "Add equipment",
  "Customer selection",
  "Create installment agreement",
  "Configure terms",
  "Preview schedule",
  "Activate agreement",
  "Record payment",
  "Balance and payment history",
]) {
  assert.match(minimalWorkflow, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}
assert.match(minimalWorkflow, /company-wide|Company-wide/);
assert.match(minimalWorkflow, /official-outstanding-balance/);

for (const phrase of [
  "Start New Installment",
  "Select the exact excavator",
  "Set the exact payment interval",
  "Customer assessment",
  "Review and create the draft",
  "Create Draft Installment",
]) {
  assert.match(wizard, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(wizard, /schedule-preview/);
assert.match(wizard, /customer_consent_confirmed/);
assert.match(wizard, /credit_assessment_consent_confirmed/);
assert.doesNotMatch(wizard, /selectedContextId|useWorkspaceContext/);
assert.doesNotMatch(wizard, /Choose a Hire location|Choose a Finance location/);

assert.match(customers, /Customer Centre/);
assert.match(customers, /Add Customer/);
assert.match(customers, /Start Installment/);
assert.match(customers, /Search Finance customer register/);
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

for (const page of [activation, deposit]) {
  assert.match(page, /Search, select, then/i);
  assert.match(page, /finance-simplified__compact-register/);
  assert.doesNotMatch(page, /selectedContextId|useWorkspaceContext/);
}
assert.match(reports, /Equipment Finance Phase 6/);
assert.doesNotMatch(reports, /selectedContextId|useWorkspaceContext/);
assert.match(collections, /Collections &amp; Payment History/);
assert.match(collections, /account-detail-official-balance/);
assert.match(collections, /payment-history/);
assert.match(collections, /Official balances are returned by the backend/i);
assert.doesNotMatch(collections, /selectedContextId|useWorkspaceContext/);

assert.match(guide, /Complete lifecycle/);
assert.match(guide, /Installment Offer is created automatically/);
assert.match(guide, /Task & Approval Inbox/);
assert.match(guide, /Opening Deposit & Machine Reservation/);
assert.match(guide, /Troubleshooting/);
assert.match(guide, /dated owner-authorized restart release/);
assert.match(guide, /general production reset endpoint.*remain blocked/);
assert.doesNotMatch(guide, /workspace="equipment_hire"/);
assert.match(guideCss, /@media \(max-width: 760px\)/);
assert.match(guideCss, /@media \(max-width: 420px\)/);
assert.match(guideCss, /grid-template-columns:\s*1fr/);

assert.match(css, /@media \(max-width: 720px\)/);
assert.match(css, /@media \(max-width: 390px\)/);
assert.match(css, /object-fit:\s*contain/);
assert.match(css, /overflow-wrap:\s*anywhere/);
assert.match(css, /white-space:\s*normal/);
assert.match(css, /position:\s*sticky/);
assert.match(css, /min-height:\s*44px/);

console.log("Equipment Finance Phase 3 usability contract passed.");
