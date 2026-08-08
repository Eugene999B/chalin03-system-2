"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");

const RELEASE_CONFIRMATION = "20260808_CHALIN_ONE_CONTENT_STUDIO_IDENTITY";
const MIGRATION_RECORD = "20260808_chalin_one_content_studio_identity";
const MIGRATION_LOCK_NAME = "chalin03:chalin-one:content-studio-identity:20260808";
const MIGRATION_FILE = "20260808_chalin_one_content_studio_identity.sql";
const VERIFIER_FILE = "20260808_chalin_one_content_studio_identity_verify.sql";
const EXPECTED_TABLES = Object.freeze([
  "content_studio_roles",
  "content_studio_role_permissions",
  "content_studio_role_scopes",
  "content_studio_user_access",
]);
const EXPECTED_ROLES = Object.freeze([
  "content_administrator",
  "editor",
  "news_editor",
  "media_manager",
  "reviewer",
  "publisher",
]);
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
    throw new Error(`Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`);
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
      ? { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) }
      : undefined,
    connectTimeout: Number(env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function assertExecutionGates(env = process.env) {
  if (!truthy(env.CHALIN_ONE_ALLOW_CONTENT_STUDIO_IDENTITY_MIGRATION)) {
    throw new Error("Set CHALIN_ONE_ALLOW_CONTENT_STUDIO_IDENTITY_MIGRATION=true only for an isolated CHALIN ONE staging/acceptance rehearsal or separately approved release operation.");
  }
  if (String(env.CHALIN_ONE_CONTENT_STUDIO_IDENTITY_MIGRATION_CONFIRM || "").trim() !== RELEASE_CONFIRMATION) {
    throw new Error(`Set CHALIN_ONE_CONTENT_STUDIO_IDENTITY_MIGRATION_CONFIRM=${RELEASE_CONFIRMATION} for this exact migration.`);
  }

  const environment = String(env.NODE_ENV || "development").trim().toLowerCase();
  const databaseName = String(env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE || "").trim();
  if (!databaseName) throw new Error("Content Studio identity migration requires an explicit database name.");

  if (environment === "production") {
    if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED) || !truthy(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
      throw new Error("Production Content Studio identity migration requires both verified Professional and SQL backups.");
    }
  } else if (!SAFE_NON_PRODUCTION_DATABASE.test(databaseName)) {
    throw new Error("Non-production Content Studio identity migration may target only isolated CHALIN ONE acceptance, staging or development databases.");
  }

  return Object.freeze({ environment, databaseName, production: environment === "production" });
}

function readMigrationFile(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) throw new Error(`Content Studio identity migration source is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function verifyFoundation(connection) {
  const placeholders = EXPECTED_TABLES.map(() => "?").join(",");
  const [tables] = await connection.query(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})`,
    EXPECTED_TABLES
  );
  const present = new Set(tables.map((row) => row.table_name));
  const missing = EXPECTED_TABLES.filter((name) => !present.has(name));
  if (missing.length) throw new Error(`Content Studio identity migration is incomplete: ${missing.join(", ")}.`);

  const [roles] = await connection.query(
    `SELECT role_code FROM content_studio_roles
      WHERE is_active = TRUE
      ORDER BY sort_order, role_code`
  );
  const roleSet = new Set(roles.map((row) => row.role_code));
  const missingRoles = EXPECTED_ROLES.filter((role) => !roleSet.has(role));
  if (missingRoles.length) throw new Error(`Content Studio role seed is incomplete: ${missingRoles.join(", ")}.`);

  const [[orphanAccess]] = await connection.query(
    `SELECT COUNT(*) AS total
       FROM content_studio_user_access a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN content_studio_roles r ON r.id = a.role_id
      WHERE u.id IS NULL OR r.id IS NULL`
  );
  if (Number(orphanAccess?.total || 0) !== 0) throw new Error("Content Studio access contains orphan identities.");

  return { table_count: tables.length, role_count: roles.length };
}

async function runChalinOneContentStudioIdentityMigration({ env = process.env } = {}) {
  const gate = assertExecutionGates(env);
  const connection = await mysql.createConnection(connectionOptions(env));
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK_NAME]);
    if (Number(lock?.acquired || 0) !== 1) throw new Error("Could not acquire the CHALIN ONE Content Studio identity migration lock.");

    await executeSqlScript(connection, readMigrationFile(MIGRATION_FILE), "CHALIN ONE Content Studio identity migration");
    const verified = await verifyFoundation(connection);
    await executeSqlScript(connection, readMigrationFile(VERIFIER_FILE), "CHALIN ONE Content Studio identity verifier");

    const [records] = await connection.query(
      `SELECT migration_name FROM schema_migrations WHERE migration_name = ? LIMIT 1`,
      [MIGRATION_RECORD]
    );
    if (!records[0]) throw new Error("Content Studio identity migration record is missing.");

    return Object.freeze({
      migration: MIGRATION_RECORD,
      database: gate.databaseName,
      environment: gate.environment,
      production: gate.production,
      expected_table_count: EXPECTED_TABLES.length,
      verified_table_count: verified.table_count,
      expected_role_count: EXPECTED_ROLES.length,
      verified_role_count: verified.role_count,
    });
  } finally {
    try { await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]); } catch {}
    await connection.end();
  }
}

if (require.main === module) {
  runChalinOneContentStudioIdentityMigration()
    .then((result) => console.log(`CHALIN ONE Content Studio identity verified ${result.verified_table_count}/${result.expected_table_count} tables and ${result.verified_role_count}/${result.expected_role_count} roles on ${result.database}.`))
    .catch((error) => {
      console.error(`CHALIN ONE Content Studio identity migration failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  EXPECTED_ROLES,
  EXPECTED_TABLES,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  SAFE_NON_PRODUCTION_DATABASE,
  assertExecutionGates,
  connectionOptions,
  readMigrationFile,
  runChalinOneContentStudioIdentityMigration,
  truthy,
  verifyFoundation,
};
