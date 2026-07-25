const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const migration = read(
  "database/migrations/20260722_equipment_sales_installments_foundation.sql"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const routes = read("backend/routes/equipmentSalesRoutes.js");
const boundary = read(
  "backend/middleware/equipmentCatalogueIntegrityMiddleware.js"
);
const backupRoutes = read("backend/routes/backupRoutes.js");
const backupSafety = read("backend/services/backupSafetyService.js");

const lifecycleTables = [
  "equipment_sales_enquiries",
  "equipment_sales_quotations",
  "equipment_sales_quotation_items",
  "equipment_sale_agreements",
  "equipment_asset_sale_locks",
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_sales_reminder_log",
];

test("Equipment Sales migration is controlled while runtime readiness is read-only", () => {
  assert.match(migration, /INSERT INTO schema_migrations/i);
  assert.match(schemaService, /information_schema\.TABLES/);
  assert.match(schemaService, /information_schema\.COLUMNS/);
  assert.match(schemaService, /information_schema\.TRIGGERS/);
  assert.match(schemaService, /verifyFoundation/);
  assert.match(schemaService, /assertEquipmentSalesSchemaReady/);
  assert.match(schemaService, /runtime_mutation_disabled/);
  assert.doesNotMatch(schemaService, /GET_LOCK|RELEASE_LOCK/);
  assert.doesNotMatch(schemaService, /executeMigration|splitSqlStatements/);
  assert.doesNotMatch(schemaService, /\bCREATE\s+(?:TABLE|TRIGGER|INDEX)\b/i);
  assert.doesNotMatch(schemaService, /\bALTER\s+TABLE\b/i);

  for (const tableName of lifecycleTables) {
    assert.match(schemaService, new RegExp(`"${tableName}"`));
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\b`));
  }
});

test("catalogue boundary mounts Equipment Sales without exposing other workspaces", () => {
  assert.match(boundary, /require\("\.\.\/routes\/equipmentSalesRoutes"\)/);
  assert.match(boundary, /ensureEquipmentSalesSchema/);
  assert.match(boundary, /isEquipmentSalesRequest/);
  assert.match(boundary, /\^\\\/sales/);
  assert.match(boundary, /dispatchEquipmentSalesRouter/);
  assert.match(boundary, /EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED/);
  assert.match(boundary, /Existing Hire and Spare Parts operations remain available/);
});

test("Equipment Sales API covers the full commercial lifecycle", () => {
  for (const endpoint of [
    'router.get("/summary"',
    'router.get("/reference"',
    'router.get("/enquiries"',
    'router.post("/enquiries"',
    'router.patch("/enquiries/:id/status"',
    'router.get("/quotations"',
    'router.post("/quotations"',
    'router.patch("/quotations/:id/status"',
    'router.get("/agreements"',
    'router.get("/agreements/:id"',
    'router.post("/agreements"',
    'router.post("/agreements/:id/payments"',
    'router.post("/agreements/:id/delivery"',
    'router.post("/agreements/:id/ownership-transfer"',
    'router.post("/agreements/:id/sms"',
  ]) {
    assert.ok(routes.includes(endpoint), `Missing Equipment Sales endpoint: ${endpoint}`);
  }

  assert.match(routes, /resolveHireLocationScope/);
  assert.match(routes, /appendHireLocationFilter/);
  assert.match(routes, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(routes, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(routes, /workspaceCode:\s*"equipment_hire"/);
});

test("sale creation locks the exact asset and prevents Hire conflicts", () => {
  assert.match(routes, /hca\.status IN \('assigned','dispatched','active'\)/);
  assert.match(routes, /assertAssetCanBeSold/);
  assert.match(routes, /EQUIPMENT_ACTIVE_ON_HIRE/);
  assert.match(routes, /EQUIPMENT_ALREADY_RESERVED/);
  assert.match(routes, /INSERT INTO equipment_asset_sale_locks/);
  assert.match(routes, /installment_active/);
  assert.match(routes, /UPDATE fleet_assets SET sale_status = \?/);
  assert.match(routes, /FOR UPDATE/);
  assert.match(routes, /UPDATE equipment_sales_quotations SET status = 'converted'/);
});

test("installment schedule, payments and receipts reconcile in transactions", () => {
  assert.match(routes, /function buildSchedule/);
  assert.match(routes, /weekly/);
  assert.match(routes, /fortnightly/);
  assert.match(routes, /monthly/);
  assert.match(routes, /INSERT INTO equipment_installment_schedule/);
  assert.match(routes, /INSERT INTO equipment_sale_payments/);
  assert.match(routes, /receipt_number/);
  assert.match(routes, /INSERT INTO equipment_sale_payment_allocations/);
  assert.match(routes, /refreshAgreement/);
  assert.match(routes, /await connection\.beginTransaction\(\)/);
  assert.match(routes, /await connection\.commit\(\)/);
  assert.match(routes, /await connection\.rollback\(\)/);
  assert.match(routes, /connection\.release\(\)/);
});

test("delivery and ownership transfer require commercial safeguards", () => {
  assert.match(routes, /function deliveryAllowed/);
  assert.match(routes, /DELIVERY_PAYMENT_THRESHOLD_NOT_MET/);
  assert.match(routes, /INSERT INTO equipment_deliveries/);
  assert.match(routes, /delivery_status = 'delivered'/);
  assert.match(routes, /OWNERSHIP_BALANCE_REMAINS/);
  assert.match(routes, /Record equipment delivery before ownership transfer/);
  assert.match(routes, /INSERT INTO equipment_ownership_transfers/);
  assert.match(routes, /ownership_status = 'transferred'/);
  assert.match(routes, /sale_status = 'sold'/);
  assert.match(routes, /current_status = 'sold'/);
});

test("Equipment Sales SMS uses the existing provider and stores workspace context", () => {
  assert.match(routes, /sendSmsAlertToPhone/);
  assert.match(routes, /equipment_sales_reminder_log/);
  assert.match(routes, /workspace_code = 'equipment_hire'/);
  assert.match(routes, /entity_type = 'equipment_sale_agreement'/);
  assert.match(routes, /template_code = \?/);
  assert.match(routes, /agreement_created/);
  assert.match(routes, /payment_receipt/);
  assert.match(routes, /delivered/);
  assert.match(routes, /ownership_ready/);
});

test("full-system backup discovers Equipment Sales tables from the live schema", () => {
  assert.match(backupRoutes, /information_schema\.TABLES/);
  assert.match(backupRoutes, /classifyDatabaseTables/);
  assert.match(backupRoutes, /included_tables/);
  assert.match(backupSafety, /currentIncludedTables/);
  assert.match(backupSafety, /Backup is missing current required tables/);
  assert.doesNotMatch(
    backupRoutes,
    /const PREFERRED_TABLE_ORDER|equipment_sales_enquiries[\s\S]*equipment_ownership_transfers/
  );
});
