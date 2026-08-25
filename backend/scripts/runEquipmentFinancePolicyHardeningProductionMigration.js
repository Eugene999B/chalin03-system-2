const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260825_EQUIPMENT_FINANCE_POLICY_HARDENING";
const MIGRATION_NAME = "20260825_equipment_finance_policy_hardening";
const MIGRATION_LOCK_NAME =
  "chalin03:production-migrations:20260825-policy-hardening";
const MIGRATION_FILE = "20260825_equipment_finance_policy_hardening.sql";
const VERIFY_FILE = "20260825_equipment_finance_policy_hardening_verify.sql";

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`
    );
  }
  return value;
}

function assertReleaseGates(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Policy-hardening runner requires NODE_ENV=production.");
  }
  if (!booleanValue(env.CHALIN03_EQUIPMENT_FINANCE_POLICY_HARDENING_ENABLED)) {
    throw new Error(
      "Set CHALIN03_EQUIPMENT_FINANCE_POLICY_HARDENING_ENABLED=true only for the controlled policy-hardening operation."
    );
  }
  if (!booleanValue(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("Confirm the verified signed Professional Backup before execution.");
  }
  if (!booleanValue(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
    throw new Error("Confirm the separate verified SQL/database backup before execution.");
  }
  if (String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !== RELEASE_CONFIRMATION) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact approved operation.`
    );
  }
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
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
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
    ssl: getSslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (buffer.trim()) {
        throw new Error("DELIMITER directive appeared before the previous statement was complete.");
      }
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

function migrationDirectory() {
  return path.resolve(__dirname, "../../database/migrations");
}

function readSqlFile(filename) {
  const resolved = path.join(migrationDirectory(), filename);
  if (!fs.existsSync(resolved)) throw new Error(`Approved Finance SQL file is missing: ${resolved}`);
  return fs.readFileSync(resolved, "utf8");
}

async function executeStatements(connection, statements, label) {
  const resultSets = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      resultSets.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1}/${statements.length}: ${error.message}`;
      throw error;
    }
  }
  return resultSets;
}

function assertSingleMigrationRecord(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.migration_name !== MIGRATION_NAME) {
    throw new Error("Policy-hardening migration record was not verified.");
  }
}

function assertZero(rows, key) {
  if (!Array.isArray(rows) || rows.length !== 1 || Number(rows[0]?.[key]) !== 0) {
    throw new Error(`Policy-hardening verifier returned non-zero ${key}.`);
  }
}

async function main() {
  assertReleaseGates();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(databaseRow?.database_name || "").trim();
    const expectedDatabase = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();

    if (!databaseName) throw new Error("No production database is selected.");
    if (!expectedDatabase) throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
    if (expectedDatabase !== databaseName) {
      throw new Error(`Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`);
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Finance policy-hardening migration lock.");

    const migrationStatements = splitSqlScript(readSqlFile(MIGRATION_FILE));
    const verifierStatements = splitSqlScript(readSqlFile(VERIFY_FILE));

    console.log(`Connected to approved production database: ${databaseName}`);
    console.log(`Policy-hardening release: ${RELEASE_CONFIRMATION}`);
    console.log(`Applying ${MIGRATION_NAME}...`);
    await executeStatements(connection, migrationStatements, `Migration ${MIGRATION_NAME}`);

    console.log(`Verifying ${MIGRATION_NAME}...`);
    const results = await executeStatements(connection, verifierStatements, `Verifier ${MIGRATION_NAME}`);
    if (results.length !== 4) throw new Error(`Policy-hardening verifier returned ${results.length} result sets instead of 4.`);
    assertSingleMigrationRecord(results[0]);
    assertZero(results[1], "missing_policy_columns");
    assertZero(results[2], "missing_policy_indexes");
    assertZero(results[3], "missing_policy_triggers");
    console.log("Policy hardening migration and read-only verifier passed.");
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
      } catch (error) {
        console.error("Warning: policy-hardening lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Equipment Finance policy-hardening production migration failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  RELEASE_CONFIRMATION,
  MIGRATION_NAME,
  MIGRATION_LOCK_NAME,
  assertReleaseGates,
  splitSqlScript,
};
