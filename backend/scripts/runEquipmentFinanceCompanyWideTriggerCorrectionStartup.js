const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_RECORD = "20260801_equipment_finance_company_wide_trigger_correction";
const MIGRATION_FILE = "20260801_equipment_finance_company_wide_trigger_correction.sql";
const LOCK_NAME = "chalin03:finance:company-wide-triggers:20260801";
const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_reservation_gate_before_insert",
  "trg_equipment_finance_commitment_gate_before_update",
  "trg_equipment_finance_delivery_gate_before_insert",
  "trg_equipment_finance_ownership_gate_before_insert",
]);

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
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

async function migrationRecordExists(connection) {
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

async function verifyTriggers(connection) {
  const placeholders = REQUIRED_TRIGGERS.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME, ACTION_STATEMENT
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME IN (${placeholders})`,
    REQUIRED_TRIGGERS
  );
  const found = new Map(rows.map((row) => [row.TRIGGER_NAME, String(row.ACTION_STATEMENT || "")]));
  const missing = REQUIRED_TRIGGERS.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Missing Finance company-wide triggers: ${missing.join(", ")}.`);
  for (const [name, statement] of found) {
    if (/NEW\.hire_location_id\s*<>|hire_location_id\s*=\s*NEW\.hire_location_id/i.test(statement)) {
      throw new Error(`${name} still depends on a Hire location comparison.`);
    }
    if (!/SET\s+NEW\.hire_location_id\s*=\s*NULL/i.test(statement)) {
      throw new Error(`${name} does not force company-wide Finance location to NULL.`);
    }
  }
  console.log("Finance company-wide database guards verified successfully.");
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expected || databaseName !== expected) {
    throw new Error("Connected database does not match CHALIN03_EXPECTED_DATABASE.");
  }
  return databaseName;
}

async function runTriggerCorrection() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[stabilization]] = await connection.query(
      "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = '20260801_equipment_finance_company_wide_stabilization'"
    );
    if (Number(stabilization?.applied || 0) !== 1) {
      throw new Error("Finance company-wide stabilization must run before trigger correction.");
    }
    if (await migrationRecordExists(connection)) {
      await verifyTriggers(connection);
      console.log(`Finance company-wide trigger correction already applied on ${databaseName}.`);
      return;
    }

    const [[manifest]] = await connection.query(
      `SELECT COUNT(*) AS ready
       FROM chalin03_finance_stabilization_snapshots
       WHERE release_id = '20260801_EQUIPMENT_FINANCE_COMPANY_WIDE_STABILIZATION'
         AND snapshot_status = 'ready'`
    );
    if (Number(manifest?.ready || 0) !== 1) {
      throw new Error("The verified Finance stabilization safety snapshot is missing.");
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Finance trigger-correction lock.");

    const filePath = path.resolve(__dirname, "../../database/migrations", MIGRATION_FILE);
    if (!fs.existsSync(filePath)) throw new Error(`Approved trigger migration is missing: ${filePath}`);
    const statements = splitSqlScript(fs.readFileSync(filePath, "utf8"));
    for (let index = 0; index < statements.length; index += 1) {
      try {
        await connection.query(statements[index]);
      } catch (error) {
        error.message = `Finance trigger correction failed at statement ${index + 1} of ${statements.length}: ${error.message}`;
        throw error;
      }
    }
    if (!(await migrationRecordExists(connection))) {
      throw new Error("Finance trigger-correction migration record is missing after apply.");
    }
    await verifyTriggers(connection);
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_NAME]);
      } catch (error) {
        console.error("Warning: Finance trigger lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runTriggerCorrection().catch((error) => {
    console.error("Equipment Finance company-wide trigger correction failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  LOCK_NAME,
  MIGRATION_FILE,
  MIGRATION_RECORD,
  REQUIRED_TRIGGERS,
  migrationRecordExists,
  runTriggerCorrection,
  splitSqlScript,
  verifyTriggers,
};
