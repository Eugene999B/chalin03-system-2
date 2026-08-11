import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const hub = read("src/pages/InventoryTraceabilityPage.jsx");
const setupPage = read("src/pages/InventoryTraceabilitySetupPage.jsx");
const lossPage = read("src/pages/InventoryLossControlPage.jsx");
const blindScanner = read("src/components/InventoryBlindCountScanner.jsx");
const app = read("src/App.jsx");
const layout = read("src/components/Layout.jsx");
const styles = read("src/styles/inventoryTraceability.css");
const lossStyles = read("src/styles/inventoryLossControl.css");
const hubStyles = read("src/styles/inventoryTraceabilityHub.css");

assert.match(hub, /Setup & Labels/);
assert.match(hub, /Blind Counts & Investigations/);
assert.match(hub, /InventoryTraceabilitySetupPage/);
assert.match(hub, /InventoryLossControlPage/);

assert.match(setupPage, /Inventory Control & Traceability/);
assert.match(setupPage, /Inventory Loss Prevention/);
assert.match(setupPage, /Sales enforcement is not active yet/);
assert.match(setupPage, /traceability_state:\s*config\.tracking_mode === "quantity" \? "off" : "setup"/s);
assert.doesNotMatch(setupPage, /traceability_state:\s*"enforced"/);
assert.match(setupPage, /Where is this item\?/);
assert.match(setupPage, /\/inventory-traceability\/scan\/verify/);
assert.match(setupPage, /A4 sheet — many labels/);
assert.match(setupPage, /58mm thermal/);
assert.match(setupPage, /50×30mm sticker/);
assert.match(setupPage, /Admin Reprint/);
assert.match(setupPage, /physically verified this batch/i);
assert.match(setupPage, /permanently voided/i);
assert.match(setupPage, /Managers who generated or printed the batch cannot verify their own work/);

assert.match(lossPage, /Blind Counts & Investigations/);
assert.match(lossPage, /Evidence, not accusation/);
assert.match(lossPage, /blind_expected_values_hidden/);
assert.match(lossPage, /Physical count \(0 allowed\)/);
assert.match(lossPage, /\/inventory-traceability\/loss-control\/counts/);
assert.match(lossPage, /\/inventory-traceability\/loss-control\/investigations/);
assert.match(lossPage, /Only an administrator can classify an investigation as confirmed loss/);
assert.match(blindScanner, /Expected IDs hidden/);
assert.match(blindScanner, /unit-observations/);
assert.match(blindScanner, /duplicates are preserved as evidence/i);

assert.match(app, /InventoryTraceabilityPage/);
assert.match(app, /path="inventory-traceability"/);
assert.match(layout, /title: "Inventory Control & Traceability"/);
assert.match(layout, /path: "\/inventory-traceability"/);

assert.match(styles, /\.traceability-page/);
assert.match(styles, /\.traceability-unit-grid/);
assert.match(styles, /@media \(max-width: 520px\)/);
assert.match(lossStyles, /\.inventory-loss-control/);
assert.match(lossStyles, /\.inventory-loss-control__investigations/);
assert.match(hubStyles, /\.inventory-traceability-hub__tabs/);

console.log("Inventory Traceability + Loss Control frontend contract passed.");
