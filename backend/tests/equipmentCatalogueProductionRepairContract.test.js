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

const DDL_PATTERN =
  /\b(?:CREATE\s+(?:TABLE|TRIGGER|PROCEDURE)|ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE)|TRUNCATE)\b/i;

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

test("catalogue core is verified before Equipment Sales requests", () => {
  assert.match(source, /verifyCatalogueCore/);
  assert.match(source, /verifyFullFoundation/);
  assert.match(source, /assertEquipmentSalesSchemaReady/);
  assert.match(source, /runtime_mutation_disabled: true/);
  assert.match(middleware, /await ensureFoundationOnce\(\)/);
  assert.match(middleware, /EQUIPMENT_SALES_FOUNDATION_STARTUP_FAILED/);
});

test("all required catalogue columns are represented by read-only checks", () => {
  for (const column of REQUIRED_FLEET_COLUMNS) {
    assert.match(source, new RegExp(`"${column}"`));
  }

  assert.match(source, /information_schema\.COLUMNS/);
  assert.match(source, /information_schema\.TRIGGERS/);
  assert.doesNotMatch(source, DDL_PATTERN);
  assert.doesNotMatch(source, /ensureColumn/);
  assert.doesNotMatch(source, /ensureIndex/);
});

test("catalogue readiness never schedules automatic repair retries", () => {
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.doesNotMatch(source, /scheduleEquipmentSalesRuntimeBootstrap/);
  assert.doesNotMatch(source, /SELECT GET_LOCK/);
  assert.doesNotMatch(source, /SELECT RELEASE_LOCK/);
});
