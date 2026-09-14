import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const projectRoot = path.resolve(frontendRoot, "..");
const readFrontend = (...parts) =>
  fs.readFileSync(path.join(frontendRoot, ...parts), "utf8");
const readProject = (...parts) =>
  fs.readFileSync(path.join(projectRoot, ...parts), "utf8");

const page = readFrontend("src", "pages", "EquipmentFinanceRecoveryGovernancePage.jsx");
const css = readFrontend("src", "styles", "equipmentFinanceRecoveryGovernance.css");
const dispatcher = readFrontend("src", "pages", "EquipmentSalesWorkspacePage.jsx");
const layout = readFrontend("src", "layouts", "InstallmentFinanceLayout.jsx");
const commandRoutes = readProject("backend", "routes", "equipmentInstallmentCommandRoutes.js");
const governanceRoutes = readProject("backend", "routes", "equipmentFinanceRecoveryGovernanceRoutes.js");
const governanceService = readProject("backend", "services", "equipmentFinanceRecoveryGovernanceService.js");
const serviceWorker = readFrontend("public", "sw.js");

for (const text of [
  "Rescheduling, Default & Recovery Governance",
  "Pending reschedules",
  "Pending defaults",
  "Eligible for default review",
  "Defaulted accounts",
  "Recovery follow-up due",
  "Prepare reschedule request",
  "Replacement plan preview",
  "Prepare default review",
  "Independent decision reason",
  "Record recovery action",
  "No Hire location selection",
  "No automatic SMS or WhatsApp",
  "different Finance Manager",
  "does not execute repossession",
]) {
  assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

for (const endpoint of [
  "reschedule-requests",
  "default-requests",
  "requests/${requestId}/decisions",
  "recovery-actions",
]) {
  assert.match(page, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(page, /equipmentWorkspaceRole/);
assert.match(page, /isEquipmentAdministrator/);
assert.match(page, /finance_manager/);
assert.match(page, /collections_officer/);
assert.match(page, /credit_officer/);
assert.match(page, /response\.data/);
assert.doesNotMatch(page, /\/equipment-hire|\/hire-commercial/);
assert.doesNotMatch(page, /sendSms|automatic_sms_enabled|WhatsApp Reminder/);

assert.match(dispatcher, /EquipmentFinanceRecoveryGovernancePage/);
assert.match(dispatcher, /stage === "governance"/);
assert.match(layout, /title: "Payments & Arrears"/);
assert.match(layout, /stage=arrears/);
assert.doesNotMatch(layout, /stage=governance/);
assert.match(layout, /Company-wide Finance portfolio/);

assert.match(commandRoutes, /equipmentFinanceRecoveryGovernanceRoutes/);
assert.match(commandRoutes, /router\.use\("\/governance"/);
assert.match(governanceRoutes, /requirePermission\("fleet\.assets\.manage"\)/);
assert.match(governanceRoutes, /APPROVAL_ROLES/);
assert.match(governanceService, /independent_approval_required: true/);
assert.match(governanceService, /schedule_status = 'rescheduled'/);
assert.match(governanceService, /agreement_status = 'defaulted'/);
assert.match(governanceService, /automatic_sms_sent: false/);
assert.doesNotMatch(governanceService, /DELETE FROM equipment_installment_schedule/);
assert.doesNotMatch(governanceService, /INSERT INTO equipment_sale_payments/);

for (const breakpoint of [1320, 960, 700, 440]) {
  assert.match(css, new RegExp(`@media \\(max-width: ${breakpoint}px\\)`));
}
assert.match(css, /finance-governance__backdrop/);
assert.match(css, /finance-governance__drawer/);
assert.match(css, /finance-governance__metrics/);
assert.match(css, /finance-governance__timeline/);
assert.match(css, /finance-governance__form-grid/);
assert.match(css, /finance-governance__table-wrap/);
assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  serviceWorker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /networkBuildAsset\(request\)/);
assert.match(serviceWorker, /CHALIN03_ASSET_MISMATCH/);
assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);

console.log("Finance rescheduling, default and recovery governance contract passed.");
