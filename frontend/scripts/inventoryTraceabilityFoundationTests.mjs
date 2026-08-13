import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const hub = read("src/pages/InventoryTraceabilityPage.jsx");
const setupPage = read("src/pages/InventoryTraceabilitySetupPage.jsx");
const labelStudio = read("src/components/InventoryLabelStudio.jsx");
const receivingPage = read("src/pages/InventorySerializedReceivingPage.jsx");
const quarantinePage = read("src/pages/InventoryReturnQuarantinePage.jsx");
const lossPage = read("src/pages/InventoryLossControlPage.jsx");
const blindScanner = read("src/components/InventoryBlindCountScanner.jsx");
const app = read("src/App.jsx");
const layout = read("src/components/Layout.jsx");
const styles = read("src/styles/inventoryTraceability.css");
const studioStyles = read("src/styles/inventoryLabelStudioSimple.css");
const receivingStyles = read("src/styles/inventorySerializedReceiving.css");
const lossStyles = read("src/styles/inventoryLossControl.css");
const hubStyles = read("src/styles/inventoryTraceabilityHub.css");

assert.match(hub, /Setup & Labels/);
assert.match(hub, /Serialized Receiving/);
assert.match(hub, /Return Quarantine/);
assert.match(hub, /Blind Counts & Investigations/);
assert.match(hub, /InventoryTraceabilitySetupPage/);
assert.match(hub, /InventorySerializedReceivingPage/);
assert.match(hub, /InventoryReturnQuarantinePage/);
assert.match(hub, /InventoryLossControlPage/);

assert.match(setupPage, /Start with the product you already created/);
assert.match(setupPage, /automaticProductPrefix/);
assert.match(setupPage, /Prepare .* IDs for Current Stock/);
assert.match(setupPage, /Create .* Missing ID/);
assert.match(setupPage, /Supplier Receiving tab/);
assert.match(setupPage, /source_type: "opening_reconciliation"/);
assert.match(setupPage, /Advanced settings & exact-ID lookup/);
assert.match(setupPage, /Sales enforcement/);
assert.match(setupPage, /Enforced — exact ID required during sale/);
assert.match(setupPage, /\/inventory-traceability\/scan\/verify/);
assert.match(setupPage, /<InventoryLabelStudio/);
assert.doesNotMatch(setupPage, /placeholder="SO4L"/);

assert.match(labelStudio, /Print Product IDs/);
assert.match(labelStudio, /Print All IDs Needing Labels/);
assert.match(labelStudio, /Choose Specific IDs/);
assert.match(labelStudio, /50×30 mm Sticker/);
assert.match(labelStudio, /A4 Sheet/);
assert.match(labelStudio, /58 mm Thermal/);
assert.match(labelStudio, /40×25 mm Compact/);
assert.match(labelStudio, /Print \/ Download Labels PDF/);
assert.match(labelStudio, /Excel ID Register \(\.xlsx\)/);
assert.match(labelStudio, /CSV ID Register \(\.csv\)/);
assert.match(labelStudio, /makeInventoryWorkbook/);
assert.match(labelStudio, /reprintCount > 0 && \(!isAdmin \|\| reason\.trim\(\)\.length < 8\)/);
assert.match(labelStudio, /signed QR/);
assert.match(labelStudio, /confirm-selected/);

assert.match(receivingPage, /Serialized Receiving/);
assert.match(receivingPage, /exact recorded supplier purchase line/i);
assert.match(receivingPage, /The quantity cannot be changed here/);
assert.match(receivingPage, /\/inventory-traceability\/receiving\/purchase-items/);
assert.match(receivingPage, /\/label-batch/);
assert.match(receivingPage, /\/inventory-traceability\/label-batches\/\$\{batchId\}\/print/);
assert.match(receivingPage, /Print Controlled Labels/);
assert.match(receivingPage, /Admin Reprint Labels/);
assert.match(receivingPage, /Unused labels must be explicitly voided/);
assert.match(receivingStyles, /\.serialized-receiving/);
assert.match(receivingStyles, /\.serialized-receiving__card/);

assert.match(quarantinePage, /Return Quarantine/);
assert.match(quarantinePage, /Quarantine is inventory, not sellable stock/);
assert.match(quarantinePage, /Complete Inspection/);

assert.match(lossPage, /Blind Counts & Investigations/);
assert.match(lossPage, /Evidence, not accusation/);
assert.match(lossPage, /blind_expected_values_hidden/);
assert.match(lossPage, /Physical count \(0 allowed\)/);
assert.match(lossPage, /\/inventory-traceability\/loss-control\/counts/);
assert.match(lossPage, /\/inventory-traceability\/loss-control\/investigations/);
assert.match(lossPage, /Only an administrator can classify an investigation as confirmed loss/);
assert.match(blindScanner, /Expected IDs hidden/);
assert.match(blindScanner, /unit-observations/);
assert.match(blindScanner, /Duplicates are preserved as evidence/i);

assert.match(app, /InventoryTraceabilityPage/);
assert.match(app, /path="inventory-traceability"/);
assert.match(layout, /title: "Inventory Control & Traceability"/);
assert.match(layout, /path: "\/inventory-traceability"/);

assert.match(styles, /\.traceability-page/);
assert.match(styles, /@media \(max-width: 520px\)/);
assert.match(studioStyles, /\.simple-label-studio/);
assert.match(studioStyles, /\.simple-traceability-start/);
assert.match(receivingStyles, /\.serialized-receiving/);
assert.match(lossStyles, /\.inventory-loss-control/);
assert.match(lossStyles, /\.inventory-loss-control__investigations/);
assert.match(hubStyles, /\.inventory-traceability-hub__tabs/);
assert.match(hubStyles, /repeat\(4, minmax\(0, 1fr\)\)/);

console.log("Inventory Traceability simplified label workflow + receiving + returns + loss-control frontend contract passed.");
