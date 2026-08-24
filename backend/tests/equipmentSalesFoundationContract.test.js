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
const backupSafety = read("backend/services/backupSafetyService.js");
const resetScript = read("backend/scripts/resetDatabaseFromBackup.js");
const restoreVerifier = read("backend/scripts/verifyRestoredDatabase.js");
const catalogueRoutes = read("backend/routes/equipmentCatalogueRoutes.js");
const catalogueIntegrityMiddleware = read(
  "backend/middleware/equipmentCatalogueIntegrityMiddleware.js"
);
const server = read("backend/server.js");
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

const SALE_HIRE_GUARDS = [
  "trg_hire_contract_asset_sale_guard_before_insert",
  "trg_hire_contract_asset_sale_guard_before_update",
  "trg_equipment_sale_agreement_hire_guard_before_insert",
  "trg_equipment_sale_agreement_hire_guard_before_update",
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
  assert.match(
    migration,
    /payment_frequency ENUM\('weekly','fortnightly','monthly','custom'\)/i
  );
  assert.match(migration, /delivery_policy ENUM/i);
  assert.match(migration, /ownership_status ENUM/i);
  assert.match(migration, /legacy_installment_agreement_id/i);
});

test("database guards prevent the same unit being sold and hired", () => {
  for (const triggerName of SALE_HIRE_GUARDS) {
    assert.match(migration, new RegExp(triggerName));
    assert.match(verification, new RegExp(`'${triggerName}'`));
    assert.match(resetScript, new RegExp(`"${triggerName}"`));
    assert.match(restoreVerifier, new RegExp(`"${triggerName}"`));
  }

  assert.match(migration, /assigned','dispatched','active/);
  assert.match(migration, /reserved','installment_active','sold/);
  assert.match(verification, /active_hire_and_sale_conflicts/);
  assert.match(restoreVerifier, /activeHireSaleConflicts/);
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

test("backup dynamically covers every new equipment sales table", () => {
  for (const tableName of REQUIRED_TABLES) {
    const tablePattern = new RegExp(`['"]${tableName}['"]`);
    assert.match(resetScript, tablePattern, `${tableName} missing from reset contract`);
    assert.match(
      restoreVerifier,
      tablePattern,
      `${tableName} missing from restore verification`
    );
  }

  assert.match(backupRoutes, /chalin03-full-system-v2/);
  assert.match(backupRoutes, /getAllBaseTables/);
  assert.match(backupRoutes, /classifyDatabaseTables/);
  assert.match(backupSafety, /currentIncludedTables/);
  assert.match(backupSafety, /Backup is missing current required tables/);
  assert.doesNotMatch(backupRoutes, /const PREFERRED_TABLE_ORDER/);
  assert.match(resetScript, /database\.endsWith\("_test"\)/);
  assert.match(resetScript, /EQUIPMENT_SALES_MIGRATION_PATH/);
  assert.match(restoreVerifier, /applicationTablesExpected:\s*67/);
  assert.match(restoreVerifier, /hireTriggersExpected:\s*20/);
});

test("Equipment Catalogue API is location scoped and explicitly protected", () => {
  assert.match(catalogueRoutes, /resolveHireLocationScope/);
  assert.match(catalogueRoutes, /requireSelectedLocation/);
  assert.match(catalogueRoutes, /appendHireLocationFilter/);
  assert.match(catalogueRoutes, /assertRecordInHireLocation/);
  assert.match(catalogueRoutes, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(catalogueRoutes, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(catalogueRoutes, /workspaceCode:\s*"equipment_hire"/);
  assert.match(server, /require\("\.\/routes\/equipmentCatalogueRoutes"\)/);
  assert.match(server, /enforceEquipmentCatalogueWriteIntegrity/);
  assert.match(server, /"\/api\/equipment-catalogue"/);
  assert.match(
    server,
    /hireBoundary,\s*enforceEquipmentCatalogueWriteIntegrity,\s*equipmentCatalogueRoutes/s
  );
});

test("Equipment Catalogue writes always settle their transactions", () => {
  assert.match(catalogueRoutes, /async function withTransaction/);
  assert.match(catalogueRoutes, /await connection\.beginTransaction\(\)/);
  assert.match(catalogueRoutes, /await connection\.commit\(\)/);
  assert.match(catalogueRoutes, /await connection\.rollback\(\)/);
  assert.match(catalogueRoutes, /connection\.release\(\)/);
  assert.doesNotMatch(catalogueRoutes, /beginTransaction[\s\S]{0,500}return res\./);
});

test("equipment pictures remain auditable instead of being deleted", () => {
  assert.match(catalogueRoutes, /\/assets\/:id\/media/);
  assert.match(catalogueRoutes, /media\/:mediaId\/primary/);
  assert.match(catalogueRoutes, /media\/:mediaId\/archive/);
  assert.match(catalogueRoutes, /archived_at = NOW\(\)/);
  assert.match(catalogueRoutes, /archive_reason/);
  assert.match(catalogueRoutes, /EQUIPMENT_MEDIA_ARCHIVED/);
  assert.match(catalogueRoutes, /main_image_url/);
  assert.doesNotMatch(catalogueRoutes, /router\.delete\s*\(/i);
  assert.doesNotMatch(catalogueRoutes, /DELETE\s+FROM\s+equipment_media/i);
});

test("secure equipment photos accept image data, preserve full images and use a sane quality ceiling", () => {
  assert.match(catalogueIntegrityMiddleware, /MAX_PROTECTED_PHOTO_BYTES = 192 \* 1024/);
  assert.match(catalogueIntegrityMiddleware, /data:\(image\\\/\[\^;\]\+\);base64/);
  assert.match(catalogueIntegrityMiddleware, /mimeType\.startsWith\("image\/"\)/);
  assert.match(catalogueIntegrityMiddleware, /300000/);
  assert.match(catalogueIntegrityMiddleware, /crypto\.createHash\("sha256"\)/);
  assert.match(catalogueIntegrityMiddleware, /database-data-url:/);
  assert.match(catalogueIntegrityMiddleware, /EQUIPMENT_SECURE_PHOTO_UPLOADED/);
  assert.match(catalogueIntegrityMiddleware, /requireSelection: true/);
  assert.match(catalogueIntegrityMiddleware, /fleet\.assets\.manage/);
  assert.match(catalogueIntegrityMiddleware, /UPDATE equipment_media[\s\S]*is_primary = FALSE/);
  assert.match(catalogueIntegrityMiddleware, /UPDATE fleet_assets[\s\S]*main_image_url = \?/);
});

test("catalogue blocks direct sold registration and controlled-sale bypasses", () => {
  assert.match(catalogueRoutes, /New equipment cannot be registered as sold/);
  assert.match(catalogueRoutes, /EQUIPMENT_ACTIVE_ON_HIRE/);
  assert.match(catalogueRoutes, /EQUIPMENT_ACTIVE_SALE_LOCK/);
  assert.match(catalogueRoutes, /active_hire_assignment_count/);
  assert.match(catalogueRoutes, /active_sale_lock_status/);
  assert.match(catalogueIntegrityMiddleware, /CONTROLLED_EQUIPMENT_SALE_REQUIRED/);
  assert.match(catalogueIntegrityMiddleware, /requestedSaleStatus === "sold"/);
  assert.match(catalogueIntegrityMiddleware, /requestedCurrentStatus === "sold"/);
  assert.match(catalogueIntegrityMiddleware, /body\.sale_status = "not_for_sale"/);
  assert.match(catalogueIntegrityMiddleware, /body\.sale_status = "available"/);
  assert.match(
    catalogueIntegrityMiddleware,
    /EQUIPMENT_PURPOSE_SALE_STATUS_CONFLICT/
  );
});

test("implementation guide preserves workspace separation and legacy records", () => {
  assert.match(implementationGuide, /Equipment Sales & Hire/);
  assert.match(implementationGuide, /Spare Parts remains a fast retail/i);
  assert.match(implementationGuide, /never deleted automatically/i);
  assert.match(implementationGuide, /must not be merged or deployed/i);
  assert.match(implementationGuide, /Android image capture/i);
});
