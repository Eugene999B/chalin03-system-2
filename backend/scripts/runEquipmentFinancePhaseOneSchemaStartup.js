const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260801_EQUIPMENT_FINANCE_PHASE1_SCHEMA";
const MIGRATION_RECORD = "20260801_equipment_finance_phase1_schema_foundation";
const MIGRATION_LOCK_NAME = "chalin03:finance:phase1-schema:20260801";
const MIGRATION_FILE = "20260801_equipment_finance_phase1_schema_foundation.sql";
const VERIFIER_FILE = "20260801_equipment_finance_phase1_schema_foundation_verify.sql";
const EXPECTED_PROBLEMS = Object.freeze([
  "missing_phase1_tables",
  "invalid_finance_location_columns",
  "missing_phase1_schedule_columns",
  "invalid_phase1_schedule_columns",
  "invalid_phase1_day_rule_enums",
  "phase1_migration_record_missing",
]);

const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

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

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimiterMatch) {
      if (buffer.trim()) {
        throw new Error("SQL DELIMITER appeared before the previous statement ended.");
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

function readSql(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved SQL file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function executeStatements(connection, statements, label) {
  const resultSets = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      resultSets.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `${label} failed at statement ${index + 1} of ${statements.length}: ${error.message}`;
      throw error;
    }
  }
  return resultSets;
}

function validateVerifierResults(results) {
  if (results.length !== EXPECTED_PROBLEMS.length) {
    throw new Error(
      `Phase 1 verifier returned ${results.length} result sets; expected ${EXPECTED_PROBLEMS.length}.`
    );
  }

  EXPECTED_PROBLEMS.forEach((key, index) => {
    const rows = results[index];
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(`Phase 1 verifier did not return exactly one ${key} row.`);
    }
    const value = Number(rows[0]?.[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Phase 1 verifier did not return numeric ${key}.`);
    }
    if (value !== 0) {
      throw new Error(`Phase 1 verifier returned ${key}=${value}; expected 0.`);
    }
  });
}

function assertMigrationReleaseGates(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Phase 1 schema migration requires NODE_ENV=production.");
  }
  if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("Confirm a fresh verified signed Chalin 03 Professional Backup first.");
  }
  if (String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !== RELEASE_CONFIRMATION) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact release.`
    );
  }
}

async function verifyDatabaseIdentity(connection) {
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(databaseRow?.database_name || "").trim();
  const expectedDatabase = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();

  if (!databaseName || !expectedDatabase) {
    throw new Error(
      "Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name."
    );
  }
  if (databaseName !== expectedDatabase) {
    throw new Error(
      `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
    );
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

  const [[migrationRow]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(migrationRow?.applied || 0) === 1;
}

async function runVerifier(connection) {
  const verifierStatements = splitSqlScript(readSql(VERIFIER_FILE));
  const results = await executeStatements(connection, verifierStatements, "Phase 1 verifier");
  validateVerifierResults(results);
}

async function runEquipmentFinancePhaseOneSchemaStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const applied = await migrationRecordExists(connection);

    if (applied) {
      await runVerifier(connection);
      console.log(`Equipment Finance Phase 1 schema already applied and verified on ${databaseName}.`);
      return { applied: true, skipped: false, database_name: databaseName };
    }

    if (!truthy(process.env.CHALIN03_EQUIPMENT_FINANCE_PHASE1_SCHEMA_ENABLED)) {
      console.log(
        "Equipment Finance Phase 1 schema is not enabled for this deployment; leaving the database unchanged."
      );
      return { applied: false, skipped: true, database_name: databaseName };
    }

    assertMigrationReleaseGates();

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      MIGRATION_LOCK_NAME,
    ]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Phase 1 schema migration lock.");

    if (!(await migrationRecordExists(connection))) {
      const migrationStatements = splitSqlScript(readSql(MIGRATION_FILE));
      await executeStatements(connection, migrationStatements, "Phase 1 schema migration");
    }

    await runVerifier(connection);
    console.log(`Equipment Finance Phase 1 schema applied and verified on ${databaseName}.`);
    return { applied: true, skipped: false, database_name: databaseName };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
      } catch (error) {
        console.error("Warning: Phase 1 schema migration lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseOneSchemaStartup().catch((error) => {
    console.error("Equipment Finance Phase 1 Railway schema gate failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  VERIFIER_FILE,
  assertMigrationReleaseGates,
  migrationRecordExists,
  runEquipmentFinancePhaseOneSchemaStartup,
  splitSqlScript,
  validateVerifierResults,
  verifyDatabaseIdentity,
};
