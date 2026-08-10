"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");
const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");

const RELEASE_CONFIRMATION = "20260810_CHALIN_ONE_PUBLIC_ANALYTICS";
const MIGRATION_RECORD = "20260810_chalin_one_public_analytics";
const MIGRATION_LOCK_NAME = "chalin03:chalin-one:public-analytics:20260810";
const MIGRATION_FILE = "20260810_chalin_one_public_analytics.sql";
const VERIFIER_FILE = "20260810_chalin_one_public_analytics_verify.sql";
const EXPECTED_TABLE = "public_analytics_daily";
const SAFE_NON_PRODUCTION_DATABASE =
  /^chalin_one_(?:acceptance|staging|development)(?:_[a-z0-9_]+)?$/i;

function truthy(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function requiredEnv(primaryName, fallbackName, env = process.env) {
  const value = env[primaryName] || env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`
    );
  }
  return value;
}

function connectionOptions(env = process.env) {
  const sslEnabled = String(env.DB_SSL || "").toLowerCase() === "true";
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST", env),
    port: Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER", env),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD", env),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE", env),
    ssl: sslEnabled
      ? {
          rejectUnauthorized: !["0", "false", "no", "off"].includes(
            String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
          ),
        }
      : undefined,
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function assertVerifiedStagingIsolation(env) {
  return validateFullStagingEnvironment(
    {
      ...env,
      CHALIN_ONE_ALLOW_PUBLIC_ANALYTICS_MIGRATION: "",
    },
    { mode: "runtime" }
  );
}

function assertExecutionGates(env = process.env) {
  if (!truthy(env.CHALIN_ONE_ALLOW_PUBLIC_ANALYTICS_MIGRATION)) {
    throw new Error(
      "Set CHALIN_ONE_ALLOW_PUBLIC_ANALYTICS_MIGRATION=true only for an isolated CHALIN ONE staging/acceptance rehearsal or separately approved release operation."
    );
  }
  if (
    String(env.CHALIN_ONE_PUBLIC_ANALYTICS_MIGRATION_CONFIRM || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN_ONE_PUBLIC_ANALYTICS_MIGRATION_CONFIRM=${RELEASE_CONFIRMATION} for this exact migration.`
    );
  }

  const environment = String(env.NODE_ENV || "development")
    .trim()
    .toLowerCase();
  const databaseName = String(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE || ""
  ).trim();
  if (!databaseName) {
    throw new Error("Public analytics migration requires an explicit database name.");
  }

  if (environment === "production") {
    if (
      !truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED) ||
      !truthy(env.CHALIN03_SQL_BACKUP_CONFIRMED)
    ) {
      throw new Error(
        "Production public analytics migration requires both verified Professional and SQL backups."
      );
    }
  } else if (!SAFE_NON_PRODUCTION_DATABASE.test(databaseName)) {
    if (environment !== "staging") {
      throw new Error(
        "Non-production public analytics migration may target only isolated CHALIN ONE acceptance, staging or development databases."
      );
    }
    try {
      assertVerifiedStagingIsolation(env);
    } catch (error) {
      throw new Error(
        `Public analytics migration refused the nonstandard staging database because dedicated CHALIN ONE isolation could not be verified: ${error.message}`
      );
    }
  }

  return Object.freeze({
    environment,
    databaseName,
    production: environment === "production",
  });
}

function readMigrationFile(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Public analytics migration source is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function verifyFoundation(connection) {
  const [tables] = await connection.query(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [EXPECTED_TABLE]
  );
  if (!tables[0]) {
    throw new Error(
      "Public analytics migration is incomplete: public_analytics_daily is missing."
    );
  }

  const [[invalid]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM public_analytics_daily
      WHERE route_path NOT LIKE '/%'
         OR CHAR_LENGTH(route_path) > 220`
  );
  if (Number(invalid?.total || 0) !== 0) {
    throw new Error("Public analytics foundation contains invalid route rows.");
  }

  return { table_count: 1, invalid_rows: 0 };
}

async function runChalinOnePublicAnalyticsMigration({ env = process.env } = {}) {
  const gate = assertExecutionGates(env);
  const connection = await mysql.createConnection(connectionOptions(env));
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      MIGRATION_LOCK_NAME,
    ]);
    if (Number(lock?.acquired || 0) !== 1) {
      throw new Error("Could not acquire the CHALIN ONE public analytics migration lock.");
    }

    await executeSqlScript(
      connection,
      readMigrationFile(MIGRATION_FILE),
      "CHALIN ONE public analytics migration"
    );
    const verified = await verifyFoundation(connection);
    await executeSqlScript(
      connection,
      readMigrationFile(VERIFIER_FILE),
      "CHALIN ONE public analytics verifier"
    );

    const [records] = await connection.query(
      `SELECT migration_name FROM schema_migrations WHERE migration_name = ? LIMIT 1`,
      [MIGRATION_RECORD]
    );
    if (!records[0]) {
      throw new Error("Public analytics migration record is missing.");
    }

    return Object.freeze({
      migration: MIGRATION_RECORD,
      database: gate.databaseName,
      environment: gate.environment,
      production: gate.production,
      verified_table_count: verified.table_count,
      invalid_rows: verified.invalid_rows,
    });
  } finally {
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
    } catch {}
    await connection.end();
  }
}

if (require.main === module) {
  runChalinOnePublicAnalyticsMigration()
    .then((result) =>
      console.log(
        `CHALIN ONE public analytics foundation verified on ${result.database}.`
      )
    )
    .catch((error) => {
      console.error(`CHALIN ONE public analytics migration failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  EXPECTED_TABLE,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  SAFE_NON_PRODUCTION_DATABASE,
  assertExecutionGates,
  assertVerifiedStagingIsolation,
  connectionOptions,
  readMigrationFile,
  runChalinOnePublicAnalyticsMigration,
  truthy,
  verifyFoundation,
};
