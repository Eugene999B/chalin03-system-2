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
const fleetPage = readFrontend("src", "pages", "FleetAssetsPage.jsx");
const layout = readFrontend("src", "layouts", "EquipmentHireLayout.jsx");
const serviceWorker = readFrontend("public", "sw.js");
const route = readProject("backend", "routes", "equipmentInstallmentCommandRoutes.js");
const service = readProject(
  "backend",
  "services",
  "equipmentInstallmentCommandService.js"
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

assert.match(fleetPage, /EquipmentInstallmentCommandPage/);
assert.match(fleetPage, /view === "installments"/);
assert.match(layout, /Installment Command Centre/);
assert.match(layout, /fleet\?view=installments/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /installment-command__account-grid/);
assert.match(css, /installment-command__backdrop/);
assert.match(serviceWorker, /chalin03-installment-command-centre-v16/);

assert.match(route, /\/portfolio/);
assert.match(route, /\/collections/);
assert.match(route, /follow-ups/);
assert.match(route, /reminders\/preview/);
assert.match(service, /portfolio_at_risk_rate/);
assert.match(service, /EQUIPMENT_INSTALLMENT_FOLLOW_UP_RECORDED/);
assert.match(service, /automatic_sms_enabled: false/);
assert.match(service, /GET_LOCK/);
assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE TABLE/i);

console.log("Equipment Installment Command Centre source contract passed.");
