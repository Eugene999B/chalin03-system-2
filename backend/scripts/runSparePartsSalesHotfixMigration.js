const { pool } = require("../config/db");

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  return rows.length > 0;
}

async function editorForeignKeyExists() {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sales'
       AND COLUMN_NAME = 'edited_by'
       AND REFERENCED_TABLE_NAME = 'users'
       AND REFERENCED_COLUMN_NAME = 'id'
     LIMIT 1`
  );

  return rows.length > 0;
}

async function addColumnIfMissing(columnName, definition) {
  if (await columnExists("sales", columnName)) {
    console.log(`✓ sales.${columnName} already exists`);
    return;
  }

  await pool.query(`ALTER TABLE sales ADD COLUMN ${definition}`);
  console.log(`✓ Added sales.${columnName}`);
}

async function addIndexIfMissing(indexName, sql) {
  if (await indexExists("sales", indexName)) {
    console.log(`✓ ${indexName} already exists`);
    return;
  }

  await pool.query(sql);
  console.log(`✓ Added ${indexName}`);
}

async function run() {
  const [databaseRows] = await pool.query("SELECT DATABASE() AS database_name");
  const databaseName = databaseRows[0]?.database_name;

  if (!databaseName) {
    throw new Error("No database is selected by the current environment.");
  }

  console.log(`Running Spare Parts sales hotfix migration on: ${databaseName}`);

  await addColumnIfMissing(
    "amount_tendered",
    "`amount_tendered` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `payment_type`"
  );
  await addColumnIfMissing(
    "change_due",
    "`change_due` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `amount_paid`"
  );
  await addColumnIfMissing(
    "edited_by",
    "`edited_by` INT NULL AFTER `voided_at`"
  );
  await addColumnIfMissing(
    "edited_at",
    "`edited_at` DATETIME NULL AFTER `edited_by`"
  );
  await addColumnIfMissing(
    "edit_reason",
    "`edit_reason` TEXT NULL AFTER `edited_at`"
  );

  await addIndexIfMissing(
    "idx_sale_change_due",
    "ALTER TABLE sales ADD INDEX `idx_sale_change_due` (`change_due`)"
  );
  await addIndexIfMissing(
    "idx_sale_edited_by",
    "ALTER TABLE sales ADD INDEX `idx_sale_edited_by` (`edited_by`)"
  );

  if (!(await editorForeignKeyExists())) {
    await pool.query(
      `ALTER TABLE sales
       ADD CONSTRAINT fk_sales_edited_by
       FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE SET NULL`
    );
    console.log("✓ Added editor foreign key");
  } else {
    console.log("✓ Editor foreign key already exists");
  }

  const [immediateBackfill] = await pool.query(
    `UPDATE sales
     SET amount_tendered = amount_paid,
         change_due = GREATEST(amount_paid - total, 0)
     WHERE amount_tendered = 0.00
       AND change_due = 0.00
       AND payment_type IN ('cash', 'momo', 'bank')`
  );
  console.log(
    `✓ Recovered tendered/change values for ${immediateBackfill.affectedRows} immediate-payment sale(s)`
  );

  const [immediateNormalize] = await pool.query(
    `UPDATE sales
     SET amount_paid = LEAST(amount_paid, total),
         balance = GREATEST(total - LEAST(amount_paid, total), 0)
     WHERE payment_type IN ('cash', 'momo', 'bank')`
  );
  console.log(
    `✓ Normalized applied payment/balance for ${immediateNormalize.affectedRows} immediate-payment sale(s)`
  );

  const [creditBackfill] = await pool.query(
    `UPDATE sales
     SET amount_tendered = amount_paid
     WHERE amount_tendered = 0.00
       AND change_due = 0.00
       AND payment_type IN ('credit', 'mixed')
       AND amount_paid > 0.00`
  );
  console.log(
    `✓ Preserved paid-now values for ${creditBackfill.affectedRows} credit/mixed sale(s)`
  );

  console.log("✅ Spare Parts sales hotfix migration completed.");
}

run()
  .catch((error) => {
    console.error("❌ Hotfix migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
