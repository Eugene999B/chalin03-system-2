const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const professionalRoutes = read("backend", "routes", "equipmentFinanceProfessionalRoutes.js");
const machineRoutes = read("backend", "routes", "equipmentFinanceMachineRegisterRoutes.js");
const layout = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const excavators = read("frontend", "src", "pages", "EquipmentFinanceExcavatorsPage.jsx");
const guide = read("frontend", "src", "pages", "EquipmentFinanceGuidePage.jsx");

test("professional backend keeps settings, documents, reminders and machine evidence", () => {
  assert.match(professionalRoutes, /settings/i);
  assert.match(professionalRoutes, /documents/i);
  assert.match(professionalRoutes, /reminder/i);
  assert.match(professionalRoutes, /requirePermission/);
  assert.match(machineRoutes, /machine-register/);
  assert.match(machineRoutes, /asset_media|media/i);
  assert.match(machineRoutes, /assertMachineStillEditable/);
});

test("professional Finance is exposed through simple daily navigation", () => {
  for (const title of [
    "Finance Home",
    "Start New Installment",
    "Customers",
    "Excavators",
    "Applications & Approvals",
    "Active Installments",
    "Payments & Arrears",
    "Documents & Reports",
    "Finance Settings",
    "Help & Guide",
  ]) {
    assert.match(layout, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(workspace, /PROFESSIONAL_STAGES/);
  assert.match(workspace, /"settings", "documents", "staff"/);
});

test("one excavator page provides full evidence and safe editing", () => {
  assert.match(excavators, /Excavator Register/);
  assert.match(excavators, /Edit excavator|Edit details/i);
  assert.match(excavators, /objectFit:\s*"contain"|object-fit:\s*contain/);
  assert.match(excavators, /serial_number/);
  assert.match(excavators, /chassis_number/);
  assert.match(excavators, /engine_number/);
  assert.doesNotMatch(layout, /Finance Equipment Reference/);
});

test("dedicated guide teaches the complete installment journey", () => {
  assert.match(guide, /What should I do first/i);
  assert.match(guide, /Installment Offer/);
  assert.match(guide, /KYC|guarantor/);
  assert.match(guide, /deposit|reservation/i);
  assert.match(guide, /arrears|late payment/i);
  assert.match(guide, /delivery/i);
  assert.match(guide, /ownership/i);
});
