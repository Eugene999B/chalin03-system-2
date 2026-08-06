"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");

const RELEASE_CONFIRMATION = "20260806_CHALIN_ONE_AI_FOUNDATION";
const MIGRATION_RECORD = "20260806_chalin_one_ai_foundation";
const MIGRATION_LOCK_NAME = "chalin03:chalin-one:ai-foundation:20260806";
const MIGRATION_FILE = "20260806_chalin_one_ai_foundation.sql";
const VERIFIER_FILE = "20260806_chalin_one_ai_foundation_verify.sql";
const SAFE_NON_PRODUCTION_DATABASE =
  /^chalin_one_(?:acceptance|staging|development)(?:_[a-z0-9_]+)?$/;

const EXPECTED_TABLES = Object.freeze([
  "ai_provider_profiles",
  "ai_conversations",
  "ai_messages",
  "ai_tool_invocations",
  "ai_evidence_records",
  "ai_usage_ledger",
  "ai_audit_events",
  "ai_prompt_safety_events",
  "ai_knowledge_sources",
  "ai_knowledge_versions",
  "ai_knowledge_approvals",
  "ai_feedback",
]);

const CRITICAL_EXISTING_TABLES = Object.freeze([
  "users",
  "products",
  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",
  "mining_sites",
  "fleet_assets",
  "hire_contracts",
  "equipment_sale_agreements",
]);

const FORBIDDEN_SECRET_COLUMN_PATTERN =
  /(^|_)(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)($|_)/i;

function truthy(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${
        fallbackName ? ` or ${fallbackName}` : ""
      }.`
    );
  }
  return value;
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") {
    return undefined;
  }
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true")
        .trim()
        .toLowerCase()
    ),
  };
}

function assertExecutionGates(env = process.env) {
  if (!truthy(env.CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION)) {
    throw new Error(
      "Set CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION=true only for a controlled AI migration rehearsal or approved release operation."
    );
  }
  if (
    String(env.CHALIN_ONE_AI_MIGRATION_CONFIRM || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN_ONE_AI_MIGRATION_CONFIRM=${RELEASE_CONFIRMATION} for this exact migration.`
    );
  }

  const environment = String(env.NODE_ENV || "development")
    .trim()
    .toLowerCase();
  const databaseName = String(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE || ""
  ).trim();

  if (!databaseName) {
    throw new Error("AI migration requires an explicit database name.");
  }

  if (environment === "production") {
    if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
      throw new Error(
        "Production AI migration requires a verified signed Professional Backup."
      );
    }
    if (!truthy(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
      throw new Error(
        "Production AI migration requires a separately verified SQL backup."
      );
    }
  } else if (!SAFE_NON_PRODUCTION_DATABASE.test(databaseName)) {
    throw new Error(
      "Non-production AI migration may target only chalin_one_acceptance*, chalin_one_staging* or chalin_one_development* databases."
    );
  }

  return Object.freeze({
    environment,
    databaseName,
    production: environment === "production",
  });
}

function connectionOptions(env = process.env) {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: getSslConfig(env),
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function readMigrationFile(filename) {
  const filePath = path.resolve(
    __dirname,
    "../../database/migrations",
    filename
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved AI migration file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row?.present || 0) === 1;
}

async function tableRowCount(connection, tableName) {
  if (!/^[a-z0-9_]+$/i.test(tableName)) {
    throw new Error(`Unsafe table name: ${tableName}`);
  }
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS row_count FROM \`${tableName}\``
  );
  return Number(rows[0]?.row_count || 0);
}

async function captureCriticalCounts(connection) {
  const counts = {};
  for (const tableName of CRITICAL_EXISTING_TABLES) {
    if (await tableExists(connection, tableName)) {
      counts[tableName] = await tableRowCount(connection, tableName);
    }
  }
  return counts;
}

function compareCriticalCounts(before, after) {
  const differences = [];
  for (const [tableName, beforeCount] of Object.entries(before)) {
    if (after[tableName] !== beforeCount) {
      differences.push({
        table_name: tableName,
        before_count: beforeCount,
        after_count: after[tableName],
      });
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `Existing business row counts changed during the additive AI migration: ${JSON.stringify(
        differences
      )}`
    );
  }
}

async function verifyExpectedTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine,
            TABLE_COLLATION AS table_collation
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'ai\\_%'`
  );
  const byName = new Map(rows.map((row) => [row.table_name, row]));
  const missing = EXPECTED_TABLES.filter((tableName) => !byName.has(tableName));
  if (missing.length > 0) {
    throw new Error(`AI foundation migration is incomplete: ${missing.join(", ")}.`);
  }
  for (const tableName of EXPECTED_TABLES) {
    const row = byName.get(tableName);
    if (String(row.engine || "").toLowerCase() !== "innodb") {
      throw new Error(`${tableName} must use InnoDB.`);
    }
    if (!String(row.table_collation || "").startsWith("utf8mb4_")) {
      throw new Error(`${tableName} must use a utf8mb4 collation.`);
    }
  }
  return rows;
}

async function verifyNoSecretColumns(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'ai\\_%'`
  );
  const forbidden = rows.filter((row) =>
    FORBIDDEN_SECRET_COLUMN_PATTERN.test(String(row.column_name || ""))
  );
  if (forbidden.length > 0) {
    throw new Error(
      `AI tables contain forbidden secret columns: ${forbidden
        .map((row) => `${row.table_name}.${row.column_name}`)
        .join(", ")}.`
    );
  }
  return true;
}

async function verifyMigrationRecord(connection) {
  const [rows] = await connection.query(
    `SELECT migration_name FROM schema_migrations
     WHERE migration_name = ? LIMIT 1`,
    [MIGRATION_RECORD]
  );
  if (!rows[0]) {
    throw new Error("AI foundation migration record is missing.");
  }
  return true;
}

async function acquireLock(connection) {
  const [[row]] = await connection.query(
    "SELECT GET_LOCK(?, 30) AS acquired",
    [MIGRATION_LOCK_NAME]
  );
  if (Number(row?.acquired || 0) !== 1) {
    throw new Error("Could not acquire the CHALIN ONE AI migration lock.");
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
  } catch {
    // Connection closure also releases the advisory lock.
  }
}

async function runChalinOneAiFoundationMigration({ env = process.env } = {}) {
  const gate = assertExecutionGates(env);
  const connection = await mysql.createConnection(connectionOptions(env));
  try {
    await acquireLock(connection);
    const before = await captureCriticalCounts(connection);
    await executeSqlScript(
      connection,
      readMigrationFile(MIGRATION_FILE),
      "CHALIN ONE AI foundation migration"
    );
    const tables = await verifyExpectedTables(connection);
    await verifyNoSecretColumns(connection);
    await verifyMigrationRecord(connection);
    await executeSqlScript(
      connection,
      readMigrationFile(VERIFIER_FILE),
      "CHALIN ONE AI foundation verifier"
    );
    const after = await captureCriticalCounts(connection);
    compareCriticalCounts(before, after);

    return Object.freeze({
      migration: MIGRATION_RECORD,
      database: gate.databaseName,
      environment: gate.environment,
      production: gate.production,
      expected_table_count: EXPECTED_TABLES.length,
      verified_table_count: tables.filter((row) =>
        EXPECTED_TABLES.includes(row.table_name)
      ).length,
      critical_row_counts: after,
      secret_columns_present: false,
    });
  } finally {
    await releaseLock(connection);
    await connection.end();
  }
}

if (require.main === module) {
  runChalinOneAiFoundationMigration()
    .then((result) => {
      console.log(
        `CHALIN ONE AI foundation migration verified ${result.verified_table_count}/${result.expected_table_count} tables on ${result.database}.`
      );
    })
    .catch((error) => {
      console.error(`CHALIN ONE AI foundation migration failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  CRITICAL_EXISTING_TABLES,
  EXPECTED_TABLES,
  FORBIDDEN_SECRET_COLUMN_PATTERN,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  SAFE_NON_PRODUCTION_DATABASE,
  VERIFIER_FILE,
  assertExecutionGates,
  captureCriticalCounts,
  compareCriticalCounts,
  connectionOptions,
  getSslConfig,
  readMigrationFile,
  runChalinOneAiFoundationMigration,
  truthy,
  verifyExpectedTables,
  verifyMigrationRecord,
  verifyNoSecretColumns,
};
