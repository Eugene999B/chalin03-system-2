const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const server = read("server.js");
const productGuard = read("routes/productRoutesInventoryHardened.js");
const saleGuard = read("routes/saleRoutesInventoryHardened.js");
const receiving = read("services/inventoryReceivingTraceabilityService.js");
const transferRoute = read("routes/inventoryTransferTraceabilityRoutes.js");
const lossRoute = read("routes/inventoryLossDetectionRoutes.js");
const traceabilityRouter = read("routes/inventoryTraceabilityRoutes.js");

test("runtime mounts the hardened product and sale routers before legacy mutation handlers", () => {
  assert.match(
    server,
    /const productRoutes = require\("\.\/routes\/productRoutesInventoryHardened"\)/
  );
  assert.match(
    server,
    /const saleRoutes = require\("\.\/routes\/saleRoutesInventoryHardened"\)/
  );
  assert.match(productGuard, /router\.use\(legacyProductRoutes\)/);
  assert.match(saleGuard, /router\.use\(legacySaleRoutes\)/);
});

test("quantity-only restock and stock adjustment fail closed for enforced serialized products", () => {
  assert.match(productGuard, /inventory_tracking_mode/);
  assert.match(productGuard, /inventory_traceability_state/);
  assert.match(productGuard, /serialized/);
  assert.match(productGuard, /enforced/);
  assert.match(productGuard, /FOR UPDATE/);
  assert.match(productGuard, /SERIALIZED_RESTOCK_REQUIRES_CONTROLLED_RECEIVING/);
  assert.match(productGuard, /SERIALIZED_STOCK_ADJUSTMENT_REQUIRES_EXACT_IDS/);
  assert.match(productGuard, /Record the supplier purchase and prepare its exact identities in Serialized Receiving/);
});

test("legacy sale edit and void cannot mutate a sale carrying serialized identity history", () => {
  assert.match(saleGuard, /FROM inventory_units u/);
  assert.match(saleGuard, /u\.sale_id = \?/);
  assert.match(saleGuard, /inventory_tracking_mode = 'serialized'/);
  assert.match(saleGuard, /SERIALIZED_SALE_EDIT_REQUIRES_EXACT_RETURN/);
  assert.match(saleGuard, /SERIALIZED_SALE_VOID_REQUIRES_EXACT_RETURN/);
  assert.match(saleGuard, /serialized_identity_preserved: true/);
  assert.match(saleGuard, /stock_mutated: false/);
  assert.match(saleGuard, /Returns/);
  assert.match(saleGuard, /quarantine/);
});

test("enforced serialized products stay enforced while purchase-linked receiving creates new identities", () => {
  assert.match(receiving, /p\.inventory_traceability_state IN \('setup', 'enforced'\)/);
  assert.match(receiving, /TRACEABILITY_STATES\.SETUP/);
  assert.match(receiving, /TRACEABILITY_STATES\.ENFORCED/);
  assert.match(receiving, /expectedQuantity: Number\(item\.quantity\)/);
  assert.match(receiving, /sourceType: "purchase"/);
  assert.match(receiving, /sourceId: item\.purchase_id/);
  assert.match(receiving, /sourceItemId: item\.purchase_item_id/);
});

test("serialized transfer mutation authority is bound to the correct physical side", () => {
  assert.match(transferRoute, /TRANSFER_DISPATCH_SOURCE_STORE_REQUIRED/);
  assert.match(transferRoute, /TRANSFER_RECEIVE_DESTINATION_STORE_REQUIRED/);
  assert.match(transferRoute, /assertTransferAccess\(req, plan, "dispatch"\)/);
  assert.match(transferRoute, /assertTransferAccess\(req, plan, "receive"\)/);
  assert.match(transferRoute, /assertTransferAccess\(req, plan, phase\)/);
  assert.match(transferRoute, /phase must be dispatch or receive/i);
});

test("transfer shortage investigations are rebound to the destination-store product", () => {
  assert.match(transferRoute, /bindTransferShortagesToDestinationProducts/);
  assert.match(transferRoute, /SET i\.product_id = sti\.destination_product_id/);
  assert.match(transferRoute, /i\.branch_id = \?/);
  assert.match(transferRoute, /i\.investigation_type = 'transfer_shortage'/);
  assert.match(transferRoute, /sti\.destination_product_id IS NOT NULL/);
  assert.match(transferRoute, /shortage_product_scope: "destination_product"/);
});

test("custody handover requires store-authorized custodians and the nominated incoming verifier", () => {
  assert.match(lossRoute, /HANDOVER_USER_STORE_ACCESS_REQUIRED/);
  assert.match(lossRoute, /user_branch_access/);
  assert.match(lossRoute, /default_branch_id/);
  assert.match(lossRoute, /can_access_all_branches/);
  assert.match(lossRoute, /HANDOVER_INCOMING_CUSTODIAN_REQUIRED/);
  assert.match(lossRoute, /Only the nominated incoming custodian/);
  assert.match(lossRoute, /assertIncomingCustodian/);
});

test("generic label generation cannot impersonate purchase restock or transfer provenance", () => {
  assert.match(traceabilityRouter, /RESERVED_LABEL_SOURCE_TYPES/);
  assert.match(traceabilityRouter, /"purchase"/);
  assert.match(traceabilityRouter, /"restock"/);
  assert.match(traceabilityRouter, /"transfer_receipt"/);
  assert.match(traceabilityRouter, /TRACEABILITY_CONTROLLED_SOURCE_WORKFLOW_REQUIRED/);
  assert.match(traceabilityRouter, /sourceType !== "opening_reconciliation"/);
  assert.match(traceabilityRouter, /req\.body\.source_id = null/);
  assert.match(traceabilityRouter, /req\.body\.source_item_id = null/);
});
