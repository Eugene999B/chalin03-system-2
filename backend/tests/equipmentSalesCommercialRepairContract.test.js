const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesCommercialRepairService.js"),
  "utf8"
);
const bootstrap = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesCommercialBootstrap.js"),
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

test("commercial repair covers every Equipment Sales table and verifies columns", () => {
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

  assert.match(service, /async function addMissingColumns/);
  assert.match(service, /ALTER TABLE/);
  assert.match(service, /verifyCommercialSalesSchema/);
  assert.match(service, /missing_columns/);
  assert.match(service, /EQUIPMENT_SALES_COMMERCIAL_SCHEMA_INCOMPLETE/);
});

test("commercial repair is additive, advisory-locked and production safe", () => {
  assert.match(service, /chalin03_equipment_sales_finalization_v3/);
  assert.match(service, /SELECT GET_LOCK/);
  assert.match(service, /SELECT RELEASE_LOCK/);
  assert.match(service, /CREATE TABLE IF NOT EXISTS/);
  assert.match(service, /ADD COLUMN/);
  assert.doesNotMatch(service, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(service, /\bTRUNCATE\b/i);
  assert.doesNotMatch(service, /\bDELETE\s+FROM\b/i);
});

test("Railway start preloads non-blocking repair and retries until ready", () => {
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/equipmentSalesCommercialBootstrap.js server.js"
  );
  assert.match(bootstrap, /BOOT_DELAY_MS = 2 \* 1000/);
  assert.match(bootstrap, /RETRY_DELAY_MS = 60 \* 1000/);
  assert.match(bootstrap, /ensureCommercialSalesSchema/);
  assert.match(bootstrap, /if \(!ready\) schedule\(RETRY_DELAY_MS\)/);
  assert.match(bootstrap, /timer\.unref/);
  assert.match(bootstrap, /Catalogue and Hire remain available/);
});

test("production preload gates every Sales request on verified commercial columns", () => {
  assert.match(bootstrap, /require\("\.\/equipmentSalesSchemaService"\)/);
  assert.match(bootstrap, /const ensureCatalogueFoundation/);
  assert.match(
    bootstrap,
    /ensureEquipmentSalesSchemaWithCommercialColumns/
  );
  assert.match(bootstrap, /await ensureCatalogueFoundation/);
  assert.match(bootstrap, /await commercialRepairOnce\(\)/);
  assert.match(bootstrap, /full_ready: ready/);
  assert.match(bootstrap, /__chalin03CommercialColumnGateInstalled/);
  assert.match(bootstrap, /requestRepairPromise = null/);
});
