const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const {
  executeStatements,
  splitSqlScript,
  verifyDatabaseIdentity,
} = require("./runEquipmentFinancePhaseFiveUnifiedDocumentsStartup");

const MIGRATION_RECORD = "20260803_equipment_finance_phase6_performance";
const MIGRATION_FILE = "20260803_equipment_finance_phase6_performance.sql";
const VERIFIER_FILE = "20260803_equipment_finance_phase6_performance_verify.sql";
const MIGRATION_LOCK = "chalin03:equipment-finance:phase6-performance";
const EXPECTED_INDEXES = new Map([
  ["equipment_credit_applications.idx_finance_perf_application_status", "application_status,updated_at,id"],
  ["equipment_credit_applications.idx_finance_perf_application_updated", "updated_at,id"],
  ["equipment_sale_agreements.idx_finance_perf_agreement_application", "sale_type,credit_application_id,updated_at,id"],
  ["equipment_finance_case_tasks.idx_finance_perf_task_user_inbox", "task_status,assigned_to,priority,due_at,id"],
  ["equipment_finance_case_tasks.idx_finance_perf_task_role_inbox", "task_status,assigned_role,priority,due_at,id"],
  ["equipment_finance_private_documents.idx_finance_perf_document_review", "document_status,review_status,uploaded_at,id"],
  ["equipment_finance_private_documents.idx_finance_perf_document_approval", "document_status,approval_status,uploaded_at,id"],
  ["equipment_finance_payment_alerts.idx_finance_perf_failed_alert", "alert_status,updated_at,id"],
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

function sslConfig(env = process.env) {
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
    ssl: sslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function readMigrationFile(filename) {
  const filePath = path.resolve(__dirname, "../../database/migrations", filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Approved Phase 6 performance SQL file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

async function migrationRecordExists(connection) {
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?",
    [MIGRATION_RECORD]
  );
  return Number(row?.applied || 0) === 1;
}

function validateVerifierResults(results) {
  if (results.length !== 3) {
    throw new Error(`Phase 6 performance verifier returned ${results.length} result sets instead of 3.`);
  }
  const [migrationRows, indexRows, repairRows] = results;
  if (
    migrationRows.length !== 1 ||
    migrationRows[0].migration_name !== MIGRATION_RECORD
  ) {
    throw new Error("Phase 6 performance migration record was not verified.");
  }
  if (indexRows.length !== EXPECTED_INDEXES.size) {
    throw new Error(
      `Phase 6 performance verifier found ${indexRows.length} indexes instead of ${EXPECTED_INDEXES.size}.`
    );
  }
  for (const row of indexRows) {
    const key = `${row.TABLE_NAME}.${row.INDEX_NAME}`;
    if (EXPECTED_INDEXES.get(key) !== row.indexed_columns) {
      throw new Error(`Phase 6 performance index ${key} is missing or has the wrong columns.`);
    }
  }
  if (Number(repairRows[0]?.misclassified_legacy_documents || 0) !== 0) {
    throw new Error("Phase 6 verifier found misclassified encrypted legacy documents.");
  }
}

async function runEquipmentFinancePhaseSixPerformanceStartup() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  let applied = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [
      MIGRATION_LOCK,
    ]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error("Could not acquire the Phase 6 performance migration lock.");

    if (!(await migrationRecordExists(connection))) {
      await executeStatements(
        connection,
        splitSqlScript(readMigrationFile(MIGRATION_FILE)),
        "Equipment Finance Phase 6 performance migration"
      );
      applied = true;
      console.log(`Applied ${MIGRATION_RECORD} on ${databaseName}.`);
    }

    const results = await executeStatements(
      connection,
      splitSqlScript(readMigrationFile(VERIFIER_FILE)),
      "Equipment Finance Phase 6 performance verifier"
    );
    validateVerifierResults(results);
    console.log(`Verified ${MIGRATION_RECORD} on ${databaseName}.`);
    return { applied, database_name: databaseName, migration: MIGRATION_RECORD };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
      } catch {
        // Closing the connection also releases the advisory lock.
      }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runEquipmentFinancePhaseSixPerformanceStartup().catch((error) => {
    console.error("Equipment Finance Phase 6 performance Railway startup gate failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_INDEXES,
  MIGRATION_FILE,
  MIGRATION_LOCK,
  MIGRATION_RECORD,
  VERIFIER_FILE,
  runEquipmentFinancePhaseSixPerformanceStartup,
  validateVerifierResults,
};
