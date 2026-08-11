import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");

const hub = read("src/pages/InventoryTraceabilityPage.jsx");
const setupPage = read("src/pages/InventoryTraceabilitySetupPage.jsx");
const receivingPage = read("src/pages/InventorySerializedReceivingPage.jsx");
const quarantinePage = read("src/pages/InventoryReturnQuarantinePage.jsx");
const lossPage = read("src/pages/InventoryLossControlPage.jsx");
const blindScanner = read("src/components/InventoryBlindCountScanner.jsx");
const app = read("src/App.jsx");
const layout = read("src/components/Layout.jsx");
const styles = read("src/styles/inventoryTraceability.css");
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
assert.match(setupPage, /Feature-branch Sales enforcement is active for enforced serialized products/);
assert.match(setupPage, /Production remains/);
assert.match(setupPage, /config\.tracking_mode === "serialized"[\s\S]*config\.traceability_state/);
assert.match(setupPage, /Enforced — exact IDs required/);
assert.match(setupPage, /canEnableSerializedEnforcement/);
assert.doesNotMatch(setupPage, /Until checkout enforcement is implemented/);
assert.match(setupPage, /Where is this item\?/);
assert.match(setupPage, /\/inventory-traceability\/scan\/verify/);
assert.match(setupPage, /A4 sheet — many labels/);
assert.match(setupPage, /58mm thermal/);
assert.match(setupPage, /50×30mm sticker/);
assert.match(setupPage, /Admin Reprint/);
assert.match(setupPage, /physically verified this batch/i);
assert.match(setupPage, /permanently voided/i);
assert.match(setupPage, /Managers who generated or printed the batch cannot verify their own work/);

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
assert.match(lossStyles, /\.inventory-loss-control/);
assert.match(lossStyles, /\.inventory-loss-control__investigations/);
assert.match(hubStyles, /\.inventory-traceability-hub__tabs/);
assert.match(hubStyles, /repeat\(4, minmax\(0, 1fr\)\)/);

console.log("Inventory Traceability, Receiving, Return Quarantine + Loss Control frontend contract passed.");
