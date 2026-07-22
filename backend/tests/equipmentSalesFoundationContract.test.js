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
const verification = read(
  "database/migrations/20260722_equipment_sales_installments_verify.sql"
);
const backupRoutes = read("backend/routes/backupRoutes.js");
const resetScript = read("backend/scripts/resetDatabaseFromBackup.js");
const restoreVerifier = read("backend/scripts/verifyRestoredDatabase.js");
const implementationGuide = read(
  "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md"
);

const REQUIRED_TABLES = [
  "equipment_media",
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

test("equipment sales migration remains additive and production guarded", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/i);
  assert.match(migration, /BACKUP REQUIRED/i);
  assert.match(migration, /INSERT INTO schema_migrations/i);
  assert.doesNotMatch(migration, /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /FOREIGN_KEY_CHECKS\s*=\s*0/i);
});

test("shared equipment catalogue supports identity, pictures, sale and hire", () => {
  for (const column of [
    "hire_location_id",
    "equipment_category",
    "model_year",
    "chassis_number",
    "engine_number",
    "condition_status",
    "operational_purpose",
    "sale_status",
    "target_selling_price",
    "standard_hire_rate",
    "main_image_url",
  ]) {
    assert.match(migration, new RegExp(`'fleet_assets',\\s*'${column}'`));
  }

  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_media/i);
  assert.match(migration, /serial_plate/);
  assert.match(migration, /delivery/);
  assert.match(migration, /ownership/);
});

test("equipment sale and installment lifecycle tables are complete", () => {
  for (const tableName of REQUIRED_TABLES) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\b`, "i")
    );
    assert.match(verification, new RegExp(`'${tableName}'`));
  }

  assert.match(migration, /sale_type ENUM\('cash','installment'\)/i);
  assert.match(migration, /payment_frequency ENUM\('weekly','fortnightly','monthly','custom'\)/i);
  assert.match(migration, /delivery_policy ENUM/i);
  assert.match(migration, /ownership_status ENUM/i);
  assert.match(migration, /legacy_installment_agreement_id/i);
});

test("database guards prevent the same unit being sold and hired", () => {
  for (const triggerName of [
    "trg_hire_contract_asset_sale_guard_before_insert",
    "trg_hire_contract_asset_sale_guard_before_update",
    "trg_equipment_sale_agreement_hire_guard_before_insert",
    "trg_equipment_sale_agreement_hire_guard_before_update",
  ]) {
    assert.match(migration, new RegExp(triggerName));
    assert.match(verification, new RegExp(`'${triggerName}'`));
  }

  assert.match(migration, /assigned','dispatched','active/);
  assert.match(migration, /reserved','installment_active','sold/);
  assert.match(verification, /active_hire_and_sale_conflicts/);
});

test("central SMS log receives workspace and Equipment Hire context", () => {
  for (const column of [
    "workspace_code",
    "business_unit_id",
    "hire_location_id",
    "entity_type",
    "entity_id",
    "template_code",
    "deduplication_key",
    "scheduled_for",
    "consent_basis",
  ]) {
    assert.match(migration, new RegExp(`'sms_log',\\s*'${column}'`));
  }
});

test("backup and restore contracts include every new equipment sales table", () => {
  for (const tableName of REQUIRED_TABLES) {
    const tablePattern = new RegExp(`['\"]${tableName}['\"]`);
    assert.match(backupRoutes, tablePattern, `${tableName} missing from backup order`);
    assert.match(resetScript, tablePattern, `${tableName} missing from reset contract`);
    assert.match(restoreVerifier, tablePattern, `${tableName} missing from restore verification`);
  }
});

test("implementation guide preserves workspace separation and legacy records", () => {
  assert.match(implementationGuide, /Equipment Sales & Hire/);
  assert.match(implementationGuide, /Spare Parts remains a fast retail/i);
  assert.match(implementationGuide, /never deleted automatically/i);
  assert.match(implementationGuide, /must not be merged or deployed/i);
  assert.match(implementationGuide, /Android image capture/i);
});
