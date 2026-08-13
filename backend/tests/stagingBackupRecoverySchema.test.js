const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
  EPHEMERAL_SECURITY_TABLES,
  NEVER_RESTORE_TABLES,
  TECHNICAL_RECOVERY_TABLES,
  isConfirmedRailwayStaging,
} = require("../services/backupSafetyService");
const {
  DATA_REPAIR_MIGRATIONS,
  SCHEMA_CHECKPOINT_MIGRATIONS,
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
const sparePartsRecoverySource = fs.readFileSync(
  path.join(repositoryRoot, "database/recovery/spare_parts_sales_hotfix.sql"),
  "utf8"
);

const PRODUCTION_BACKUP_20260812_MIGRATIONS = Object.freeze([
  "20260714_cash_control_security_migration",
  "20260718_release3d_notifications_group_alerts",
  "20260718_release3e_shared_reports_documents_roles_audit",
  "20260718_release3fb_professional_installment_sales",
  "20260718_release3fd2_worker_identity_cards",
  "20260719_standalone_employment_documents_signature",
  "20260719_worker_hr_letters",
  "20260722_bank_biometric_device_reset_v1",
  "20260722_equipment_sales_installments_foundation",
  "20260723_equipment_catalogue_core_compatibility_repair_v2",
  "20260723_equipment_sales_commercial_column_repair_v1",
  "20260723_release31_audit_schema_baseline",
  "20260723_release31_audit_schema_safety",
  "20260723_release31_database_safety_guards",
  "20260723_release31_runtime_schema_baseline",
  "20260725_phase1_financial_control_hardening",
  "20260725_post_phase1_audit_signoff_readiness",
  "20260726_mining_trial_data_cleanup",
  "20260729_equipment_credit_application_foundation",
  "20260729_equipment_finance_agreement_activation",
  "20260729_equipment_finance_deposit_reservation",
  "20260729_equipment_finance_final_lifecycle",
  "20260731_equipment_finance_operational_polish",
  "20260731_equipment_finance_professional_rebuild",
  "20260801_equipment_finance_phase1_schema_foundation",
  "20260802_boss_approved_product_quantity_correction",
  "20260803_equipment_finance_phase3_agreement_creation",
  "20260803_equipment_finance_phase4_deposit_reservation_integrity",
  "20260803_equipment_finance_phase5_unified_documents",
  "20260803_equipment_finance_phase6_performance",
  "20260804_boss_approved_product_quantity_correction",
  "20260804_equipment_finance_phase3_application_pipeline",
  "20260805_automatic_customer_merge_rollback",
  "20260805_equipment_finance_opening_deposit_foundation_repair",
  "20260805_exact_name_receipt_owner_recovery",
  "20260805_master_mickey_july31_exact_debt_repair",
  "20260805_missing_credit_debt_backfill",
  "20260805_post_rollback_debt_account_reconciliation",
  "20260805_unpaid_receipt_identity_isolation",
  "20260805_user_authorized_equipment_installment_restart_reset",
  "20260805_user_authorized_installment_finance_excavator_cleanup",
  "20260805_zero_payment_credit_debt_visibility_repair",
  "20260806_kwabena_main_store_quantity_correction",
  "20260806_master_mickey_merge_profile_visibility",
  "20260810_payroll_financial_foundation",
  "clean_master_database_reset",
  "equipment_finance_phase4_balance_guard",
  "equipment_finance_phase4_corrections_settlements",
  "equipment_finance_phase5a_private_documents",
  "equipment_finance_phase5b_document_review",
  "equipment_finance_phase5c_delivery_authorization",
  "equipment_finance_phase5d_delivery_confirmation",
  "equipment_finance_phase6_reporting_notifications",
  "equipment_hire_part4_5c",
  "release2_final_security_backup_workers_executive",
  "release2a1_one_active_session",
  "release2a2_account_lock_otp",
  "release2d_worker_profile_expansion",
  "release2f_worker_print_pack",
  "release3_group_command_configuration",
  "release3_owner_mfa_security",
  "release3b_mining_operations_control",
  "release3c_hire_commercial_completion",
  "release3fa_authentication_sessions_ux",
  "release3fc_user_permissions_security_messages",
  "release3fc2_category_isolation_guides_receipts_workers",
  "release3fc3_mobile_id_expense_funding",
  "shared_fleet_mining_baseline",
  "spare_parts_sales_hotfix",
  "stage6a_group_users_staff",
  "stage6b_permissions_audit_migration",
  "stage6c_reliability_migration",
  "stage6d_security_migration",
]);

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

test("staging recovery environment uses existing Railway staging identity, internal DB and restore window", () => {
  const validEnv = {
    NODE_ENV: "production",
    RAILWAY_PUBLIC_DOMAIN: CHALIN_ONE_STAGING_PUBLIC_DOMAIN,
    DB_HOST: "mysql.railway.internal",
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
    /internal Railway MySQL host/i
  );
  assert.throws(
    () => assertRecoveryEnvironment({ ...validEnv, ALLOW_WEB_RESTORE: "false" }),
    /restore window/i
  );
});

test("staging identity also recognizes the configured CHALIN ONE frontend without trusting production hosts", () => {
  assert.equal(
    isConfirmedRailwayStaging({
      NODE_ENV: "production",
      FRONTEND_URL: "https://chalin-one-staging-preview.pages.dev",
    }),
    true
  );
  assert.equal(
    isConfirmedRailwayStaging({
      NODE_ENV: "production",
      FRONTEND_URL_ALT: "https://chalin-one.chalin03-system-2.pages.dev",
    }),
    true
  );
  assert.equal(
    isConfirmedRailwayStaging({
      NODE_ENV: "production",
      FRONTEND_URL: "https://chalin03.com",
    }),
    false
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

test("Spare Parts legacy hotfix recovery restores schema without replaying historical sale updates", () => {
  assert.match(sparePartsRecoverySource, /amount_tendered/);
  assert.match(sparePartsRecoverySource, /change_due/);
  assert.match(sparePartsRecoverySource, /edited_by/);
  assert.doesNotMatch(sparePartsRecoverySource, /\bUPDATE\s+sales\b/i);
  assert.doesNotMatch(sparePartsRecoverySource, /\bDELETE\s+FROM\b/i);
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

test("legacy migration names resolve to explicit recovery-safe sources or documented checkpoints", () => {
  const result = discoverMigrationPlan(
    backupWithMigrations([
      "stage6a_group_users_staff",
      "spare_parts_sales_hotfix",
      "20260723_release31_audit_schema_safety",
      "20260723_release31_database_safety_guards",
      "20260723_release31_audit_schema_baseline",
      "20260723_release31_runtime_schema_baseline",
    ])
  );
  const byName = new Map(result.plan.map((item) => [item.migrationName, item.filePath]));
  const checkpoints = new Set(
    result.checkpointMigrations.map((item) => item.migration_name)
  );

  assert.match(
    byName.get("stage6a_group_users_staff") || "",
    /stage6a_group_users_staff_migration\.sql$/
  );
  assert.match(
    byName.get("spare_parts_sales_hotfix") || "",
    /database[\\/]recovery[\\/]spare_parts_sales_hotfix\.sql$/
  );
  assert.match(
    byName.get("20260723_release31_audit_schema_safety") || "",
    /database[\\/]recovery[\\/]20260723_release31_audit_schema_safety\.sql$/
  );
  assert.match(
    byName.get("20260723_release31_database_safety_guards") || "",
    /database[\\/]recovery[\\/]20260723_release31_database_safety_guards\.sql$/
  );
  assert.equal(checkpoints.has("20260723_release31_audit_schema_baseline"), true);
  assert.equal(checkpoints.has("20260723_release31_runtime_schema_baseline"), true);
});

test("the exact 2026-08-12 production backup migration history is fully classified for safe recovery", () => {
  assert.equal(PRODUCTION_BACKUP_20260812_MIGRATIONS.length, 73);
  const result = discoverMigrationPlan(
    backupWithMigrations(PRODUCTION_BACKUP_20260812_MIGRATIONS)
  );
  const expectedDataRepairs = PRODUCTION_BACKUP_20260812_MIGRATIONS.filter((name) =>
    DATA_REPAIR_MIGRATIONS.has(name)
  ).sort();
  const expectedCheckpoints = PRODUCTION_BACKUP_20260812_MIGRATIONS.filter((name) =>
    SCHEMA_CHECKPOINT_MIGRATIONS.has(name)
  ).sort();
  const actualCheckpoints = result.checkpointMigrations
    .map((item) => item.migration_name)
    .sort();

  assert.deepEqual(
    result.unresolved,
    [],
    `Missing structural migration source(s): ${result.unresolved.join(", ")}`
  );
  assert.deepEqual([...result.excludedDataMigrations].sort(), expectedDataRepairs);
  assert.deepEqual(actualCheckpoints, expectedCheckpoints);
  assert.equal(
    result.plan.length +
      result.excludedDataMigrations.length +
      result.checkpointMigrations.length,
    PRODUCTION_BACKUP_20260812_MIGRATIONS.length
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
  assert.match(routeSource, /requestHost\(req\)/);
  assert.match(routeSource, /CHALIN_ONE_STAGING_PUBLIC_DOMAIN/);
  assert.match(routeSource, /recoveryEnvironmentForRequest\(req\)/);
  assert.match(routeSource, /recovery_route:\s*"staging_signed_v2"/);
  assert.match(routeSource, /X-Chalin03-Backup-Route/);

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

test("staging recovery falls back to server-side database markers and never trusts forwarded-host authority", () => {
  assert.doesNotMatch(routeSource, /x-forwarded-host/i);
  assert.match(routeSource, /STAGING_RECOVERY_DATABASE_MARKERS/);
  assert.match(routeSource, /chalin_one_full_staging_completion_v1/);
  assert.match(routeSource, /chalin_one_staging_auth_baseline_v1/);
  assert.match(routeSource, /chalin_one_staging_clean_master_schema_bootstrap_v1/);
  assert.match(routeSource, /SELECT migration_name[\s\S]*FROM schema_migrations/);
  assert.match(routeSource, /stagingRecoveryDatabaseConfirmed/);
  assert.match(routeSource, /isConfirmedStagingDatabase\(\)/);
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
