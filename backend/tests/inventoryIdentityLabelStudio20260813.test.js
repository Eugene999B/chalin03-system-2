const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const traceability = read("routes/inventoryTraceabilityRoutes.js");
const traceabilityService = read("services/inventoryTraceabilityService.js");
const automaticIdentity = read("services/inventoryIdentityStudioConstants.js");
const bootstrap = read("services/inventoryRouteSafetyBootstrap.js");
const productGuard = read("routes/productRoutesInventoryHardened.js");
const saleGuard = read("routes/saleRoutesInventoryHardened.js");
const saleIdentity = read("services/inventorySaleTraceabilityService.js");
const saleScan = read("routes/inventorySaleScanRoutes.js");
const receiving = read("services/inventoryReceivingTraceabilityService.js");
const transfer = read("routes/inventoryTransferTraceabilityRoutes.js");
const lossControl = read("routes/inventoryLossDetectionRoutes.js");
const documentService = read("services/inventoryIdentityStudioDocumentService.js");

test("Chalin One installs automatic product, purchase and sale inventory safety on established routers", () => {
  assert.match(traceabilityService, /installInventoryRouteSafety/);
  assert.match(bootstrap, /productRoutes\.stack =/);
  assert.match(bootstrap, /purchaseRoutes\.stack =/);
  assert.match(bootstrap, /saleRoutes\.stack =/);
  assert.match(bootstrap, /originalProductStack/);
  assert.match(bootstrap, /originalPurchaseStack/);
  assert.match(bootstrap, /originalSaleStack/);
  assert.match(bootstrap, /buildAutomaticPurchaseRouter/);
  assert.match(bootstrap, /AUTOMATIC_PURCHASE_IDENTITY_ERROR/);
  assert.match(productGuard, /reconcileAutomaticIdentityCoverage/);
  assert.match(productGuard, /createAutomaticIdentityBatches/);
  assert.match(productGuard, /Automatic IDs created with product opening stock/);
  assert.match(productGuard, /new_automatic_ids_created/);
  assert.match(productGuard, /SERIALIZED_STOCK_ADJUSTMENT_REQUIRES_EXACT_IDS/);
  assert.doesNotMatch(productGuard, /SERIALIZED_RESTOCK_REQUIRES_CONTROLLED_RECEIVING/);
  assert.match(saleGuard, /SERIALIZED_SALE_EDIT_REQUIRES_EXACT_RETURN/);
  assert.match(saleGuard, /SERIALIZED_SALE_VOID_REQUIRES_EXACT_RETURN/);
});

test("automatic identity service derives codes, fills stock gaps and creates new received identities", () => {
  assert.match(automaticIdentity, /automaticProductCode/);
  assert.match(automaticIdentity, /ensureAutomaticIdentityProfile/);
  assert.match(automaticIdentity, /createAutomaticIdentityBatches/);
  assert.match(automaticIdentity, /reconcileAutomaticIdentityCoverage/);
  assert.match(automaticIdentity, /TRACKING_MODES\.SERIALIZED/);
  assert.match(automaticIdentity, /TRACEABILITY_STATES\.SETUP/);
  assert.match(automaticIdentity, /opening_reconciliation/);
  assert.match(automaticIdentity, /AUTOMATIC_ID_BATCH_LIMIT = 2000/);
});

test("manual setup sales consume only safe unprinted identities while printed stock still needs exact IDs", () => {
  assert.match(saleIdentity, /loadAutomaticPendingUnits/);
  assert.match(saleIdentity, /status = 'label_pending'/);
  assert.match(saleIdentity, /TRACEABILITY_MANUAL_SALE_NEEDS_EXACT_IDS/);
  assert.match(saleIdentity, /automatic_unprinted_manual_sale/);
  assert.match(saleIdentity, /UNIT_STATUSES\.LABEL_PENDING/);
  assert.match(saleIdentity, /UNIT_STATUSES\.ACTIVE/);
  assert.match(saleIdentity, /exact_physical_id/);
});

test("autonomous sale scan resolves exact IDs or product barcodes to product and selling price", () => {
  assert.match(saleScan, /scan_type: "exact_unit"/);
  assert.match(saleScan, /scan_type: "product_barcode"/);
  assert.match(saleScan, /p\.selling_price/);
  assert.match(saleScan, /sale_ready/);
  assert.match(saleScan, /exact_id_required/);
  assert.match(saleScan, /sync-automatic-identities/);
  assert.match(saleScan, /reconcileAutomaticIdentityCoverage/);
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
