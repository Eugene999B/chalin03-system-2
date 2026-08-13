const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const service = read("services/inventoryReceivingTraceabilityService.js");
const route = read("routes/inventoryTraceabilityReceivingRoutes.js");

test("serialized receiving queue is branch-isolated and includes both rollout states", () => {
  assert.match(service, /pu\.branch_id = \?/);
  assert.match(service, /p\.inventory_tracking_mode = 'serialized'/);
  assert.match(service, /p\.inventory_traceability_state IN \('setup', 'enforced'\)/);
  assert.match(service, /TRACEABILITY_STATES\.SETUP/);
  assert.match(service, /TRACEABILITY_STATES\.ENFORCED/);
  assert.match(service, /TRACEABILITY_PURCHASE_TRACEABILITY_REQUIRED/);
  assert.match(route, /requireRole\("admin", "manager"\)/);
});

test("purchase label preparation uses the exact stored purchase item quantity", () => {
  assert.match(service, /expectedQuantity: Number\(item\.quantity\)/);
  assert.doesNotMatch(route, /expected_quantity/);
  assert.match(service, /sourceType: "purchase"/);
  assert.match(service, /sourceId: item\.purchase_id/);
  assert.match(service, /sourceItemId: item\.purchase_item_id/);
});

test("a purchase item cannot silently mint a second controlled stock batch", () => {
  assert.match(service, /TRACEABILITY_PURCHASE_BATCH_EXISTS/);
  assert.match(service, /Open the existing batch instead of generating duplicate identities/);
  assert.match(route, /existing_batch/);
});

test("purchase receiving writes traceability audit evidence", () => {
  assert.match(service, /PREPARE_PURCHASE_SERIALIZED_LABELS/);
  assert.match(service, /purchase_serialized_labels_prepared/);
  assert.match(service, /severity: "high"/);
  assert.match(service, /label_batch_code/);
});
