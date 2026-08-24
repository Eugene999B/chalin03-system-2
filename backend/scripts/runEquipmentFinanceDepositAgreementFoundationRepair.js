const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_RECORD =
  "20260824_equipment_finance_deposit_agreement_foundation_repair";
const MIGRATION_FILE =
  "20260824_equipment_finance_deposit_agreement_foundation_repair.sql";
const VERIFIER_FILE =
  "20260824_equipment_finance_deposit_agreement_foundation_repair_verify.sql";
const MIGRATION_LOCK = "chalin03:equipment-finance:deposit-agreement-foundation:20260824";

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`
    );
  }
  return value;
}

function getSslConfig(env = process.env) {
  if (String(env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) {
    return {
      ca: Buffer.from(encodedCa, "base64").toString("utf8"),
      rejectUnauthorized: true,
    };
  }
  const disabled = ["0", "false", "no", "off"].includes(
    String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
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
    ssl: getSslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function migrationDirectory() {
  const candidates = [
    path.resolve(__dirname, "../database/migrations"),
    path.resolve(__dirname, "../../database/migrations"),
  ];
  const existing = candidates.find((directory) => fs.existsSync(directory));
  if (!existing) {
    throw new Error(
      `Deposit agreement foundation migration directory is missing. Checked: ${candidates.join(", ")}`
    );
  }
  return existing;
}

function readMigrationFile(filename) {
  const filePath = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved Deposit agreement foundation SQL file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function hasExecutableSql(sqlText) {
  return String(sqlText || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:--|#).*$/, ""))
    .join("\n")
    .trim().length > 0;
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (hasExecutableSql(buffer)) {
        throw new Error("SQL DELIMITER appeared before the previous statement was complete.");
      }
      buffer = "";
      delimiter = delimiterMatch[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (hasExecutableSql(statement)) statements.push(statement);
    buffer = "";
  }

  if (hasExecutableSql(buffer)) throw new Error("SQL script ended with an incomplete statement.");
  return statements;
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expected) {
    throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
  }
  if (databaseName !== expected) {
    throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
  }
  return databaseName;
}

async function migrationRecordExists(connection) {
  const [[tableRow]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'`
  );
  if (Number(tableRow?.present || 0) !== 1) return false;
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
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

async function verify(connection) {
  const results = await executeStatements(
    connection,
    splitSqlScript(readMigrationFile(VERIFIER_FILE)),
    "Deposit agreement foundation verifier"
  );
  if (results.length !== 2) throw new Error(`Deposit agreement foundation verifier returned ${results.length} result sets; expected 2.`);
  const missingColumns = Number(results[0]?.[0]?.missing_deposit_agreement_columns || 0);
  const missingRecord = Number(results[1]?.[0]?.deposit_agreement_foundation_migration_record_missing || 0);
  if (missingColumns !== 0 || missingRecord !== 0) {
    throw new Error(`Deposit agreement foundation verification failed: missing_columns=${missingColumns}, missing_migration_record=${missingRecord}.`);
  }
}

async function runEquipmentFinanceDepositAgreementFoundationRepair() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Deposit agreement foundation migration lock.");

    if (!(await migrationRecordExists(connection))) {
      console.log(`Applying ${MIGRATION_RECORD} on ${databaseName}.`);
      await executeStatements(
        connection,
        splitSqlScript(readMigrationFile(MIGRATION_FILE)),
        "Deposit agreement foundation migration"
      );
    }

    await verify(connection);
    console.log(`Verified ${MIGRATION_RECORD} on ${databaseName}.`);
    return { applied: true, database_name: databaseName };
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]); } catch { /* connection close releases lock */ }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinanceDepositAgreementFoundationRepair().catch((error) => {
    console.error("Equipment Finance Deposit agreement foundation repair failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION_RECORD,
  MIGRATION_FILE,
  VERIFIER_FILE,
  runEquipmentFinanceDepositAgreementFoundationRepair,
};
