const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const server = read("server.js");
const traceability = read("routes/inventoryTraceabilityRoutes.js");
const productGuard = read("routes/productRoutesInventoryHardened.js");
const saleGuard = read("routes/saleRoutesInventoryHardened.js");
const receiving = read("services/inventoryReceivingTraceabilityService.js");
const transfer = read("routes/inventoryTransferTraceabilityRoutes.js");
const lossControl = read("routes/inventoryLossDetectionRoutes.js");
const documentService = read("services/inventoryIdentityStudioDocumentService.js");

test("Chalin One mounts the serialized product and sale hardening wrappers", () => {
  assert.match(server, /productRoutesInventoryHardened/);
  assert.match(server, /saleRoutesInventoryHardened/);
  assert.match(productGuard, /SERIALIZED_RESTOCK_REQUIRES_CONTROLLED_RECEIVING/);
  assert.match(productGuard, /SERIALIZED_STOCK_ADJUSTMENT_REQUIRES_EXACT_IDS/);
  assert.match(saleGuard, /SERIALIZED_SALE_EDIT_REQUIRES_EXACT_RETURN/);
  assert.match(saleGuard, /SERIALIZED_SALE_VOID_REQUIRES_EXACT_RETURN/);
});

test("Label Studio supports exact-ID selective print, export and partial confirmation", () => {
  assert.match(traceability, /identity-studio\/units/);
  assert.match(traceability, /identity-studio\/print-selected/);
  assert.match(traceability, /identity-studio\/export-selected/);
  assert.match(traceability, /identity-studio\/confirm-selected/);
  assert.match(traceability, /unit_id, print_format, copies/);
  assert.match(traceability, /LABEL_STUDIO_EXACT_PRINT_REQUIRED/);
  assert.match(traceability, /Unselected IDs remain untouched/i);
  assert.match(traceability, /STUDIO_MAX_SELECTION = 500/);
});

test("selected label documents keep server-only signed QR labels and selectable layouts", () => {
  assert.match(documentService, /buildSignedLabelPayload\(unit\.unit_code\)/);
  assert.match(documentService, /"a4", "thermal", "sticker", "compact"/);
  assert.match(documentService, /"compact", "standard", "detailed"/);
  assert.match(documentService, /\[mm\(40\), mm\(25\)\]/);
  assert.match(documentService, /CHALIN 03 Selected Inventory Labels/);
});

test("supplier and transfer provenance cannot be forged from the generic label screen", () => {
  assert.match(traceability, /TRACEABILITY_CONTROLLED_SOURCE_WORKFLOW_REQUIRED/);
  assert.match(traceability, /Serialized Receiving/);
  assert.match(traceability, /CONTROLLED_SOURCE_TYPES/);
});

test("serialized receiving works in setup and enforced states", () => {
  assert.match(receiving, /inventory_traceability_state IN \('setup', 'enforced'\)/);
  assert.match(receiving, /TRACEABILITY_STATES\.SETUP/);
  assert.match(receiving, /TRACEABILITY_STATES\.ENFORCED/);
});

test("transfer phase authority and custody authority remain explicit", () => {
  assert.match(transfer, /TRANSFER_DISPATCH_SOURCE_STORE_REQUIRED/);
  assert.match(transfer, /TRANSFER_RECEIVE_DESTINATION_STORE_REQUIRED/);
  assert.match(transfer, /shortage_product_scope: "destination_product"/);
  assert.match(lossControl, /HANDOVER_USER_STORE_ACCESS_REQUIRED/);
  assert.match(lossControl, /HANDOVER_INCOMING_CUSTODIAN_REQUIRED/);
});
