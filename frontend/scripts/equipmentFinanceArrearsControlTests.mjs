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

const page = readFrontend("src", "pages", "EquipmentFinanceArrearsPage.jsx");
const css = readFrontend("src", "styles", "equipmentFinanceArrears.css");
const dispatcher = readFrontend("src", "pages", "EquipmentSalesWorkspacePage.jsx");
const layout = readFrontend("src", "layouts", "InstallmentFinanceLayout.jsx");
const route = readProject("backend", "routes", "equipmentInstallmentCommandRoutes.js");
const service = readProject("backend", "services", "equipmentFinanceArrearsService.js");

for (const text of [
  "Arrears & Collections Control",
  "Due today",
  "Overdue",
  "Broken promises",
  "Follow-up due",
  "Never contacted",
  "High risk",
  "Promise date",
  "Promise amount",
  "Next action date",
  "Download statement",
  "Download overdue notice",
  "Correct this evidence",
  "Record append-only correction",
  "The original record remains preserved",
]) {
  assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(page, /equipment-catalogue\/sales\/installment-command/);
assert.match(page, /\$\{API\}\/collections/);
assert.match(page, /\/follow-ups\/\$\{correction\.id\}\/corrections/);
assert.match(page, /responseType: "blob"/);
assert.match(page, /documents\/\$\{type\}\.pdf/);
assert.match(page, /fleet\.assets\.manage/);
assert.match(page, /finance_manager/);
assert.match(page, /collections_officer/);
assert.doesNotMatch(page, /\/equipment-hire|\/hire-commercial/);
assert.doesNotMatch(page, /sendSms|WhatsApp Reminder|automatic_sms_enabled/);

assert.match(dispatcher, /EquipmentFinanceArrearsPage/);
assert.match(dispatcher, /stage === "arrears"/);
assert.match(layout, /title: "Payments & Arrears"/);
assert.match(layout, /stage=arrears/);
assert.match(layout, /Company-wide Finance portfolio/);
assert.doesNotMatch(layout, /Finance staff select Hire locations/);

assert.match(route, /listFinanceArrears/);
assert.match(route, /recordFinanceCollectionFollowUp/);
assert.match(route, /correctFinanceCollectionFollowUp/);
assert.match(service, /append_only_audit_evidence/);
assert.match(service, /financial_values_changed: false/);
assert.match(service, /automatic_sms_sent: false/);
assert.doesNotMatch(service, /UPDATE equipment_sale_agreements/);
assert.doesNotMatch(service, /INSERT INTO equipment_sale_payments/);

assert.match(css, /@media\(max-width:1320px\)/);
assert.match(css, /@media\(max-width:960px\)/);
assert.match(css, /@media\(max-width:700px\)/);
assert.match(css, /@media\(max-width:440px\)/);
assert.match(css, /finance-arrears__backdrop/);
assert.match(css, /finance-arrears__account-grid/);
assert.match(css, /finance-arrears__timeline/);

console.log("Finance arrears and collections control contract passed.");
