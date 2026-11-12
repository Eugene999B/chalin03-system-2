const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  verifyDatabaseIdentity,
} = require("./runEquipmentFinancePhaseOneSchemaStartup");

const MIGRATION_RECORD =
  "20260803_equipment_finance_phase3_agreement_creation";
const MIGRATION_FILE =
  "20260803_equipment_finance_phase3_agreement_creation.sql";
const VERIFIER_FILE =
  "20260803_equipment_finance_phase3_agreement_creation_verify.sql";
const MIGRATION_LOCK_NAME =
  "chalin03:finance:phase3-agreement-creation:20260803";
const EXPECTED_PROBLEMS = Object.freeze([
  "phase3_agreement_migration_record_missing",
  "missing_phase3_agreement_triggers",
  "legacy_optional_activation_gate_fragments",
  "missing_company_wide_approval_gate_fragments",
  "missing_unique_credit_application_agreement_index",
]);

const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );

function hasExecutableSql(sqlText) {
  return String(sqlText || "")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("--");
    });
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (hasExecutableSql(buffer)) {
        throw new Error(
          "SQL DELIMITER appeared before the previous statement ended."
        );
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

  if (hasExecutableSql(buffer)) {
    throw new Error("SQL script ended with an incomplete statement.");
  }
  return statements;
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

function readSql(filename) {
  const filePath = path.resolve(
    __dirname,
    "../../database/migrations",
    filename
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved Phase 3 SQL file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function executeStatements(connection, statements, label) {
  const results = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      results.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1} of ${
        statements.length
      }: ${error.message}`;
      throw error;
    }
  }
  return results;
}

function validateVerifierResults(results) {
  if (results.length !== EXPECTED_PROBLEMS.length) {
    throw new Error(
      `Phase 3 agreement verifier returned ${results.length} result sets; expected ${EXPECTED_PROBLEMS.length}.`
    );
  }

  EXPECTED_PROBLEMS.forEach((key, index) => {
    const rows = results[index];
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(
        `Phase 3 agreement verifier did not return exactly one ${key} row.`
      );
    }
    const value = Number(rows[0]?.[key]);
    if (!Number.isFinite(value)) {
      throw new Error(
        `Phase 3 agreement verifier did not return numeric ${key}.`
      );
    }
    if (value !== 0) {
      throw new Error(
        `Phase 3 agreement verifier returned ${key}=${value}; expected 0.`
      );
    }
  });
}

async function migrationRecordExists(connection) {
  const [[tableRow]] = await connection.query(
    `SELECT COUNT(*) AS present
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'`
  );
  if (Number(tableRow?.present || 0) !== 1) return false;

  const [[migrationRow]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(migrationRow?.applied || 0) === 1;
}

async function runVerifier(connection) {
  const statements = splitSqlScript(readSql(VERIFIER_FILE));
  const results = await executeStatements(
    connection,
    statements,
    "Phase 3 agreement verifier"
  );
  validateVerifierResults(results);
}

function assertReleaseSafety(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error(
      "Phase 3 agreement migration requires NODE_ENV=production."
    );
  }
  if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error(
      "Confirm a fresh verified signed Chalin 03 Professional Backup first."
    );
  }
}

async function runEquipmentFinanceAgreementCreationStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    if (await migrationRecordExists(connection)) {
      await runVerifier(connection);
      console.log(
        `Equipment Finance Phase 3 agreement schema already applied and verified on ${databaseName}.`
      );
      return { applied: true, database_name: databaseName };
    }

    assertReleaseSafety();

    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 30) AS acquired",
      [MIGRATION_LOCK_NAME]
    );
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error(
        "Could not acquire the Phase 3 agreement migration lock."
      );
    }

    if (!(await migrationRecordExists(connection))) {
      const statements = splitSqlScript(readSql(MIGRATION_FILE));
      await executeStatements(
        connection,
        statements,
        "Phase 3 agreement migration"
      );
    }

    await runVerifier(connection);
    console.log(
      `Equipment Finance Phase 3 agreement schema applied and verified on ${databaseName}.`
    );
    return { applied: true, database_name: databaseName };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query(
          "SELECT RELEASE_LOCK(?) AS released",
          [MIGRATION_LOCK_NAME]
        );
      } catch (error) {
        console.error(
          "Warning: Phase 3 agreement migration lock release failed:",
          error.message
        );
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinanceAgreementCreationStartup().catch((error) => {
    console.error(
      "Equipment Finance Phase 3 Railway agreement migration failed."
    );
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  VERIFIER_FILE,
  assertReleaseSafety,
  migrationRecordExists,
  runEquipmentFinanceAgreementCreationStartup,
  splitSqlScript,
  validateVerifierResults,
};


