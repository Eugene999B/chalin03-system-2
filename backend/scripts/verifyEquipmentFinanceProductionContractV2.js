const mysql = require("mysql2/promise");
require("dotenv").config();

const REQUIRED_MIGRATIONS = ["20260803_equipment_finance_phase4_deposit_reservation_integrity"];
const REQUIRED_COLUMNS = {
  equipment_sale_agreements: ["credit_application_id", "activation_source", "equipment_commitment_status", "deposit_completed_at", "deposit_completed_by", "reservation_activated_at", "reservation_activated_by"],
  equipment_sale_payments: ["credit_application_id", "payment_stage", "reservation_effect", "idempotency_key"],
};
const REQUIRED_TRIGGERS = {
  trg_equipment_finance_payment_gate_before_insert: "INSERT",
  trg_equipment_finance_reservation_gate_before_insert: "INSERT",
  trg_equipment_finance_commitment_gate_before_update: "UPDATE",
};
function env(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${name}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}
function connectionOptions() {
  const sslEnabled = String(process.env.DB_SSL || "").trim().toLowerCase() === "true";
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase());
  return { host: env("DB_HOST", "MYSQLHOST"), port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306), user: env("DB_USER", "MYSQLUSER"), password: env("DB_PASSWORD", "MYSQLPASSWORD"), database: env("DB_NAME", "MYSQLDATABASE"), ssl: sslEnabled ? (ca ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true } : { rejectUnauthorized }) : undefined, connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000), timezone: "Z" };
}
function requirePattern(sql, pattern, label) { if (!pattern.test(sql)) throw new Error(`Finance production contract failed: ${label}.`); }
async function verify() {
  const db = await mysql.createConnection(connectionOptions());
  try {
    const [[identity]] = await db.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || "").trim();
    if (!databaseName || databaseName !== expected) throw new Error(`Finance production contract verification refused: connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`);

    const tableNames = Object.keys(REQUIRED_COLUMNS);
    const [columnRows] = await db.query(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tableNames.map(() => "?").join(",")})`, tableNames);
    const actualColumns = new Set(columnRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    const missingColumns = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) for (const column of columns) if (!actualColumns.has(`${table}.${column}`)) missingColumns.push(`${table}.${column}`);
    if (missingColumns.length) throw new Error(`Finance production contract is missing columns: ${missingColumns.join(", ")}.`);

    const triggerNames = Object.keys(REQUIRED_TRIGGERS);
    const [triggerRows] = await db.query(`SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME IN (${triggerNames.map(() => "?").join(",")})`, triggerNames);
    const triggerMap = new Map(triggerRows.map((row) => [row.TRIGGER_NAME, row]));
    for (const [triggerName, expectedEvent] of Object.entries(REQUIRED_TRIGGERS)) {
      const row = triggerMap.get(triggerName);
      if (!row) throw new Error(`Finance production contract is missing trigger ${triggerName}.`);
      if (row.EVENT_MANIPULATION !== expectedEvent || row.ACTION_TIMING !== "BEFORE") throw new Error(`Finance production contract has invalid timing/event for ${triggerName}.`);
    }

    const paymentSql = String(triggerMap.get("trg_equipment_finance_payment_gate_before_insert").ACTION_STATEMENT || "");
    const reservationSql = String(triggerMap.get("trg_equipment_finance_reservation_gate_before_insert").ACTION_STATEMENT || "");
    const commitmentSql = String(triggerMap.get("trg_equipment_finance_commitment_gate_before_update").ACTION_STATEMENT || "");
    requirePattern(paymentSql, /NEW\.payment_stage\s*=\s*['\"]opening_deposit['\"]/i, "opening-deposit payment stage gate");
    requirePattern(paymentSql, /NEW\.idempotency_key/i, "opening-deposit idempotency enforcement");
    requirePattern(paymentSql, /application_status/i, "explicit Finance application approval evidence");
    requirePattern(reservationSql, /NEW\.lock_status\s*<>\s*['\"]installment_active['\"]/i, "exact installment reservation status rejection gate");
    requirePattern(reservationSql, /v_deposit_received\s*\+\s*0\.01\s*<\s*v_deposit_required/i, "completed-deposit reservation gate");
    requirePattern(reservationSql, /hire_contract_assets/i, "Hire conflict protection");
    requirePattern(commitmentSql, /OLD\.equipment_commitment_status\s*<>\s*['\"]reserved['\"]/i, "commitment transition guard");
    requirePattern(commitmentSql, /NEW\.equipment_commitment_status\s*=\s*['\"]reserved['\"]/i, "commitment reservation target guard");
    requirePattern(commitmentSql, /NEW\.agreement_status\s+IN\s*\(/i, "active Finance agreement status gate");
    requirePattern(commitmentSql, /v_active_lock_count/i, "active reservation evidence");
    requirePattern(commitmentSql, /v_active_hire_count/i, "Hire conflict protection");

    const [[migrationTable]] = await db.query("SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
    if (Number(migrationTable?.present || 0) !== 1) throw new Error("Finance production contract is missing schema_migrations.");
    const [migrationRows] = await db.query(`SELECT migration_name FROM schema_migrations WHERE migration_name IN (${REQUIRED_MIGRATIONS.map(() => "?").join(",")})`, REQUIRED_MIGRATIONS);
    const installed = new Set(migrationRows.map((row) => row.migration_name));
    const missingMigrations = REQUIRED_MIGRATIONS.filter((name) => !installed.has(name));
    if (missingMigrations.length) throw new Error(`Finance production contract is missing migrations: ${missingMigrations.join(", ")}.`);

    console.log(JSON.stringify({ verified: true, database_name: databaseName, verified_triggers: triggerNames, verified_migrations: REQUIRED_MIGRATIONS, message: "Finance production contract verified against canonical reset-safe trigger semantics." }, null, 2));
  } finally { await db.end(); }
}
verify().catch((error) => { console.error("Finance production contract verification failed."); console.error(error.message); process.exit(1); });
