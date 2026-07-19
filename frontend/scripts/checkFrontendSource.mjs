import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const indexHtml = read("index.html");
const app = read("src/App.jsx");
const authContext = read("src/context/AuthContext.jsx");
const axiosClient = read("src/api/axiosClient.js");
const loginPage = read("src/pages/LoginPage.jsx");
const usersSettingsPage = read("src/pages/UsersSettingsPage.jsx");
const workspaceAdministrationPage = read(
  "src/pages/WorkspaceAdministrationPage.jsx"
);
const newSale = read("src/pages/NewSalePage.jsx");
const salesHistory = read("src/pages/SalesHistoryPage.jsx");
const productsPage = read("src/pages/ProductsPage.jsx");
const smsPage = read("src/pages/SmsPage.jsx");
const ownerRecoveryPage = read("src/pages/OwnerRecoveryPage.jsx");
const release2FinalControlPage = read(
  "src/pages/Release2FinalControlPage.jsx"
);
const release2FinalCss = read("src/styles/release2Final.css");
const expandedWorkerPage = read(
  "src/pages/ExpandedWorkerProfilePage.jsx"
);
const expandedWorkerCss = read(
  "src/styles/expandedWorkerProfile.css"
);
const workerHrLettersPanel = read(
  "src/components/WorkerHrLettersPanel.jsx"
);
const workerHrLettersCss = read(
  "src/styles/workerHrLetters.css"
);

assert.match(indexHtml, /Chalin 03 Group Operations Platform/);
assert.doesNotMatch(indexHtml, /https:\/\/chalin03\.com/);
assert.match(app, /SystemOperationsPage/);
assert.match(app, /system-operations/);
assert.match(app, /PermissionRoute/);
assert.match(app, /MINING_SECTION_PERMISSIONS/);
assert.match(app, /HIRE_SECTION_PERMISSIONS/);
assert.match(authContext, /effective_permissions/);
assert.match(authContext, /hasPermission/);
assert.match(authContext, /workspaceRole/);
assert.match(authContext, /\/auth\/logout/);
assert.match(axiosClient, /SESSION_REPLACED/);
assert.match(axiosClient, /isOwnerRecoveryRequest/);
assert.match(axiosClient, /\/owner-recovery/);
assert.match(loginPage, /chalin03_login_notice/);
assert.match(loginPage, /\/auth\/recovery\/request-otp/);
assert.match(loginPage, /\/auth\/recovery\/reset-password/);
assert.match(loginPage, /Forgot Password \/ Unlock Account/);
assert.match(loginPage, /6-Digit Recovery Code/);
assert.match(loginPage, /Owner Break-Glass/);
assert.match(usersSettingsPage, /Only the original System Administrator can unlock or reset user accounts/);
assert.match(usersSettingsPage, /Account Locked/);
assert.match(usersSettingsPage, /Unlock & Reset/);
assert.match(workspaceAdministrationPage, /canResetAccounts/);
assert.match(workspaceAdministrationPage, /Account locked/);
assert.match(workspaceAdministrationPage, /Unlock & reset/);
assert.match(workspaceAdministrationPage, /minLength=\{8\}/);
assert.match(newSale, /QUALITY PARTS. RELIABLE SERVICE. BUILT ON TRUST./);
assert.match(salesHistory, /QUALITY PARTS. RELIABLE SERVICE. BUILT ON TRUST./);
assert.match(productsPage, /\/products\/\$\{restockProduct\.id\}\/restock/);
assert.match(productsPage, /Receive \/ Restock/);
assert.match(productsPage, /Adjust \/ Correct/);
assert.match(productsPage, /delete productData\.quantity/);
assert.match(smsPage, /accepted: "Sent"/);
assert.match(smsPage, /failed: "Not sent"/);
assert.match(smsPage, /Delivery unknown/);
assert.match(smsPage, /Clear SMS History/);
assert.match(smsPage, /View Archived/);
assert.match(smsPage, /Restore Archived History/);
assert.match(smsPage, /Permanently Delete Archived SMS/);
assert.match(smsPage, /\/sms\/logs\/archive/);
assert.match(smsPage, /\/sms\/logs\/restore/);
assert.match(smsPage, /\/sms\/logs\/delete-archived/);
assert.doesNotMatch(smsPage, /"Updates automatically"/);
assert.match(app, /OwnerRecoveryPage/);
assert.match(app, /Release2FinalControlPage/);
assert.match(app, /owner-recovery/);
assert.match(app, /security-centre/);
assert.match(app, /professional-backups/);
assert.match(app, /executive\.operations\.view/);
assert.match(ownerRecoveryPage, /Owner Break-Glass Recovery/);
assert.match(ownerRecoveryPage, /reset-system-admin/);
assert.match(release2FinalControlPage, /Protected Action Unlock/);
assert.match(release2FinalControlPage, /Professional Backup Centre/);
assert.match(release2FinalControlPage, /Worker Profile Foundation/);
assert.match(release2FinalControlPage, /Executive Security, Backup &/);
assert.match(release2FinalControlPage, /X-Protected-Action-Token/);
assert.match(release2FinalControlPage, /Release 2 Final does not perform/);
assert.match(release2FinalCss, /\.r2-owner-page/);
assert.match(release2FinalCss, /\.r2-worker-shell/);
assert.match(release2FinalControlPage, /ExpandedWorkerProfilePage/);
assert.match(expandedWorkerPage, /Upload Photo/);
assert.match(expandedWorkerPage, /Personal & National ID/);
assert.match(expandedWorkerPage, /Letters & HR Correspondence/);
assert.match(expandedWorkerPage, /WorkerHrLettersPanel/);
assert.match(expandedWorkerPage, /Family & Emergency/);
assert.match(expandedWorkerPage, /GhanaPost digital address/);
assert.match(expandedWorkerPage, /SSNIT number/);
assert.match(expandedWorkerPage, /Private Worker Document/);
assert.match(expandedWorkerPage, /X-Protected-Action-Token/);
assert.match(expandedWorkerPage, /Print Full Profile/);
assert.match(expandedWorkerPage, /Exact Card Size/);
assert.match(expandedWorkerPage, /A4 Print Sheet/);
assert.match(expandedWorkerPage, /id-card-pdf\?layout=card/);
assert.match(expandedWorkerPage, /id-card-pdf\?layout=a4/);
assert.match(expandedWorkerCss, /\.worker-print-pack-actions/);
assert.match(expandedWorkerCss, /\.worker-print-choice-overlay/);
assert.match(expandedWorkerCss, /\.expanded-worker-layout/);
assert.match(expandedWorkerCss, /\.worker-profile-tabs/);
assert.match(workerHrLettersPanel, /Employment Letters and HR Correspondence/);
assert.match(workerHrLettersPanel, /Save Draft Letter/);
assert.match(workerHrLettersPanel, /Record Worker Signature \/ Receipt/);
assert.match(workerHrLettersPanel, /Authorised boss \/ signatory name/);
assert.match(workerHrLettersCss, /\.worker-hr-card/);

console.log("PASS - frontend static source checks completed.");
