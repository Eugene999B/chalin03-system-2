import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(join(root, relative), "utf8");

const page = read("src/pages/StockTransfersPage.jsx");
const panel = read("src/components/InventoryTransferIdentityPanel.jsx");
const styles = read("src/styles/inventoryTransferIdentity.css");

assert.match(page, /InventoryTransferIdentityPanel/);
assert.match(page, /transferIdentityPolicy/);
assert.match(page, /handleSerializedTransferCompleted/);
assert.match(page, /Checking physical-ID transfer policy/i);
assert.match(page, /transferIdentityPolicy === "quantity"/);
assert.match(page, /loadTransferDetails/);

assert.match(panel, /Exact physical identity control/);
assert.match(panel, /Serialized Stock Transfer/);
assert.match(panel, /Expected IDs hidden/);
assert.match(panel, /No quantity-only bypass/);
assert.match(panel, /Missing arrivals stay in transit/);
assert.match(panel, /\/inventory-traceability\/transfer-control\/\$\{transferId\}\/items\/\$\{item\.id\}\/scan/);
assert.match(panel, /phase, value: raw/);
assert.match(panel, /selectedCodes\(item\.id\)\.length === Number\(item\.requested_quantity/);
assert.match(panel, /receiveMissingCount/);
assert.match(panel, /clean\(actionNote\)\.length >= 8/);
assert.match(panel, /window\.confirm/);
assert.match(panel, /keep those IDs in transit and open investigation evidence/i);
assert.match(panel, /dispatch_note/);
assert.match(panel, /receive_note/);
assert.match(panel, /unit_ids: selectedCodes\(item\.id\)/);
assert.match(panel, /Record Partial Receipt & Investigate Shortage/);
assert.match(panel, /Destination stock increases only for verified arrivals/i);
assert.match(styles, /\.inventory-transfer-identity/);
assert.match(styles, /@media \(max-width: 620px\)/);

console.log("Serialized stock transfer physical-ID frontend contract passed.");
