const fs = require("fs");
const path = require("path");

const { pool } = require("../config/db");

const MIGRATION_NAME = "20260722_equipment_sales_installments_foundation";
const MIGRATION_FILE = path.resolve(
  __dirname,
  "../../database/migrations/20260722_equipment_sales_installments_foundation.sql"
);
const LOCK_NAME = "chalin03_equipment_sales_foundation_v1";

function splitSqlStatements(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of String(sqlText || "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      delimiter = trimmed.replace(/^DELIMITER\s+/i, "");
      continue;
    }

    buffer += `${rawLine}\n`;

    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = "";
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function migrationApplied(connection) {
  const [tableRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'schema_migrations'`
  );

  if (Number(tableRows[0]?.total || 0) === 0) return false;

  const [rows] = await connection.query(
    "SELECT id FROM schema_migrations WHERE migration_name = ? LIMIT 1",
    [MIGRATION_NAME]
  );
  return rows.length > 0;
}

async function verifyFoundation(connection) {
  const expectedTables = [
    "equipment_media",
    "equipment_sales_enquiries",
    "equipment_sales_quotations",
    "equipment_sales_quotation_items",
    "equipment_sale_agreements",
    "equipment_asset_sale_locks",
    "equipment_installment_schedule",
    "equipment_sale_payments",
    "equipment_sale_payment_allocations",
    "equipment_deliveries",
    "equipment_ownership_transfers",
    "equipment_sales_reminder_log",
    "equipment_legacy_installment_migrations",
  ];

  const [tableRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${expectedTables.map(() => "?").join(",")})`,
    expectedTables
  );

  if (Number(tableRows[0]?.total || 0) !== expectedTables.length) {
    throw new Error("Equipment Sales foundation verification found missing tables.");
  }

  const [columnRows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND (
         (TABLE_NAME = 'fleet_assets' AND COLUMN_NAME IN (
           'hire_location_id','operational_purpose','sale_status',
           'target_selling_price','standard_hire_rate','main_image_url'
         ))
         OR
         (TABLE_NAME = 'sms_log' AND COLUMN_NAME IN (
           'workspace_code','hire_location_id','entity_type','entity_id',
           'template_code','deduplication_key'
         ))
       )`
  );

  if (Number(columnRows[0]?.total || 0) !== 12) {
    throw new Error("Equipment Sales foundation verification found missing columns.");
  }
}

async function ensureEquipmentSalesSchema() {
  if (String(process.env.DISABLE_EQUIPMENT_SALES_STARTUP_MIGRATION || "").toLowerCase() === "true") {
    console.warn("Equipment Sales startup migration is disabled by environment configuration.");
    return { applied: false, skipped: true, reason: "disabled" };
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 60) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Equipment Sales migration lock.");
    }

    if (await migrationApplied(connection)) {
      await verifyFoundation(connection);
      return { applied: false, skipped: true, reason: "already_applied" };
    }

    if (!fs.existsSync(MIGRATION_FILE)) {
      throw new Error(`Equipment Sales migration file is missing: ${MIGRATION_FILE}`);
    }

    // The migration contains standard SQL string literals. Remove ANSI_QUOTES
    // only for this connection so double-quoted definitions remain portable.
    await connection.query(
      "SET SESSION sql_mode = REPLACE(REPLACE(@@SESSION.sql_mode, 'ANSI_QUOTES,', ''), ',ANSI_QUOTES', '')"
    );

    const statements = splitSqlStatements(fs.readFileSync(MIGRATION_FILE, "utf8"));
    if (statements.length < 20) {
      throw new Error("Equipment Sales migration file did not contain the expected statements.");
    }

    for (const statement of statements) {
      await connection.query(statement);
    }

    await verifyFoundation(connection);
    console.log("Equipment Sales & Hire foundation migration applied successfully.");
    return { applied: true, skipped: false, statement_count: statements.length };
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
      } catch (error) {
        console.warn("Could not release Equipment Sales migration lock:", error.message);
      }
    }
    connection.release();
  }
}

module.exports = {
  MIGRATION_NAME,
  ensureEquipmentSalesSchema,
  splitSqlStatements,
  verifyFoundation,
};
