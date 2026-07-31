const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const RELEASE_CONFIRMATION = "20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH";
const MIGRATION_RECORD = "20260731_equipment_finance_operational_polish";
const MIGRATION_LOCK_NAME = "chalin03:fin-ops:20260731";
const MIGRATION_FILE = "20260731_equipment_finance_operational_polish.sql";
const VERIFIER_FILE = "20260731_equipment_finance_operational_polish_verify.sql";
const PRESERVED_TABLES = Object.freeze([
  "equipment_credit_applications",
  "equipment_sale_agreements",
  "equipment_sale_payments",
  "equipment_finance_issued_documents",
  "equipment_finance_payment_alerts",
]);
const EXPECTED_PROBLEMS = Object.freeze([
  "missing_operational_polish_tables",
  "missing_operational_polish_columns",
  "missing_operational_polish_indexes",
  "invalid_operational_polish_drafts",
  "invalid_operational_polish_documents",
  "invalid_operational_polish_amendments",
  "operational_polish_migration_record_missing",
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

function assertReleaseGates(env = process.env) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Phase 3 migration requires NODE_ENV=production.");
  }
  if (!truthy(env.CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED)) {
    throw new Error(
      "Set CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED=true only for the controlled Phase 3 migration."
    );
  }
  if (!truthy(env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("Confirm a fresh verified signed Chalin 03 Professional Backup first.");
  }
  if (!truthy(env.CHALIN03_SQL_BACKUP_CONFIRMED)) {
    throw new Error("Confirm a separate fresh Railway/MySQL SQL backup first.");
  }
  if (String(env.CHALIN03_MIGRATION_RELEASE || "").trim() !== RELEASE_CONFIRMATION) {
    throw new Error(
      `Set CHALIN03_MIGRATION_RELEASE=${RELEASE_CONFIRMATION} for this exact release.`
    );
  }
}

function splitSqlScript(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of String(sqlText || "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (match) {
      if (buffer.trim()) {
        throw new Error("SQL DELIMITER appeared before the previous statement ended.");
      }
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

function readSql(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) throw new Error(`Approved SQL file is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function execute(connection, statements, label) {
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
  EXPECTED_PROBLEMS.forEach((key, index) => {
    const rows = results[index];
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error(`Verifier did not return exactly one ${key} row.`);
    }
    const value = Number(rows[0]?.[key]);
    if (!Number.isFinite(value)) throw new Error(`Verifier did not return numeric ${key}.`);
    if (value !== 0) throw new Error(`Verifier returned ${key}=${value}; expected 0.`);
  });
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

async function tableRowCounts(connection) {
  const counts = {};
  for (const tableName of PRESERVED_TABLES) {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) throw new Error("Unsafe preserved table name.");
    const [rows] = await connection.query(`SELECT COUNT(*) AS row_count FROM \`${tableName}\``);
    counts[tableName] = Number(rows[0]?.row_count || 0);
  }
  return counts;
}

function assertPreservedCounts(before, after) {
  for (const tableName of PRESERVED_TABLES) {
    if (before[tableName] !== after[tableName]) {
      throw new Error(
        `Phase 3 migration changed ${tableName} row count from ${before[tableName]} to ${after[tableName]}.`
      );
    }
  }
}

async function runEquipmentFinanceOperationalPolishMigration() {
  assertReleaseGates();
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(databaseRow?.database_name || "").trim();
    const expectedDatabase = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
    if (!databaseName || !expectedDatabase) {
      throw new Error("Set CHALIN03_EXPECTED_DATABASE to the exact Railway production database name.");
    }
    if (databaseName !== expectedDatabase) {
      throw new Error(
        `Connected database ${databaseName} does not match CHALIN03_EXPECTED_DATABASE.`
      );
    }

    const [[prerequisite]] = await connection.query(
      `SELECT COUNT(*) AS ready
       FROM schema_migrations
       WHERE migration_name = '20260731_equipment_finance_professional_rebuild'`
    );
    if (Number(prerequisite?.ready || 0) !== 1) {
      throw new Error("The Professional Equipment Finance rebuild migration is not recorded.");
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      MIGRATION_LOCK_NAME,
    ]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Phase 3 Finance migration lock.");

    const beforeCounts = await tableRowCounts(connection);
    const migrationStatements = splitSqlScript(readSql(MIGRATION_FILE));
    const verifierStatements = splitSqlScript(readSql(VERIFIER_FILE));

    console.log(`Connected to approved database: ${databaseName}`);
    console.log(`Phase 3 Finance release: ${RELEASE_CONFIRMATION}`);
    console.log(`Applying ${MIGRATION_FILE}...`);
    await execute(connection, migrationStatements, "Phase 3 Finance migration");

    const afterCounts = await tableRowCounts(connection);
    assertPreservedCounts(beforeCounts, afterCounts);

    console.log(`Verifying ${VERIFIER_FILE}...`);
    validateVerifierResults(
      await execute(connection, verifierStatements, "Phase 3 Finance verifier")
    );
    console.log("Equipment Finance Phase 3 operational polish migration verified successfully.");
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
      } catch (error) {
        console.error("Warning: migration lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinanceOperationalPolishMigration().catch((error) => {
    console.error("Equipment Finance Phase 3 migration failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  PRESERVED_TABLES,
  RELEASE_CONFIRMATION,
  VERIFIER_FILE,
  assertReleaseGates,
  assertPreservedCounts,
  runEquipmentFinanceOperationalPolishMigration,
  splitSqlScript,
  validateVerifierResults,
};
