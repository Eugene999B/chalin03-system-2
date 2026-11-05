const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_RECORD = "20260830_equipment_finance_installment_late_fee_policy";
const MIGRATION_LOCK = "chalin03:equipment-finance:installment-late-fee-policy";
const REQUIRED_COLUMNS = Object.freeze({
  default_week_interval_weeks:
    "ALTER TABLE equipment_finance_settings ADD COLUMN default_week_interval_weeks TINYINT NOT NULL DEFAULT 1",
  late_fee_trigger_mode:
    "ALTER TABLE equipment_finance_settings ADD COLUMN late_fee_trigger_mode ENUM('each_missed_installment','after_final_due_plus_grace') NOT NULL DEFAULT 'each_missed_installment'",
  late_fee_decision_mode:
    "ALTER TABLE equipment_finance_settings ADD COLUMN late_fee_decision_mode ENUM('automatic','boss_approval') NOT NULL DEFAULT 'automatic'",
});

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

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
    return { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true };
  }
  return {
    rejectUnauthorized: !["0", "false", "no", "off"].includes(
      String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
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
    ssl: sslConfig(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

async function verifyDatabaseIdentity(connection) {
  const [[row]] = await connection.query("SELECT DATABASE() AS database_name");
  const databaseName = String(row?.database_name || "").trim();
  const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
  if (!databaseName || !expected || databaseName !== expected) {
    throw new Error(
      `Production database identity check failed: connected=${databaseName || "none"} expected=${expected || "unset"}.`
    );
  }
  return databaseName;
}

async function ensureMigrationRecord(connection) {
  await connection.query(
    "INSERT INTO schema_migrations (migration_name, applied_at) VALUES (?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name)",
    [MIGRATION_RECORD]
  );
}

async function ensurePolicyColumns(connection) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_settings'
        AND COLUMN_NAME IN (?, ?, ?)`,
    Object.keys(REQUIRED_COLUMNS)
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  let changed = false;
  for (const [column, statement] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existing.has(column)) {
      await connection.query(statement);
      changed = true;
    }
  }
  return changed;
}

async function ensureDecisionTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS equipment_finance_late_fee_decisions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      agreement_id BIGINT NOT NULL,
      schedule_id BIGINT NOT NULL,
      trigger_mode VARCHAR(60) NOT NULL,
      decision_mode VARCHAR(30) NOT NULL,
      eligible_on DATE NOT NULL,
      proposed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      basis_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
      fee_type VARCHAR(30) NOT NULL DEFAULT 'fixed',
      fee_value DECIMAL(15,4) NOT NULL DEFAULT 0,
      status ENUM('pending','applied','waived') NOT NULL DEFAULT 'pending',
      decided_by INT NULL,
      decided_at DATETIME NULL,
      decision_reason VARCHAR(1000) NULL,
      applied_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_equipment_finance_late_fee_decision (agreement_id, schedule_id, trigger_mode),
      INDEX idx_equipment_finance_late_fee_queue (status, eligible_on),
      INDEX idx_equipment_finance_late_fee_agreement (agreement_id, status)
    )
  `);
}

async function verify(connection) {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_settings'
        AND COLUMN_NAME IN (?, ?, ?)`,
    Object.keys(REQUIRED_COLUMNS)
  );
  const existing = new Set(columns.map((row) => row.COLUMN_NAME));
  const missingColumns = Object.keys(REQUIRED_COLUMNS).filter((name) => !existing.has(name));
  const [tables] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'equipment_finance_late_fee_decisions'`
  );
  if (missingColumns.length || !tables.length) {
    throw new Error(
      `Installment late-fee policy verification failed: missingColumns=${JSON.stringify(missingColumns)}, decisionTable=${tables.length === 1}.`
    );
  }
  return { missing_columns: missingColumns, decision_table_present: true };
}

async function run() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Equipment Finance installment late-fee policy migration requires NODE_ENV=production.");
  }
  if (!truthy(process.env.CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED)) {
    throw new Error("Equipment Finance production migrations are not enabled.");
  }
  if (!truthy(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) {
    throw new Error("Signed production backup confirmation is required.");
  }

  const connection = await mysql.createConnection(connectionOptions());
  let locked = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire Equipment Finance installment late-fee migration lock.");

    const changed = await ensurePolicyColumns(connection);
    await ensureDecisionTable(connection);
    await ensureMigrationRecord(connection);
    const verification = await verify(connection);

    console.log(JSON.stringify({
      verified: true,
      database_name: databaseName,
      migration: MIGRATION_RECORD,
      policy_columns_added: changed,
      decision_table_present: verification.decision_table_present,
    }));
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Equipment Finance installment late-fee policy migration failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { MIGRATION_LOCK, MIGRATION_RECORD, REQUIRED_COLUMNS, run };
