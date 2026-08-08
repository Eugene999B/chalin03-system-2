"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");
const {
  RAILWAY_STAGING_ISOLATION_CONFIRMATION,
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");

const BASE_SCHEMA_CONFIRMATION =
  "APPLY_CHALIN_ONE_CLEAN_MASTER_SCHEMA_TO_EMPTY_STAGING_DB";
const BASE_SCHEMA_MARKER =
  "chalin_one_staging_clean_master_schema_bootstrap_v1";
const BASE_SCHEMA_PATH = path.resolve(__dirname, "../../database/schema.sql");
const REQUIRED_BASE_TABLES = Object.freeze([
  "branches",
  "schema_migrations",
  "users",
  "products",
  "customers",
  "sales",
  "audit_unlock_requests",
]);

class ChalinOneStagingBaseSchemaSafetyError extends Error {
  constructor(message, code = "CHALIN_ONE_STAGING_BASE_SCHEMA_UNSAFE") {
    super(message);
    this.name = "ChalinOneStagingBaseSchemaSafetyError";
    this.code = code;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function unsafe(message, code) {
  throw new ChalinOneStagingBaseSchemaSafetyError(message, code);
}

function databaseConfig(env = process.env) {
  return {
    host: clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST),
    port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user: clean(env.DB_USER || env.MYSQLUSER),
    password: String(env.DB_PASSWORD || env.MYSQLPASSWORD || ""),
    database: clean(env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE),
    ssl:
      clean(env.DB_SSL).toLowerCase() === "true"
        ? {
            rejectUnauthorized:
              clean(env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
              "false",
          }
        : false,
    timezone: "Z",
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
  };
}

function validateFreshStagingBootstrapEnvironment(env = process.env) {
  const runtime = validateFullStagingEnvironment(env, { mode: "runtime" });
  const railwayEnvironment = clean(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
  ).toLowerCase();
  const host = clean(env.DB_HOST || env.MYSQLHOST || env.MYSQL_HOST);
  const database = clean(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE
  );

  if (railwayEnvironment !== "staging") {
    unsafe(
      "Base-schema bootstrap requires Railway environment staging.",
      "CHALIN_ONE_STAGING_BASE_SCHEMA_RAILWAY_STAGING_REQUIRED"
    );
  }
  if (!/\.railway\.internal$/i.test(host)) {
    unsafe(
      "Base-schema bootstrap requires the dedicated internal Railway MySQL host (*.railway.internal).",
      "CHALIN_ONE_STAGING_BASE_SCHEMA_INTERNAL_DB_REQUIRED"
    );
  }
  if (
    clean(env.CHALIN_ONE_STAGING_DATABASE_ISOLATION) !==
    RAILWAY_STAGING_ISOLATION_CONFIRMATION
  ) {
    unsafe(
      "Base-schema bootstrap requires the exact dedicated Railway staging database isolation token.",
      "CHALIN_ONE_STAGING_BASE_SCHEMA_ISOLATION_REQUIRED"
    );
  }
  if (!database) {
    unsafe(
      "Base-schema bootstrap requires a database name.",
      "CHALIN_ONE_STAGING_BASE_SCHEMA_DATABASE_REQUIRED"
    );
  }
  if (/(^|[_-])(prod|production|live)([_-]|$)/i.test(database)) {
    unsafe(
      `Refusing production-like database name ${database}.`,
      "CHALIN_ONE_STAGING_BASE_SCHEMA_PRODUCTION_NAME_BLOCKED"
    );
  }
  if (clean(env.CHALIN_ONE_STAGING_BASE_SCHEMA_CONFIRM) !== BASE_SCHEMA_CONFIRMATION) {
    unsafe(
      "Set the exact one-time CHALIN_ONE_STAGING_BASE_SCHEMA_CONFIRM token before applying the clean master schema.",
      "CHALIN_ONE_STAGING_BASE_SCHEMA_CONFIRMATION_REQUIRED"
    );
  }

  return Object.freeze({
    safe: true,
    database,
    host,
    runtime,
  });
}

async function listBaseTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );
  return rows.map((row) => String(row.TABLE_NAME || row.table_name || "").trim()).filter(Boolean);
}

async function hasBootstrapMarker(connection) {
  const tables = await listBaseTables(connection);
  if (!tables.includes("schema_migrations")) return false;

  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS present FROM schema_migrations WHERE migration_name = ?",
    [BASE_SCHEMA_MARKER]
  );
  return Number(row?.present || 0) === 1;
}

async function verifyRequiredBaseTables(connection) {
  const tables = new Set(await listBaseTables(connection));
  const missing = REQUIRED_BASE_TABLES.filter((tableName) => !tables.has(tableName));
  if (missing.length > 0) {
    unsafe(
      `Clean master schema verification failed. Missing base tables: ${missing.join(", ")}.`,
      "CHALIN_ONE_STAGING_BASE_SCHEMA_VERIFY_FAILED"
    );
  }
  return [...tables].sort();
}

async function bootstrapChalinOneFreshStagingDatabase({
  env = process.env,
  connectionFactory = mysql.createConnection,
} = {}) {
  const safety = validateFreshStagingBootstrapEnvironment(env);
  const connection = await connectionFactory(databaseConfig(env));

  try {
    const [[identity]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const connectedDatabase = clean(identity?.database_name);
    if (connectedDatabase !== safety.database) {
      unsafe(
        `Connected database ${connectedDatabase || "(none)"} does not match the configured staging database ${safety.database}.`,
        "CHALIN_ONE_STAGING_BASE_SCHEMA_DATABASE_MISMATCH"
      );
    }

    const existingTables = await listBaseTables(connection);
    if (existingTables.length > 0) {
      if (await hasBootstrapMarker(connection)) {
        const tables = await verifyRequiredBaseTables(connection);
        console.log(
          `CHALIN ONE clean master schema is already bootstrapped on ${connectedDatabase}; ${tables.length} base table(s) verified. No schema was reapplied.`
        );
        return Object.freeze({
          applied: false,
          already_bootstrapped: true,
          database: connectedDatabase,
          table_count: tables.length,
        });
      }

      unsafe(
        `Refusing to apply the clean master schema because ${connectedDatabase} is not empty (${existingTables.length} base table(s)) and does not contain the CHALIN ONE staging bootstrap marker.`,
        "CHALIN_ONE_STAGING_BASE_SCHEMA_DATABASE_NOT_EMPTY"
      );
    }

    const schemaSql = fs.readFileSync(BASE_SCHEMA_PATH, "utf8");
    if (!/CREATE\s+TABLE\s+audit_unlock_requests/i.test(schemaSql)) {
      unsafe(
        "The repository clean master schema does not contain audit_unlock_requests.",
        "CHALIN_ONE_STAGING_BASE_SCHEMA_SOURCE_INVALID"
      );
    }

    await executeSqlScript(connection, schemaSql, "CHALIN ONE clean master schema");
    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [
        BASE_SCHEMA_MARKER,
        "Guarded clean master schema bootstrap for isolated CHALIN ONE Railway staging",
      ]
    );

    const tables = await verifyRequiredBaseTables(connection);
    console.log(
      `CHALIN ONE clean master schema applied safely to ${connectedDatabase}; ${tables.length} base table(s) verified.`
    );

    return Object.freeze({
      applied: true,
      already_bootstrapped: false,
      database: connectedDatabase,
      table_count: tables.length,
    });
  } finally {
    await connection.end().catch(() => {});
  }
}

if (require.main === module) {
  bootstrapChalinOneFreshStagingDatabase().catch((error) => {
    console.error(`CHALIN ONE staging base-schema bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BASE_SCHEMA_CONFIRMATION,
  BASE_SCHEMA_MARKER,
  REQUIRED_BASE_TABLES,
  ChalinOneStagingBaseSchemaSafetyError,
  bootstrapChalinOneFreshStagingDatabase,
  databaseConfig,
  listBaseTables,
  validateFreshStagingBootstrapEnvironment,
  verifyRequiredBaseTables,
};
