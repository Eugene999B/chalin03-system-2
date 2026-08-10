import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const page = read("src/pages/InventoryTraceabilityPage.jsx");
const app = read("src/App.jsx");
const layout = read("src/components/Layout.jsx");
const styles = read("src/styles/inventoryTraceability.css");

assert.match(page, /Inventory Control & Traceability/);
assert.match(page, /Inventory Loss Prevention/);
assert.match(page, /Sales enforcement is not active yet/);
assert.match(page, /traceability_state:\s*config\.tracking_mode === "quantity" \? "off" : "setup"/s);
assert.doesNotMatch(page, /traceability_state:\s*"enforced"/);
assert.match(page, /Where is this item\?/);
assert.match(page, /\/inventory-traceability\/scan\/verify/);
assert.match(page, /A4 sheet — many labels/);
assert.match(page, /58mm thermal/);
assert.match(page, /50×30mm sticker/);
assert.match(page, /Admin Reprint/);
assert.match(page, /physically verified this batch/i);
assert.match(page, /permanently voided/i);
assert.match(page, /Managers who generated or printed the batch cannot verify their own work/);

assert.match(app, /InventoryTraceabilityPage/);
assert.match(app, /path="inventory-traceability"/);
assert.match(layout, /title: "Inventory Control & Traceability"/);
assert.match(layout, /path: "\/inventory-traceability"/);

assert.match(styles, /\.traceability-page/);
assert.match(styles, /\.traceability-unit-grid/);
assert.match(styles, /@media \(max-width: 520px\)/);

console.log("Inventory Traceability frontend foundation contract passed.");
