const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_RECORD = "20260829_equipment_finance_sms_alert_enum";
const MIGRATION_LOCK = "chalin03:equipment-finance:sms-alert-enum";
const REQUIRED_SMS_TYPE = "equipment_finance_payment_alert";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function sslConfig() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  if (encodedCa) return { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true };
  return { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) };
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
    throw new Error(`Production database identity check failed: connected=${databaseName || "none"} expected=${expected || "unset"}.`);
  }
  return databaseName;
}

async function smsTypeEnum(connection) {
  const [rows] = await connection.query("SHOW COLUMNS FROM sms_log LIKE 'sms_type'");
  if (rows.length !== 1) throw new Error("sms_log.sms_type column was not found.");
  return String(rows[0].Type || "");
}

async function migrationExists(connection) {
  const [[row]] = await connection.query("SELECT COUNT(*) AS applied FROM schema_migrations WHERE migration_name = ?", [MIGRATION_RECORD]);
  return Number(row?.applied || 0) === 1;
}

async function ensureEnum(connection) {
  const current = await smsTypeEnum(connection);
  if (current.includes(`'${REQUIRED_SMS_TYPE}'`)) return false;

  const required = [
    "receipt",
    "debt_reminder",
    "low_stock",
    "daily_summary",
    "sale_confirmation",
    "security_alert",
    REQUIRED_SMS_TYPE,
    "other",
  ];
  const sqlEnum = required.map((item) => `'${item.replace(/'/g, "''")}'`).join(", ");
  await connection.query(`ALTER TABLE sms_log MODIFY COLUMN sms_type ENUM(${sqlEnum}) NOT NULL DEFAULT 'other'`);
  return true;
}

async function ensureMigrationRecord(connection) {
  await connection.query(
    "INSERT INTO schema_migrations (migration_name, applied_at) VALUES (?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name)",
    [MIGRATION_RECORD]
  );
}

async function run() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") throw new Error("Equipment Installment SMS migration requires NODE_ENV=production.");
  if (!truthy(process.env.CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED)) throw new Error("Equipment Finance production migrations are not enabled.");
  if (!truthy(process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED)) throw new Error("Signed production backup confirmation is required.");

  const connection = await mysql.createConnection(connectionOptions());
  let locked = false;
  try {
    const databaseName = await verifyDatabaseIdentity(connection);
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire Equipment Installment SMS migration lock.");

    const changed = await ensureEnum(connection);
    await ensureMigrationRecord(connection);

    const verifiedType = await smsTypeEnum(connection);
    if (!verifiedType.includes(`'${REQUIRED_SMS_TYPE}'`)) throw new Error("Equipment Installment SMS enum verification failed.");

    console.log(JSON.stringify({ verified: true, database_name: databaseName, migration: MIGRATION_RECORD, sms_type_added: changed, sms_type: REQUIRED_SMS_TYPE }));
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]).catch(() => {});
    await connection.end();
  }
}

if (require.main === module) run().catch((error) => { console.error("Equipment Installment SMS migration failed:"); console.error(error.message); process.exit(1); });

module.exports = { MIGRATION_LOCK, MIGRATION_RECORD, REQUIRED_SMS_TYPE, run, smsTypeEnum };
