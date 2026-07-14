const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

try {
  require("dotenv").config();
} catch (_error) {
  // dotenv is optional for environments that inject DB variables directly.
}

const CANONICAL_TABLES = [
  "branches",
  "schema_migrations",
  "users",
  "user_branch_access",
  "business_units",
  "business_locations",
  "user_business_access",
  "products",
  "stock_adjustments",
  "suppliers",
  "purchases",
  "purchase_items",
  "purchase_payments",
  "customers",
  "sales",
  "sale_items",
  "debts",
  "debt_payments",
  "returns",
  "expenses",
  "sms_log",
  "activity_log",
  "application_error_log",
  "settings",
  "daily_closings",
  "audit_signoffs",
  "audit_unlock_requests",
  "audit_reapproval_log",
  "stock_transfers",
  "stock_transfer_items",
  "fleet_assets",
  "fleet_meter_readings",
  "fleet_fuel_logs",
  "fleet_maintenance_records",
  "fleet_inspections",
  "mining_sites",
  "user_mining_site_access",
  "user_hire_location_access",
  "mining_daily_logs",
  "mining_production_records",
  "mining_equipment_logs",
  "mining_fuel_logs",
  "mining_expenses",
  "mining_incidents",
  "hire_customers",
  "hire_enquiries",
  "hire_quotations",
  "hire_contracts",
  "hire_contract_assets",
  "hire_dispatches",
  "hire_work_logs",
  "hire_invoices",
  "hire_invoice_lines",
  "hire_payments",
  "hire_return_inspections",
];

const ALIAS_TABLES = new Set(["stores", "user_store_access", "activity_logs"]);
const HIRE_TRIGGERS = [
  "trg_hire_enquiry_location_before_insert",
  "trg_hire_quotation_location_before_insert",
  "trg_hire_contract_location_before_insert",
  "trg_hire_dispatch_location_before_insert",
  "trg_hire_work_location_before_insert",
  "trg_hire_invoice_location_before_insert",
  "trg_hire_payment_location_before_insert",
  "trg_hire_return_location_before_insert",
  "trg_hire_enquiry_location_before_update",
  "trg_hire_quotation_location_before_update",
  "trg_hire_contract_location_before_update",
  "trg_hire_dispatch_location_before_update",
  "trg_hire_work_location_before_update",
  "trg_hire_invoice_location_before_update",
  "trg_hire_payment_location_before_update",
  "trg_hire_return_location_before_update",
];

function env(primaryName, fallbackName, defaultValue = undefined) {
  return process.env[primaryName] || process.env[fallbackName] || defaultValue;
}

function getConnectionConfig() {
  const sslValue = String(process.env.DB_SSL || "").toLowerCase();
  const ssl =
    sslValue === "true"
      ? { rejectUnauthorized: true }
      : sslValue === "false"
        ? false
        : undefined;

  return {
    host: env("DB_HOST", "MYSQLHOST"),
    port: Number(env("DB_PORT", "MYSQLPORT", 3306)),
    user: env("DB_USER", "MYSQLUSER"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD"),
    database: env("DB_NAME", "MYSQLDATABASE"),
    timezone: "Z",
    ssl,
  };
}

function assertGuardedLocalTestDatabase(config) {
  const host = String(config.host || "").toLowerCase();
  const database = String(config.database || "").toLowerCase();

  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Refusing destructive reset unless DB_HOST is localhost, 127.0.0.1 or ::1.");
  }

  if (host.includes("railway") || database.includes("railway")) {
    throw new Error("Refusing Railway-like host or database name.");
  }

  if (!database.endsWith("_test")) {
    throw new Error("Refusing destructive reset unless DB_NAME ends in _test.");
  }
}

function safeIdentifier(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(value || ""))) {
    throw new Error(`Unsafe identifier: ${value}`);
  }

  return `\`${value}\``;
}

function backupPathFromArgs() {
  const explicitIndex = process.argv.findIndex((arg) => arg === "--backup");

  if (explicitIndex >= 0) {
    return process.argv[explicitIndex + 1];
  }

  return process.argv[2] || process.env.BACKUP_FILE;
}

function expectedShaFromArgs() {
  const explicitIndex = process.argv.findIndex((arg) => arg === "--sha256");

  if (explicitIndex >= 0) {
    return process.argv[explicitIndex + 1];
  }

  return process.env.BACKUP_SHA256;
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseBackup(filePath, expectedSha) {
  if (!filePath) {
    throw new Error("Backup path is required. Pass --backup path/to/PRIVATE_FULL_SYSTEM_BACKUP.json.");
  }

  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Backup file not found: ${resolved}`);
  }

  const sha256 = hashFile(resolved);

  if (expectedSha && sha256.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error("Backup SHA-256 does not match the expected value.");
  }

  const backup = JSON.parse(fs.readFileSync(resolved, "utf8"));

  if (!backup || backup.backup_type !== "full_system_backup") {
    throw new Error("Backup metadata is invalid or is not a full_system_backup.");
  }

  if (!backup.tables || typeof backup.tables !== "object") {
    throw new Error("Backup does not contain a tables object.");
  }

  return { backup, resolved, sha256 };
}

function countRows(tableMap) {
  return Object.entries(tableMap).reduce((sum, [tableName, rows]) => {
    if (ALIAS_TABLES.has(tableName)) {
      return sum;
    }

    return sum + (Array.isArray(rows) ? rows.length : 0);
  }, 0);
}

function convertSale(row) {
  const converted = { ...row };
  const legacyPaid = Number(row.amount_paid || 0);
  const total = Number(row.total || 0);

  if (converted.amount_tendered === undefined) {
    converted.amount_tendered = legacyPaid;
  }

  if (converted.change_due === undefined) {
    converted.amount_paid = Number(Math.min(legacyPaid, total).toFixed(2));
    converted.change_due = Number(Math.max(legacyPaid - total, 0).toFixed(2));
    converted.balance = Number(Math.max(total - converted.amount_paid, 0).toFixed(2));
  }

  return converted;
}

function normalizeRestoreRow(tableName, row) {
  const normalized = { ...row };

  if (tableName === "branches") {
    const branchCode =
      normalized.code || normalized.branch_code || normalized.store_code || null;
    normalized.code = branchCode;
    normalized.branch_code = branchCode;
  }

  if (tableName === "users") {
    normalized.must_change_password =
      normalized.must_change_password === undefined
        ? false
        : normalized.must_change_password;
    normalized.password_changed_at =
      normalized.password_changed_at === undefined
        ? null
        : normalized.password_changed_at;
    normalized.created_by =
      normalized.created_by === undefined ? null : normalized.created_by;
  }

  if (tableName === "sales") {
    return convertSale(normalized);
  }

  return normalized;
}

function canonicalRowsForTable(backup, tableName) {
  if (ALIAS_TABLES.has(tableName)) {
    return [];
  }

  const rows = backup.tables[tableName];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => normalizeRestoreRow(tableName, row));
}

function validateBackupBeforeReset(backup) {
  const tableNames = Object.keys(backup.tables);
  const canonicalRecordCount = countRows(backup.tables);
  const includedAliases = tableNames.filter((tableName) => ALIAS_TABLES.has(tableName));

  if (!tableNames.includes("users") || !tableNames.includes("branches")) {
    throw new Error("Backup must contain users and branches.");
  }

  const sourceSales = Array.isArray(backup.tables.sales) ? backup.tables.sales : [];
  const convertedSales = canonicalRowsForTable(backup, "sales");
  const legacySaleConversionOk = convertedSales.every((sale, index) => {
    const source = sourceSales[index] || {};

    if (source.amount_tendered !== undefined && source.change_due !== undefined) {
      return true;
    }

    const legacyPaid = Number(source.amount_paid || 0);
    const total = Number(source.total || 0);

    return (
      Number(sale.amount_tendered || 0) === legacyPaid &&
      Number(sale.amount_paid || 0) === Number(Math.min(legacyPaid, total).toFixed(2)) &&
      Number(sale.change_due || 0) === Number(Math.max(legacyPaid - total, 0).toFixed(2)) &&
      Number(sale.balance || 0) ===
        Number(Math.max(total - Math.min(legacyPaid, total), 0).toFixed(2))
    );
  });

  return {
    tableCount: tableNames.length,
    canonicalRecordCount,
    includedAliases,
    legacySaleConversionOk,
  };
}

async function askSecondConfirmation(databaseName) {
  if (process.env.SECOND_CONFIRM_DATABASE_RESET === databaseName) {
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Non-interactive reset requires SECOND_CONFIRM_DATABASE_RESET to equal the database name."
    );
  }

  const readline = require("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const maintenance = await rl.question(
    "Type MAINTENANCE_CONFIRMED after stopping application writes: "
  );

  if (maintenance !== "MAINTENANCE_CONFIRMED") {
    rl.close();
    throw new Error("Maintenance-mode confirmation failed.");
  }

  const typedDatabase = await rl.question(
    `Type the database name (${databaseName}) to continue: `
  );

  rl.close();

  if (typedDatabase !== databaseName) {
    throw new Error("Database-name confirmation failed.");
  }
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";

  for (const rawLine of sqlText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      delimiter = trimmed.replace(/^DELIMITER\s+/i, "");
      continue;
    }

    buffer += `${rawLine}\n`;

    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();

      if (statement) {
        statements.push(statement);
      }

      buffer = "";
    }
  }

  const trailing = buffer.trim();

  if (trailing) {
    statements.push(trailing);
  }

  return statements;
}

async function executeSqlFile(connection, filePath) {
  const statements = splitSqlStatements(fs.readFileSync(filePath, "utf8"));

  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function dropAliasObject(connection, objectName) {
  const [rows] = await connection.query(
    `SELECT TABLE_TYPE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = ?
     LIMIT 1`,
    [objectName]
  );

  if (rows.length === 0) {
    return;
  }

  if (rows[0].TABLE_TYPE === "VIEW") {
    await connection.query(`DROP VIEW IF EXISTS ${safeIdentifier(objectName)}`);
    return;
  }

  await connection.query(`DROP TABLE IF EXISTS ${safeIdentifier(objectName)}`);
}

async function cleanDatabase(connection) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");

  for (const triggerName of HIRE_TRIGGERS) {
    await connection.query(`DROP TRIGGER IF EXISTS ${safeIdentifier(triggerName)}`);
  }

  // Drop child compatibility objects before their possible parent alias.
  for (const aliasName of ["user_store_access", "activity_logs", "stores"]) {
    await dropAliasObject(connection, aliasName);
  }

  for (const tableName of [...CANONICAL_TABLES].reverse()) {
    await connection.query(`DROP TABLE IF EXISTS ${safeIdentifier(tableName)}`);
  }

  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
}

async function getTableColumnMetadata(connection, tableName) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${safeIdentifier(tableName)}`);
  return columns;
}

async function getTableColumns(connection, tableName) {
  const columns = await getTableColumnMetadata(connection, tableName);
  return columns.map((column) => column.Field);
}

function normalizeDatabaseValue(columnType, value) {
  if (value === undefined || value === null) {
    return null;
  }

  const type = String(columnType || "").toLowerCase();

  if (type.startsWith("date") && !type.startsWith("datetime")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  }

  if (type.startsWith("datetime") || type.startsWith("timestamp")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toISOString().slice(0, 19).replace("T", " ");
  }

  return value;
}

async function insertRows(connection, tableName, rows) {
  if (!rows.length) {
    return 0;
  }

  const tableMetadata = await getTableColumnMetadata(connection, tableName);
  const columnTypes = new Map(
    tableMetadata.map((column) => [column.Field, column.Type])
  );
  const allowedColumns = new Set(columnTypes.keys());
  const columns = Object.keys(rows[0]).filter((column) => allowedColumns.has(column));

  if (columns.length === 0) {
    return 0;
  }

  const sql = `INSERT INTO ${safeIdentifier(tableName)} (${columns
    .map(safeIdentifier)
    .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;

  for (const row of rows) {
    await connection.query(
      sql,
      columns.map((column) =>
        normalizeDatabaseValue(columnTypes.get(column), row[column])
      )
    );
  }

  return rows.length;
}

async function restoreRows(connection, backup) {
  const restored = {};

  await connection.beginTransaction();

  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of CANONICAL_TABLES) {
      const rows = canonicalRowsForTable(backup, tableName);
      restored[tableName] = await insertRows(connection, tableName, rows);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    throw error;
  }

  return restored;
}

async function resetAutoIncrements(connection) {
  for (const tableName of CANONICAL_TABLES) {
    const columns = await getTableColumns(connection, tableName);

    if (!columns.includes("id")) {
      continue;
    }

    const [rows] = await connection.query(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${safeIdentifier(tableName)}`
    );
    const nextId = Math.max(1, Number(rows[0]?.next_id || 1));
    await connection.query(`ALTER TABLE ${safeIdentifier(tableName)} AUTO_INCREMENT = ${nextId}`);
  }
}

async function runVerificationSummary(connection) {
  const [tableRows] = await connection.query(
    `SELECT COUNT(*) AS table_count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_TYPE = 'BASE TABLE'
     AND TABLE_NAME IN (${CANONICAL_TABLES.map(() => "?").join(", ")})`,
    CANONICAL_TABLES
  );
  const [triggerRows] = await connection.query(
    `SELECT COUNT(*) AS trigger_count
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
     AND TRIGGER_NAME IN (${HIRE_TRIGGERS.map(() => "?").join(", ")})`,
    HIRE_TRIGGERS
  );
  const [coreColumnRows] = await connection.query(
    `SELECT COUNT(*) AS core_column_count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     AND (
       (TABLE_NAME = 'branches' AND COLUMN_NAME IN ('code', 'branch_code')) OR
       (TABLE_NAME = 'debts' AND COLUMN_NAME = 'amount_owed') OR
       (TABLE_NAME = 'debt_payments' AND COLUMN_NAME = 'amount') OR
       (TABLE_NAME = 'stock_transfers' AND COLUMN_NAME = 'approval_note')
     )`
  );
  const [roleRows] = await connection.query(
    `SELECT COUNT(*) AS role_support_count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'users'
     AND COLUMN_NAME = 'role'
     AND COLUMN_TYPE LIKE '%staff%'`
  );
  const [duplicateUsers] = await connection.query(
    `SELECT COUNT(*) AS problem_count
     FROM (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1) x`
  );
  const [duplicateReceipts] = await connection.query(
    `SELECT COUNT(*) AS problem_count
     FROM (SELECT receipt_number FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1) x`
  );
  const [orphanSaleItems] = await connection.query(
    `SELECT COUNT(*) AS problem_count
     FROM sale_items si
     LEFT JOIN sales s ON s.id = si.sale_id
     WHERE s.id IS NULL`
  );

  return {
    applicationTablesFound: Number(tableRows[0]?.table_count || 0) - 1,
    schemaMigrationsIncluded: Number(tableRows[0]?.table_count || 0) === 55,
    hireTriggersFound: Number(triggerRows[0]?.trigger_count || 0),
    requiredCoreColumnsFound: Number(coreColumnRows[0]?.core_column_count || 0),
    userRoleSupportsStaff: Number(roleRows[0]?.role_support_count || 0) === 1,
    duplicateUsers: Number(duplicateUsers[0]?.problem_count || 0),
    duplicateReceipts: Number(duplicateReceipts[0]?.problem_count || 0),
    orphanSaleItems: Number(orphanSaleItems[0]?.problem_count || 0),
  };
}

async function main() {
  if (process.env.CONFIRM_DATABASE_RESET !== "DELETE_AND_RESTORE") {
    throw new Error("Set CONFIRM_DATABASE_RESET=DELETE_AND_RESTORE to run this destructive reset.");
  }

  const backupInfo = parseBackup(backupPathFromArgs(), expectedShaFromArgs());
  const validation = validateBackupBeforeReset(backupInfo.backup);

  const config = getConnectionConfig();

  if (!config.host || !config.user || !config.database) {
    throw new Error("Missing DB_HOST/MYSQLHOST, DB_USER/MYSQLUSER, or DB_NAME/MYSQLDATABASE.");
  }

  assertGuardedLocalTestDatabase(config);

  console.log("Database reset target:");
  console.log(`  host: ${config.host}`);
  console.log(`  port: ${config.port}`);
  console.log(`  user: ${config.user}`);
  console.log(`  database: ${config.database}`);
  console.log("Backup summary:");
  console.log(`  file: ${backupInfo.resolved}`);
  console.log(`  sha256: ${backupInfo.sha256}`);
  console.log(`  included tables: ${validation.tableCount}`);
  console.log(`  canonical rows after alias dedupe: ${validation.canonicalRecordCount}`);
  console.log(`  ignored aliases present: ${validation.includedAliases.join(", ") || "none"}`);
  console.log(`  legacy sale conversion check: ${validation.legacySaleConversionOk ? "ok" : "not applicable"}`);

  await askSecondConfirmation(config.database);

  const connection = await mysql.createConnection(config);

  try {
    await cleanDatabase(connection);
    await executeSqlFile(connection, path.resolve(__dirname, "../../database/schema.sql"));
    const restored = await restoreRows(connection, backupInfo.backup);
    await executeSqlFile(connection, path.resolve(__dirname, "../../database/seed_reference_data.sql"));
    await resetAutoIncrements(connection);
    const verification = await runVerificationSummary(connection);

    console.log("Restore completed.");
    console.log(`  restored canonical tables: ${Object.values(restored).filter((count) => count > 0).length}`);
    console.log(`  restored canonical rows: ${Object.values(restored).reduce((sum, count) => sum + count, 0)}`);
    console.log("Verification summary:");
    console.log(JSON.stringify(verification, null, 2));

    if (
      verification.applicationTablesFound !== 54 ||
      !verification.schemaMigrationsIncluded ||
      verification.hireTriggersFound !== 16 ||
      verification.requiredCoreColumnsFound !== 5 ||
      !verification.userRoleSupportsStaff ||
      verification.duplicateUsers > 0 ||
      verification.duplicateReceipts > 0 ||
      verification.orphanSaleItems > 0
    ) {
      throw new Error("Post-restore verification found blocking problems. See summary above.");
    }
  } catch (error) {
    console.error("Reset/restore failed.");
    console.error(error.message);
    console.error("Recovery: keep the site in maintenance mode and restore from the latest SQL dump or rerun with the private JSON backup after fixing the issue.");
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
