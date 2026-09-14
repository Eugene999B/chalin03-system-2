const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  splitSqlScript,
  verifyDatabaseIdentity,
} = require("./runEquipmentFinancePhaseOneSchemaStartup");

const MIGRATION_FILE = "20260804_equipment_finance_phase3_application_pipeline.sql";
const VERIFIER_FILE = "20260804_equipment_finance_phase3_application_pipeline_verify.sql";
const MIGRATION_LOCK_NAME = "chalin03:finance:phase3-application-pipeline:20260804";
const EXPECTED_PROBLEMS = Object.freeze([
  "missing_phase3_tables",
  "missing_phase3_columns",
  "invalid_phase3_location_nullability",
  "invalid_phase3_workflow_enums",
  "missing_phase3_indexes",
  "phase3_migration_record_missing",
]);

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

function readSql(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved Phase 3 SQL file is missing: ${filePath}`);
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

function validateVerifierResults(results) {
  if (results.length !== EXPECTED_PROBLEMS.length) {
    throw new Error(
      `Phase 3 verifier returned ${results.length} result sets; expected ${EXPECTED_PROBLEMS.length}.`
    );
  }
  const failures = [];
  EXPECTED_PROBLEMS.forEach((key, index) => {
    const rows = results[index];
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(`Phase 3 verifier did not return exactly one ${key} row.`);
    }
    const value = Number(rows[0]?.[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`Phase 3 verifier did not return numeric ${key}.`);
    }
    if (value !== 0) failures.push(`${key}=${value}`);
  });
  if (failures.length) {
    const error = new Error(`Phase 3 Finance schema requires repair: ${failures.join(", ")}.`);
    error.code = "FINANCE_PHASE3_SCHEMA_REPAIR_REQUIRED";
    throw error;
  }
  return true;
}

async function runVerifier(connection) {
  const statements = splitSqlScript(readSql(VERIFIER_FILE));
  const results = await executeStatements(connection, statements, "Phase 3 verifier");
  return validateVerifierResults(results);
}

async function needsRepair(connection) {
  try {
    await runVerifier(connection);
    return false;
  } catch (error) {
    if (error.code !== "FINANCE_PHASE3_SCHEMA_REPAIR_REQUIRED") throw error;
    console.warn(error.message);
    return true;
  }
}

async function runEquipmentFinancePhaseThreeApplicationStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    if (!(await needsRepair(connection))) {
      console.log(`Equipment Finance Phase 3 application pipeline is healthy on ${databaseName}.`);
      return { repaired: false, database_name: databaseName };
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      MIGRATION_LOCK_NAME,
    ]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Phase 3 Finance migration lock.");

    if (await needsRepair(connection)) {
      const statements = splitSqlScript(readSql(MIGRATION_FILE));
      await executeStatements(connection, statements, "Phase 3 Finance application migration");
    }

    await runVerifier(connection);
    console.log(`Equipment Finance Phase 3 application pipeline repaired and verified on ${databaseName}.`);
    return { repaired: true, database_name: databaseName };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
      } catch (error) {
        console.error("Warning: Phase 3 Finance migration lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseThreeApplicationStartup().catch((error) => {
    console.error("Equipment Finance Phase 3 application startup failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  VERIFIER_FILE,
  executeStatements,
  needsRepair,
  runEquipmentFinancePhaseThreeApplicationStartup,
  runVerifier,
  validateVerifierResults,
};
