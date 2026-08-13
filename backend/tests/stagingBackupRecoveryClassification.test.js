const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
} = require("../services/backupSafetyService");
const {
  DATA_REPAIR_MIGRATIONS,
  discoverMigrationPlan,
} = require("../scripts/prepareStagingBackupRecoverySchema");

const MIGRATION_NAME =
  "20260805_equipment_finance_opening_deposit_foundation_repair";

test("Equipment Finance opening-deposit foundation repair remains a structural recovery migration", () => {
  assert.equal(DATA_REPAIR_MIGRATIONS.has(MIGRATION_NAME), false);

  const result = discoverMigrationPlan({
    backup_type: BACKUP_TYPE,
    version: BACKUP_MANIFEST_VERSION,
    schema_migrations: [{ migration_name: MIGRATION_NAME }],
    tables: {},
  });

  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.excludedDataMigrations, []);
  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].migrationName, MIGRATION_NAME);
  assert.match(
    result.plan[0].filePath,
    /20260805_equipment_finance_opening_deposit_foundation_repair\.sql$/
  );
});
