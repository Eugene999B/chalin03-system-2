const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

test("serialized transfer foundation keeps exact physical IDs as durable transfer evidence", () => {
  const migration = read("database/migrations/20260811_inventory_transfer_traceability.sql");
  const verifier = read("database/migrations/20260811_inventory_transfer_traceability_verify.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_transfer_units/);
  assert.match(migration, /UNIQUE KEY uq_inventory_transfer_unit \(transfer_id, unit_id\)/);
  assert.match(migration, /transfer_item_id BIGINT NOT NULL/);
  assert.match(migration, /receipt_status VARCHAR\(24\) NOT NULL DEFAULT 'pending'/);
  assert.match(verifier, /Every problem_count must be 0/);
  assert.match(verifier, /receipt_status = 'received'/);
  assert.match(verifier, /receipt_status = 'missing'/);
});

test("serialized transfer dispatch locks exact active units before the same transaction reduces source stock", () => {
  const service = read("backend/services/inventoryTransferTraceabilityService.js");

  assert.match(service, /dispatchTransferWithIdentities/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /TRANSFER_DISPATCH_EXACT_IDS_REQUIRED/);
  assert.match(service, /unit\.status !== UNIT_STATUSES\.ACTIVE/);
  assert.match(service, /assertUnitTransition\(unit\.status, UNIT_STATUSES\.IN_TRANSIT\)/);
  assert.match(service, /UPDATE products SET quantity = \?/);
  assert.match(service, /INSERT INTO inventory_transfer_units/);
  assert.match(service, /eventType: "transfer_dispatched"/);
  assert.match(service, /status = 'dispatched'/);
});

test("serialized transfer receiving increases destination stock only for observed IDs and investigates missing IDs", () => {
  const service = read("backend/services/inventoryTransferTraceabilityService.js");

  assert.match(service, /receiveTransferWithIdentities/);
  assert.match(service, /TRANSFER_RECEIPT_SCAN_LIST_REQUIRED/);
  assert.match(service, /TRANSFER_VARIANCE_NOTE_REQUIRED/);
  assert.match(service, /afterQuantity = beforeQuantity \+ receiveMappings\.length/);
  assert.match(service, /receipt_status = 'received'/);
  assert.match(service, /receipt_status = 'missing'/);
  assert.match(service, /eventType: "transfer_receipt_missing"/);
  assert.match(service, /investigation_type = 'transfer_shortage'/);
  assert.match(service, /destination_stock_increased_only_for_observed_units: true/);
  assert.match(service, /completed \? "received" : "dispatched"/);
});

test("legacy quantity transfer actions are physically guarded against enforced serialized inventory", () => {
  const service = read("backend/services/inventoryTransferTraceabilityService.js");
  const legacyRoutes = read("backend/routes/stockTransferRoutes.js");
  assert.match(service, /assertLegacyQuantityTransferAllowed/);
  assert.match(service, /inventory_tracking_mode = 'serialized'/);
  assert.match(service, /inventory_traceability_state = 'enforced'/);
  assert.match(service, /SERIALIZED_TRANSFER_IDENTITY_WORKFLOW_REQUIRED/);
  assert.match(
    legacyRoutes,
    /require\("\.\.\/services\/inventoryTransferTraceabilityService"\)/
  );
  const guards = legacyRoutes.match(
    /assertLegacyQuantityTransferAllowed\(connection, \{ transferId \}\);/g
  ) || [];
  assert.equal(guards.length, 2, "dispatch and receive must each block the legacy quantity bypass");
});

test("transfer control API never reveals the expected ID list before physical scanning", () => {
  const service = read("backend/services/inventoryTransferTraceabilityService.js");
  const routes = read("backend/routes/inventoryTransferTraceabilityRoutes.js");
  const wrapper = read("backend/routes/inventoryTraceabilityRoutes.js");

  assert.match(service, /expected_ids_hidden_until_physically_scanned: true/);
  assert.match(routes, /items\/:transferItemId\/scan/);
  assert.match(routes, /:transferId\/dispatch/);
  assert.match(routes, /:transferId\/receive/);
  assert.match(routes, /requireRole\("admin", "manager"\)/);
  assert.match(wrapper, /\/transfer-control/);
  assert.doesNotMatch(service, /expected_unit_codes:/);
});
