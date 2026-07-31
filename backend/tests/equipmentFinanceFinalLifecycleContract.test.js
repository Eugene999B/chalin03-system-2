const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const routes = read("backend", "routes", "equipmentFinanceFinalLifecycleRoutes.js");
const page = read("frontend", "src", "pages", "EquipmentFinanceFinalLifecyclePage.jsx");
const workspace = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");
const excavators = read("frontend", "src", "pages", "EquipmentFinanceExcavatorsPage.jsx");
const styles = read("frontend", "src", "styles", "equipmentFinancePhaseOne.css");

test("final lifecycle keeps controlled collections, delivery and ownership APIs", () => {
  assert.match(routes, /collections|payments/i);
  assert.match(routes, /delivery/i);
  assert.match(routes, /ownership/i);
  assert.match(routes, /requirePermission/);
  assert.match(routes, /FOR UPDATE/);
  assert.match(routes, /writeAuditEvent/);
});

test("professional lifecycle stages remain reachable inside simplified account work", () => {
  assert.match(workspace, /FINAL_LIFECYCLE_STAGES/);
  assert.match(workspace, /"collections", "delivery", "ownership"/);
  assert.match(workspace, /EquipmentFinanceFinalLifecyclePage/);
  assert.match(page, /collection|payment/i);
  assert.match(page, /delivery/i);
  assert.match(page, /ownership/i);
});

test("machine evidence and money remain complete on phone layouts", () => {
  assert.match(excavators, /objectFit:\s*"contain"|object-fit:\s*contain/);
  assert.match(styles, /object-fit:\s*contain/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /white-space:\s*normal/);
  assert.match(styles, /@media \(max-width: 620px\)/);
});

test("Finance lifecycle never requires a Hire-location selector", () => {
  assert.doesNotMatch(page, /selectedHireLocationId|requireHireLocationScope|Choose a Hire location/);
  assert.doesNotMatch(workspace, /EquipmentHireOperationsPage/);
});
