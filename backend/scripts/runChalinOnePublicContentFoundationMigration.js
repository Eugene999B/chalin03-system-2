"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { executeSqlScript } = require("./sqlScriptRunner");

const RELEASE_CONFIRMATION = "20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION";
const MIGRATION_RECORD = "20260805_chalin_one_public_content_foundation";
const MIGRATION_LOCK_NAME = "chalin03:chalin-one:public-content:20260805";
const MIGRATION_FILE = "20260805_chalin_one_public_content_foundation.sql";
const VERIFIER_FILE =
  "20260805_chalin_one_public_content_foundation_verify.sql";

const EXPECTED_TABLES = Object.freeze([
  "public_media_folders",
  "public_media_assets",
  "public_site_settings",
  "public_pages",
  "public_page_versions",
  "public_page_sections",
  "public_navigation_items",
  "public_news_categories",
  "public_news_articles",
  "public_announcements",
  "public_business_divisions",
  "public_leadership_profiles",
  "public_projects",
  "public_project_media",
  "public_equipment_catalogue",
  "public_testimonials",
  "public_locations",
  "public_company_statistics",
  "public_job_vacancies",
  "public_tenders",
  "public_faqs",
  "public_forms",
  "public_form_fields",
  "public_form_submissions",
  "public_form_submission_files",
  "public_content_versions",
  "public_content_approvals",
  "public_content_audit_log",
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

  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(env.DB_SSL_REJECT_UNAUTHORIZED || "true")
      .trim()
      .toLowerCase()
  );

  return { rejectUnauthorized };
}

function assertExecutionGates(env = process.env) {
  if (!truthy(env.CHALIN_ONE_ALLOW_SCHEMA_MIGRATION)) {
    throw new Error(
      "Set CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=true only for a controlled migration rehearsal or approved release operation."
    );
  }

  if (
    String(env.CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM || "").trim() !==
    RELEASE_CONFIRMATION
  ) {
    throw new Error(
      `Set CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=${RELEASE_CONFIRMATION} for this exact migration.`
    );
  }

  const environment = String(env.NODE_ENV || "development")
    .trim()
    .toLowerCase();

  if (environment === "production") {
    if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
      throw new Error(
        "Production migration requires a verified signed Professional Backup."
      );
    }

    if (!truthy(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
      throw new Error(
        "Production migration requires a separately verified SQL backup."
      );
    }
  }

  const databaseName = String(
    env.DB_NAME || env.MYSQLDATABASE || env.MYSQL_DATABASE || ""
  ).trim();

  if (
    environment !== "production" &&
    /^(railway|production|prod)$/i.test(databaseName)
  ) {
    throw new Error(
      "A non-production migration run may not target a database named railway, production or prod."
    );
  }

  return {
    environment,
    databaseName,
    production: environment === "production",
  };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: getSslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
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
    throw new Error(`Approved migration file is missing: ${filePath}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
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
    const afterCount = after[tableName];
    if (afterCount !== beforeCount) {
      differences.push({ tableName, beforeCount, afterCount });
    }
  }

  if (differences.length > 0) {
    const summary = differences
      .map(
        ({ tableName, beforeCount, afterCount }) =>
          `${tableName}: ${beforeCount} -> ${afterCount}`
      )
      .join(", ");

    throw new Error(
      `Existing business row counts changed during the additive migration: ${summary}`
    );
  }
}

async function verifyExpectedTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_COLLATION AS table_collation
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME LIKE 'public\\_%'`
  );

  const byName = new Map(rows.map((row) => [row.table_name, row]));
  const missing = EXPECTED_TABLES.filter((tableName) => !byName.has(tableName));

  if (missing.length > 0) {
    throw new Error(
      `Public-content migration is incomplete. Missing tables: ${missing.join(", ")}.`
    );
  }

  const invalid = EXPECTED_TABLES.filter((tableName) => {
    const row = byName.get(tableName);
    return (
      String(row?.engine || "").toLowerCase() !== "innodb" ||
      !String(row?.table_collation || "").toLowerCase().startsWith("utf8mb4")
    );
  });

  if (invalid.length > 0) {
    throw new Error(
      `Public-content tables must use InnoDB and utf8mb4: ${invalid.join(", ")}.`
    );
  }

  return rows;
}

async function verifyMigrationRecord(connection) {
  const [rows] = await connection.query(
    `SELECT migration_name
     FROM schema_migrations
     WHERE migration_name = ?
     LIMIT 1`,
    [MIGRATION_RECORD]
  );

  if (!rows[0]) {
    throw new Error(`Migration record ${MIGRATION_RECORD} was not created.`);
  }
}

async function acquireMigrationLock(connection) {
  const [[row]] = await connection.query(
    "SELECT GET_LOCK(?, 30) AS acquired",
    [MIGRATION_LOCK_NAME]
  );

  if (Number(row?.acquired) !== 1) {
    throw new Error(
      "Could not obtain the CHALIN ONE public-content migration lock."
    );
  }
}

async function releaseMigrationLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK_NAME]);
  } catch {
    // The database releases advisory locks when the connection closes.
  }
}

async function runChalinOnePublicContentFoundationMigration() {
  const gate = assertExecutionGates();
  const connection = await mysql.createConnection(connectionOptions());

  try {
    await acquireMigrationLock(connection);

    const [[databaseRow]] = await connection.query(
      "SELECT DATABASE() AS database_name"
    );
    const connectedDatabase = String(databaseRow?.database_name || "");

    if (!connectedDatabase) {
      throw new Error("The migration connection has no selected database.");
    }

    if (gate.databaseName && connectedDatabase !== gate.databaseName) {
      throw new Error(
        `Connected database ${connectedDatabase} does not match configured database ${gate.databaseName}.`
      );
    }

    console.log(
      `Running CHALIN ONE public-content foundation against ${connectedDatabase} (${gate.environment}).`
    );

    const beforeCounts = await captureCriticalCounts(connection);
    const migrationSql = readMigrationFile(MIGRATION_FILE);
    const verifierSql = readMigrationFile(VERIFIER_FILE);

    await executeSqlScript(
      connection,
      migrationSql,
      "CHALIN ONE public-content migration"
    );

    await verifyMigrationRecord(connection);
    await verifyExpectedTables(connection);

    const afterCounts = await captureCriticalCounts(connection);
    compareCriticalCounts(beforeCounts, afterCounts);

    await executeSqlScript(
      connection,
      verifierSql,
      "CHALIN ONE public-content verification"
    );

    console.log(
      `CHALIN ONE public-content foundation verified: ${EXPECTED_TABLES.length} tables present; existing business row counts unchanged.`
    );
  } finally {
    await releaseMigrationLock(connection);
    await connection.end();
  }
}

if (require.main === module) {
  runChalinOnePublicContentFoundationMigration().catch((error) => {
    console.error(`CHALIN ONE public-content migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CRITICAL_EXISTING_TABLES,
  EXPECTED_TABLES,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  VERIFIER_FILE,
  assertExecutionGates,
  captureCriticalCounts,
  compareCriticalCounts,
  getSslConfig,
  runChalinOnePublicContentFoundationMigration,
  truthy,
  verifyExpectedTables,
  verifyMigrationRecord,
};
