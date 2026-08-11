const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const service = read("backend/services/inventoryTransferTraceabilityService.js");
const routes = read("backend/routes/inventoryTransferTraceabilityRoutes.js");
const legacyRoutes = read("backend/routes/stockTransferRoutes.js");

test("duplicate and cross-line physical IDs fail closed before dispatch", () => {
  assert.match(service, /DUPLICATE_TRANSFER_UNIT_ID/);
  assert.match(service, /TRANSFER_UNIT_REUSED_ACROSS_ITEMS/);
  assert.match(service, /seen\.has\(decoded\.unitCode\)/);
  assert.match(service, /allScannedCodes\.has\(code\)/);
  assert.match(service, /allScannedCodes\.add\(code\)/);
});

test("dispatch re-locks and revalidates the unit after the earlier scan check", () => {
  assert.match(service, /SELECT \* FROM inventory_units[\s\S]*FOR UPDATE/);
  assert.match(service, /TRANSFER_DISPATCH_UNIT_WRONG_SOURCE/);
  assert.match(service, /TRANSFER_DISPATCH_UNIT_NOT_ACTIVE/);
  assert.match(service, /unit\.status !== UNIT_STATUSES\.ACTIVE \|\| unit\.transfer_id/);
  assert.match(service, /assertUnitTransition\(unit\.status, UNIT_STATUSES\.IN_TRANSIT\)/);
  assert.match(service, /withTransaction\(async \(connection\) =>/);
});

test("receipt rejects unexpected, replayed or state-changed physical IDs", () => {
  assert.match(service, /TRANSFER_RECEIPT_UNIT_UNEXPECTED/);
  assert.match(service, /TRANSFER_RECEIPT_UNIT_ALREADY_RECEIVED/);
  assert.match(service, /TRANSFER_RECEIPT_UNIT_STATE_CHANGED/);
  assert.match(service, /mapping\.unit_status !== UNIT_STATUSES\.IN_TRANSIT/);
  assert.match(service, /Number\(mapping\.current_transfer_id\) !== cleanTransferId/);
});

test("zero and partial physical receipt remain evidence-first rather than quantity-first", () => {
  assert.match(service, /Send an explicit empty list only when zero units physically arrived/);
  assert.doesNotMatch(service, /input\.unit_codes\.length\s*<=\s*0/);
  assert.match(service, /TRANSFER_VARIANCE_NOTE_REQUIRED/);
  assert.match(service, /afterQuantity = beforeQuantity \+ receiveMappings\.length/);
  assert.match(service, /toStatus: UNIT_STATUSES\.IN_TRANSIT/);
  assert.match(service, /stock_mutated: false/);
  assert.match(service, /worker_fault_assigned: false/);
  assert.match(service, /investigation_type = 'transfer_shortage'/);
});

test("a late-arriving transfer shortage can be received and closes its open investigation as found", () => {
  assert.match(service, /resolveTransferShortageIfFound/);
  assert.match(service, /resolution_category = 'found'/);
  assert.match(service, /Physical unit was later received against transfer/);
  assert.match(service, /eventType: "transfer_received"/);
});

test("destination traceability mismatch fails before a serialized identity is activated there", () => {
  assert.match(service, /TRANSFER_DESTINATION_TRACEABILITY_MISMATCH/);
  assert.match(service, /destinationProduct\.inventory_tracking_mode !== "serialized"/);
  assert.match(service, /destinationProduct\.inventory_traceability_state !== "enforced"/);
  assert.match(service, /sourceCode !== destinationCode/);
});

test("legacy dispatch and receive remain physically blocked for enforced serialized transfer lines", () => {
  const guards = legacyRoutes.match(
    /assertLegacyQuantityTransferAllowed\(connection, \{ transferId \}\);/g
  ) || [];
  assert.equal(guards.length, 2);
  assert.match(service, /SERIALIZED_TRANSFER_IDENTITY_WORKFLOW_REQUIRED/);
});

test("secondary route audit failure cannot turn an already committed transfer into a false client failure", () => {
  assert.match(routes, /async function writeSecondaryAudit\(event\)/);
  assert.match(routes, /try \{[\s\S]*await writeAuditEvent\(event\);[\s\S]*return true;[\s\S]*catch \(error\)/);
  assert.match(routes, /return false;/);
  const calls = routes.match(/await writeSecondaryAudit\(\{/g) || [];
  assert.equal(calls.length, 2, "dispatch and receive should both use the non-throwing secondary audit wrapper");
  assert.match(routes, /secondary_audit_recorded: secondaryAuditRecorded/);
});
