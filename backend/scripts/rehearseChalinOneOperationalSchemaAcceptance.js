"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");
const {
  STAGING_FOUNDATION_MIGRATIONS,
  STAGING_OPERATIONAL_MIGRATIONS,
  applyStagingOperationalPlan,
} = require("./upgradeChalinOneStagingOperationalSchema");

const DATABASE_PATTERN = /^chalin_one_operational_acceptance(?:_[a-z0-9_]+)?$/i;
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const BASE_SCHEMA_PATH = path.join(REPOSITORY_ROOT, "database", "schema.sql");

const ADMIN_RUNTIME_TABLES = Object.freeze([
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "business_units",
  "business_locations",
  "user_business_access",
  "activity_log",
  "auth_sessions",
  "settings",

  // Admin / permissions / security
  "protected_action_sessions",
  "privileged_action_ledger",
  "owner_break_glass_accounts",
  "owner_break_glass_mfa_enrollments",
  "owner_break_glass_recovery_codes",
  "owner_break_glass_login_history",
  "user_permission_overrides",
  "security_event_dismissals",
  "user_category_assignment_conflicts",
  "worker_category_assignment_conflicts",

  // Backups / diagnostics support
  "backup_history",

  // Workers / employment documents
  "worker_profiles",
  "worker_assignments",
  "worker_family_members",
  "worker_emergency_contacts",
  "worker_private_files",
  "worker_print_history",
  "worker_identity_sequences",
  "worker_hr_letters",
  "document_signature_settings",
  "standalone_hr_documents",

  // Payroll
  "payroll_compensation_profiles",
  "payroll_periods",
  "payroll_entries",
  "payroll_payments",

  // Inventory traceability
  "inventory_product_tracking",
  "inventory_serial_units",
  "inventory_trace_events",
  "inventory_count_sessions",
  "inventory_loss_cases",
]);

const ADMIN_RUNTIME_COLUMNS = Object.freeze([
  Object.freeze(["users", "login_phone_normalized"]),
  Object.freeze(["users", "primary_workspace_code"]),
  Object.freeze(["users", "category_assignment_status"]),
  Object.freeze(["auth_sessions", "device_type"]),
  Object.freeze(["auth_sessions", "location_source"]),
  Object.freeze(["worker_profiles", "workspace_code"]),
  Object.freeze(["worker_profiles", "business_unit_id"]),
  Object.freeze(["worker_profiles", "id_card_serial"]),
  Object.freeze(["settings", "worker_id_card_validity_months"]),
  Object.freeze(["settings", "worker_employee_number_prefix"]),
  Object.freeze(["worker_hr_letters", "approval_signature_data_url"]),
  Object.freeze(["worker_hr_letters", "signature_captured_at"]),
]);

function clean(value) {
  return String(value ?? "").trim();
}

function required(name, fallback = "") {
  const value = clean(process.env[name] || (fallback ? process.env[fallback] : ""));
  if (!value) throw new Error(`Missing ${name}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function databaseName(env = process.env) {
  const value = clean(env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE);
  if (!DATABASE_PATTERN.test(value)) {
    throw new Error(
      "Operational-schema rehearsal requires an isolated chalin_one_operational_acceptance database."
    );
  }
  return value;
}

function connectionOptions(database) {
  return {
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database,
    timezone: "Z",
    multipleStatements: false,
  };
}

async function resetDatabase(database) {
  const connection = await mysql.createConnection({
    ...connectionOptions(database),
    database: undefined,
  });
  try {
    const safeName = `\`${database.replace(/`/g, "``")}\``;
    await connection.query(`DROP DATABASE IF EXISTS ${safeName}`);
    await connection.query(
      `CREATE DATABASE ${safeName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
}

async function assertAdminRuntimeTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()`
  );
  const existing = new Set(rows.map((row) => String(row.TABLE_NAME)));
  const missing = ADMIN_RUNTIME_TABLES.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(
      `Admin runtime schema is incomplete after operational rehearsal. Missing: ${missing.join(", ")}.`
    );
  }
  return ADMIN_RUNTIME_TABLES.length;
}

async function assertAdminRuntimeColumns(connection) {
  const missing = [];
  for (const [tableName, columnName] of ADMIN_RUNTIME_COLUMNS) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1`,
      [tableName, columnName]
    );
    if (!rows[0]) missing.push(`${tableName}.${columnName}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Admin runtime columns are incomplete after operational rehearsal. Missing: ${missing.join(", ")}.`
    );
  }
  return ADMIN_RUNTIME_COLUMNS.length;
}

async function assertMigrationRecords(connection) {
  const expected = [
    ...STAGING_FOUNDATION_MIGRATIONS.map((migration) => migration.record),
    ...STAGING_OPERATIONAL_MIGRATIONS.map((migration) => migration.record),
  ];

  const [rows] = await connection.query(
    `SELECT migration_name
       FROM schema_migrations
      WHERE migration_name IN (?)`,
    [expected]
  );
  const recorded = new Set(rows.map((row) => String(row.migration_name)));
  const missing = expected.filter((record) => !recorded.has(record));
  if (missing.length > 0) {
    throw new Error(
      `Not every Admin/Worker/Payroll/Inventory staging migration was durably recorded. Missing: ${missing.join(", ")}.`
    );
  }
  return expected.length;
}

async function runOperationalSchemaAcceptance() {
  const database = databaseName();
  await resetDatabase(database);

  const connection = await mysql.createConnection(connectionOptions(database));
  try {
    const schemaSql = fs.readFileSync(BASE_SCHEMA_PATH, "utf8");
    await executeSqlScript(connection, schemaSql, "CHALIN ONE clean master schema rehearsal");

    const reports = await applyStagingOperationalPlan(connection);
    const adminTableCount = await assertAdminRuntimeTables(connection);
    const adminColumnCount = await assertAdminRuntimeColumns(connection);
    const migrationRecordCount = await assertMigrationRecords(connection);

    console.log(
      JSON.stringify(
        {
          status: "success",
          database,
          base_schema_loaded: true,
          foundation_migrations: reports.foundations,
          operational_migrations: reports.operational,
          admin_runtime_table_count: adminTableCount,
          admin_runtime_column_count: adminColumnCount,
          migration_record_count: migrationRecordCount,
        },
        null,
        2
      )
    );
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runOperationalSchemaAcceptance().catch((error) => {
    console.error(`CHALIN ONE operational-schema rehearsal failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ADMIN_RUNTIME_COLUMNS,
  ADMIN_RUNTIME_TABLES,
  DATABASE_PATTERN,
  assertAdminRuntimeColumns,
  assertAdminRuntimeTables,
  assertMigrationRecords,
  databaseName,
  runOperationalSchemaAcceptance,
};
