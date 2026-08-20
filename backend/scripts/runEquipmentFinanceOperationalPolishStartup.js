const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  VERIFIER_FILE,
  runEquipmentFinanceOperationalPolishMigration,
  splitSqlScript,
  validateVerifierResults,
} = require("./runEquipmentFinanceOperationalPolishMigration");
const {
  runEquipmentFinancePhaseThreeApplicationStartup,
} = require("./runEquipmentFinancePhaseThreeApplicationStartup");
const {
  runEquipmentFinanceAgreementCreationStartup,
} = require("./runEquipmentFinanceAgreementCreationStartup");

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

function readVerifierSql() {
  const filePath = path.resolve(
    __dirname,
    "../../database/migrations",
    VERIFIER_FILE
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved Phase 3 verifier is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function executeVerifier(connection, statements) {
  const results = [];
  for (let index = 0; index < statements.length; index += 1) {
    try {
      const [rows] = await connection.query(statements[index]);
      results.push(Array.isArray(rows) ? rows : []);
    } catch (error) {
      error.message = `Phase 3 startup verifier failed at statement ${
        index + 1
      } of ${statements.length}: ${error.message}`;
      throw error;
    }
  }
  validateVerifierResults(results);
}

async function verifyDatabaseIdentity(connection) {
  const [[databaseRow]] = await connection.query(
    "SELECT DATABASE() AS database_name"
  );
  const databaseName = String(databaseRow?.database_name || "").trim();
  const expectedDatabase = String(
    process.env.CHALIN03_EXPECTED_DATABASE || ""
  ).trim();

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

async function inspectAndVerifyAppliedRelease() {
  const connection = await mysql.createConnection(connectionOptions());
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const applied = await migrationRecordExists(connection);
    if (!applied) {
      return { applied: false, database_name: databaseName };
    }

    const verifierStatements = splitSqlScript(readVerifierSql());
    await executeVerifier(connection, verifierStatements);
    console.log(
      `Phase 3 Finance migration already applied and verified on ${databaseName}.`
    );
    return { applied: true, database_name: databaseName };
  } finally {
    await connection.end();
  }
}

async function runEquipmentFinanceOperationalPolishStartup() {
  // This is the existing reviewed Railway Phase 3 gate. Keep the public startup
  // command stable while verifying the newer application pipeline first.
  const applicationPipeline =
    await runEquipmentFinancePhaseThreeApplicationStartup();
  const state = await inspectAndVerifyAppliedRelease();

  if (!state.applied) {
    console.log(
      `Phase 3 Finance migration record is absent on ${state.database_name}; running controlled release ${RELEASE_CONFIRMATION}.`
    );
    await runEquipmentFinanceOperationalPolishMigration();
  }

  await runEquipmentFinanceAgreementCreationStartup();
  return {
    applied: true,
    database_name: state.database_name,
    application_pipeline_repaired: Boolean(applicationPipeline?.repaired),
  };
}

if (require.main === module) {
  runEquipmentFinanceOperationalPolishStartup().catch((error) => {
    console.error("Equipment Finance Phase 3 Railway startup gate failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  executeVerifier,
  inspectAndVerifyAppliedRelease,
  migrationRecordExists,
  runEquipmentFinanceOperationalPolishStartup,
  verifyDatabaseIdentity,
};
