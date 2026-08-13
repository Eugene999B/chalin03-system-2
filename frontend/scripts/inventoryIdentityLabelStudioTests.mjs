import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const workspace = read("src/pages/InventoryAutomaticLabelsPage.jsx");
const hub = read("src/pages/InventoryTraceabilityPage.jsx");
const newSale = read("src/pages/NewSalePage.jsx");
const manualSale = read("src/pages/ManualNewSalePage.jsx");
const scanner = read("src/components/AutonomousSaleScanner.jsx");
const studio = read("src/components/InventoryLabelStudio.jsx");
const mobileCss = read("src/styles/inventoryBeginnerLabels.css");

assert.match(workspace, /New stock waiting for labels/);
assert.match(workspace, /Older stock still waiting/);
assert.match(workspace, /NEW_STOCK_SOURCES/);
assert.match(workspace, /identity-studio\/print-selected/);
assert.match(workspace, /identity-studio\/confirm-selected/);
assert.match(workspace, /Some Labels Damaged/);
assert.doesNotMatch(workspace, /Prepare .* IDs for Current Stock/);
assert.match(hub, /Stock Checks/);
assert.match(hub, /Receiving Detail/);
assert.match(mobileCss, /max-width:760px/);

assert.match(newSale, /ManualNewSalePage/);
assert.doesNotMatch(newSale, /How do you want to sell/);
assert.match(manualSale, /AutonomousSaleScanner/);
assert.match(manualSale, /addResolvedScanToCart/);
assert.match(manualSale, /Scanned and manually selected products share this one cart/);
assert.match(manualSale, /unitIdsRequired/);
assert.match(scanner, /sale-scan\/verify/);
assert.match(scanner, /Scan Item/);
assert.match(scanner, /qr_code/);
assert.match(scanner, /ean_13/);

assert.match(studio, /Choose Specific IDs/);
assert.match(studio, /Excel ID Register/);
assert.match(studio, /CSV ID Register/);

console.log("Beginner inventory and integrated New Sale scanner contracts passed.");
