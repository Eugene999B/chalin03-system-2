const { pool } = require("../config/db");

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function tableExists(tableName) {
  const [rows] = await query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
     AND table_name = ?`,
    [tableName]
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function columnExists(tableName, columnName) {
  const [rows] = await query(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
     AND table_name = ?
     AND column_name = ?`,
    [tableName, columnName]
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await query(
    `SELECT COUNT(*) AS count
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
     AND table_name = ?
     AND index_name = ?`,
    [tableName, indexName]
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const exists = await tableExists(tableName);

  if (!exists) {
    console.log(`ℹ️  Skipped ${tableName}.${columnName} because table does not exist.`);
    return false;
  }

  const hasColumn = await columnExists(tableName, columnName);

  if (hasColumn) {
    console.log(`✅ ${tableName}.${columnName} already exists.`);
    return false;
  }

  await query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  console.log(`✅ Added ${tableName}.${columnName}.`);
  return true;
}

async function addIndexIfMissing(tableName, indexName, columnsSql) {
  const exists = await tableExists(tableName);

  if (!exists) {
    console.log(`ℹ️  Skipped index ${indexName} because ${tableName} does not exist.`);
    return false;
  }

  const hasIndex = await indexExists(tableName, indexName);

  if (hasIndex) {
    console.log(`✅ Index ${indexName} already exists on ${tableName}.`);
    return false;
  }

  await query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (${columnsSql})`);
  console.log(`✅ Added index ${indexName} on ${tableName}.`);
  return true;
}

async function ensureBranchesTable() {
  const exists = await tableExists("branches");

  if (!exists) {
    await query(`
      CREATE TABLE branches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(30) NOT NULL UNIQUE,
        branch_code VARCHAR(30) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        location VARCHAR(255) NULL,
        phone VARCHAR(50) NULL,
        is_head_office TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Created branches table.");
  }

  await addColumnIfMissing("branches", "code", "VARCHAR(30) NULL");
  await addColumnIfMissing("branches", "branch_code", "VARCHAR(30) NULL");
  await addColumnIfMissing("branches", "name", "VARCHAR(150) NULL");
  await addColumnIfMissing("branches", "location", "VARCHAR(255) NULL");
  await addColumnIfMissing("branches", "phone", "VARCHAR(50) NULL");
  await addColumnIfMissing("branches", "is_head_office", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("branches", "is_active", "TINYINT(1) NOT NULL DEFAULT 1");

  const hasCode = await columnExists("branches", "code");
  const hasBranchCode = await columnExists("branches", "branch_code");

  if (hasCode && hasBranchCode) {
    await query(`
      UPDATE branches
      SET branch_code = code
      WHERE (branch_code IS NULL OR branch_code = "")
      AND code IS NOT NULL
      AND code <> ""
    `);

    await query(`
      UPDATE branches
      SET code = branch_code
      WHERE (code IS NULL OR code = "")
      AND branch_code IS NOT NULL
      AND branch_code <> ""
    `);
  }

  await query(`
    INSERT INTO branches (id, code, branch_code, name, location, phone, is_head_office, is_active)
    VALUES
      (1, 'MAIN', 'MAIN', 'Chalin 03 Main Store', 'Dunkwa Police Barrier', NULL, 1, 1),
      (2, 'AJAKAA', 'AJAKAA', 'Chalin 03 Store', 'Ajakaa Manso', NULL, 0, 1)
    ON DUPLICATE KEY UPDATE
      code = VALUES(code),
      branch_code = VALUES(branch_code),
      name = VALUES(name),
      location = VALUES(location),
      is_active = 1
  `);

  console.log("✅ Ensured MAIN and AJAKAA branches.");
}

async function ensureUsersBranchColumns() {
  if (!(await tableExists("users"))) {
    console.log("⚠️  users table not found.");
    return;
  }

  await addColumnIfMissing("users", "default_branch_id", "INT NULL");
  await addColumnIfMissing("users", "can_access_all_branches", "TINYINT(1) NOT NULL DEFAULT 0");

  await query(`
    UPDATE users
    SET default_branch_id = 1
    WHERE default_branch_id IS NULL OR default_branch_id <= 0
  `);

  await query(`
    UPDATE users
    SET can_access_all_branches = 1
    WHERE LOWER(role) = 'admin'
  `);

  console.log("✅ Repaired users branch columns and admin all-store access.");
}

async function ensureUserBranchAccessTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_branch_access (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      branch_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_branch_access (user_id, branch_id),
      INDEX idx_user_branch_access_user (user_id),
      INDEX idx_user_branch_access_branch (branch_id)
    )
  `);

  await query(`
    INSERT IGNORE INTO user_branch_access (user_id, branch_id)
    SELECT id, 1
    FROM users
    WHERE LOWER(role) = 'admin'
  `);

  await query(`
    INSERT IGNORE INTO user_branch_access (user_id, branch_id)
    SELECT id, 2
    FROM users
    WHERE LOWER(role) = 'admin'
  `);

  await query(`
    INSERT IGNORE INTO user_branch_access (user_id, branch_id)
    SELECT id, COALESCE(default_branch_id, 1)
    FROM users
    WHERE COALESCE(default_branch_id, 1) > 0
  `);

  console.log("✅ Ensured user_branch_access table and default access.");
}

async function ensureBranchIdOnTable(tableName) {
  if (!(await tableExists(tableName))) {
    console.log(`ℹ️  ${tableName} does not exist. Skipped.`);
    return;
  }

  await addColumnIfMissing(tableName, "branch_id", "INT NULL");

  await query(`
    UPDATE \`${tableName}\`
    SET branch_id = 1
    WHERE branch_id IS NULL OR branch_id <= 0
  `);

  await addIndexIfMissing(tableName, `idx_${tableName}_branch_id`, "`branch_id`");
}

async function main() {
  console.log("🔧 Starting Chalin 03 production multi-store schema repair...");

  await ensureBranchesTable();
  await ensureUsersBranchColumns();
  await ensureUserBranchAccessTable();

  const branchAwareTables = [
    "products",
    "stock_adjustments",
    "suppliers",
    "purchases",
    "purchase_payments",
    "customers",
    "sales",
    "sale_items",
    "debts",
    "debt_payments",
    "returns",
    "expenses",
    "daily_closings",
    "audit_signoffs",
    "audit_unlock_requests",
    "audit_reapproval_log",
    "sms_log",
    "activity_log",
    "settings",
  ];

  for (const tableName of branchAwareTables) {
    await ensureBranchIdOnTable(tableName);
  }

  if (await tableExists("sale_items")) {
    await addIndexIfMissing("sale_items", "idx_sale_items_sale_id", "`sale_id`");
  }

  if (await tableExists("debt_payments")) {
    await addIndexIfMissing("debt_payments", "idx_debt_payments_debt_id", "`debt_id`");
  }

  console.log("✅ Multi-store schema repair completed successfully.");
  console.log("✅ Now restart/redeploy the backend and test login/dashboard again.");
}

main()
  .catch((error) => {
    console.error("❌ Multi-store schema repair failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
