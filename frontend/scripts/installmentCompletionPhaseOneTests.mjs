import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const layout = source("src/layouts/InstallmentFinanceLayout.jsx");
const workspace = source("src/pages/EquipmentSalesWorkspacePage.jsx");
const home = source("src/pages/EquipmentFinanceCompletionHomePage.jsx");
const inbox = source("src/pages/EquipmentFinanceTaskInboxPage.jsx");
const caseOperations = source("src/pages/EquipmentFinanceCaseOperationsPage.jsx");
const applications = source("src/pages/EquipmentFinanceApplicationsCompletionPage.jsx");
const optionalApplications = source("src/pages/EquipmentFinanceApplicationsOptionalPage.jsx");
const commandPage = source("src/pages/EquipmentInstallmentCommandPage.jsx");
const protectedImages = source("src/utils/equipmentMediaCaptureBridge.js");
const productionHotfix = source("src/styles/equipmentFinanceProductionHotfix.css");

assert.match(commandPage, /EquipmentFinanceCompletionHomePage/);
assert.match(home, /Complete these six business stages/);
assert.match(home, /Where do I record a payment\?/);
assert.match(home, /stage=deposit/);
assert.match(home, /stage=collections/);

assert.match(layout, /title: "Applications & Approvals"/);
assert.match(layout, /title: "Task & Approval Inbox"/);
assert.match(layout, /title: "Case Operations"/);
assert.match(layout, /title: "Active Installments"/);
assert.match(layout, /stage=inbox/);
assert.match(layout, /stage=case-operations/);

assert.match(workspace, /EquipmentFinanceApplicationsCompletionPage/);
assert.match(workspace, /EquipmentFinanceTaskInboxPage/);
assert.match(workspace, /EquipmentFinanceCaseOperationsPage/);
assert.match(workspace, /stage === "inbox"/);
assert.match(workspace, /stage === "case-operations"/);
assert.match(
  workspace,
  /if \(!stage \|\| stage === "applications" \|\| stage === "start"\)/
);

assert.match(inbox, /Action queue only/);
assert.match(inbox, /This page contains work requiring action/);
assert.doesNotMatch(inbox, /Schedule Simulator/);
assert.doesNotMatch(inbox, /Secure document upload/);

assert.match(caseOperations, /One selected case/);
assert.match(caseOperations, /Complete chronology/);
assert.match(caseOperations, /credit-applications\/\$\{applicationId\}\/image/);
assert.match(caseOperations, /Account and payment history/);
assert.match(caseOperations, /equipmentFinanceProductionHotfix\.css/);
assert.doesNotMatch(caseOperations, /Tasks, approvals and exceptions/);

assert.match(applications, /protectedApplicationImagePath/);
assert.match(applications, /Case Operations/);
assert.match(applications, /EquipmentFinanceApplicationsOptionalPage/);
assert.match(applications, /responseType: "blob"/);
assert.match(applications, /Administrator approval is immediate/);
assert.match(applications, /No separate manager review is required/);
assert.match(applications, /data-admin-direct-approval-note/);
assert.match(applications, /characterData: true/);
assert.match(applications, /useAuth/);
assert.match(applications, /completionObjectUrl/);
assert.match(applications, /equipmentFinanceProductionHotfix\.css/);
assert.match(optionalApplications, /Administrators may approve\s+directly/);
assert.match(productionHotfix, /\.installment-completion__case-list button/);
assert.match(productionHotfix, /display: grid/);
assert.match(productionHotfix, /data-completion-image-state="loading"/);

assert.match(protectedImages, /responseType: "blob"/);
assert.match(protectedImages, /naturalWidth > 0/);
assert.match(protectedImages, /credit-applications/);

console.log("Installment Completion Phase 1 source contracts passed.");
