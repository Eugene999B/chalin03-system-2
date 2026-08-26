import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");

const workspace = read("src", "pages", "EquipmentSalesWorkspacePage.jsx");
const wizard = read("src", "pages", "EquipmentFinanceStartWizardPage.jsx");
const portrait = read("src", "components", "CustomerPortrait.jsx");
const customers = read("src", "pages", "EquipmentFinanceCustomerCentrePage.jsx");
const excavators = read("src", "pages", "EquipmentFinanceExcavatorsPage.jsx");
const activation = read("src", "pages", "EquipmentFinanceAgreementActivationPage.jsx");
const deposit = read("src", "pages", "EquipmentFinanceDepositReservationPageV2.jsx");
const collections = read("src", "pages", "EquipmentFinanceCollectionsMinimalPage.jsx");
const documents = read("src", "pages", "EquipmentFinanceDocumentCentrePage.jsx");

for (const stage of ["start", "customers", "machines", "guide", "activation", "deposit", "collections"]) {
  assert.match(workspace, new RegExp(`stage === "${stage}"`));
}
assert.doesNotMatch(workspace, /useWorkspaceContext|selectedContextId/);

for (const phrase of [
  "Start New Installment",
  "Select the exact excavator",
  "Set the exact payment interval",
  "Customer assessment",
  "Create Draft Installment",
  "profile_photo_data_url",
]) {
  assert.match(wizard, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(wizard, /CustomerPortraitPicker/);
assert.match(wizard, /schedule-preview/);

for (const phrase of [
  "normalizeCustomerPortrait",
  "CustomerPortraitPicker",
  "image\\/jpeg",
  "TARGET_WIDTH",
  "TARGET_HEIGHT",
  "MAX_BYTES",
  "safePhotoSource",
]) {
  assert.match(portrait, new RegExp(phrase));
}

assert.match(customers, /Finance Customer Centre/);
assert.match(customers, /CustomerPortraitPicker/);
assert.match(customers, /Search Finance customer register/);
assert.match(customers, /profile_photo_data_url/);
assert.doesNotMatch(customers, /useWorkspaceContext/);

assert.match(excavators, /One source of truth/);
assert.match(excavators, /Save Excavator/);
assert.match(excavators, /finance-simple__machine-image/);
assert.match(excavators, /viewerPhoto/);

assert.match(activation, /Search, select, then/i);
assert.match(activation, /finance-simplified__compact-register/);
assert.doesNotMatch(activation, /useWorkspaceContext|selectedContextId/);

assert.match(deposit, /Opening Deposit/);
assert.match(deposit, /Approved agreements/);
assert.match(deposit, /finance-simplified__compact-register/);
assert.doesNotMatch(deposit, /useWorkspaceContext|selectedContextId/);

assert.match(collections, /Collections &amp; Payment History/);
assert.match(collections, /Official balances are returned by the backend/i);
assert.match(collections, /payment-history/);
assert.doesNotMatch(collections, /useWorkspaceContext|selectedContextId/);

assert.match(documents, /CustomerPortrait/);

console.log("Equipment Finance Phase 1 source contract passed.");
