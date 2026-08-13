"use strict";

const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const { pool } = require("../config/db");
const { executeSqlScript } = require("./sqlScriptRunner");
const {
  assertDedicatedRailwayStaging,
} = require("./completeChalinOneFullStagingDatabase");
const {
  reconcileChalinOneSyntheticPayrollGovernance,
} = require("./reconcileChalinOneSyntheticPayrollGovernance");

const LOCK_NAME = "chalin03:chalin-one:staging-operational-schema:v2";
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const MIGRATION_ROOT = path.join(REPOSITORY_ROOT, "database", "migrations");
const PAYROLL_FOUNDATION_RECORD = "20260810_payroll_financial_foundation";

// CHALIN ONE's clean schema intentionally does not replay every historical
// operational migration. Current admin/worker routes, however, still depend on
// these additive foundations. They must exist before Payroll can create foreign
// keys to worker_profiles and before the admin pages are considered ready.
const STAGING_FOUNDATION_MIGRATIONS = Object.freeze([
  Object.freeze({
    record: "release2_final_security_backup_workers_executive",
    file: "20260716_release2_final_security_backup_workers_executive.sql",
    required_tables: Object.freeze([
      "protected_action_sessions",
      "privileged_action_ledger",
      "backup_history",
      "owner_break_glass_accounts",
      "worker_profiles",
      "worker_assignments",
    ]),
  }),
  Object.freeze({
    record: "release2d_worker_profile_expansion",
    file: "20260716_release2d_worker_profile_expansion.sql",
    required_tables: Object.freeze([
      "worker_family_members",
      "worker_emergency_contacts",
      "worker_private_files",
    ]),
    required_columns: Object.freeze([
      Object.freeze(["worker_profiles", "preferred_name"]),
      Object.freeze(["worker_profiles", "national_id_number"]),
    ]),
  }),
  Object.freeze({
    record: "release2f_worker_print_pack",
    file: "20260716_release2f_worker_print_pack.sql",
    required_tables: Object.freeze(["worker_print_history"]),
    required_columns: Object.freeze([
      Object.freeze(["worker_profiles", "id_card_serial"]),
      Object.freeze(["worker_profiles", "id_card_expiry_date"]),
    ]),
  }),
  Object.freeze({
    record: "release3_owner_mfa_security",
    file: "20260716_release3_owner_mfa_security.sql",
    required_tables: Object.freeze([
      "owner_break_glass_mfa_enrollments",
      "owner_break_glass_recovery_codes",
      "owner_break_glass_login_history",
    ]),
    required_columns: Object.freeze([
      Object.freeze(["owner_break_glass_accounts", "mfa_enabled"]),
    ]),
  }),
  Object.freeze({
    record: "release2a1_one_active_session",
    file: "20260716_release2a1_one_active_session.sql",
    required_tables: Object.freeze(["auth_sessions"]),
    required_columns: Object.freeze([
      Object.freeze(["auth_sessions", "session_id"]),
      Object.freeze(["auth_sessions", "user_id"]),
      Object.freeze(["auth_sessions", "expires_at"]),
      Object.freeze(["auth_sessions", "revoked_at"]),
    ]),
  }),
  Object.freeze({
    record: "release2a2_account_lock_otp",
    file: "20260716_release2a2_account_lock_otp.sql",
    required_tables: Object.freeze(["password_recovery_otps"]),
    required_columns: Object.freeze([
      Object.freeze(["users", "is_login_locked"]),
      Object.freeze(["users", "login_locked_at"]),
      Object.freeze(["users", "login_lock_reason"]),
      Object.freeze(["users", "last_failed_login_at"]),
      Object.freeze(["users", "last_failed_login_ip"]),
    ]),
  }),
  Object.freeze({
    record: "release3fa_authentication_sessions_ux",
    file: "20260718_release3fa_authentication_sessions_ux.sql",
    required_columns: Object.freeze([
      Object.freeze(["users", "login_phone_normalized"]),
      Object.freeze(["auth_sessions", "device_type"]),
      Object.freeze(["auth_sessions", "location_source"]),
    ]),
  }),
  Object.freeze({
    record: "release3fc_user_permissions_security_messages",
    file: "20260718_release3fc_user_permissions_security_messages.sql",
    required_tables: Object.freeze([
      "user_permission_overrides",
      "security_event_dismissals",
    ]),
  }),
  Object.freeze({
    record: "release3fc2_category_isolation_guides_receipts_workers",
    file: "20260718_release3fc2_category_isolation_guides_receipts_workers.sql",
    required_tables: Object.freeze([
      "user_category_assignment_conflicts",
      "worker_category_assignment_conflicts",
    ]),
    required_columns: Object.freeze([
      Object.freeze(["users", "primary_workspace_code"]),
      Object.freeze(["users", "category_assignment_status"]),
      Object.freeze(["worker_profiles", "workspace_code"]),
      Object.freeze(["worker_profiles", "business_unit_id"]),
    ]),
  }),
  Object.freeze({
    record: "20260718_release3fd2_worker_identity_cards",
    file: "20260718_release3fd2_worker_identity_cards.sql",
    required_tables: Object.freeze(["worker_identity_sequences"]),
    required_columns: Object.freeze([
      Object.freeze(["settings", "worker_id_card_validity_months"]),
      Object.freeze(["settings", "worker_employee_number_prefix"]),
    ]),
  }),
  Object.freeze({
    record: "20260719_worker_hr_letters",
    file: "20260719_worker_hr_letters.sql",
    required_tables: Object.freeze(["worker_hr_letters"]),
  }),
  Object.freeze({
    record: "20260719_standalone_employment_documents_signature",
    file: "20260719_standalone_employment_documents_signature.sql",
    required_tables: Object.freeze([
      "document_signature_settings",
      "standalone_hr_documents",
    ]),
    required_columns: Object.freeze([
      Object.freeze(["worker_hr_letters", "approval_signature_data_url"]),
      Object.freeze(["worker_hr_letters", "signature_captured_at"]),
    ]),
  }),
]);

const STAGING_OPERATIONAL_MIGRATIONS = Object.freeze([
  Object.freeze({
    record: PAYROLL_FOUNDATION_RECORD,
    file: "20260810_payroll_financial_foundation.sql",
    verify: "20260810_payroll_financial_foundation_verify.sql",
    zero_fields: Object.freeze([
      "missing_payroll_tables",
      "compensation_worker_workspace_mismatches",
      "entry_worker_workspace_mismatches",
      "payment_worker_workspace_mismatches",
      "self_approved_compensation_profiles",
      "self_approved_payroll_periods",
    ]),
  }),
  Object.freeze({
    record: "20260810_inventory_traceability_foundation",
    file: "20260810_inventory_traceability_foundation.sql",
    verify: "20260810_inventory_traceability_foundation_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
  Object.freeze({
    record: "20260810_inventory_loss_detection_foundation",
    file: "20260810_inventory_loss_detection_foundation.sql",
    verify: "20260810_inventory_loss_detection_foundation_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
  Object.freeze({
    record: "20260810_inventory_count_snapshot_hardening",
    file: "20260810_inventory_count_snapshot_hardening.sql",
    verify: "20260810_inventory_count_snapshot_hardening_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
  Object.freeze({
    record: "20260811_inventory_transfer_traceability",
    file: "20260811_inventory_transfer_traceability.sql",
    verify: "20260811_inventory_transfer_traceability_verify.sql",
    zero_fields: Object.freeze(["problem_count"]),
  }),
]);

class ChalinOneStagingOperationalSchemaError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_FAILED") {
    super(message);
    this.name = "ChalinOneStagingOperationalSchemaError";
    this.code = code;
  }
}

function readRequiredFile(fileName) {
  const filePath = path.join(MIGRATION_ROOT, fileName);
  if (!fs.existsSync(filePath)) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Required staging migration source file is missing: ${fileName}.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_SOURCE_MISSING"
    );
  }
  return fs.readFileSync(filePath, "utf8");
}

async function migrationRecorded(connection, record) {
  const [rows] = await connection.query(
    `SELECT migration_name
       FROM schema_migrations
      WHERE migration_name = ?
      LIMIT 1`,
    [record]
  );
  return Boolean(rows[0]);
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName]
  );
  return Boolean(rows[0]);
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Boolean(rows[0]);
}

async function missingFoundationStructure(connection, migration) {
  const missing = [];
  for (const tableName of migration.required_tables || []) {
    if (!(await tableExists(connection, tableName))) {
      missing.push(`table:${tableName}`);
    }
  }
  for (const [tableName, columnName] of migration.required_columns || []) {
    if (!(await columnExists(connection, tableName, columnName))) {
      missing.push(`column:${tableName}.${columnName}`);
    }
  }
  return missing;
}

async function acquireLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
    LOCK_NAME,
  ]);
  if (Number(row?.acquired || 0) !== 1) {
    throw new ChalinOneStagingOperationalSchemaError(
      "Could not acquire the CHALIN ONE staging operational-schema lock.",
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_LOCK_UNAVAILABLE"
    );
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch {
    // The database connection also releases this advisory lock on close.
  }
}

function assertVerifierZeroResults(resultSets, migration) {
  const expectedFields = new Set(migration.zero_fields || []);
  const observedFields = new Set();
  const failures = [];

  for (const rows of resultSets || []) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      for (const field of expectedFields) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
        observedFields.add(field);
        const value = Number(row[field]);
        if (!Number.isFinite(value) || value !== 0) {
          failures.push(`${field}=${String(row[field])}`);
        }
      }
    }
  }

  const missingFields = [...expectedFields].filter(
    (field) => !observedFields.has(field)
  );
  if (missingFields.length > 0) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Verifier for ${migration.record} did not return required zero-result fields: ${missingFields.join(", ")}.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_VERIFIER_INCOMPLETE"
    );
  }
  if (failures.length > 0) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Verifier for ${migration.record} reported problems: ${failures.join(", ")}.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_VERIFIER_FAILED"
    );
  }
}

async function applyFoundationMigration(connection, migration) {
  const recordedBefore = await migrationRecorded(connection, migration.record);
  const missingBefore = await missingFoundationStructure(connection, migration);
  const needsRepair = !recordedBefore || missingBefore.length > 0;

  if (needsRepair) {
    console.log(
      `CHALIN ONE staging foundation applying/repairing ${migration.record}` +
        (missingBefore.length ? ` (${missingBefore.join(", ")})` : ".")
    );
    await executeSqlScript(
      connection,
      readRequiredFile(migration.file),
      `CHALIN ONE staging foundation ${migration.record}`
    );
  } else {
    console.log(`CHALIN ONE staging foundation already healthy: ${migration.record}.`);
  }

  if (!(await migrationRecorded(connection, migration.record))) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Foundation ${migration.record} did not create its schema_migrations record.`,
      "CHALIN_ONE_STAGING_FOUNDATION_RECORD_MISSING"
    );
  }

  const missingAfter = await missingFoundationStructure(connection, migration);
  if (missingAfter.length > 0) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Foundation ${migration.record} is still incomplete after repair: ${missingAfter.join(", ")}.`,
      "CHALIN_ONE_STAGING_FOUNDATION_STRUCTURE_INCOMPLETE"
    );
  }

  return Object.freeze({
    record: migration.record,
    applied_or_repaired: needsRepair,
    repaired_structure: Object.freeze(missingBefore),
    verified: true,
  });
}

async function applyStagingMigration(connection, migration) {
  const migrationSql = readRequiredFile(migration.file);
  const verifierSql = readRequiredFile(migration.verify);
  const recordedBefore = await migrationRecorded(connection, migration.record);

  if (!recordedBefore) {
    console.log(`CHALIN ONE staging operational migration applying: ${migration.record}.`);
    await executeSqlScript(
      connection,
      migrationSql,
      `CHALIN ONE staging operational migration ${migration.record}`
    );
  } else {
    console.log(`CHALIN ONE staging operational migration already recorded: ${migration.record}.`);
  }

  if (!(await migrationRecorded(connection, migration.record))) {
    throw new ChalinOneStagingOperationalSchemaError(
      `Migration ${migration.record} did not create its schema_migrations record.`,
      "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_RECORD_MISSING"
    );
  }

  const verification = await executeSqlScript(
    connection,
    verifierSql,
    `CHALIN ONE staging operational verification ${migration.record}`
  );
  assertVerifierZeroResults(verification, migration);

  return Object.freeze({
    record: migration.record,
    applied: !recordedBefore,
    verified: true,
  });
}

async function applyStagingOperationalPlan(connection) {
  const foundationReports = [];
  for (const migration of STAGING_FOUNDATION_MIGRATIONS) {
    foundationReports.push(await applyFoundationMigration(connection, migration));
  }

  const operationalReports = [];
  for (const migration of STAGING_OPERATIONAL_MIGRATIONS) {
    operationalReports.push(await applyStagingMigration(connection, migration));
  }

  return Object.freeze({
    foundations: Object.freeze(foundationReports),
    operational: Object.freeze(operationalReports),
  });
}

async function canReconcileRecordedSyntheticPayroll(connection) {
  if (!(await migrationRecorded(connection, PAYROLL_FOUNDATION_RECORD))) return false;
  for (const tableName of [
    "users",
    "worker_profiles",
    "payroll_compensation_profiles",
    "payroll_periods",
    "payroll_entries",
  ]) {
    if (!(await tableExists(connection, tableName))) return false;
  }
  return true;
}

async function upgradeChalinOneStagingOperationalSchema({ env = process.env } = {}) {
  const safety = assertDedicatedRailwayStaging(env);
  const connection = await pool.getConnection();
  let locked = false;

  try {
    await acquireLock(connection);
    locked = true;

    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    if (!databaseName) {
      throw new ChalinOneStagingOperationalSchemaError(
        "The staging operational-schema connection has no selected database.",
        "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_DATABASE_NOT_SELECTED"
      );
    }

    let payrollGovernanceReconciliation = null;
    if (await canReconcileRecordedSyntheticPayroll(connection)) {
      payrollGovernanceReconciliation =
        await reconcileChalinOneSyntheticPayrollGovernance({ connection, env });
    }

    const reports = await applyStagingOperationalPlan(connection);

    const result = Object.freeze({
      safe: true,
      database: databaseName,
      railway_environment: safety.railway_environment,
      payroll_governance_reconciliation: payrollGovernanceReconciliation,
      foundation_migrations: reports.foundations,
      operational_migrations: reports.operational,
      production_runner_used: false,
    });
    console.log(
      "CHALIN ONE staging Admin/Worker foundation + Payroll + Inventory schema verified safely."
    );
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (locked) await releaseLock(connection);
    connection.release();
  }
}

if (require.main === module) {
  upgradeChalinOneStagingOperationalSchema()
    .catch((error) => {
      console.error(
        `CHALIN ONE staging operational-schema upgrade failed: ${error.message}`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}

module.exports = {
  LOCK_NAME,
  PAYROLL_FOUNDATION_RECORD,
  STAGING_FOUNDATION_MIGRATIONS,
  STAGING_OPERATIONAL_MIGRATIONS,
  ChalinOneStagingOperationalSchemaError,
  applyFoundationMigration,
  applyStagingMigration,
  applyStagingOperationalPlan,
  assertVerifierZeroResults,
  canReconcileRecordedSyntheticPayroll,
  missingFoundationStructure,
  upgradeChalinOneStagingOperationalSchema,
};
