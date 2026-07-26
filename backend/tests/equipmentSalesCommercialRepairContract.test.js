const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(backendRoot, relativePath), "utf8");

const schemaService = read("services/equipmentSalesSchemaService.js");
const serverSource = read("server.js");
const packageJson = JSON.parse(read("package.json"));

const DDL_PATTERN =
  /\b(?:CREATE\s+(?:TABLE|TRIGGER|PROCEDURE)|ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE)|TRUNCATE)\b/i;

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

test("Equipment Sales commercial schema is verified without runtime repair", () => {
  for (const tableName of COMMERCIAL_TABLES) {
    assert.match(schemaService, new RegExp(`"${tableName}"`));
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
    assert.match(schemaService, new RegExp(`"${requiredColumn}"`));
  }

  assert.match(schemaService, /assertEquipmentSalesSchemaReady/);
  assert.match(schemaService, /verifyFullFoundation/);
  assert.match(schemaService, /missing_columns/);
  assert.match(schemaService, /EQUIPMENT_SALES_SCHEMA_NOT_READY/);
  assert.doesNotMatch(schemaService, DDL_PATTERN);
});

test("Railway start never preloads commercial schema repair", () => {
  assert.match(
    packageJson.scripts.start,
    /node -r \.\/services\/exportWorkbookSafetyBootstrap\.js server\.js$/
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /equipmentSalesCommercial(?:Bootstrap|RepairService)/
  );
  assert.equal(
    fs.existsSync(
      path.join(backendRoot, "services/equipmentSalesCommercialBootstrap.js")
    ),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(backendRoot, "services/equipmentSalesCommercialRepairService.js")
    ),
    false
  );
});

test("production startup uses one read-only schema readiness gate", () => {
  assert.match(serverSource, /validateProductionSchemaReadiness/);
  assert.match(serverSource, /runtime schema mutation is disabled/);
  assert.doesNotMatch(serverSource, /equipmentSalesCommercialBootstrap/);
  assert.doesNotMatch(serverSource, /ensureCommercialSalesSchema/);
});
