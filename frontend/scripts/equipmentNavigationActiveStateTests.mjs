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
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");
const fleetPage = read("src/pages/FleetAssetsPage.jsx");
const app = read("src/App.jsx");

assert.match(layout, /useLocation/);
assert.match(layout, /function isNavigationItemActive/);
assert.match(layout, /if \(!item\.matchSearch\) return true/);
assert.match(layout, /currentSearch === target\.search/);
assert.match(layout, /aria-current=\{active \? "page" : undefined\}/);

assert.match(
  equipmentLayout,
  /title: "Maintenance Register"[\s\S]*?fleet\?view=maintenance[\s\S]*?matchSearch: true/
);
assert.match(equipmentLayout, /path: "\/equipment-hire-operations\/fleet"/);
assert.match(equipmentLayout, /path: "\/equipment-installment-finance"/);
assert.doesNotMatch(equipmentLayout, /fleet\?view=sales/);
assert.doesNotMatch(equipmentLayout, /fleet\?view=reports/);
assert.doesNotMatch(equipmentLayout, /fleet\?view=installments/);

assert.match(financeLayout, /path: "\/equipment-installment-finance"/);
assert.match(financeLayout, /path: "\/equipment-installment-finance\/applications"/);
assert.match(financeLayout, /path: "\/equipment-installment-finance\/reports"/);
assert.match(financeLayout, /path: "\/equipment-installment-finance\/catalogue"/);
assert.match(app, /path="\/equipment-installment-finance"/);

assert.match(fleetPage, /view === "installments"/);
assert.match(fleetPage, /view === "sales"/);
assert.match(fleetPage, /view === "reports"/);
assert.match(fleetPage, /view === "maintenance"/);
assert.match(fleetPage, /return <SharedFleetAssetsPage \/>/);
assert.match(fleetPage, /Navigate to="\/equipment-installment-finance/);

console.log("Equipment Hire and Installment Finance navigation contracts passed.");
