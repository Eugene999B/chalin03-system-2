import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const studio = read("src/components/InventoryLabelStudio.jsx");
const quick = read("src/components/InventoryQuickPrintAll.jsx");
const workspace = read("src/pages/InventoryAutomaticLabelsPage.jsx");
const hub = read("src/pages/InventoryTraceabilityPage.jsx");
const newSale = read("src/pages/NewSalePage.jsx");
const manualSale = read("src/pages/ManualNewSalePage.jsx");
const autoSale = read("src/pages/AutonomousSalePage.jsx");
const scanner = read("src/components/AutonomousSaleScanner.jsx");
const checkout = read("src/components/AutonomousSaleCheckoutForm.jsx");

assert.match(studio, /Choose Specific IDs/);
assert.match(studio, /Excel ID Register/);
assert.match(studio, /CSV ID Register/);
assert.match(studio, /identity-studio\/confirm-selected/);

assert.match(quick, /Print All .* Unprinted IDs/);
assert.match(quick, /50×30 mm Sticker — Recommended/);
assert.match(quick, /identity-studio\/print-selected/);
assert.match(quick, /confirm-selected/);

assert.match(workspace, /IDs follow your stock automatically/);
assert.match(workspace, /sync-automatic-identities/);
assert.match(workspace, /New stock = new ID/);
assert.match(workspace, /InventoryQuickPrintAll/);
assert.doesNotMatch(workspace, /Prepare .* IDs for Current Stock/);
assert.match(hub, /InventoryAutomaticLabelsPage/);
assert.match(hub, /Automatic IDs & Labels/);

assert.match(newSale, /Autonomous Scan — Recommended/);
assert.match(newSale, /Manual Sale/);
assert.match(newSale, /useState\("autonomous"\)/);
assert.match(manualSale, /InventoryUnitScanner/);
assert.match(manualSale, /installmentPlan/);
assert.match(scanner, /sale-scan\/verify/);
assert.match(scanner, /qr_code/);
assert.match(scanner, /ean_13/);
assert.match(scanner, /Start Continuous Camera Scan/);
assert.match(autoSale, /Autonomous Scan Sale/);
assert.match(autoSale, /AutonomousSaleCheckoutForm/);
assert.match(checkout, /\/sales\/customers/);
assert.match(checkout, /axiosClient\.post\("\/sales"/);
assert.match(checkout, /unit_ids/);

console.log("Automatic IDs, Quick Print and Autonomous\/Manual Sale contracts passed.");
