"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");

const RELEASE_CONFIRMATION = "20260806_CHALIN_ONE_PORTAL_SECURITY_FOUNDATION";
const MIGRATION_RECORD = "20260806_chalin_one_portal_security_foundation";
const MIGRATION_LOCK_NAME = "chalin03:chalin-one:portal-security:20260806";
const MIGRATION_FILE = "20260806_chalin_one_portal_security_foundation.sql";
const VERIFIER_FILE = "20260806_chalin_one_portal_security_foundation_verify.sql";
const EXPECTED_TABLES = Object.freeze([
  "portal_accounts",
  "portal_invitations",
  "portal_sessions",
  "portal_access_grants",
  "portal_consent_records",
  "portal_audit_events",
]);
const FORBIDDEN_RAW_IDENTITY_COLUMNS = Object.freeze([
  "session_token",
  "invitation_token",
  "access_token",
  "refresh_token",
  "jwt",
  "ip_address",
  "user_agent",
]);
const SAFE_NON_PRODUCTION_DATABASE =
  /^chalin_one_(?:acceptance|staging|development)(?:_[a-z0-9_]+)?$/;

function truthy(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function requiredEnv(primaryName, fallbackName, env = process.env) {
  const value = env[primaryName] || env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${
        fallbackName ? ` or ${fallbackName}` : ""
      }.`
    );
  }
  return value;
}

function connectionOptions(env = process.env) {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", env),
    port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", env),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", env),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", env),
    ssl:
      String(env.DB_SSL || "").trim().toLowerCase() === "true"
        ? {
            rejectUnauthorized: !["0", "false", "no", "off"].includes(
              String(env.DB_SSL_REJECT_UNAUTHORIZED || "true")
                .trim()
                .toLowerCase()
            ),
          }
        : undefined,
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function assertExecutionGates(env = process.env) {
  if (!truthy(env.CHALIN_ONE_ALLOW_PORTAL_SCHEMA_MIGRATION)) {
    throw new Error(
      "Set CHALIN_ONE_ALLOW_PORTAL_SCHEMA_MIGRATION=true only for a controlled portal-security migration rehearsal or approved release operation."
    );
  }
  if (
    String(env.CHALIN_ONE_PORTAL_MIGRATION_CONFIRM || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN_ONE_PORTAL_MIGRATION_CONFIRM=${RELEASE_CONFIRMATION} for this exact migration.`
    );
  }
  const environment = String(env.NODE_ENV || "development")
    .trim()
    .toLowerCase();
  const databaseName = String(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE || ""
  ).trim();
  if (!databaseName) {
    throw new Error("Portal security migration requires an explicit database name.");
  }
  if (environment === "production") {
    if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
      throw new Error(
        "Production portal migration requires a verified signed Professional Backup."
      );
    }
    if (!truthy(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
      throw new Error(
        "Production portal migration requires a separately verified SQL backup."
      );
    }
  } else if (!SAFE_NON_PRODUCTION_DATABASE.test(databaseName)) {
    throw new Error(
      "Non-production portal migration may target only isolated CHALIN ONE acceptance, staging or development databases."
    );
  }
  return Object.freeze({
    environment,
    databaseName,
    production: environment === "production",
  });
}

function readMigrationFile(filename) {
  const filePath = path.resolve(
    __dirname,
    "../../database/migrations",
    filename
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved portal migration file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function verifyTables(connection) {
  const placeholders = EXPECTED_TABLES.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine,
            TABLE_COLLATION AS table_collation
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    EXPECTED_TABLES
  );
  const byName = new Map(rows.map((row) => [row.table_name, row]));
  const missing = EXPECTED_TABLES.filter((tableName) => !byName.has(tableName));
  if (missing.length > 0) {
    throw new Error(`Portal security migration is incomplete: ${missing.join(", ")}.`);
  }
  for (const row of rows) {
    if (String(row.engine || "").toLowerCase() !== "innodb") {
      throw new Error(`${row.table_name} must use InnoDB.`);
    }
    if (!String(row.table_collation || "").startsWith("utf8mb4_")) {
      throw new Error(`${row.table_name} must use utf8mb4 collation.`);
    }
  }
  return rows;
}

async function verifyNoRawIdentityColumns(connection) {
  const tablePlaceholders = EXPECTED_TABLES.map(() => "?").join(", ");
  const columnPlaceholders = FORBIDDEN_RAW_IDENTITY_COLUMNS.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${tablePlaceholders})
       AND COLUMN_NAME IN (${columnPlaceholders})`,
    [...EXPECTED_TABLES, ...FORBIDDEN_RAW_IDENTITY_COLUMNS]
  );
  if (rows.length > 0) {
    throw new Error(
      `Portal security tables contain forbidden raw identity columns: ${rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .join(", ")}.`
    );
  }
}

async function runChalinOnePortalSecurityFoundationMigration({
  env = process.env,
} = {}) {
  const gate = assertExecutionGates(env);
  const connection = await mysql.createConnection(connectionOptions(env));
  try {
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK_NAME]
    );
    if (Number(lock?.acquired || 0) !== 1) {
      throw new Error(
        "Could not acquire the CHALIN ONE portal security migration lock."
      );
    }
    await executeSqlScript(
      connection,
      readMigrationFile(MIGRATION_FILE),
      "CHALIN ONE portal security foundation migration"
    );
    const tables = await verifyTables(connection);
    await verifyNoRawIdentityColumns(connection);
    await executeSqlScript(
      connection,
      readMigrationFile(VERIFIER_FILE),
      "CHALIN ONE portal security verifier"
    );
    const [records] = await connection.query(
      `SELECT migration_name FROM schema_migrations
       WHERE migration_name = ? LIMIT 1`,
      [MIGRATION_RECORD]
    );
    if (!records[0]) {
      throw new Error("Portal security migration record is missing.");
    }
    return Object.freeze({
      migration: MIGRATION_RECORD,
      database: gate.databaseName,
      environment: gate.environment,
      production: gate.production,
      expected_table_count: EXPECTED_TABLES.length,
      verified_table_count: tables.length,
      raw_identity_columns_present: false,
    });
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
    } catch {
      // Connection closure also releases the advisory lock.
    }
    await connection.end();
  }
}

if (require.main === module) {
  runChalinOnePortalSecurityFoundationMigration()
    .then((result) => {
      console.log(
        `CHALIN ONE portal security foundation verified ${result.verified_table_count}/${result.expected_table_count} tables on ${result.database}.`
      );
    })
    .catch((error) => {
      console.error(`CHALIN ONE portal migration failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  EXPECTED_TABLES,
  FORBIDDEN_RAW_IDENTITY_COLUMNS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  SAFE_NON_PRODUCTION_DATABASE,
  VERIFIER_FILE,
  assertExecutionGates,
  connectionOptions,
  readMigrationFile,
  runChalinOnePortalSecurityFoundationMigration,
  truthy,
  verifyNoRawIdentityColumns,
  verifyTables,
};
