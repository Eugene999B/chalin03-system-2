const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  MIGRATION_RECORD,
  VERIFIER_FILE,
  migrationRecordExists,
  runEquipmentFinanceCompanyWideStabilizationMigration,
  splitSqlScript,
  validateVerifierResults,
} = require("./runEquipmentFinanceCompanyWideStabilizationMigration");

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

function readVerifierSql() {
  const filePath = path.resolve(__dirname, "../../database/migrations", VERIFIER_FILE);
  if (!fs.existsSync(filePath)) throw new Error(`Approved Finance verifier is missing: ${filePath}`);
  return fs.readFileSync(filePath, "utf8");
}

async function executeVerifier(connection) {
  const statements = splitSqlScript(readVerifierSql());
  const results = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      results.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `Finance stabilization startup verifier failed at statement ${index + 1} of ${statements.length}: ${error.message}`;
      throw error;
    }
  }
  validateVerifierResults(results);
}

async function verifyDatabaseIdentity(connection) {
  const [[databaseRow]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(databaseRow?.database_name || "").trim();
  const expectedDatabase = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expectedDatabase || databaseName !== expectedDatabase) {
    throw new Error("Connected database does not match CHALIN03_EXPECTED_DATABASE.");
  }
  return databaseName;
}

async function inspectAppliedRelease() {
  const connection = await mysql.createConnection(connectionOptions());
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const applied = await migrationRecordExists(connection);
    if (!applied) return { applied: false, database_name: databaseName };
    await executeVerifier(connection);
    console.log(`Finance company-wide stabilization already applied and verified on ${databaseName}.`);
    return { applied: true, database_name: databaseName };
  } finally {
    await connection.end();
  }
}

async function runEquipmentFinanceCompanyWideStabilizationStartup() {
  const state = await inspectAppliedRelease();
  if (state.applied) return state;
  console.log(
    `${MIGRATION_RECORD} is absent on ${state.database_name}; running the controlled company-wide Finance stabilization.`
  );
  await runEquipmentFinanceCompanyWideStabilizationMigration();
  return { applied: true, database_name: state.database_name };
}

if (require.main === module) {
  runEquipmentFinanceCompanyWideStabilizationStartup().catch((error) => {
    console.error("Equipment Finance company-wide Railway startup gate failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  executeVerifier,
  inspectAppliedRelease,
  runEquipmentFinanceCompanyWideStabilizationStartup,
  verifyDatabaseIdentity,
};
