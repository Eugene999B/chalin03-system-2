const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  EPHEMERAL_SECURITY_TABLES,
  NEVER_RESTORE_TABLES,
  TECHNICAL_RECOVERY_TABLES,
} = require("../services/backupSafetyService");
const {
  DATA_REPAIR_MIGRATIONS,
  STAGING_DATABASE_ISOLATION_CONFIRMATION,
  assertRecoveryEnvironment,
  assertSchemaPreparationSql,
  discoverMigrationPlan,
} = require("../scripts/prepareStagingBackupRecoverySchema");

const repositoryRoot = path.resolve(__dirname, "../..");
const routeSource = fs.readFileSync(
  path.join(repositoryRoot, "backend/routes/stagingBackupRecoveryRoutes.js"),
  "utf8"
);
const serverSource = fs.readFileSync(
  path.join(repositoryRoot, "backend/server.js"),
  "utf8"
);
const frontendSource = fs.readFileSync(
  path.join(repositoryRoot, "frontend/src/pages/BackupPage.jsx"),
  "utf8"
);

function backupWithMigrations(names) {
  return {
    backup_type: BACKUP_TYPE,
    version: BACKUP_MANIFEST_VERSION,
    schema_migrations: names.map((migration_name) => ({ migration_name })),
    tables: {},
  };
}

test("technical migration snapshots and passkey challenges are never restored", () => {
  for (const tableName of TECHNICAL_RECOVERY_TABLES) {
    assert.equal(NEVER_RESTORE_TABLES.has(tableName), true, tableName);
  }
  assert.equal(EPHEMERAL_SECURITY_TABLES.has("passkey_challenges"), true);
  assert.equal(NEVER_RESTORE_TABLES.has("passkey_challenges"), true);
});

test("staging recovery environment requires confirmed Railway staging, internal DB, isolation token and restore window", () => {
  const validEnv = {
    NODE_ENV: "production",
    RAILWAY_PUBLIC_DOMAIN: "chalin03-system-2-staging.up.railway.app",
    DB_HOST: "mysql.railway.internal",
    CHALIN_ONE_STAGING_DATABASE_ISOLATION:
      STAGING_DATABASE_ISOLATION_CONFIRMATION,
    ALLOW_WEB_RESTORE: "true",
  };
  assert.doesNotThrow(() => assertRecoveryEnvironment(validEnv));

  assert.throws(
    () =>
      assertRecoveryEnvironment({
        ...validEnv,
        RAILWAY_PUBLIC_DOMAIN: "chalin03-system-2-production.up.railway.app",
      }),
    /staging environment/i
  );
  assert.throws(
    () => assertRecoveryEnvironment({ ...validEnv, DB_HOST: "production.example.com" }),
    /internal Railway staging MySQL host/i
  );
  assert.throws(
    () => assertRecoveryEnvironment({ ...validEnv, ALLOW_WEB_RESTORE: "false" }),
    /restore window/i
  );
});

test("schema preparation rejects destructive SQL but permits additive helper procedure cleanup", () => {
  assert.throws(
    () => assertSchemaPreparationSql("DELETE FROM users;", "bad", "bad.sql"),
    /DELETE FROM/i
  );
  assert.throws(
    () => assertSchemaPreparationSql("DROP TABLE users;", "bad", "bad.sql"),
    /DROP TABLE/i
  );
  assert.throws(
    () =>
      assertSchemaPreparationSql(
        "ALTER TABLE users DROP COLUMN phone;",
        "bad",
        "bad.sql"
      ),
    /ALTER TABLE DROP/i
  );
  assert.doesNotThrow(() =>
    assertSchemaPreparationSql(
      "DROP PROCEDURE IF EXISTS helper; CREATE TABLE IF NOT EXISTS recovery_test (id INT PRIMARY KEY);",
      "safe",
      "safe.sql"
    )
  );
});

test("migration discovery selects trusted production structural sources and excludes data repairs", () => {
  const backup = backupWithMigrations([
    "release3_group_command_configuration",
    "release3b_mining_operations_control",
    "20260731_equipment_finance_professional_rebuild",
    "equipment_finance_phase5a_private_documents",
    "20260805_master_mickey_july31_exact_debt_repair",
    "migration_source_that_is_not_in_repository",
  ]);
  const result = discoverMigrationPlan(backup);
  const selected = new Set(result.plan.map((item) => item.migrationName));

  assert.equal(selected.has("release3_group_command_configuration"), true);
  assert.equal(selected.has("release3b_mining_operations_control"), true);
  assert.equal(
    selected.has("20260731_equipment_finance_professional_rebuild"),
    true
  );
  assert.equal(selected.has("equipment_finance_phase5a_private_documents"), true);
  assert.equal(
    result.excludedDataMigrations.includes(
      "20260805_master_mickey_july31_exact_debt_repair"
    ),
    true
  );
  assert.equal(
    DATA_REPAIR_MIGRATIONS.has("20260805_master_mickey_july31_exact_debt_repair"),
    true
  );
  assert.equal(
    result.unresolved.includes("migration_source_that_is_not_in_repository"),
    true
  );
});

test("signed-v2 staging router owns dry-run, preparation and restore preflight before legacy backup routers", () => {
  assert.match(routeSource, /\/restore\/dry-run/);
  assert.match(routeSource, /\/restore\/prepare-staging-schema/);
  assert.match(routeSource, /STAGING_SCHEMA_BEHIND_BACKUP/);
  assert.match(routeSource, /source_only_columns/);
  assert.match(routeSource, /requireProtectedAction/);
  assert.match(routeSource, /requirePermission\("backup\.restore"\)/);
  assert.match(routeSource, /checksumBackup\(backup\)/);

  const stagingMount = serverSource.indexOf(
    'app.use("/api/backups", stagingBackupRecoveryRoutes);'
  );
  const delegatedMount = serverSource.indexOf(
    'app.use("/api/backups", delegatedBackupRoutes);'
  );
  const canonicalMount = serverSource.indexOf(
    'app.use("/api/backups", backupRoutes);'
  );
  assert.ok(stagingMount >= 0);
  assert.ok(stagingMount < delegatedMount);
  assert.ok(delegatedMount < canonicalMount);
});

test("Backup page exposes one-click trial schema preparation and blocks restore on table or column gaps", () => {
  assert.match(frontendSource, /Prepare Trial Schema/);
  assert.match(frontendSource, /prepare-staging-schema/);
  assert.match(frontendSource, /sourceOnlyColumnCount/);
  assert.match(frontendSource, /Production columns missing in trial schema/);
  assert.match(
    frontendSource,
    /sourceOnlyTables\.length === 0[\s\S]*sourceOnlyColumns === 0/
  );
});
