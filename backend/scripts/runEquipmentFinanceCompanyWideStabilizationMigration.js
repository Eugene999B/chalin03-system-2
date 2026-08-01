const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_ID = "20260801_EQUIPMENT_FINANCE_COMPANY_WIDE_STABILIZATION";
const MIGRATION_RECORD = "20260801_equipment_finance_company_wide_stabilization";
const MIGRATION_FILE = "20260801_equipment_finance_company_wide_stabilization.sql";
const VERIFIER_FILE = "20260801_equipment_finance_company_wide_stabilization_verify.sql";
const LOCK_NAME = "chalin03:finance:company-wide:20260801";
const MANIFEST_TABLE = "chalin03_finance_stabilization_snapshots";
const SNAPSHOT_TABLES = Object.freeze([
  ["equipment_credit_applications", "chalin03_snap_20260801_fin_apps"],
  ["equipment_sales_quotations", "chalin03_snap_20260801_fin_quotes"],
  ["equipment_sales_quotation_items", "chalin03_snap_20260801_fin_quote_items"],
  ["equipment_sale_agreements", "chalin03_snap_20260801_fin_agreements"],
  ["equipment_asset_sale_locks", "chalin03_snap_20260801_fin_locks"],
  ["equipment_sale_payments", "chalin03_snap_20260801_fin_payments"],
  ["equipment_deliveries", "chalin03_snap_20260801_fin_deliveries"],
  ["equipment_ownership_transfers", "chalin03_snap_20260801_fin_ownership"],
  ["equipment_sales_reminder_log", "chalin03_snap_20260801_fin_reminders"],
]);
const EXPECTED_VERIFIER_KEYS = Object.freeze([
  "missing_finance_stabilization_columns",
  "non_nullable_finance_location_columns",
  "finance_records_with_hire_location",
  "invalid_finance_interval_terms",
  "invalid_company_wide_agreement_intervals",
  "finance_stabilization_migration_record_missing",
]);

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function quoteIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `\`${identifier}\``;
}

function sslConfig() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  const disabled = ["0", "false", "no", "off"].includes(
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return { rejectUnauthorized: !disabled };
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
    multipleStatements: false,
  };
}

function assertReleaseEnvironment() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Finance company-wide stabilization requires NODE_ENV=production.");
  }
  if (!truthy(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("Confirm the fresh signed Chalin 03 website backup before this release.");
  }
}

function migrationPath(fileName) {
  const filePath = path.resolve(__dirname, "../../database/migrations", fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Approved migration file is missing: ${filePath}`);
  return filePath;
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (buffer.trim()) throw new Error("SQL DELIMITER appeared before the previous statement ended.");
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement) statements.push(statement);
    buffer = "";
  }
  if (buffer.trim()) throw new Error("SQL script ended with an incomplete statement.");
  return statements;
}

async function executeStatements(connection, statements, label) {
  const results = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      results.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1} of ${statements.length}: ${error.message}`;
      throw error;
    }
  }
  return results;
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

async function rowCount(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`
  );
  return Number(rows[0]?.row_count || 0);
}

async function currentCounts(connection) {
  const counts = {};
  for (const [source] of SNAPSHOT_TABLES) counts[source] = await rowCount(connection, source);
  return counts;
}

function assertCountsPreserved(before, after) {
  for (const [source] of SNAPSHOT_TABLES) {
    if (Number(before[source]) !== Number(after[source])) {
      throw new Error(
        `Finance stabilization changed ${source} row count from ${before[source]} to ${after[source]}.`
      );
    }
  }
}

async function ensureManifest(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(MANIFEST_TABLE)} (
    release_id VARCHAR(120) NOT NULL PRIMARY KEY,
    database_name VARCHAR(150) NOT NULL,
    snapshot_status ENUM('creating','ready') NOT NULL DEFAULT 'creating',
    counts_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME NULL
  )`);
}

async function verifySnapshot(connection, counts) {
  for (const [source, snapshot] of SNAPSHOT_TABLES) {
    if (!(await tableExists(connection, snapshot))) {
      throw new Error(`Required Finance safety snapshot ${snapshot} is missing.`);
    }
    const copied = await rowCount(connection, snapshot);
    const expected = Number(counts[source] || 0);
    if (copied !== expected) {
      throw new Error(`${snapshot} contains ${copied} rows; expected ${expected}.`);
    }
  }
}

async function createOrVerifySnapshot(connection, databaseName) {
  await ensureManifest(connection);
  const [manifestRows] = await connection.query(
    `SELECT * FROM ${quoteIdentifier(MANIFEST_TABLE)} WHERE release_id = ? LIMIT 1`,
    [RELEASE_ID]
  );
  const existing = manifestRows[0];
  if (existing?.snapshot_status === "ready") {
    if (String(existing.database_name || "") !== databaseName) {
      throw new Error("Finance stabilization snapshot database identity does not match.");
    }
    let counts;
    try {
      counts = JSON.parse(existing.counts_json || "{}");
    } catch {
      throw new Error("Finance stabilization snapshot manifest is invalid.");
    }
    await verifySnapshot(connection, counts);
    console.log("Existing Finance stabilization safety snapshot verified.");
    return counts;
  }

  await connection.query(
    `INSERT INTO ${quoteIdentifier(MANIFEST_TABLE)}
       (release_id, database_name, snapshot_status, counts_json)
     VALUES (?, ?, 'creating', '{}')
     ON DUPLICATE KEY UPDATE database_name = VALUES(database_name),
                             snapshot_status = 'creating', counts_json = '{}'`,
    [RELEASE_ID, databaseName]
  );

  const counts = {};
  for (const [source, snapshot] of SNAPSHOT_TABLES) {
    if (!(await tableExists(connection, source))) {
      throw new Error(`Cannot snapshot missing Finance source table ${source}.`);
    }
    if (!(await tableExists(connection, snapshot))) {
      await connection.query(
        `CREATE TABLE ${quoteIdentifier(snapshot)} LIKE ${quoteIdentifier(source)}`
      );
    }
    await connection.query(
      `INSERT IGNORE INTO ${quoteIdentifier(snapshot)} SELECT * FROM ${quoteIdentifier(source)}`
    );
    counts[source] = await rowCount(connection, source);
    const copied = await rowCount(connection, snapshot);
    if (copied !== counts[source]) {
      throw new Error(`${snapshot} copied ${copied} of ${counts[source]} rows.`);
    }
  }

  await connection.query(
    `UPDATE ${quoteIdentifier(MANIFEST_TABLE)}
     SET snapshot_status = 'ready', counts_json = ?, verified_at = CURRENT_TIMESTAMP
     WHERE release_id = ?`,
    [JSON.stringify(counts), RELEASE_ID]
  );
  await verifySnapshot(connection, counts);
  console.log("Finance stabilization database-side safety snapshot created and verified.");
  return counts;
}

function validateVerifierResults(results) {
  if (results.length !== EXPECTED_VERIFIER_KEYS.length) {
    throw new Error(
      `Finance stabilization verifier returned ${results.length} result sets; expected ${EXPECTED_VERIFIER_KEYS.length}.`
    );
  }
  EXPECTED_VERIFIER_KEYS.forEach((key, index) => {
    const rows = results[index];
    const value = Number(rows?.[0]?.[key]);
    if (!Number.isFinite(value)) throw new Error(`Verifier did not return numeric ${key}.`);
    if (value !== 0) throw new Error(`Verifier returned ${key}=${value}; expected 0.`);
    console.log(`${key}=0`);
  });
}

async function migrationRecordExists(connection) {
  if (!(await tableExists(connection, "schema_migrations"))) return false;
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

async function verifyAppliedRelease(connection) {
  const verifier = splitSqlScript(fs.readFileSync(migrationPath(VERIFIER_FILE), "utf8"));
  validateVerifierResults(await executeStatements(connection, verifier, "Finance stabilization verifier"));
}

async function runEquipmentFinanceCompanyWideStabilizationMigration() {
  assertReleaseEnvironment();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(databaseRow?.database_name || "").trim();
    const expectedDatabase = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
    if (!databaseName || !expectedDatabase || databaseName !== expectedDatabase) {
      throw new Error("Connected database does not match CHALIN03_EXPECTED_DATABASE.");
    }

    const [[phaseThree]] = await connection.query(
      "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = '20260731_equipment_finance_operational_polish'"
    );
    if (Number(phaseThree?.applied || 0) !== 1) {
      throw new Error("Equipment Finance Phase 3 must be recorded before stabilization.");
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Finance stabilization migration lock.");

    if (await migrationRecordExists(connection)) {
      await verifyAppliedRelease(connection);
      console.log(`Equipment Finance company-wide stabilization already applied on ${databaseName}.`);
      return;
    }

    await createOrVerifySnapshot(connection, databaseName);
    const before = await currentCounts(connection);
    const migration = splitSqlScript(fs.readFileSync(migrationPath(MIGRATION_FILE), "utf8"));
    await executeStatements(connection, migration, "Finance company-wide stabilization migration");
    const after = await currentCounts(connection);
    assertCountsPreserved(before, after);
    await verifyAppliedRelease(connection);
    console.log("Equipment Finance company-wide stabilization verified successfully.");
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_NAME]);
      } catch (error) {
        console.error("Warning: Finance stabilization lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinanceCompanyWideStabilizationMigration().catch((error) => {
    console.error("Equipment Finance company-wide stabilization failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_VERIFIER_KEYS,
  LOCK_NAME,
  MANIFEST_TABLE,
  MIGRATION_FILE,
  MIGRATION_RECORD,
  RELEASE_ID,
  SNAPSHOT_TABLES,
  VERIFIER_FILE,
  assertCountsPreserved,
  createOrVerifySnapshot,
  migrationRecordExists,
  runEquipmentFinanceCompanyWideStabilizationMigration,
  splitSqlScript,
  validateVerifierResults,
  verifyAppliedRelease,
};
