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
const studioStyles = read("src/styles/inventoryLabelStudio.css");
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

assert.match(setupPage, /Inventory Control & Traceability/);
assert.match(setupPage, /Inventory Loss Prevention/);
assert.match(setupPage, /CHALIN ONE Trial/);
assert.match(setupPage, /Controlled Chalin One trial/);
assert.match(setupPage, /config\.tracking_mode === "serialized"[\s\S]*config\.traceability_state/);
assert.match(setupPage, /Enforced — exact IDs required/);
assert.match(setupPage, /canEnableSerializedEnforcement/);
assert.doesNotMatch(setupPage, /Until checkout enforcement is implemented/);
assert.match(setupPage, /<InventoryLabelStudio/);
assert.match(setupPage, /source_type: "opening_reconciliation"/);
assert.match(setupPage, /Serialized Receiving/);
assert.doesNotMatch(setupPage, /<option value="purchase">/);
assert.doesNotMatch(setupPage, /<option value="restock">/);
assert.doesNotMatch(setupPage, /<option value="transfer_receipt">/);
assert.match(setupPage, /Where is this exact item\?/);
assert.match(setupPage, /Find one physical stock unit/);
assert.match(setupPage, /\/inventory-traceability\/scan\/verify/);

assert.match(labelStudio, /Inventory Identity & Label Studio/);
assert.match(labelStudio, /Select All Filtered/);
assert.match(labelStudio, /Select First 10/);
assert.match(labelStudio, /Select First 24/);
assert.match(labelStudio, /A4 sheet — 24 labels\/page/);
assert.match(labelStudio, /58mm thermal/);
assert.match(labelStudio, /50×30mm sticker/);
assert.match(labelStudio, /40×25mm compact/);
assert.match(labelStudio, /Compact — QR \+ exact ID \+ product/);
assert.match(labelStudio, /Standard — QR \+ ID \+ product\/code/);
assert.match(labelStudio, /Detailed — product \+ batch \+ store \+ status/);
assert.match(labelStudio, /Download Selected Labels PDF/);
assert.match(labelStudio, /Download Selected IDs \(CSV\)/);
assert.match(labelStudio, /reprintCount > 0 && \(!isAdmin \|\| reason\.trim\(\)\.length < 8\)/);
assert.match(labelStudio, /QR signatures are generated only inside the controlled PDF/);
assert.match(labelStudio, /No unselected stock ID will be activated or voided/);

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
assert.match(styles, /\.traceability-unit-grid/);
assert.match(styles, /@media \(max-width: 520px\)/);
assert.match(studioStyles, /\.identity-studio/);
assert.match(studioStyles, /\.traceability-flow/);
assert.match(receivingStyles, /\.serialized-receiving/);
assert.match(lossStyles, /\.inventory-loss-control/);
assert.match(lossStyles, /\.inventory-loss-control__investigations/);
assert.match(hubStyles, /\.inventory-traceability-hub__tabs/);
assert.match(hubStyles, /repeat\(4, minmax\(0, 1fr\)\)/);

console.log("Inventory Traceability + Label Studio + Receiving + Return Quarantine + Loss Control frontend contract passed.");
