"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { executeSqlScript } = require("./sqlScriptRunner");
const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  isConfirmedRailwayStaging,
} = require("../services/backupSafetyService");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const DATABASE_ROOT = path.join(REPOSITORY_ROOT, "database");
const MIGRATION_ROOT = path.join(DATABASE_ROOT, "migrations");
const RECOVERY_ROOT = path.join(DATABASE_ROOT, "recovery");
const LOCK_NAME = "chalin03:backup-recovery-schema:staging:v1";
const DEFAULT_BATCH_SIZE = 3;

// These production migrations intentionally changed or repaired business data.
// A staging schema preparation must never replay them; the signed backup itself
// is the source of production data for the recovery trial.
const DATA_REPAIR_MIGRATIONS = new Set([
  "20260722_bank_biometric_device_reset_v1",
  "20260726_mining_trial_data_cleanup",
  "20260802_boss_approved_product_quantity_correction",
  "20260804_boss_approved_product_quantity_correction",
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
]);

// Historical schema checkpoints are intentionally not replayed. They either
// describe the original clean baseline, were verification-only compatibility
// checkpoints, or were explicitly declared `mode: baseline` in the controlled
// Release 3.1 manifest. The restore gate still requires zero source-only tables
// and zero source-only columns after all replayable migrations have run, so a
// checkpoint can never hide an actual schema gap.
const SCHEMA_CHECKPOINT_MIGRATIONS = new Map([
  [
    "clean_master_database_reset",
    "Original clean-master schema baseline/reset marker; never replay a database reset during recovery.",
  ],
  [
    "equipment_hire_part4_5c",
    "Original Equipment Hire Parts 4-5C baseline marker; current staging already starts from the application baseline and later controlled Hire migrations remain replayable.",
  ],
  [
    "shared_fleet_mining_baseline",
    "Original shared Fleet/Mining baseline marker; later controlled Mining migrations remain replayable and final table/column parity is mandatory.",
  ],
  [
    "20260723_equipment_catalogue_core_compatibility_repair_v2",
    "Historical Equipment Catalogue compatibility checkpoint; the retained Release 3.1 implementation verifies readiness rather than replaying runtime DDL.",
  ],
  [
    "20260723_equipment_sales_commercial_column_repair_v1",
    "Historical Equipment Sales commercial compatibility checkpoint; the retained Release 3.1 implementation is verification-only and the controlled foundation remains replayable.",
  ],
  [
    "20260723_release31_audit_schema_baseline",
    "Controlled Release 3.1 manifest mode=baseline; verified by the audit-schema safety verifier and not a mutation migration.",
  ],
  [
    "20260723_release31_runtime_schema_baseline",
    "Controlled Release 3.1 manifest mode=baseline; records the verified runtime schema contract without mutation.",
  ],
]);

// A few pre-controlled migrations use a filename that predates the migration
// name stored in schema_migrations. Keep the relationship explicit rather than
// guessing by fuzzy matching.
const RECOVERY_MIGRATION_ALIASES = new Map([
  ["stage6a_group_users_staff", "stage6a_group_users_staff_migration.sql"],
]);

const LEGACY_VERIFIER_ALIASES = new Map([
  ["stage6a_group_users_staff_migration.sql", "stage6a_verify.sql"],
  ["stage6b_permissions_audit_migration.sql", "stage6b_verify.sql"],
  ["stage6c_reliability_migration.sql", "stage6c_verify.sql"],
  ["stage6d_security_migration.sql", "stage6d_verify.sql"],
]);

const FORBIDDEN_SCHEMA_PREPARATION_PATTERNS = Object.freeze([
  { pattern: /\bDROP\s+(?:TEMPORARY\s+)?TABLE\b/i, label: "DROP TABLE" },
  { pattern: /\bTRUNCATE\s+(?:TABLE\s+)?/i, label: "TRUNCATE" },
  { pattern: /\bDELETE\s+FROM\b/i, label: "DELETE FROM" },
  { pattern: /\bREPLACE\s+INTO\b/i, label: "REPLACE INTO" },
  { pattern: /\bRENAME\s+TABLE\b/i, label: "RENAME TABLE" },
  {
    pattern:
      /\bALTER\s+TABLE\b[\s\S]{0,500}?\bDROP\s+(?:COLUMN|INDEX|KEY|FOREIGN\s+KEY|CONSTRAINT)\b/i,
    label: "ALTER TABLE DROP",
  },
  {
    pattern: /\bCREATE\s+OR\s+REPLACE\s+TABLE\b/i,
    label: "CREATE OR REPLACE TABLE",
  },
  {
    pattern: /\bFOREIGN_KEY_CHECKS\s*=\s*0\b/i,
    label: "FOREIGN_KEY_CHECKS=0",
  },
]);

class StagingBackupSchemaPreparationError extends Error {
  constructor(message, code = "STAGING_BACKUP_SCHEMA_PREPARATION_FAILED") {
    super(message);
    this.name = "StagingBackupSchemaPreparationError";
    this.code = code;
  }
}

function clean(value) {
  return String(value ?? "").trim();
}

function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function assertSchemaPreparationSql(sql, migrationName, filePath) {
  const executableSql = stripSqlComments(sql);
  for (const rule of FORBIDDEN_SCHEMA_PREPARATION_PATTERNS) {
    if (rule.pattern.test(executableSql)) {
      throw new StagingBackupSchemaPreparationError(
        `Migration ${migrationName} is not eligible for staging schema preparation because ${rule.label} was detected in ${path.basename(
          filePath
        )}.`,
        "STAGING_BACKUP_SCHEMA_MIGRATION_NOT_ADDITIVE"
      );
    }
  }
}

function assertRecoveryEnvironment(env = process.env) {
  if (!isConfirmedRailwayStaging(env)) {
    throw new StagingBackupSchemaPreparationError(
      "Backup schema preparation may run only in the confirmed CHALIN ONE Railway staging environment.",
      "STAGING_BACKUP_SCHEMA_ENVIRONMENT_REQUIRED"
    );
  }

  const databaseHost = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST);
  if (!/\.railway\.internal$/i.test(databaseHost)) {
    throw new StagingBackupSchemaPreparationError(
      "Backup schema preparation requires the internal Railway MySQL host inside the confirmed staging environment.",
      "STAGING_BACKUP_SCHEMA_INTERNAL_DB_REQUIRED"
    );
  }

  if (clean(env.ALLOW_WEB_RESTORE).toLowerCase() !== "true") {
    throw new StagingBackupSchemaPreparationError(
      "Open the approved staging restore window before preparing the recovery schema.",
      "STAGING_BACKUP_SCHEMA_RESTORE_WINDOW_REQUIRED"
    );
  }
}

function assertSignedV2Backup(backup) {
  if (
    !backup ||
    backup.backup_type !== BACKUP_TYPE ||
    backup.version !== BACKUP_MANIFEST_VERSION ||
    !Array.isArray(backup.schema_migrations) ||
    !backup.tables ||
    typeof backup.tables !== "object"
  ) {
    throw new StagingBackupSchemaPreparationError(
      "Schema preparation requires a parsed signed-v2 CHALIN full-system backup.",
      "STAGING_BACKUP_SCHEMA_SIGNED_V2_REQUIRED"
    );
  }
}

function normalizedMigrationStem(fileName) {
  return path
    .basename(fileName, ".sql")
    .replace(/^\d{8}_/, "")
    .toLowerCase();
}

function migrationNamesFromBackup(backup) {
  return [
    ...new Set(
      (backup.schema_migrations || [])
        .map((row) => clean(row?.migration_name))
        .filter(Boolean)
    ),
  ];
}

function listSqlFiles(directory, directOnly = false) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!directOnly) files.push(...listSqlFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sql")) continue;
    files.push(fullPath);
  }
  return files;
}

function migrationSourceFiles() {
  return [
    ...listSqlFiles(RECOVERY_ROOT),
    ...listSqlFiles(DATABASE_ROOT, true),
    ...listSqlFiles(MIGRATION_ROOT),
  ].filter((filePath) => {
    const name = path.basename(filePath).toLowerCase();
    return (
      name !== "schema.sql" &&
      !name.includes("seed") &&
      !name.includes("rollback") &&
      !name.endsWith("_verify.sql") &&
      !name.endsWith("_verification.sql")
    );
  });
}

function sourceDateKey(filePath) {
  const fileName = path.basename(filePath, ".sql");
  const dated = fileName.match(/^(\d{8})_(.+)$/);
  if (dated) return `${dated[1]}:${dated[2]}`;
  const stageMatch = fileName.match(/^stage6([a-z])_/i);
  if (stageMatch) {
    return `20260713:${String(stageMatch[1]).toLowerCase()}:${fileName}`;
  }
  return `99999999:${fileName}`;
}

function sourcePriority(filePath) {
  if (
    filePath === RECOVERY_ROOT ||
    filePath.startsWith(`${RECOVERY_ROOT}${path.sep}`)
  ) {
    return 0;
  }
  if (
    filePath === MIGRATION_ROOT ||
    filePath.startsWith(`${MIGRATION_ROOT}${path.sep}`)
  ) {
    return 1;
  }
  return 2;
}

function discoverMigrationPlan(backup) {
  const sourceFiles = migrationSourceFiles();
  const backupMigrationNames = migrationNamesFromBackup(backup);
  const plan = [];
  const unresolved = [];
  const excludedDataMigrations = [];
  const checkpointMigrations = [];

  for (const migrationName of backupMigrationNames) {
    if (DATA_REPAIR_MIGRATIONS.has(migrationName)) {
      excludedDataMigrations.push(migrationName);
      continue;
    }

    if (SCHEMA_CHECKPOINT_MIGRATIONS.has(migrationName)) {
      checkpointMigrations.push({
        migration_name: migrationName,
        reason: SCHEMA_CHECKPOINT_MIGRATIONS.get(migrationName),
      });
      continue;
    }

    const lowerName = migrationName.toLowerCase();
    const normalizedName = lowerName.replace(/^\d{8}_/, "");
    const aliasFileName = clean(
      RECOVERY_MIGRATION_ALIASES.get(migrationName)
    ).toLowerCase();
    const matches = sourceFiles.filter((filePath) => {
      const baseName = path.basename(filePath).toLowerCase();
      const stem = path.basename(filePath, ".sql").toLowerCase();
      const normalizedStem = normalizedMigrationStem(filePath);
      return (
        (aliasFileName && baseName === aliasFileName) ||
        stem === lowerName ||
        normalizedStem === lowerName ||
        stem === normalizedName ||
        normalizedStem === normalizedName
      );
    });

    if (!matches.length) {
      unresolved.push(migrationName);
      continue;
    }

    matches.sort((left, right) => {
      const leftAlias =
        aliasFileName && path.basename(left).toLowerCase() === aliasFileName
          ? 0
          : 1;
      const rightAlias =
        aliasFileName && path.basename(right).toLowerCase() === aliasFileName
          ? 0
          : 1;
      if (leftAlias !== rightAlias) return leftAlias - rightAlias;
      const leftExact =
        path.basename(left, ".sql").toLowerCase() === lowerName ? 0 : 1;
      const rightExact =
        path.basename(right, ".sql").toLowerCase() === lowerName ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      const priorityDelta = sourcePriority(left) - sourcePriority(right);
      if (priorityDelta !== 0) return priorityDelta;
      return left.localeCompare(right);
    });

    plan.push({ migrationName, filePath: matches[0] });
  }

  plan.sort((left, right) =>
    sourceDateKey(left.filePath).localeCompare(sourceDateKey(right.filePath))
  );

  return {
    plan,
    unresolved,
    excludedDataMigrations,
    checkpointMigrations,
  };
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND TABLE_TYPE = 'BASE TABLE'`,
    [tableName]
  );
  return Number(row?.present || 0) === 1;
}

async function migrationRecorded(connection, migrationName) {
  if (!(await tableExists(connection, "schema_migrations"))) return false;
  const [rows] = await connection.query(
    `SELECT migration_name
       FROM schema_migrations
      WHERE migration_name = ?
      LIMIT 1`,
    [migrationName]
  );
  return Boolean(rows[0]);
}

async function recordRecoveryMigration(connection, migrationName, filePath) {
  if (!(await tableExists(connection, "schema_migrations"))) {
    throw new StagingBackupSchemaPreparationError(
      `Trusted recovery migration ${migrationName} completed but schema_migrations is unavailable, so completion cannot be recorded safely.`,
      "STAGING_BACKUP_SCHEMA_MIGRATION_LEDGER_REQUIRED"
    );
  }

  const source = path.relative(REPOSITORY_ROOT, filePath).replace(/\\/g, "/");
  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name)`,
    [
      migrationName,
      `Staging recovery replayed trusted additive schema source ${source}`.slice(
        0,
        240
      ),
    ]
  );
}

function verifierFor(filePath) {
  const directory = path.dirname(filePath);
  const stem = path.basename(filePath, ".sql");
  const direct = path.join(directory, `${stem}_verify.sql`);
  if (fs.existsSync(direct)) return direct;

  if (stem.endsWith("_foundation")) {
    const shorter = path.join(
      directory,
      `${stem.replace(/_foundation$/, "")}_verify.sql`
    );
    if (fs.existsSync(shorter)) return shorter;
  }

  const legacyName = LEGACY_VERIFIER_ALIASES.get(
    path.basename(filePath).toLowerCase()
  );
  if (legacyName) {
    const legacy = path.join(DATABASE_ROOT, legacyName);
    if (fs.existsSync(legacy)) return legacy;
  }

  return null;
}

async function acquireLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
    LOCK_NAME,
  ]);
  if (Number(row?.acquired || 0) !== 1) {
    throw new StagingBackupSchemaPreparationError(
      "Another staging recovery schema preparation is already running.",
      "STAGING_BACKUP_SCHEMA_LOCK_UNAVAILABLE"
    );
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch {
    // Connection close releases the advisory lock as a final fallback.
  }
}

async function pendingPlan(connection, plan) {
  const pending = [];
  for (const item of plan) {
    if (!(await migrationRecorded(connection, item.migrationName))) {
      pending.push(item);
    }
  }
  return pending;
}

async function prepareStagingBackupRecoverySchema({
  connection,
  backup,
  env = process.env,
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  assertRecoveryEnvironment(env);
  assertSignedV2Backup(backup);

  const boundedBatchSize = Math.max(1, Math.min(5, Number(batchSize) || 1));
  const discovery = discoverMigrationPlan(backup);
  const applied = [];
  const alreadyRecorded = [];
  const blocked = [];

  await acquireLock(connection);
  try {
    const initialPending = await pendingPlan(connection, discovery.plan);
    const pendingSet = new Set(initialPending.map((item) => item.migrationName));
    for (const item of discovery.plan) {
      if (!pendingSet.has(item.migrationName)) alreadyRecorded.push(item.migrationName);
    }

    for (const item of initialPending) {
      if (applied.length >= boundedBatchSize) break;
      const sql = fs.readFileSync(item.filePath, "utf8");
      try {
        assertSchemaPreparationSql(sql, item.migrationName, item.filePath);
      } catch (error) {
        blocked.push({
          migration_name: item.migrationName,
          file: path.relative(REPOSITORY_ROOT, item.filePath),
          code: error.code,
          message: error.message,
        });
        continue;
      }

      await executeSqlScript(
        connection,
        sql,
        `Staging recovery schema migration ${item.migrationName}`
      );

      const verifierPath = verifierFor(item.filePath);
      if (verifierPath) {
        const verifierSql = fs.readFileSync(verifierPath, "utf8");
        await executeSqlScript(
          connection,
          verifierSql,
          `Staging recovery schema verification ${item.migrationName}`
        );
      }

      if (!(await migrationRecorded(connection, item.migrationName))) {
        await recordRecoveryMigration(
          connection,
          item.migrationName,
          item.filePath
        );
      }

      applied.push({
        migration_name: item.migrationName,
        file: path.relative(REPOSITORY_ROOT, item.filePath),
        verifier: verifierPath
          ? path.relative(REPOSITORY_ROOT, verifierPath)
          : null,
        recorded_after_apply: await migrationRecorded(
          connection,
          item.migrationName
        ),
      });
    }

    const remaining = await pendingPlan(connection, discovery.plan);
    return {
      applied,
      already_recorded: alreadyRecorded,
      blocked,
      unresolved_source_migrations: discovery.unresolved,
      excluded_data_migrations: discovery.excludedDataMigrations,
      verified_schema_checkpoints: discovery.checkpointMigrations,
      remaining_candidate_migrations: remaining.map(
        (item) => item.migrationName
      ),
      remaining_candidate_count: remaining.length,
      batch_size: boundedBatchSize,
    };
  } finally {
    await releaseLock(connection);
  }
}

module.exports = {
  DATA_REPAIR_MIGRATIONS,
  DEFAULT_BATCH_SIZE,
  FORBIDDEN_SCHEMA_PREPARATION_PATTERNS,
  LEGACY_VERIFIER_ALIASES,
  LOCK_NAME,
  RECOVERY_MIGRATION_ALIASES,
  RECOVERY_ROOT,
  SCHEMA_CHECKPOINT_MIGRATIONS,
  StagingBackupSchemaPreparationError,
  assertRecoveryEnvironment,
  assertSchemaPreparationSql,
  discoverMigrationPlan,
  prepareStagingBackupRecoverySchema,
  recordRecoveryMigration,
};
