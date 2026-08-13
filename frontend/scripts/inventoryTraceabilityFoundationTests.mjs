import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const hub = read("src/pages/InventoryTraceabilityPage.jsx");
const automaticPage = read("src/pages/InventoryAutomaticLabelsPage.jsx");
const quickPrint = read("src/components/InventoryQuickPrintAll.jsx");
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

assert.match(hub, /Automatic IDs & Labels/);
assert.match(hub, /Supplier Receiving Detail/);
assert.match(hub, /Return Quarantine/);
assert.match(hub, /Blind Counts & Investigations/);
assert.match(hub, /InventoryAutomaticLabelsPage/);
assert.match(hub, /InventorySerializedReceivingPage/);
assert.match(hub, /InventoryReturnQuarantinePage/);
assert.match(hub, /InventoryLossControlPage/);

assert.match(automaticPage, /IDs follow your stock automatically/);
assert.match(automaticPage, /Create 20 items/);
assert.match(automaticPage, /Restock 7/);
assert.match(automaticPage, /sync-automatic-identities/);
assert.match(automaticPage, /New stock = new ID/);
assert.match(automaticPage, /InventoryQuickPrintAll/);
assert.match(automaticPage, /Choose specific IDs, reprints & ID registers/);
assert.match(automaticPage, /Advanced policy & exact-ID lookup/);
assert.doesNotMatch(automaticPage, /Prepare .* IDs for Current Stock/);

assert.match(quickPrint, /Print All .* Unprinted IDs/);
assert.match(quickPrint, /50×30 mm Sticker — Recommended/);
assert.match(quickPrint, /confirm-selected/);
assert.match(labelStudio, /Choose Specific IDs/);
assert.match(labelStudio, /Excel ID Register/);
assert.match(labelStudio, /CSV ID Register/);
assert.match(labelStudio, /signed QR/);

assert.match(receivingPage, /Serialized Receiving/);
assert.match(receivingPage, /exact recorded supplier purchase line/i);
assert.match(receivingPage, /The quantity cannot be changed here/);
assert.match(receivingPage, /\/inventory-traceability\/receiving\/purchase-items/);
assert.match(receivingPage, /Print Controlled Labels/);
assert.match(receivingPage, /Unused labels must be explicitly voided/);
assert.match(receivingStyles, /\.serialized-receiving/);

assert.match(quarantinePage, /Return Quarantine/);
assert.match(quarantinePage, /Quarantine is inventory, not sellable stock/);
assert.match(quarantinePage, /Complete Inspection/);

assert.match(lossPage, /Blind Counts & Investigations/);
assert.match(lossPage, /Evidence, not accusation/);
assert.match(lossPage, /blind_expected_values_hidden/);
assert.match(lossPage, /\/inventory-traceability\/loss-control\/counts/);
assert.match(lossPage, /Only an administrator can classify an investigation as confirmed loss/);
assert.match(blindScanner, /Expected IDs hidden/);
assert.match(blindScanner, /Duplicates are preserved as evidence/i);

assert.match(app, /InventoryTraceabilityPage/);
assert.match(app, /path="inventory-traceability"/);
assert.match(layout, /title: "Inventory Control & Traceability"/);
assert.match(layout, /path: "\/inventory-traceability"/);
assert.match(styles, /\.traceability-page/);
assert.match(studioStyles, /\.simple-label-studio/);
assert.match(lossStyles, /\.inventory-loss-control/);
assert.match(hubStyles, /\.inventory-traceability-hub__tabs/);
assert.match(hubStyles, /repeat\(4, minmax\(0, 1fr\)\)/);

console.log("Automatic inventory identity workspace + receiving + returns + loss-control frontend contract passed.");
