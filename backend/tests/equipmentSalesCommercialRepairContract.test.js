const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesCommercialRepairService.js"),
  "utf8"
);
const readiness = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesSchemaService.js"),
  "utf8"
);
const middleware = fs.readFileSync(
  path.resolve(__dirname, "../middleware/equipmentSalesReadinessMiddleware.js"),
  "utf8"
);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
);

const COMMERCIAL_TABLES = [
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
  "equipment_legacy_installment_migrations",
];

test("commercial readiness contract covers every Equipment Sales lifecycle table", () => {
  for (const tableName of COMMERCIAL_TABLES) {
    assert.match(service, new RegExp(`${tableName}: \\{`));
  }

  for (const requiredColumn of [
    "enquiry_number",
    "quotation_number",
    "quotation_item_id",
    "agreement_number",
    "outstanding_balance",
    "overdue_amount",
    "schedule_status",
    "payment_number",
    "receipt_number",
    "delivery_number",
    "transfer_number",
    "reminder_key",
    "source_snapshot_json",
  ]) {
    assert.match(service, new RegExp(`"${requiredColumn}"`));
  }

  assert.match(service, /async function verifyCommercialSalesSchema/);
  assert.match(service, /missing_columns/);
});

test("Equipment Sales runtime readiness is read-only and fails closed", () => {
  assert.doesNotMatch(service, /CREATE\s+TABLE/i);
  assert.doesNotMatch(service, /ALTER\s+TABLE/i);
  assert.doesNotMatch(service, /DROP\s+(?:TABLE|TRIGGER|PROCEDURE)/i);
  assert.doesNotMatch(service, /INSERT\s+INTO\s+schema_migrations/i);
  assert.doesNotMatch(service, /GET_LOCK/i);
  assert.match(service, /verification_only: true/);
  assert.match(service, /statusCode = 503/);
});

test("production imports only read-only Equipment Sales verification", () => {
  assert.match(readiness, /verifyCommercialSalesSchema/);
  assert.doesNotMatch(readiness, /ensureCommercialSalesSchema/);
  assert.match(readiness, /verifyCatalogueCore/);
  assert.match(readiness, /verifyFoundationSafety/);

  assert.match(middleware, /EQUIPMENT_SALES_SCHEMA_NOT_READY/);
  assert.match(
    middleware,
    /Equipment Catalogue and normal Hire operations remain available/
  );
  assert.match(middleware, /status\?\.full_ready/);
});

test("Railway start uses controlled deployment and no repair preload", () => {
  assert.equal(
    packageJson.scripts.start,
    "node scripts/runControlledDeployment.js --deployment && node server.js"
  );
  assert.doesNotMatch(packageJson.scripts.start, /equipmentSalesCommercialBootstrap/);
});

test("normal server startup has no active commercial repair caller", () => {
  const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const packageSource = JSON.stringify(packageJson);
  assert.doesNotMatch(server, /ensureCommercialSalesSchema/);
  assert.doesNotMatch(packageSource, /ensureCommercialSalesSchema/);
  assert.doesNotMatch(server, /CommercialRepair/);
});
