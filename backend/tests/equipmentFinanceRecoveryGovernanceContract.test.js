const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const routes = read("backend", "routes", "equipmentFinanceRecoveryGovernanceRoutes.js");
const service = read("backend", "services", "equipmentFinanceRecoveryGovernanceService.js");
const page = read("frontend", "src", "pages", "EquipmentFinanceRecoveryGovernancePage.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const layout = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");

test("recovery governance remains permission controlled and audited", () => {
  assert.match(routes, /requirePermission/);
  assert.match(routes, /REQUEST_ROLES/);
  assert.match(routes, /RECOVERY_ROLES/);
  assert.match(routes, /APPROVAL_ROLES/);
  assert.match(routes, /reschedul|default|recover/i);
  assert.match(service, /writeAuditEvent/);
  assert.match(service, /FOR UPDATE/);
});

test("governance remains reachable inside Finance account work", () => {
  assert.match(workspace, /EquipmentFinanceRecoveryGovernancePage/);
  assert.match(workspace, /stage === "governance"/);
  assert.match(layout, /Payments & Arrears/);
  assert.match(page, /reschedul|default|recover/i);
  assert.match(page, /axiosClient/);
});

test("recovery governance stays outside Hire operations", () => {
  assert.doesNotMatch(page, /selectedHireLocationId|requireHireLocationScope|Choose a Hire location/);
  assert.doesNotMatch(layout, /Open Equipment Hire Operations/);
  assert.match(layout, /No access to Hire jobs or contracts/);
});
