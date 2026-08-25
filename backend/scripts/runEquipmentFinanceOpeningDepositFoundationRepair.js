const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_LOCK = "chalin03:equipment-finance:opening-deposit-foundation-repair";
const MIGRATION_RECORD = "20260805_equipment_finance_opening_deposit_foundation_repair";
const MIGRATION_FILE = "20260805_equipment_finance_opening_deposit_foundation_repair.sql";
const VERIFIER_FILE = "20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql";
const INTEGRITY_MIGRATION_RECORD = "20260803_equipment_finance_phase4_deposit_reservation_integrity";
const INTEGRITY_MIGRATION_FILE = "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql";
const REQUIRED_TRIGGERS = Object.freeze([
  "trg_equipment_finance_payment_gate_before_insert",
  "trg_equipment_finance_reservation_gate_before_insert",
  "trg_equipment_finance_commitment_gate_before_update",
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
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (ca) return { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true };
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
    ),
  };
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
    multipleStatements: false,
    timezone: "Z",
  };
}

function splitSql(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) {
      if (buffer.trim()) throw new Error("SQL DELIMITER appeared before the previous statement was complete.");
      buffer = "";
      delimiter = match[1];
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

function migrationDirectory() {
  const candidates = [
    path.resolve(__dirname, "../database/migrations"),
    path.resolve(__dirname, "../../database/migrations"),
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) throw new Error(`Approved Opening Deposit migration directory is missing. Checked: ${candidates.join(", ")}`);
  return existing;
}

function readMigration(filename) {
  const filePath = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved Opening Deposit SQL file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
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

function validateFoundation(results) {
  if (results.length !== 4) {
    throw new Error(`Opening Deposit repair verifier returned ${results.length} result sets instead of 4.`);
  }

  const [migrationRows, columnRows, indexRows, duplicateRows] = results;
  if (migrationRows.length !== 1 || migrationRows[0]?.migration_name !== MIGRATION_RECORD) {
    throw new Error("Opening Deposit repair migration record was not verified.");
  }
  if (Number(columnRows[0]?.missing_opening_deposit_columns || 0) !== 0) {
    throw new Error("Opening Deposit evidence/payment columns are still missing.");
  }
  if (Number(indexRows[0]?.missing_opening_deposit_indexes || 0) !== 0) {
    throw new Error("Opening Deposit supporting indexes are still missing.");
  }
  if (Number(duplicateRows[0]?.duplicate_opening_deposit_idempotency_keys || 0) !== 0) {
    throw new Error("Duplicate Opening Deposit idempotency keys must be reviewed before startup can continue.");
  }
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expected || databaseName !== expected) {
    throw new Error("Opening Deposit production database identity check failed.");
  }
  return databaseName;
}

async function validateIntegrityTriggers(connection) {
  const placeholders = REQUIRED_TRIGGERS.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING
       FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN (${placeholders})`,
    REQUIRED_TRIGGERS
  );

  const expected = new Map([
    [REQUIRED_TRIGGERS[0], ["INSERT", "BEFORE"]],
    [REQUIRED_TRIGGERS[1], ["INSERT", "BEFORE"]],
    [REQUIRED_TRIGGERS[2], ["UPDATE", "BEFORE"]],
  ]);
  const found = new Map(rows.map((row) => [row.TRIGGER_NAME, row]));

  for (const [name, [event, timing]] of expected) {
    const row = found.get(name);
    if (!row) throw new Error(`Opening Deposit integrity trigger is missing: ${name}.`);
    if (row.EVENT_MANIPULATION !== event || row.ACTION_TIMING !== timing) {
      throw new Error(`Opening Deposit integrity trigger ${name} has invalid timing.`);
    }
  }
}

async function runEquipmentFinanceOpeningDepositFoundationRepair() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Opening Deposit foundation repair lock.");

    await executeStatements(connection, splitSql(readMigration(MIGRATION_FILE)), "Opening Deposit foundation repair");
    const verifierResults = await executeStatements(
      connection,
      splitSql(readMigration(VERIFIER_FILE)),
      "Opening Deposit foundation verifier"
    );
    validateFoundation(verifierResults);

    await executeStatements(
      connection,
      splitSql(readMigration(INTEGRITY_MIGRATION_FILE)),
      "Opening Deposit integrity trigger repair"
    );
    await validateIntegrityTriggers(connection);

    console.log(`Verified ${MIGRATION_RECORD} and ${INTEGRITY_MIGRATION_RECORD} on ${databaseName}.`);
    return {
      applied: true,
      database_name: databaseName,
      migration: MIGRATION_RECORD,
      integrity_migration: INTEGRITY_MIGRATION_RECORD,
    };
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]); } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinanceOpeningDepositFoundationRepair().catch((error) => {
    console.error("Equipment Finance Opening Deposit startup repair failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_FILE,
  MIGRATION_LOCK,
  MIGRATION_RECORD,
  VERIFIER_FILE,
  INTEGRITY_MIGRATION_FILE,
  INTEGRITY_MIGRATION_RECORD,
  REQUIRED_TRIGGERS,
  runEquipmentFinanceOpeningDepositFoundationRepair,
  validateFoundation,
  validateIntegrityTriggers,
};
