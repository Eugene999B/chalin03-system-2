import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const workspace = read("src/pages/EquipmentSalesWorkspacePage.jsx");
const page = read("src/pages/EquipmentFinanceDocumentCentrePage.jsx");
const css = read("src/styles/equipmentFinanceDocumentCompletion.css");
const discoveryCss = read("src/styles/equipmentFinanceDocumentDiscovery.css");
const simplifiedCss = read("src/styles/equipmentFinanceSimplifiedWorkspace.css");
const layout = read("src/layouts/InstallmentFinanceLayout.jsx");
const workflow = read("../.github/workflows/chalin03-verification.yml");

assert.match(workspace, /EquipmentFinanceDocumentCentrePage/);
assert.match(workspace, /stage === "generated-documents"/);
assert.match(workspace, /stage === "generated-documents-core"/);
assert.match(workspace, /EquipmentFinanceProfessionalPage mode="documents"/);

for (const title of [
  "Finance Document Centre",
  "Agreement & Approval Pack",
  "Payments & Customer Account",
  "Machine, Guarantor & Handover",
  "Changes, Settlement & Ownership",
  "Immutable document history",
]) {
  assert.match(page, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const type of [
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "boss_approval_pack",
  "payment_schedule",
  "machine_annexure",
  "guarantor_undertaking",
  "payment_receipt",
  "customer_statement",
  "delivery_handover_note",
  "arrears_notice",
  "amendment_agreement",
  "settlement_confirmation",
  "ownership_transfer",
]) {
  assert.match(page, new RegExp(type));
}

assert.match(page, /const COMPLETION_API = `\$\{PROFESSIONAL_API\}\/completion-documents`/);
assert.match(page, /const OPERATIONAL_API = `\$\{API\}\/operational-polish`/);
assert.match(page, /\$\{COMPLETION_API\}\/options/);
assert.match(page, /\$\{COMPLETION_API\}\/issue/);
assert.match(page, /cases\/agreement\/\$\{selectedAgreementId\}\/amendments/);
assert.match(page, /amendment_id: documentType === "amendment_agreement"/);
assert.match(page, /No approved or applied numbered amendment exists/);
assert.match(page, /Ready to issue \$\{selectedAmendment\.amendment_number\}/);
assert.match(page, /Open Amendments/);
assert.match(page, /responseType: "blob"/);
assert.match(page, /format === "print"/);
assert.match(page, /documentType === "payment_receipt"/);
assert.match(page, /selectedPaymentId/);
assert.match(page, /snapshot_checksum/);
assert.match(page, /Search Finance document accounts/);
assert.match(page, /No agreement selected/);
assert.match(page, /src="\/chalin03-logo\.png"/);
assert.doesNotMatch(page, /nextAccounts\[0\]/);
assert.doesNotMatch(page, /payments\?\.at\(-1\)/);
assert.match(page, /Thermal Receipt/);
assert.match(page, /Issue Word/);
assert.match(page, /Issue PDF/);
assert.match(page, /Customer Profile/);
assert.match(page, /Payments Centre/);

for (const discoveryContract of [
  "Choose a document category",
  "finance-docs__category-index",
  "documents inside",
  "finance-docs__group-toggle",
  "Open category",
]) {
  assert.ok(page.includes(discoveryContract), `Missing document discovery contract: ${discoveryContract}`);
}
assert.match(page, /getElementById\(`finance-document-group-\$\{groupCode\}`\)/);
assert.match(page, /id=\{`finance-document-group-\$\{group\.code\}`\}/);

assert.match(layout, /title: "Generated Documents"/);
assert.match(layout, /stage=generated-documents/);

assert.match(css, /--docs-green: #174f35/);
assert.match(css, /--docs-gold: #d3a72c/);
assert.match(css, /finance-docs__document-grid/);
assert.match(css, /finance-docs__history-list/);
assert.match(css, /@media \(max-width: 980px\)/);
assert.match(css, /@media \(max-width: 700px\)/);
assert.match(css, /@media \(max-width: 480px\)/);
assert.match(discoveryCss, /finance-docs__category-hub/);
assert.match(discoveryCss, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(discoveryCss, /scroll-snap-type: x mandatory/);
assert.match(discoveryCss, /finance-docs__group--discovery\[open\]/);
assert.match(discoveryCss, /finance-docs__card-error/);
assert.match(discoveryCss, /@media \(max-width: 700px\)/);
assert.match(simplifiedCss, /finance-simplified__picker-controls/);
assert.match(simplifiedCss, /finance-simplified__brand-logo/);

assert.match(workflow, /equipmentFinanceCompletionPhaseThreeDocuments\.spec\.js/);
assert.match(workflow, /finance-completion-phase-three-documents-browser\.log/);

console.log("Installment Completion Phase 3 document source contracts passed.");
