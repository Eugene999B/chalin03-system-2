import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const studio = read("src/components/InventoryLabelStudio.jsx");
const setup = read("src/pages/InventoryTraceabilitySetupPage.jsx");

assert.match(studio, /identity-studio\/units/);
assert.match(studio, /identity-studio\/print-selected/);
assert.match(studio, /identity-studio\/export-selected/);
assert.match(studio, /identity-studio\/confirm-selected/);
assert.match(studio, /Select All Filtered/);
assert.match(studio, /Select First 10/);
assert.match(studio, /Select First 24/);
assert.match(studio, /Download Selected Labels PDF/);
assert.match(studio, /Download Selected IDs \(CSV\)/);
assert.match(studio, /A4 sheet — 24 labels\/page/);
assert.match(studio, /58mm thermal/);
assert.match(studio, /50×30mm sticker/);
assert.match(studio, /40×25mm compact/);
assert.match(studio, /Compact — QR \+ exact ID \+ product/);
assert.match(studio, /Standard — QR \+ ID \+ product\/code/);
assert.match(studio, /Detailed — product \+ batch \+ store \+ status/);
assert.match(studio, /reprintCount > 0 && \(!isAdmin \|\| reason\.trim\(\)\.length < 8\)/);
assert.match(studio, /QR signatures are generated only inside the controlled PDF/);
assert.match(studio, /No unselected stock ID will be activated or voided/);

assert.match(setup, /<InventoryLabelStudio/);
assert.match(setup, /source_type: "opening_reconciliation"/);
assert.match(setup, /Serialized Receiving/);
assert.doesNotMatch(setup, /<option value="purchase">/);
assert.doesNotMatch(setup, /<option value="restock">/);
assert.doesNotMatch(setup, /<option value="transfer_receipt">/);
assert.match(setup, /Choose the exact IDs/);

console.log("Inventory Identity & Label Studio frontend contracts passed.");
