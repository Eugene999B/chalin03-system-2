const { pool } = require("../config/db");

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    AND INDEX_NAME = ?
    LIMIT 1
    `,
    [tableName, indexName]
  );

  return rows.length > 0;
}

async function safeQuery(label, sql, params = []) {
  try {
    await pool.query(sql, params);
    console.log(`✅ ${label}`);
  } catch (error) {
    console.log(`⚠️ ${label}: ${error.message}`);
  }
}

async function addColumnIfMissing(tableName, columnName, sql) {
  const exists = await columnExists(tableName, columnName);

  if (exists) {
    console.log(`✅ ${tableName}.${columnName} already exists`);
    return;
  }

  await safeQuery(`Add ${tableName}.${columnName}`, sql);
}

async function addIndexIfMissing(tableName, indexName, sql) {
  const exists = await indexExists(tableName, indexName);

  if (exists) {
    console.log(`✅ ${tableName}.${indexName} already exists`);
    return;
  }

  await safeQuery(`Add index ${tableName}.${indexName}`, sql);
}

async function main() {
  console.log("🔧 Starting Chalin 03 multi-store repair...");

  await safeQuery(
    "Create branches table",
    `
    CREATE TABLE IF NOT EXISTS branches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      branch_code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      location VARCHAR(255),
      phone VARCHAR(50),
      manager_name VARCHAR(150),
      is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      INDEX idx_branch_code (branch_code),
      INDEX idx_branch_name (name),
      INDEX idx_branch_active (is_active)
    )
    `
  );

  await safeQuery(
    "Insert main store",
    `
    INSERT INTO branches (
      id,
      branch_code,
      name,
      location,
      phone,
      manager_name,
      is_head_office,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      branch_code = VALUES(branch_code),
      name = VALUES(name),
      location = VALUES(location),
      phone = VALUES(phone),
      manager_name = VALUES(manager_name),
      is_head_office = VALUES(is_head_office),
      is_active = VALUES(is_active)
    `,
    [
      1,
      "MAIN",
      "Chalin 03 Main Store",
      "Dunkwa Police Barrier",
      "0249469080 / 0249995510",
      null,
      true,
      true,
    ]
  );

  await safeQuery(
    "Insert Ajakaa store",
    `
    INSERT INTO branches (
      id,
      branch_code,
      name,
      location,
      phone,
      manager_name,
      is_head_office,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      branch_code = VALUES(branch_code),
      name = VALUES(name),
      location = VALUES(location),
      phone = VALUES(phone),
      manager_name = VALUES(manager_name),
      is_head_office = VALUES(is_head_office),
      is_active = VALUES(is_active)
    `,
    [
      2,
      "AJAKAA",
      "Chalin 03 Store",
      "Ajakaa Manso",
      "0249469080 / 0249995510",
      null,
      false,
      true,
    ]
  );

  await addColumnIfMissing(
    "users",
    "default_branch_id",
    `
    ALTER TABLE users
    ADD COLUMN default_branch_id INT NULL AFTER phone
    `
  );

  await addColumnIfMissing(
    "users",
    "can_access_all_branches",
    `
    ALTER TABLE users
    ADD COLUMN can_access_all_branches BOOLEAN NOT NULL DEFAULT FALSE AFTER default_branch_id
    `
  );

  await addIndexIfMissing(
    "users",
    "idx_user_default_branch",
    `
    ALTER TABLE users
    ADD INDEX idx_user_default_branch (default_branch_id)
    `
  );

  await addIndexIfMissing(
    "users",
    "idx_user_all_branches",
    `
    ALTER TABLE users
    ADD INDEX idx_user_all_branches (can_access_all_branches)
    `
  );

  await safeQuery(
    "Create user_branch_access table",
    `
    CREATE TABLE IF NOT EXISTS user_branch_access (
      user_id INT NOT NULL,
      branch_id INT NOT NULL,
      access_role ENUM('admin', 'manager', 'cashier') NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

      PRIMARY KEY (user_id, branch_id),

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,

      INDEX idx_user_branch_access_branch (branch_id),
      INDEX idx_user_branch_access_primary (is_primary)
    )
    `
  );

  await safeQuery(
    "Give admin access to all branches",
    `
    UPDATE users
    SET default_branch_id = 1,
        can_access_all_branches = TRUE
    WHERE username = 'admin'
    `
  );

  await safeQuery(
    "Give admin main branch access",
    `
    INSERT INTO user_branch_access (user_id, branch_id, access_role, is_primary)
    VALUES (1, 1, 'admin', TRUE)
    ON DUPLICATE KEY UPDATE
      access_role = VALUES(access_role),
      is_primary = VALUES(is_primary)
    `
  );

  await safeQuery(
    "Give admin Ajakaa branch access",
    `
    INSERT INTO user_branch_access (user_id, branch_id, access_role, is_primary)
    VALUES (1, 2, 'admin', FALSE)
    ON DUPLICATE KEY UPDATE
      access_role = VALUES(access_role),
      is_primary = VALUES(is_primary)
    `
  );

  await addColumnIfMissing(
    "settings",
    "branch_id",
    `
    ALTER TABLE settings
    ADD COLUMN branch_id INT NOT NULL DEFAULT 1 AFTER id
    `
  );

  await addColumnIfMissing(
    "settings",
    "branch_name",
    `
    ALTER TABLE settings
    ADD COLUMN branch_name VARCHAR(150) NOT NULL DEFAULT 'Chalin 03 Main Store' AFTER business_name
    `
  );

  await addColumnIfMissing(
    "settings",
    "receipt_prefix",
    `
    ALTER TABLE settings
    ADD COLUMN receipt_prefix VARCHAR(20) DEFAULT 'CHL-MAIN' AFTER owner_phone
    `
  );

  await addIndexIfMissing(
    "settings",
    "idx_settings_branch",
    `
    ALTER TABLE settings
    ADD INDEX idx_settings_branch (branch_id)
    `
  );

  await safeQuery(
    "Update main branch settings",
    `
    UPDATE settings
    SET branch_id = 1,
        business_name = 'Chalin 03 Company Limited',
        branch_name = 'Chalin 03 Main Store',
        business_address = 'Dunkwa Police Barrier',
        business_phone = '0249469080 / 0249995510',
        owner_phone = '0543421127',
        receipt_prefix = 'CHL-MAIN'
    WHERE id = 1
    `
  );

  const [branchTwoSettings] = await pool.query(
    `
    SELECT id
    FROM settings
    WHERE branch_id = 2
    LIMIT 1
    `
  );

  if (branchTwoSettings.length === 0) {
    await safeQuery(
      "Insert Ajakaa branch settings",
      `
      INSERT INTO settings (
        branch_id,
        business_name,
        branch_name,
        business_address,
        business_phone,
        owner_phone,
        receipt_prefix,
        tax_rate,
        debt_reminder_days,
        daily_summary_time,
        receipt_footer
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, 7, '18:00:00', 'Thank You For Coming')
      `,
      [
        2,
        "Chalin 03 Company Limited",
        "Chalin 03 Store",
        "Ajakaa Manso",
        "0249469080 / 0249995510",
        "0543421127",
        "CHL-AJM",
      ]
    );
  } else {
    console.log("✅ Ajakaa branch settings already exist");
  }

  console.log("\n📌 Final checks:");

  const [branches] = await pool.query(
    `
    SELECT id, branch_code, name, location, is_active
    FROM branches
    ORDER BY id
    `
  );

  console.table(branches);

  const [users] = await pool.query(
    `
    SELECT id, full_name, username, role, default_branch_id, can_access_all_branches
    FROM users
    ORDER BY id
    `
  );

  console.table(users);

  const [settings] = await pool.query(
    `
    SELECT id, branch_id, business_name, branch_name, business_address, receipt_prefix
    FROM settings
    ORDER BY branch_id
    `
  );

  console.table(settings);

  console.log("\n✅ Multi-store base repair completed.");
}

main()
  .catch((error) => {
    console.error("❌ Multi-store repair failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });