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
const exactScanner = read("src/components/InventoryUnitScanner.jsx");
const camera = read("src/components/CameraBarcodeReader.jsx");
const studio = read("src/components/InventoryLabelStudio.jsx");
const mobileCss = read("src/styles/inventoryBeginnerLabels.css");
const headers = read("public/_headers");

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
assert.match(scanner, /Single Item/);
assert.match(scanner, /Multiple Items/);
assert.match(scanner, /Automatic add/);
assert.match(scanner, /CameraBarcodeReader/);
assert.match(scanner, /qr_code/);
assert.match(scanner, /ean_13/);
assert.doesNotMatch(scanner, /Camera scanning is unavailable in this browser/);

assert.match(exactScanner, /CameraBarcodeReader/);
assert.match(exactScanner, /Scan Physical Item IDs/);
assert.match(exactScanner, /accepted: true/);
assert.match(exactScanner, /next\.length >= count/);

assert.match(camera, /navigator\.mediaDevices\.getUserMedia/);
assert.match(camera, /BarcodeDetector/);
assert.match(camera, /ZXING_FALLBACK_URL/);
assert.match(camera, /cdn\.jsdelivr\.net\/npm\/@zxing\/browser@0\.1\.5/);
assert.match(camera, /BrowserMultiFormatReader/);
assert.match(camera, /enumerateDevices/);
assert.match(camera, /getCapabilities/);
assert.match(camera, /torch/);
assert.match(camera, /Camera permission is blocked/);
assert.match(camera, /NotReadableError/);
assert.match(camera, /Move it away/);
assert.match(camera, /blockedRawRef/);
assert.match(camera, /650/);

assert.match(headers, /Permissions-Policy: camera=\(self\)/);
assert.doesNotMatch(headers, /Permissions-Policy: camera=\(\)/);
assert.match(headers, /script-src[^\n]*https:\/\/cdn\.jsdelivr\.net/);

assert.match(studio, /Choose Specific IDs/);
assert.match(studio, /Excel ID Register/);
assert.match(studio, /CSV ID Register/);

console.log("Beginner inventory, camera reliability, and integrated New Sale scanner contracts passed.");
