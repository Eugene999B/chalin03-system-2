const { pool } = require("../config/db");

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    LIMIT 1
    `,
    [tableName]
  );

  return rows.length > 0;
}

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

async function safeQuery(label, sql) {
  try {
    await pool.query(sql);
    console.log(`✅ ${label}`);
  } catch (error) {
    console.log(`⚠️ ${label}: ${error.message}`);
  }
}

async function addBranchColumn(tableName, afterColumn = "id") {
  const exists = await tableExists(tableName);

  if (!exists) {
    console.log(`⚠️ ${tableName} table does not exist. Skipping.`);
    return;
  }

  const hasBranchId = await columnExists(tableName, "branch_id");

  if (!hasBranchId) {
    await safeQuery(
      `Add ${tableName}.branch_id`,
      `
      ALTER TABLE ${tableName}
      ADD COLUMN branch_id INT NOT NULL DEFAULT 1 AFTER ${afterColumn}
      `
    );
  } else {
    console.log(`✅ ${tableName}.branch_id already exists`);
  }

  const branchIndexName = `idx_${tableName}_branch`;
  const hasIndex = await indexExists(tableName, branchIndexName);

  if (!hasIndex) {
    await safeQuery(
      `Add ${tableName}.${branchIndexName}`,
      `
      ALTER TABLE ${tableName}
      ADD INDEX ${branchIndexName} (branch_id)
      `
    );
  } else {
    console.log(`✅ ${tableName}.${branchIndexName} already exists`);
  }
}

async function addNullableBranchColumn(tableName, afterColumn = "id") {
  const exists = await tableExists(tableName);

  if (!exists) {
    console.log(`⚠️ ${tableName} table does not exist. Skipping.`);
    return;
  }

  const hasBranchId = await columnExists(tableName, "branch_id");

  if (!hasBranchId) {
    await safeQuery(
      `Add ${tableName}.branch_id`,
      `
      ALTER TABLE ${tableName}
      ADD COLUMN branch_id INT NULL AFTER ${afterColumn}
      `
    );
  } else {
    console.log(`✅ ${tableName}.branch_id already exists`);
  }

  const branchIndexName = `idx_${tableName}_branch`;
  const hasIndex = await indexExists(tableName, branchIndexName);

  if (!hasIndex) {
    await safeQuery(
      `Add ${tableName}.${branchIndexName}`,
      `
      ALTER TABLE ${tableName}
      ADD INDEX ${branchIndexName} (branch_id)
      `
    );
  } else {
    console.log(`✅ ${tableName}.${branchIndexName} already exists`);
  }
}

async function main() {
  console.log("🔧 Repairing branch columns for Chalin 03...");

  await addBranchColumn("products");
  await addBranchColumn("stock_adjustments");
  await addBranchColumn("suppliers");
  await addBranchColumn("purchases");
  await addBranchColumn("purchase_payments");
  await addBranchColumn("customers");
  await addBranchColumn("sales");
  await addBranchColumn("debts");
  await addBranchColumn("debt_payments");
  await addBranchColumn("returns");
  await addBranchColumn("expenses");
  await addBranchColumn("daily_closings");
  await addBranchColumn("audit_signoffs");
  await addBranchColumn("audit_unlock_requests");
  await addBranchColumn("audit_reapproval_log");

  await addNullableBranchColumn("sms_log");
  await addNullableBranchColumn("activity_log");

  const hasSmsSentBy = await columnExists("sms_log", "sent_by");

  if (!hasSmsSentBy) {
    await safeQuery(
      "Add sms_log.sent_by",
      `
      ALTER TABLE sms_log
      ADD COLUMN sent_by INT NULL AFTER provider_response
      `
    );
  } else {
    console.log("✅ sms_log.sent_by already exists");
  }

  const hasSettingsBranchName = await columnExists("settings", "branch_name");

  if (!hasSettingsBranchName) {
    await safeQuery(
      "Add settings.branch_name",
      `
      ALTER TABLE settings
      ADD COLUMN branch_name VARCHAR(150) NOT NULL DEFAULT 'Chalin 03 Main Store' AFTER business_name
      `
    );
  } else {
    console.log("✅ settings.branch_name already exists");
  }

  const hasSettingsReceiptPrefix = await columnExists(
    "settings",
    "receipt_prefix"
  );

  if (!hasSettingsReceiptPrefix) {
    await safeQuery(
      "Add settings.receipt_prefix",
      `
      ALTER TABLE settings
      ADD COLUMN receipt_prefix VARCHAR(20) DEFAULT 'CHL-MAIN' AFTER owner_phone
      `
    );
  } else {
    console.log("✅ settings.receipt_prefix already exists");
  }

  await safeQuery(
    "Update old records to main branch",
    `
    UPDATE activity_log
    SET branch_id = 1
    WHERE branch_id IS NULL
    `
  );

  console.log("");
  console.log("📌 Checking important columns:");

  const [checks] = await pool.query(
    `
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
    AND COLUMN_NAME = 'branch_id'
    ORDER BY TABLE_NAME
    `
  );

  console.table(checks);

  console.log("");
  console.log("✅ Branch column repair completed.");
}

main()
  .catch((error) => {
    console.error("❌ Branch column repair failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });