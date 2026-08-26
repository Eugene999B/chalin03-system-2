import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (...parts) => fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");

const layout = read("src", "layouts", "InstallmentFinanceLayout.jsx");
const workspace = read("src", "pages", "EquipmentSalesWorkspacePage.jsx");
const wizard = read("src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const customers = read("src", "pages", "EquipmentFinanceCustomerCentrePage.jsx");
const portrait = read("src", "components", "CustomerPortrait.jsx");
const excavators = read("src", "pages", "EquipmentFinanceExcavatorsPage.jsx");
const activation = read("src", "pages", "EquipmentFinanceAgreementActivationPage.jsx");
const deposit = read("src", "pages", "EquipmentFinanceDepositReservationPageV2.jsx");
const collections = read("src", "pages", "EquipmentFinanceCollectionsMinimalPage.jsx");
const documents = read("src", "pages", "EquipmentFinanceDocumentCentrePage.jsx");
const guide = read("src", "pages", "EquipmentFinanceGuidePage.jsx");
const portraitCss = read("src", "styles", "customerProfilePortrait.css");
const wizardCss = read("src", "styles", "equipmentFinanceStartWizardPolish.css");

for (const stage of ["start", "customers", "machines", "guide", "activation", "deposit", "collections"]) {
  assert.match(workspace, new RegExp(`stage === "${stage}"`));
}
assert.match(workspace, /EquipmentFinanceCustomerCentrePage/);
assert.match(workspace, /EquipmentFinanceStartWizardPage/);
assert.doesNotMatch(workspace, /useWorkspaceContext|selectedContextId/);

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
assert.match(layout, /Company-wide Finance portfolio/);

for (const phrase of [
  "Start New Installment",
  "Select the exact excavator",
  "Set the exact payment interval",
  "Customer assessment",
  "Review and create the draft",
  "Create Draft Installment",
  "profile_photo_data_url",
]) {
  assert.match(wizard, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(wizard, /schedule-preview/);
assert.match(wizard, /CustomerPortraitPicker/);
assert.match(wizard, /customer_consent_confirmed/);
assert.match(wizard, /credit_assessment_consent_confirmed/);
assert.doesNotMatch(wizard, /Choose a Hire location|Choose a Finance location/);

assert.match(portrait, /normalizeCustomerPortrait/);
assert.match(portrait, /CustomerPortraitPicker/);
assert.match(portrait, /image\/jpeg/);
assert.match(portrait, /TARGET_WIDTH/);
assert.match(portrait, /TARGET_HEIGHT/);
assert.match(portrait, /MAX_BYTES/);
assert.match(portrait, /safePhotoSource/);
assert.match(portraitCss, /customer-portrait/);
assert.match(portraitCss, /customer-photo-picker/);

assert.match(customers, /Finance Customer Centre/);
assert.match(customers, /Search Finance customer register/);
assert.match(customers, /CustomerPortraitPicker/);
assert.match(customers, /Start New Installment/);
assert.match(customers, /profile_photo_data_url/);
assert.doesNotMatch(customers, /useWorkspaceContext/);

assert.match(excavators, /One source of truth/);
assert.match(excavators, /Save Excavator/);
assert.match(excavators, /finance-simple__machine-image/);
assert.match(excavators, /viewerPhoto/);

assert.match(activation, /Search, select, then/i);
assert.match(activation, /finance-simplified__compact-register/);
assert.doesNotMatch(activation, /selectedContextId|useWorkspaceContext/);

assert.match(deposit, /Opening Deposit/);
assert.match(deposit, /Approved agreements/);
assert.match(deposit, /finance-simplified__compact-register/);
assert.doesNotMatch(deposit, /selectedContextId|useWorkspaceContext/);

assert.match(collections, /Collections &amp; Payment History/);
assert.match(collections, /Official balances are returned by the backend/i);
assert.match(collections, /account-detail-official-balance/);
assert.match(collections, /payment-history/);
assert.doesNotMatch(collections, /selectedContextId|useWorkspaceContext/);

assert.match(documents, /CustomerPortrait/);
assert.match(documents, /customer portrait|customer_profile_photo|profile_photo/i);
assert.match(guide, /Complete lifecycle/);
assert.match(guide, /Troubleshooting/);
assert.match(wizardCss, /@media \(max-width: 760px\)/);
assert.match(wizardCss, /@media \(max-width: 420px\)/);

console.log("Equipment Finance Phase 1 usability and customer-portrait contracts passed.");
