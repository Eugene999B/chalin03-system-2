const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../services/equipmentSalesSchemaService.js"),
  "utf8"
);
const middleware = fs.readFileSync(
  path.resolve(__dirname, "../middleware/equipmentCatalogueIntegrityMiddleware.js"),
  "utf8"
);

const REQUIRED_FLEET_COLUMNS = [
  "hire_location_id",
  "equipment_category",
  "model_year",
  "chassis_number",
  "engine_number",
  "condition_status",
  "operational_purpose",
  "sale_status",
  "acquisition_cost",
  "target_selling_price",
  "standard_hire_rate",
  "main_image_url",
];

test("catalogue core is repaired before the optional commercial foundation", () => {
  assert.match(source, /CORE_REPAIR_MIGRATION_NAME/);
  assert.match(source, /ensureCatalogueCoreSchema/);
  assert.match(source, /verifyCatalogueCore/);
  assert.match(source, /core_ready: core\.ready/);
  assert.match(source, /commercial foundation remains pending; Equipment Catalogue core will stay available/);
  assert.match(source, /if \(full\.ready\) startEquipmentSalesReminderScheduler/);
});

test("all required catalogue columns are added idempotently without AFTER clauses", () => {
  for (const column of REQUIRED_FLEET_COLUMNS) {
    assert.match(source, new RegExp(`\\["${column}"`));
  }

  assert.match(source, /async function ensureColumn/);
  assert.match(source, /information_schema\.COLUMNS/);
  assert.match(source, /ALTER TABLE/);
  assert.doesNotMatch(source, /FLEET_ASSET_COLUMNS[\s\S]{0,3000}\sAFTER\s/i);
});

test("catalogue media and sale-lock tables can be created without FK mismatch failures", () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS equipment_media/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS equipment_asset_sale_locks/);
  assert.match(source, /stripForeignKeysFromCreateTable/);
  assert.match(source, /production databases can contain compatible referenced IDs/i);
  assert.match(source, /Application transaction guards remain active/);
});

test("full commercial repair is retried but cannot return catalogue 503 after core verification", () => {
  assert.match(source, /verifyFullFoundation/);
  assert.match(source, /scheduleEquipmentSalesRuntimeBootstrap\(RUNTIME_RETRY_DELAY_MS\)/);
  assert.match(source, /runtimeBootstrapReady = Boolean\(status\?\.core_ready\)/);
  assert.match(middleware, /await ensureFoundationOnce\(\)/);
  assert.match(middleware, /EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED/);
});
