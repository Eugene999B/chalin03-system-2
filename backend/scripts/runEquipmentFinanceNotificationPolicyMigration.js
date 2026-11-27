const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_RECORD = "20260904_equipment_finance_notification_controls";
const MIGRATION_LOCK = "chalin03:equipment-finance:notification-controls";

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

async function run() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    throw new Error("Equipment Installment notification migration requires NODE_ENV=production.");
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
    if (!locked) throw new Error("Could not acquire Equipment Installment notification migration lock.");

    await connection.query(`CREATE TABLE IF NOT EXISTS equipment_finance_notification_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      equipment_created TINYINT(1) NOT NULL DEFAULT 1,
      customer_created TINYINT(1) NOT NULL DEFAULT 1,
      application_approved TINYINT(1) NOT NULL DEFAULT 1,
      agreement TINYINT(1) NOT NULL DEFAULT 1,
      deposit TINYINT(1) NOT NULL DEFAULT 1,
      payment TINYINT(1) NOT NULL DEFAULT 1,
      reminders TINYINT(1) NOT NULL DEFAULT 1,
      settlement_ownership TINYINT(1) NOT NULL DEFAULT 1,
      document_share TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT chk_equipment_finance_notification_singleton CHECK (id = 1)
    )`);
    await connection.query(
      "INSERT INTO equipment_finance_notification_settings (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id"
    );
    await connection.query(
      "INSERT INTO schema_migrations (migration_name, applied_at) VALUES (?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name)",
      [MIGRATION_RECORD]
    );
    const [rows] = await connection.query(
      "SELECT id, equipment_created, customer_created, application_approved, agreement, deposit, payment, reminders, settlement_ownership, document_share FROM equipment_finance_notification_settings WHERE id = 1 LIMIT 1"
    );
    if (rows.length !== 1) throw new Error("Notification settings row verification failed.");
    console.log(JSON.stringify({ verified: true, database_name: databaseName, migration: MIGRATION_RECORD }));
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Equipment Installment notification migration failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { MIGRATION_LOCK, MIGRATION_RECORD, run };
