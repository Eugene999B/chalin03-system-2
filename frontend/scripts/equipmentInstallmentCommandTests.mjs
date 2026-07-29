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

const page = readFrontend("src", "pages", "EquipmentInstallmentCommandPage.jsx");
const css = readFrontend("src", "styles", "equipmentInstallmentCommand.css");
const app = readFrontend("src", "App.jsx");
const fleetPage = readFrontend("src", "pages", "FleetAssetsPage.jsx");
const hireLayout = readFrontend("src", "layouts", "EquipmentHireLayout.jsx");
const financeLayout = readFrontend("src", "layouts", "InstallmentFinanceLayout.jsx");
const workspaceLayout = readFrontend(
  "src",
  "components",
  "BusinessWorkspaceLayout.jsx"
);
const serviceWorker = readFrontend("public", "sw.js");
const route = readProject("backend", "routes", "equipmentInstallmentCommandRoutes.js");
const service = readProject(
  "backend",
  "services",
  "equipmentInstallmentCommandService.js"
);
const readModel = readProject(
  "backend",
  "services",
  "equipmentInstallmentReadModelService.js"
);

for (const text of [
  "Installment Command Centre",
  "Portfolio Aging",
  "Expected Collections",
  "Collections Work Queue",
  "Reminder Control &amp; Evidence",
  "Customer Protection &amp; SMS Cost Control",
  "Record Follow-Up",
  "Send SMS Reminder",
  "WhatsApp Reminder",
  "approved Meta Business API",
]) {
  assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(page, /portfolio_at_risk_rate/);
assert.match(page, /risk_score/);
assert.match(page, /promise_date/);
assert.match(page, /RUN INSTALLMENT REMINDERS/);
assert.match(page, /en-GB/);
assert.match(page, /GHS/);
assert.match(page, /manual_whatsapp_enabled/);
assert.match(page, /maximum_hours_between_sms|minimum_hours_between_sms/);
assert.match(page, /max_messages_per_run/);

assert.match(app, /InstallmentFinanceLayout/);
assert.match(app, /path="\/equipment-installment-finance"/);
assert.match(app, /EquipmentInstallmentCommandPage/);
assert.match(app, /EquipmentSalesWorkspacePage/);
assert.match(app, /EquipmentSalesReportsPage/);
assert.match(app, /allowedWorkspaces=\{EQUIPMENT_HIRE_WORKSPACE\}/);
assert.doesNotMatch(app, /const INSTALLMENT_WORKSPACE/);

assert.match(financeLayout, /Equipment Installment Finance/);
assert.match(financeLayout, /Independent finance division/);
assert.match(financeLayout, /Separated from Equipment Hire operations/);
assert.match(financeLayout, /Finance Command Centre/);
assert.match(financeLayout, /Credit Applications & Approval/);
assert.match(financeLayout, /Installment Documents & Reports/);
assert.match(financeLayout, /Open Equipment Hire Operations/);
assert.match(financeLayout, /workspaceCode="equipment_hire"/);

assert.match(hireLayout, /Equipment Hire Operations/);
assert.match(hireLayout, /Independent Hire division/);
assert.match(hireLayout, /Separated from Installment Finance/);
assert.match(hireLayout, /Open Equipment Installment Finance/);
assert.doesNotMatch(hireLayout, /title: "Installment Command Centre"/);
assert.doesNotMatch(hireLayout, /title: "Sales & Installments"/);
assert.doesNotMatch(hireLayout, /title: "Sales Documents & Reports"/);

assert.match(fleetPage, /Navigate/);
assert.match(fleetPage, /view === "installments"/);
assert.match(fleetPage, /to="\/equipment-installment-finance"/);
assert.match(fleetPage, /to="\/equipment-installment-finance\/applications"/);
assert.match(fleetPage, /to="\/equipment-installment-finance\/reports"/);
assert.doesNotMatch(fleetPage, /<EquipmentInstallmentCommandPage/);

assert.match(workspaceLayout, /independenceLabel = "Independent workspace"/);
assert.match(workspaceLayout, /contextHeading = "Active operating context"/);
assert.match(workspaceLayout, /separationBadge = "Separated from Spare Parts"/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /installment-command__account-grid/);
assert.match(css, /installment-command__backdrop/);
assert.match(serviceWorker, /chalin03-installment-runtime-stability-v18/);
assert.match(serviceWorker, /cacheCoreAssets/);
assert.match(serviceWorker, /networkNavigation/);
assert.doesNotMatch(serviceWorker, /status:\s*503/);

assert.match(route, /\/portfolio/);
assert.match(route, /\/collections/);
assert.match(route, /equipmentInstallmentReadModelService/);
assert.match(route, /follow-ups/);
assert.match(route, /reminders\/preview/);
assert.match(readModel, /resilient_read_model/);
assert.match(readModel, /information_schema\.COLUMNS/);
assert.match(readModel, /optional_evidence_deferred/);
assert.doesNotMatch(readModel, /UPDATE equipment_sale_agreements/);
assert.match(service, /portfolio_at_risk_rate/);
assert.match(service, /EQUIPMENT_INSTALLMENT_FOLLOW_UP_RECORDED/);
assert.match(service, /automatic_sms_enabled: false/);
assert.match(service, /GET_LOCK/);
assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE TABLE/i);

console.log("Equipment Installment Finance runtime stability contract passed.");
