const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const server = read("server.js");
const routes = read("routes/inventoryTraceabilityRoutes.js");
const coreRoutes = read("routes/inventoryTraceabilityCoreRoutes.js");
const receivingRoutes = read("routes/inventoryTraceabilityReceivingRoutes.js");
const lossRoutes = read("routes/inventoryLossDetectionRoutes.js");
const repository = read("services/inventoryTraceabilityRepositoryService.js");
const labels = read("services/inventoryLabelDocumentService.js");
const primitives = read("services/inventoryTraceabilityService.js");
const migration = fs.readFileSync(
  path.resolve(root, "../database/migrations/20260810_inventory_traceability_foundation.sql"),
  "utf8"
);
const verifier = fs.readFileSync(
  path.resolve(root, "../database/migrations/20260810_inventory_traceability_foundation_verify.sql"),
  "utf8"
);

test("feature API is branch-isolated and mounted only in Spare Parts workspace", () => {
  assert.match(server, /const inventoryTraceabilityRoutes = require\("\.\/routes\/inventoryTraceabilityRoutes"\)/);
  assert.match(
    server,
    /app\.use\(\s*"\/api\/inventory-traceability",\s*requireAuth,\s*sparePartsBoundary,\s*inventoryTraceabilityRoutes\s*\)/s
  );
  assert.match(coreRoutes, /router\.use\(requireAuth\)/);
  assert.match(coreRoutes, /requireRole\("admin"\)/);
  assert.match(coreRoutes, /requireRole\("admin", "manager"\)/);
});

test("composite traceability router exposes receiving and loss-control without duplicating the core API", () => {
  assert.match(routes, /inventoryTraceabilityCoreRoutes/);
  assert.match(routes, /inventoryTraceabilityReceivingRoutes/);
  assert.match(routes, /inventoryLossDetectionRoutes/);
  assert.match(routes, /router\.use\("\/receiving", inventoryTraceabilityReceivingRoutes\)/);
  assert.match(routes, /router\.use\("\/loss-control", inventoryLossDetectionRoutes\)/);
  assert.match(routes, /router\.use\(inventoryTraceabilityCoreRoutes\)/);
  assert.match(receivingRoutes, /purchase-items/);
  assert.match(lossRoutes, /\/counts/);
  assert.match(lossRoutes, /\/investigations/);
  assert.match(lossRoutes, /\/handovers/);
});

test("tracking is backward compatible and exact-ID enforcement is explicit, serialized-only and reconciled", () => {
  assert.match(migration, /inventory_tracking_mode` VARCHAR\(20\) NOT NULL DEFAULT ''quantity''/);
  assert.match(migration, /inventory_traceability_state` VARCHAR\(20\) NOT NULL DEFAULT ''off''/);
  assert.match(repository, /ready_for_serialized_enforcement/);
  assert.match(repository, /current\.inventory_traceability_state !== TRACEABILITY_STATES\.ENFORCED/);
  assert.match(primitives, /TRACEABILITY_ENFORCEMENT_REQUIRES_SERIALIZED/);
  assert.match(primitives, /Exact-ID enforcement is available only for serialized products/);
  assert.doesNotMatch(primitives, /TRACEABILITY_ENFORCEMENT_NOT_RELEASED/);
  assert.match(coreRoutes, /an administrator may enable enforcement separately/);
  assert.match(
    verifier,
    /inventory_traceability_state = 'enforced'[\s\S]*inventory_tracking_mode <> 'serialized'/
  );
  assert.match(
    verifier,
    /inventory_tracking_mode IN \('batch', 'serialized'\)[\s\S]*inventory_product_code IS NULL/
  );
  assert.doesNotMatch(verifier, /checkout enforcement has not been released yet/i);
  assert.doesNotMatch(
    verifier,
    /FROM products\s+WHERE inventory_traceability_state = 'enforced';/
  );
});

test("serialized configuration cannot be downgraded or silently recoded after identities exist", () => {
  assert.match(repository, /TRACEABILITY_PRODUCT_CODE_LOCKED/);
  assert.match(repository, /TRACEABILITY_DOWNGRADE_BLOCKED/);
  assert.match(repository, /TRACEABILITY_IDENTITY_RECONCILIATION_REQUIRED/);
});

test("label batch finalization requires every generated identity to be activated or voided", () => {
  assert.match(repository, /TRACEABILITY_BATCH_CONFIRMATION_INCOMPLETE/);
  assert.match(repository, /Every generated label identity must be explicitly confirmed as attached or voided/);
  assert.match(repository, /TRACEABILITY_ACTIVATION_OVERLAP/);
  assert.match(repository, /UNIT_STATUSES\.VOIDED/);
});

test("unit event history is append-only through the feature API", () => {
  assert.match(repository, /INSERT INTO inventory_unit_events/);
  assert.doesNotMatch(coreRoutes, /DELETE\s+FROM\s+inventory_unit_events/i);
  assert.doesNotMatch(coreRoutes, /UPDATE\s+inventory_unit_events/i);
  assert.doesNotMatch(repository, /DELETE\s+FROM\s+inventory_unit_events/i);
  assert.doesNotMatch(repository, /UPDATE\s+inventory_unit_events/i);
  assert.match(migration, /previous_event_hash CHAR\(64\)/);
  assert.match(migration, /event_hash CHAR\(64\) NOT NULL/);
});

test("signed QR payloads are generated only inside the controlled PDF path", () => {
  assert.match(labels, /buildSignedLabelPayload\(units\[index\]\.unit_code, signingSecret\)/);
  assert.match(coreRoutes, /buildInventoryLabelPdf/);
  assert.match(coreRoutes, /verifySignedLabelPayload\(input\)/);
  assert.doesNotMatch(coreRoutes, /qr_payload\s*:/);
  assert.match(coreRoutes, /Signed QR payloads are not exposed through the API/);
  assert.match(primitives, /INVENTORY_LABEL_SIGNING_SECRET/);
  assert.doesNotMatch(primitives, /BACKUP_SIGNING_SECRET/);
  assert.doesNotMatch(primitives, /JWT_SECRET/);
});

test("label reprints are administrator-controlled and cannot be silently acknowledged", () => {
  assert.match(coreRoutes, /TRACEABILITY_REPRINT_ADMIN_REQUIRED/);
  assert.match(coreRoutes, /TRACEABILITY_REPRINT_REASON_REQUIRED/);
  assert.match(coreRoutes, /REPRINT_INVENTORY_LABEL_BATCH/);
  assert.match(coreRoutes, /TRACEABILITY_USE_CONTROLLED_PRINT/);
  assert.match(coreRoutes, /prior_print_count/);
});

test("activation requires physical labels to have been printed and manager verification is independent", () => {
  assert.match(coreRoutes, /TRACEABILITY_PRINT_REQUIRED_BEFORE_ACTIVATION/);
  assert.match(coreRoutes, /TRACEABILITY_INDEPENDENT_VERIFICATION_REQUIRED/);
  assert.match(coreRoutes, /control\.created_by/);
  assert.match(coreRoutes, /control\.printed_by/);
  assert.match(coreRoutes, /roleOf\(req\) !== "admin"/);
});

test("foundation migration carries explicit additive and backup-required markers", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /BACKUP REQUIRED/);
});

test("foundation migration is additive and verifier checks all new tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_label_batches/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_units/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_unit_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_label_print_events/);
  assert.doesNotMatch(migration, /DROP TABLE/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DELETE FROM/i);
  assert.doesNotMatch(migration, /UPDATE products SET quantity/i);
  assert.match(verifier, /inventory_label_batches/);
  assert.match(verifier, /inventory_units/);
  assert.match(verifier, /inventory_unit_events/);
  assert.match(verifier, /inventory_label_print_events/);
});
