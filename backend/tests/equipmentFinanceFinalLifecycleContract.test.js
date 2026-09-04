const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const routes = read("backend", "routes", "equipmentFinanceFinalLifecycleRoutes.js");
const page = read("frontend", "src", "pages", "EquipmentFinanceFinalLifecyclePage.jsx");
const collections = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceCollectionsMinimalPage.jsx"
);
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

test("minimal collections is separate while delivery and ownership remain advanced", () => {
  assert.match(workspace, /stage === "collections"/);
  assert.match(workspace, /EquipmentFinanceCollectionsMinimalPage/);
  assert.match(workspace, /FINAL_LIFECYCLE_STAGES/);
  assert.match(workspace, /"delivery", "ownership"/);
  assert.match(workspace, /EquipmentFinanceFinalLifecyclePage/);
  assert.match(collections, /Collections &amp; Payment History/);
  assert.match(collections, /account-detail-official-balance/);
  assert.match(collections, /payment-history/);
  assert.match(page, /delivery/i);
  assert.match(page, /ownership/i);
});

test("machine evidence and money remain complete on phone layouts", () => {
  assert.match(excavators, /finance-simple__machine-image/);
  assert.match(excavators, /finance-simple__photo-viewer/);
  assert.match(styles, /object-fit:\s*contain/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /white-space:\s*normal/);
  assert.match(styles, /@media \(max-width: 720px\)/);
});

test("Finance lifecycle never requires a Hire-location selector", () => {
  assert.doesNotMatch(page, /selectedHireLocationId|requireHireLocationScope|Choose a Hire location/);
  assert.doesNotMatch(collections, /selectedHireLocationId|requireHireLocationScope|Choose a Hire location/);
  assert.doesNotMatch(workspace, /EquipmentHireOperationsPage/);
});
