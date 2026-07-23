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
  "equipment_installment_schedule",
  "equipment_sale_payments",
  "equipment_sale_payment_allocations",
  "equipment_deliveries",
  "equipment_ownership_transfers",
  "equipment_sales_reminder_log",
  "equipment_legacy_installment_migrations",
];

test("commercial contract covers every Equipment Sales table and required columns", () => {
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

test("production imports only read-only Equipment Sales verification", () => {
  assert.match(readiness, /verifyCommercialSalesSchema/);
  assert.doesNotMatch(readiness, /ensureCommercialSalesSchema/);
  assert.match(readiness, /verifyCatalogueCore/);
  assert.match(readiness, /verifyFoundationSafety/);

  assert.match(middleware, /EQUIPMENT_SALES_SCHEMA_NOT_READY/);
  assert.match(middleware, /Equipment Catalogue and normal Hire operations remain available/);
  assert.match(middleware, /status\?\.full_ready/);
});

test("Railway start uses controlled deployment and no repair preload", () => {
  assert.equal(
    packageJson.scripts.start,
    "node scripts/runControlledDeployment.js --deployment && node server.js"
  );
  assert.doesNotMatch(packageJson.scripts.start, /equipmentSalesCommercialBootstrap/);
  assert.equal(
    fs.existsSync(
      path.resolve(__dirname, "../services/equipmentSalesCommercialBootstrap.js")
    ),
    false
  );
});

test("legacy repair implementation has no active runtime caller", () => {
  const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const packageSource = JSON.stringify(packageJson);
  assert.doesNotMatch(server, /ensureCommercialSalesSchema/);
  assert.doesNotMatch(packageSource, /ensureCommercialSalesSchema/);
  assert.doesNotMatch(server, /CommercialRepair/);
});
