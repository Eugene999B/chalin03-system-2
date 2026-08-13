import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const studio = read("src/components/InventoryLabelStudio.jsx");
const setup = read("src/pages/InventoryTraceabilitySetupPage.jsx");
const styles = read("src/styles/inventoryLabelStudioSimple.css");

assert.match(studio, /identity-studio\/units/);
assert.match(studio, /identity-studio\/print-selected/);
assert.match(studio, /identity-studio\/export-selected/);
assert.match(studio, /identity-studio\/confirm-selected/);
assert.match(studio, /Print All IDs Needing Labels/);
assert.match(studio, /Choose Specific IDs/);
assert.match(studio, /50×30 mm Sticker/);
assert.match(studio, /A4 Sheet/);
assert.match(studio, /58 mm Thermal/);
assert.match(studio, /40×25 mm Compact/);
assert.match(studio, /Standard/);
assert.match(studio, /Simple/);
assert.match(studio, /Detailed/);
assert.match(studio, /Print \/ Download Labels PDF/);
assert.match(studio, /Excel ID Register \(\.xlsx\)/);
assert.match(studio, /CSV ID Register \(\.csv\)/);
assert.match(studio, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
assert.match(studio, /makeInventoryWorkbook/);
assert.match(studio, /reprintCount > 0 && \(!isAdmin \|\| reason\.trim\(\)\.length < 8\)/);
assert.match(studio, /signed QR/);
assert.match(studio, /Confirm .*Attached/);

assert.match(setup, /Start with the product you already created/);
assert.match(setup, /automaticProductPrefix/);
assert.match(setup, /Prepare .* IDs for Current Stock/);
assert.match(setup, /source_type: "opening_reconciliation"/);
assert.match(setup, /Supplier Receiving tab/);
assert.match(setup, /Advanced settings & exact-ID lookup/);
assert.match(setup, /Automatic product prefix/);
assert.match(setup, /<InventoryLabelStudio/);
assert.doesNotMatch(setup, /placeholder="SO4L"/);

assert.match(styles, /\.simple-label-studio/);
assert.match(styles, /\.simple-traceability-start/);

console.log("Simplified Inventory Label Studio frontend contracts passed.");
