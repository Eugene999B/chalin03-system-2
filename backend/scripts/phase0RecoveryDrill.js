const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  checksumBackup,
  classifyDatabaseTables,
  safeTableName,
  signBackup,
  validateBackupContract,
} = require("../services/backupSafetyService");

const SOURCE_DB = "chalin03_phase0_source";
const TARGET_DB = "chalin03_phase0_target";
const BUFFER_MARKER = "buffer_base64";
const SIGNING_SECRET =
  "phase0-recovery-drill-only-9f86c4657a9848f9b13f16c5e9f62451d1f66f91a8d44d92";

function connectionOptions(database) {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database,
    multipleStatements: true,
  };
}

function encodeBackupValue(value) {
  if (Buffer.isBuffer(value)) {
    return {
      __chalin03_type: BUFFER_MARKER,
      data: value.toString("base64"),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

function decodeRestoreValue(value, columnType) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.__chalin03_type === BUFFER_MARKER &&
    typeof value.data === "string"
  ) {
    return Buffer.from(value.data, "base64");
  }

  const type = String(columnType || "").toLowerCase();
  if (typeof value === "string" && /^date$/.test(type)) return value.slice(0, 10);
  if (
    typeof value === "string" &&
    /^(datetime|timestamp)/.test(type) &&
    value.includes("T")
  ) {
    return new Date(value).toISOString().slice(0, 19).replace("T", " ");
  }
  return value;
}

async function resetDatabase(admin, database) {
  await admin.query(`DROP DATABASE IF EXISTS ${safeTableName(database)}`);
  await admin.query(
    `CREATE DATABASE ${safeTableName(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
}

async function createRepresentativeSchema(connection) {
  const statements = [
    `CREATE TABLE schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration_name VARCHAR(190) NOT NULL UNIQUE,
      description TEXT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE branches (
      id INT PRIMARY KEY,
      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE users (
      id INT PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(30) NOT NULL,
      default_branch_id INT NULL,
      token_version INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE products (
      id INT PRIMARY KEY,
      branch_id INT NOT NULL,
      name VARCHAR(180) NOT NULL,
      sku VARCHAR(80) NOT NULL,
      quantity DECIMAL(12,2) NOT NULL,
      selling_price DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE customers (
      id INT PRIMARY KEY,
      branch_id INT NOT NULL,
      full_name VARCHAR(180) NOT NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE sales (
      id INT PRIMARY KEY,
      branch_id INT NOT NULL,
      customer_id INT NULL,
      receipt_number VARCHAR(80) NOT NULL UNIQUE,
      total DECIMAL(12,2) NOT NULL,
      amount_paid DECIMAL(12,2) NOT NULL,
      balance DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE sale_items (
      id INT PRIMARY KEY,
      sale_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity DECIMAL(12,2) NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      line_total DECIMAL(12,2) NOT NULL
    )`,
    `CREATE TABLE debts (
      id INT PRIMARY KEY,
      branch_id INT NOT NULL,
      customer_id INT NOT NULL,
      sale_id INT NOT NULL,
      original_amount DECIMAL(12,2) NOT NULL,
      balance DECIMAL(12,2) NOT NULL,
      status VARCHAR(30) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE expenses (
      id INT PRIMARY KEY,
      branch_id INT NOT NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      expense_date DATE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE mining_sites (
      id INT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(180) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE hire_customers (
      id INT PRIMARY KEY,
      customer_code VARCHAR(50) NOT NULL UNIQUE,
      customer_name VARCHAR(180) NOT NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE document_signature_settings (
      id INT PRIMARY KEY,
      authorised_name VARCHAR(180) NOT NULL,
      authorised_title VARCHAR(180) NOT NULL,
      signature_png LONGBLOB NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE worker_private_files (
      id INT PRIMARY KEY,
      worker_id INT NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      checksum_sha256 CHAR(64) NOT NULL,
      file_data LONGBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE activity_log (
      id INT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(100) NOT NULL,
      details TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE auth_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE password_recovery_otps (
      id INT PRIMARY KEY,
      user_id INT NOT NULL,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL
    )`,
    `CREATE TABLE protected_action_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL
    )`,
    `CREATE TABLE owner_recovery_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL
    )`,
    `CREATE TABLE owner_break_glass_mfa_enrollments (
      id INT PRIMARY KEY,
      user_id INT NOT NULL,
      enrollment_secret TEXT NOT NULL,
      expires_at DATETIME NOT NULL
    )`,
  ];

  for (const statement of statements) await connection.query(statement);

  await connection.query(
    `INSERT INTO schema_migrations (migration_name, description) VALUES
      ('clean_master_database_reset', 'Representative recovery baseline'),
      ('phase0_signed_backup_restore', 'Signed backup and session invalidation contract')`
  );
}

async function seedSource(connection) {
  const fileData = Buffer.from("representative-private-file", "utf8");
  const fileChecksum = crypto.createHash("sha256").update(fileData).digest("hex");

  await connection.query(
    `INSERT INTO branches (id, code, name) VALUES (1, 'MAIN', 'Recovery Drill Main Store')`
  );
  await connection.query(
    `INSERT INTO users
      (id, full_name, username, password_hash, role, default_branch_id, token_version, is_active)
     VALUES (1, 'Recovery Administrator', 'recovery-admin', '$2b$10$synthetic', 'admin', 1, 4, 1)`
  );
  await connection.query(
    `INSERT INTO products
      (id, branch_id, name, sku, quantity, selling_price)
     VALUES (1, 1, 'Synthetic Brake Pad', 'DRILL-BP-001', 12, 245.50)`
  );
  await connection.query(
    `INSERT INTO customers (id, branch_id, full_name, phone)
     VALUES (1, 1, 'Synthetic Customer', '0000000000')`
  );
  await connection.query(
    `INSERT INTO sales
      (id, branch_id, customer_id, receipt_number, total, amount_paid, balance)
     VALUES (1, 1, 1, 'DRILL-RECEIPT-001', 245.50, 100.00, 145.50)`
  );
  await connection.query(
    `INSERT INTO sale_items
      (id, sale_id, product_id, quantity, unit_price, line_total)
     VALUES (1, 1, 1, 1, 245.50, 245.50)`
  );
  await connection.query(
    `INSERT INTO debts
      (id, branch_id, customer_id, sale_id, original_amount, balance, status)
     VALUES (1, 1, 1, 1, 145.50, 145.50, 'outstanding')`
  );
  await connection.query(
    `INSERT INTO expenses
      (id, branch_id, description, amount, expense_date)
     VALUES (1, 1, 'Synthetic recovery expense', 20.00, '2026-07-25')`
  );
  await connection.query(
    `INSERT INTO mining_sites (id, code, name) VALUES (1, 'DRILL-MINE', 'Synthetic Mine Site')`
  );
  await connection.query(
    `INSERT INTO hire_customers (id, customer_code, customer_name, phone)
     VALUES (1, 'DRILL-HIRE-001', 'Synthetic Hire Customer', '0000000000')`
  );
  await connection.query(
    `INSERT INTO document_signature_settings
      (id, authorised_name, authorised_title, signature_png)
     VALUES (1, 'Recovery Signatory', 'Managing Director', ?)` ,
    [Buffer.from("synthetic-signature", "utf8")]
  );
  await connection.query(
    `INSERT INTO worker_private_files
      (id, worker_id, original_filename, mime_type, checksum_sha256, file_data)
     VALUES (1, 1, 'synthetic.txt', 'text/plain', ?, ?)` ,
    [fileChecksum, fileData]
  );
  await connection.query(
    `INSERT INTO activity_log (id, user_id, action, details)
     VALUES (1, 1, 'RECOVERY_DRILL_SEED', 'Synthetic representative audit evidence')`
  );
}

async function seedTargetSecurityState(connection) {
  await connection.query(
    `INSERT INTO users
      (id, full_name, username, password_hash, role, default_branch_id, token_version, is_active)
     VALUES (99, 'Pre Restore User', 'pre-restore', '$2b$10$synthetic', 'admin', NULL, 19, 1)`
  );
  await connection.query(
    `INSERT INTO auth_sessions (id, user_id, expires_at)
     VALUES ('pre-restore-session', 99, DATE_ADD(NOW(), INTERVAL 1 DAY))`
  );
  await connection.query(
    `INSERT INTO password_recovery_otps (id, user_id, otp_hash, expires_at)
     VALUES (1, 99, 'synthetic-otp-hash', DATE_ADD(NOW(), INTERVAL 1 HOUR))`
  );
  await connection.query(
    `INSERT INTO protected_action_sessions (id, user_id, expires_at)
     VALUES ('pre-restore-protected', 99, DATE_ADD(NOW(), INTERVAL 1 HOUR))`
  );
  await connection.query(
    `INSERT INTO owner_recovery_sessions (id, user_id, expires_at)
     VALUES ('pre-restore-owner', 99, DATE_ADD(NOW(), INTERVAL 1 HOUR))`
  );
  await connection.query(
    `INSERT INTO owner_break_glass_mfa_enrollments
      (id, user_id, enrollment_secret, expires_at)
     VALUES (1, 99, 'synthetic-enrollment', DATE_ADD(NOW(), INTERVAL 1 HOUR))`
  );
}

async function getAllBaseTables(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );
  return rows.map((row) => row.TABLE_NAME);
}

async function getColumnMetadata(connection, tableName) {
  const [rows] = await connection.query(`SHOW FULL COLUMNS FROM ${safeTableName(tableName)}`);
  return rows
    .filter((column) => !String(column.Extra || "").toLowerCase().includes("generated"))
    .map((column) => ({ name: column.Field, type: String(column.Type || "").toLowerCase() }));
}

async function getSchemaSnapshot(connection, includedTables) {
  const metadata = {};
  const tableColumns = {};
  for (const tableName of includedTables) {
    const columns = await getColumnMetadata(connection, tableName);
    metadata[tableName] = columns;
    tableColumns[tableName] = columns.map((column) => column.name);
  }
  return { metadata, tableColumns };
}

async function getSchemaMigrations(connection) {
  const [rows] = await connection.query(
    `SELECT migration_name, description, applied_at
       FROM schema_migrations
      ORDER BY migration_name`
  );
  return rows.map((row) => ({
    migration_name: row.migration_name,
    description: row.description || null,
    applied_at: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
  }));
}

async function buildSignedBackup(connection) {
  const inventory = classifyDatabaseTables(await getAllBaseTables(connection));
  const { metadata, tableColumns } = await getSchemaSnapshot(
    connection,
    inventory.includedTables
  );
  const schemaMigrations = await getSchemaMigrations(connection);
  const backup = {
    app: "Chalin 03 Group Operations Platform",
    version: BACKUP_MANIFEST_VERSION,
    backup_type: BACKUP_TYPE,
    backup_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    included_tables: inventory.includedTables,
    excluded_tables: inventory.excludedTables,
    table_columns: tableColumns,
    table_counts: {},
    total_record_count: 0,
    schema_migrations: schemaMigrations,
    tables: {},
  };

  for (const tableName of inventory.includedTables) {
    const columns = metadata[tableName].map((column) => column.name);
    const columnSql = columns.map((column) => `\`${column}\``).join(", ");
    const [rows] = await connection.query(
      `SELECT ${columnSql} FROM ${safeTableName(tableName)}`
    );
    backup.tables[tableName] = rows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, encodeBackupValue(row[column])]))
    );
    backup.table_counts[tableName] = rows.length;
    backup.total_record_count += rows.length;
  }

  backup.checksum_sha256 = checksumBackup(backup);
  backup.signature_hmac_sha256 = signBackup(backup, SIGNING_SECRET);
  backup.manifest = {
    manifest_version: BACKUP_MANIFEST_VERSION,
    backup_id: backup.backup_id,
    canonical_table_count: backup.included_tables.length,
    excluded_table_count: backup.excluded_tables.length,
    total_record_count: backup.total_record_count,
    checksum_sha256: backup.checksum_sha256,
    signature_hmac_sha256: backup.signature_hmac_sha256,
  };

  return { backup, inventory, metadata, schemaMigrations, tableColumns };
}

async function targetContract(connection) {
  const inventory = classifyDatabaseTables(await getAllBaseTables(connection));
  const { metadata, tableColumns } = await getSchemaSnapshot(
    connection,
    inventory.includedTables
  );
  const schemaMigrations = await getSchemaMigrations(connection);
  return { inventory, metadata, tableColumns, schemaMigrations };
}

function validateAgainstTarget(backup, contract) {
  return validateBackupContract({
    backup,
    currentIncludedTables: contract.inventory.includedTables,
    currentTableColumns: contract.tableColumns,
    currentSchemaMigrations: contract.schemaMigrations,
    signingSecret: SIGNING_SECRET,
    requireSignature: true,
  });
}

async function insertRows(connection, tableName, rows, columnMetadata) {
  if (!rows.length) return;
  const columns = columnMetadata.map((column) => column.name);
  const types = Object.fromEntries(columnMetadata.map((column) => [column.name, column.type]));
  const escapedColumns = columns.map((column) => `\`${column}\``).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${safeTableName(tableName)} (${escapedColumns}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columns.map((column) => decodeRestoreValue(row[column], types[column]));
    await connection.query(sql, values);
  }
}

async function restoreBackup(connection, backup, contract) {
  await connection.beginTransaction();
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const tableName of [...backup.included_tables].reverse()) {
      await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
    }
    for (const tableName of backup.included_tables) {
      await insertRows(
        connection,
        tableName,
        backup.tables[tableName],
        contract.metadata[tableName]
      );
    }
    for (const tableName of contract.inventory.ephemeralSecurityTables) {
      await connection.query(`DELETE FROM ${safeTableName(tableName)}`);
    }
    await connection.query(
      "UPDATE users SET token_version = COALESCE(token_version, 0) + 1"
    );
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function countRows(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total_count FROM ${safeTableName(tableName)}`
  );
  return Number(rows[0].total_count);
}

async function verifyRestoredState(connection, backup, contract) {
  for (const tableName of backup.included_tables) {
    assert.equal(
      await countRows(connection, tableName),
      Number(backup.table_counts[tableName]),
      `row count mismatch for ${tableName}`
    );
  }

  for (const tableName of contract.inventory.ephemeralSecurityTables) {
    assert.equal(await countRows(connection, tableName), 0, `${tableName} was not cleared`);
  }

  const [users] = await connection.query(
    "SELECT username, token_version FROM users ORDER BY id"
  );
  assert.deepEqual(users, [{ username: "recovery-admin", token_version: 5 }]);

  const [products] = await connection.query("SELECT name, sku FROM products WHERE id = 1");
  assert.deepEqual(products[0], {
    name: "Synthetic Brake Pad",
    sku: "DRILL-BP-001",
  });

  const [sales] = await connection.query(
    "SELECT receipt_number, total, balance FROM sales WHERE id = 1"
  );
  assert.equal(sales[0].receipt_number, "DRILL-RECEIPT-001");
  assert.equal(Number(sales[0].total), 245.5);
  assert.equal(Number(sales[0].balance), 145.5);

  const [mining] = await connection.query("SELECT code, name FROM mining_sites WHERE id = 1");
  assert.deepEqual(mining[0], { code: "DRILL-MINE", name: "Synthetic Mine Site" });

  const [hire] = await connection.query(
    "SELECT customer_code, customer_name FROM hire_customers WHERE id = 1"
  );
  assert.deepEqual(hire[0], {
    customer_code: "DRILL-HIRE-001",
    customer_name: "Synthetic Hire Customer",
  });

  const [privateFiles] = await connection.query(
    "SELECT checksum_sha256, file_data FROM worker_private_files WHERE id = 1"
  );
  assert.equal(
    privateFiles[0].checksum_sha256,
    crypto.createHash("sha256").update(privateFiles[0].file_data).digest("hex")
  );
}

async function main() {
  const admin = await mysql.createConnection(connectionOptions(undefined));
  let source;
  let target;
  try {
    await resetDatabase(admin, SOURCE_DB);
    await resetDatabase(admin, TARGET_DB);
    source = await mysql.createConnection(connectionOptions(SOURCE_DB));
    target = await mysql.createConnection(connectionOptions(TARGET_DB));

    await createRepresentativeSchema(source);
    await createRepresentativeSchema(target);
    await seedSource(source);
    await seedTargetSecurityState(target);

    const { backup } = await buildSignedBackup(source);
    const contract = await targetContract(target);

    const validReport = validateAgainstTarget(backup, contract);
    assert.equal(validReport.valid, true, validReport.errors.join("\n"));

    const tampered = structuredClone(backup);
    tampered.tables.products[0].name = "Tampered Product";
    const tamperedReport = validateAgainstTarget(tampered, contract);
    assert.equal(tamperedReport.valid, false);
    assert.ok(
      tamperedReport.errors.some((error) =>
        /checksum|signature/i.test(error)
      ),
      "tampered backup was not rejected by checksum/signature validation"
    );

    const incomplete = structuredClone(backup);
    incomplete.included_tables = incomplete.included_tables.filter(
      (tableName) => tableName !== "expenses"
    );
    delete incomplete.tables.expenses;
    delete incomplete.table_columns.expenses;
    delete incomplete.table_counts.expenses;
    incomplete.total_record_count = Object.values(incomplete.table_counts).reduce(
      (sum, count) => sum + Number(count),
      0
    );
    incomplete.checksum_sha256 = checksumBackup(incomplete);
    incomplete.signature_hmac_sha256 = signBackup(incomplete, SIGNING_SECRET);
    const incompleteReport = validateAgainstTarget(incomplete, contract);
    assert.equal(incompleteReport.valid, false);
    assert.ok(
      incompleteReport.errors.some((error) => /missing current required tables/i.test(error)),
      "incomplete but correctly signed backup was not rejected"
    );

    await restoreBackup(target, backup, contract);
    await verifyRestoredState(target, backup, contract);

    const report = {
      status: "passed",
      completed_at: new Date().toISOString(),
      backup_version: backup.version,
      backup_id: backup.backup_id,
      included_table_count: backup.included_tables.length,
      excluded_tables: backup.excluded_tables,
      total_record_count: backup.total_record_count,
      checks: {
        signed_v2_backup_validation: "passed",
        checksum_and_hmac_tamper_rejection: "passed",
        signed_incomplete_backup_rejection: "passed",
        exact_table_row_count_restore: "passed",
        representative_business_record_restore: "passed",
        binary_private_file_restore: "passed",
        pre_restore_session_revocation: "passed",
        recovery_otp_revocation: "passed",
        protected_action_session_revocation: "passed",
        owner_recovery_session_revocation: "passed",
        owner_mfa_enrollment_revocation: "passed",
        user_token_version_increment: "passed",
      },
      representative_domains: [
        "spare_parts",
        "sales_and_debts",
        "expenses",
        "mining",
        "equipment_hire",
        "document_signatures",
        "worker_private_files",
        "audit_evidence",
      ],
    };

    const outputPath = path.resolve(
      process.cwd(),
      "phase0-recovery-drill-report.json"
    );
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (source) await source.end();
    if (target) await target.end();
    await admin.query(`DROP DATABASE IF EXISTS ${safeTableName(SOURCE_DB)}`);
    await admin.query(`DROP DATABASE IF EXISTS ${safeTableName(TARGET_DB)}`);
    await admin.end();
  }
}

main().catch((error) => {
  console.error("Phase 0 recovery drill failed:", error);
  process.exitCode = 1;
});
