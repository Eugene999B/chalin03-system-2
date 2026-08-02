const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  VERIFIER_FILE,
  splitSqlScript,
  validateVerifierResults,
  verifyDatabaseIdentity,
} = require("./runEquipmentFinancePhaseOneSchemaStartup");

const REPAIR_NAME = "Equipment Finance Phase 1 emergency compatibility repair";

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

function readSql(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved SQL file is missing: ${filePath}`);
  }
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

async function verifyPhaseOneSchema(connection) {
  const verifierStatements = splitSqlScript(readSql(VERIFIER_FILE));
  const results = await executeStatements(
    connection,
    verifierStatements,
    "Phase 1 emergency verifier"
  );
  validateVerifierResults(results);
  return true;
}

async function phaseOneSchemaNeedsRepair(connection) {
  try {
    await verifyPhaseOneSchema(connection);
    return false;
  } catch (error) {
    console.warn(`${REPAIR_NAME}: ${error.message}`);
    return true;
  }
}

async function runEquipmentFinancePhaseOneEmergencyRepair() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;

  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    if (!(await phaseOneSchemaNeedsRepair(connection))) {
      console.log(`Equipment Finance Phase 1 schema is healthy on ${databaseName}.`);
      return { repaired: false, database_name: databaseName };
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      MIGRATION_LOCK_NAME,
    ]);
    lockAcquired = Number(lockRow?.acquired) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Phase 1 emergency repair lock.");
    }

    // Another Railway instance may have repaired the schema while this process waited.
    if (await phaseOneSchemaNeedsRepair(connection)) {
      const migrationStatements = splitSqlScript(readSql(MIGRATION_FILE));
      await executeStatements(
        connection,
        migrationStatements,
        "Phase 1 emergency compatibility repair"
      );
    }

    await verifyPhaseOneSchema(connection);
    console.log(`Equipment Finance Phase 1 schema repaired and verified on ${databaseName}.`);
    return { repaired: true, database_name: databaseName };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [MIGRATION_LOCK_NAME]);
      } catch (error) {
        console.error("Warning: Phase 1 emergency repair lock release failed:", error.message);
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseOneEmergencyRepair().catch((error) => {
    console.error(`${REPAIR_NAME} failed.`);
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_PROBLEMS,
  REPAIR_NAME,
  executeStatements,
  phaseOneSchemaNeedsRepair,
  runEquipmentFinancePhaseOneEmergencyRepair,
  verifyPhaseOneSchema,
};
