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
const loginEntry = read("src/pages/LoginPage.jsx");
const loginPage = read("src/pages/LoginPageGroupOperations.jsx");
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
assert.match(axiosClient, /chalin03_login_notice/);
assert.match(loginEntry, /LoginPageGroupOperations/);
assert.match(loginEntry, /openEmergencyCommand/);
assert.match(loginPage, /\/auth\/recovery\/request-otp/);
assert.match(loginPage, /\/auth\/recovery\/reset-password/);
assert.match(loginPage, /Recover password/);
assert.match(loginPage, /6-digit code/);
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
assert.match(ownerRecoveryPage, /Owner Break-Glass Recovery/);
assert.match(ownerRecoveryPage, /X-Owner-Recovery-Token/);
assert.match(ownerRecoveryPage, /Use emergency recovery code/);
assert.match(release2FinalControlPage, /Release 2 Final Control/);
assert.match(release2FinalCss, /\.release2-final-control/);
assert.match(expandedWorkerPage, /Expanded Worker Profile/);
assert.match(expandedWorkerCss, /\.expanded-worker-profile/);
assert.match(workerHrLettersPanel, /Worker HR Letters/);
assert.match(workerHrLettersCss, /\.worker-hr-letters/);

console.log("Frontend source verification passed.");
