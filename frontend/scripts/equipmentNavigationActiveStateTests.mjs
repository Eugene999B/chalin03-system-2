import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const layout = read("src/components/BusinessWorkspaceLayout.jsx");
const equipmentLayout = read("src/layouts/EquipmentHireLayout.jsx");
const fleetPage = read("src/pages/FleetAssetsPage.jsx");

assert.match(layout, /useLocation/);
assert.match(layout, /function isNavigationItemActive/);
assert.match(layout, /if \(!item\.matchSearch\) return true/);
assert.match(layout, /currentSearch === target\.search/);
assert.match(layout, /aria-current=\{active \? "page" : undefined\}/);

for (const view of ["sales", "reports", "maintenance"]) {
  assert.match(
    equipmentLayout,
    new RegExp(`fleet\\?view=${view}`),
    `${view} must have its own fleet view`
  );
}

assert.match(equipmentLayout, /title: "Equipment Catalogue"[\s\S]*?matchSearch: true/);
assert.match(equipmentLayout, /title: "Sales & Installments"[\s\S]*?matchSearch: true/);
assert.match(equipmentLayout, /title: "Sales Documents & Reports"[\s\S]*?matchSearch: true/);
assert.match(equipmentLayout, /title: "Maintenance Register"[\s\S]*?matchSearch: true/);
assert.match(fleetPage, /view === "maintenance"/);
assert.match(fleetPage, /return <SharedFleetAssetsPage \/>/);

console.log("Equipment navigation active-state contracts passed.");
