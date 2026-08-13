const test = require("node:test");
const assert = require("node:assert/strict");

const canonical = require("../services/backupSafetyService");
const compatibilityEntrypoint = require("../services/backupSafetyService/index.js");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  STAGING_RECOVERY_DATABASE_MARKERS,
  checksumBackup,
  validateBackupContract,
} = canonical;

function productionLikeStagingBackup() {
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: BACKUP_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    backup_id: "00000000-0000-4000-8000-000000000099",
    created_at: "2026-08-13T07:14:05.245Z",
    included_tables: ["future_production_table", "products"],
    excluded_tables: ["schema_migrations"],
    table_columns: {
      future_production_table: ["id", "value"],
      products: ["id", "name"],
    },
    table_counts: {
      future_production_table: 0,
      products: 1,
    },
    total_record_count: 1,
    schema_migrations: [{ migration_name: "future_production_migration" }],
    tables: {
      future_production_table: [],
      products: [{ id: 1, name: "Filter" }],
    },
  };
  backup.checksum_sha256 = checksumBackup(backup);
  // Cross-environment staging validates the signed-v2 package shape and exact
  // checksum, but must not claim it can authenticate production's HMAC secret.
  backup.signature_hmac_sha256 = "b".repeat(64);
  return backup;
}

test("directory compatibility entrypoint re-exports the canonical runtime validator", () => {
  assert.strictEqual(
    compatibilityEntrypoint.validateBackupContract,
    canonical.validateBackupContract
  );
});

test("staging DB markers force trial compatibility even under production-like Railway labels", () => {
  const report = validateBackupContract({
    backup: productionLikeStagingBackup(),
    currentIncludedTables: ["products", "trial_only_table"],
    currentTableColumns: {
      products: ["id", "name"],
      trial_only_table: ["id"],
    },
    currentTableMetadata: {
      products: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
        { name: "name", nullable: false, hasDefault: false, extra: "" },
      ],
      trial_only_table: [
        { name: "id", nullable: false, hasDefault: false, extra: "auto_increment" },
      ],
    },
    currentSchemaMigrations: [
      ...STAGING_RECOVERY_DATABASE_MARKERS.map((migration_name) => ({
        migration_name,
      })),
      { migration_name: "trial_only_migration" },
    ],
    signingSecret: "a".repeat(64),
    requireSignature: true,
    allowAdditiveSchemaDrift: true,
    recoveryEnvironment: {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
    },
  });

  assert.equal(report.valid, true, report.errors.join("\n"));
  assert.equal(report.crossEnvironmentRecovery, true);
  assert.equal(report.stagingRecoveryDatabaseConfirmed, true);
  assert.equal(report.signatureVerified, false);
  assert.deepEqual(report.sourceOnlyTables, ["future_production_table"]);
  assert.deepEqual(report.currentOnlyTables, ["trial_only_table"]);
  assert.equal(report.errors.length, 0);
  assert.match(
    report.warnings.join(" "),
    /future_production_table|future_production_migration|signature/i
  );
});
