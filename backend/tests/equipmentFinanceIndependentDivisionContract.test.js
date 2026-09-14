const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = read("frontend", "src", "App.jsx");
const layout = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const phaseOneRoutes = read("backend", "routes", "equipmentFinancePhaseOneRoutes.js");
const divisionAccess = read("frontend", "src", "security", "equipmentDivisionAccess.js");

test("Finance keeps its own protected company-wide route tree", () => {
  assert.match(app, /path="\/equipment-installment-finance"/);
  assert.match(app, /InstallmentFinanceLayout/);
  assert.match(app, /EquipmentSalesWorkspacePage/);
  assert.match(layout, /workspaceCode="equipment_installment_finance"/);
  assert.match(layout, /company-wide Finance portfolio/i);
});

test("Finance navigation cannot open Hire jobs, contracts or location administration", () => {
  assert.match(layout, /No access to Hire jobs or contracts/);
  assert.doesNotMatch(layout, /Open Equipment Hire Operations/);
  assert.doesNotMatch(layout, /Hire Enquiries|Hire Contracts|Dispatch|Returns/);
  assert.doesNotMatch(workspace, /EquipmentHireOperationsPage|HireCommercialControlPage/);
});

test("Finance start and customer APIs do not accept Hire location context", () => {
  assert.match(phaseOneRoutes, /hire_location_selection_required:\s*false/);
  assert.match(phaseOneRoutes, /scope:\s*"company_wide"/);
  assert.doesNotMatch(phaseOneRoutes, /selectedHireLocationId|requireHireLocationScope/);
});

test("role families still enforce Hire, Finance and approved dual access", () => {
  assert.match(divisionAccess, /HIRE_WORKSPACE_ROLES/);
  assert.match(divisionAccess, /FINANCE_WORKSPACE_ROLES/);
  assert.match(divisionAccess, /DUAL_DIVISION_ROLES/);
  assert.match(divisionAccess, /canAccessEquipmentDivision/);
});

test("every simplified Finance item points to an explicit Finance route", () => {
  for (const route of [
    "/equipment-installment-finance",
    "/equipment-installment-finance/applications",
    "/equipment-installment-finance/reports",
    "/equipment-installment-finance/change-password",
  ]) {
    assert.match(app, new RegExp(`path=\\"${route.replace("/equipment-installment-finance/", "").replace("/equipment-installment-finance", "")}\\"|path=\\"\\/equipment-installment-finance\\"`));
  }
  assert.match(layout, /Start New Installment/);
  assert.match(layout, /Customers/);
  assert.match(layout, /Excavators/);
  assert.match(layout, /Applications & Approvals/);
});
