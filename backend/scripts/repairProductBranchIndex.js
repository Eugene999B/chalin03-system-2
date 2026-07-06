const { pool } = require("../config/db");

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

async function safeQuery(label, sql) {
  try {
    await pool.query(sql);
    console.log(`✅ ${label}`);
  } catch (error) {
    console.log(`⚠️ ${label}: ${error.message}`);
  }
}

async function main() {
  console.log("🔧 Repairing product branch barcode index...");

  const hasBranchId = await columnExists("products", "branch_id");

  if (!hasBranchId) {
    await safeQuery(
      "Add products.branch_id",
      `
      ALTER TABLE products
      ADD COLUMN branch_id INT NOT NULL DEFAULT 1 AFTER id
      `
    );
  } else {
    console.log("✅ products.branch_id already exists");
  }

  const hasOldBarcodeUnique = await indexExists("products", "barcode");

  if (hasOldBarcodeUnique) {
    await safeQuery(
      "Drop old global barcode unique index",
      `
      ALTER TABLE products
      DROP INDEX barcode
      `
    );
  } else {
    console.log("✅ old global barcode unique index not found");
  }

  const hasBranchBarcodeUnique = await indexExists(
    "products",
    "unique_product_branch_barcode"
  );

  if (!hasBranchBarcodeUnique) {
    await safeQuery(
      "Add branch barcode unique index",
      `
      ALTER TABLE products
      ADD UNIQUE KEY unique_product_branch_barcode (branch_id, barcode)
      `
    );
  } else {
    console.log("✅ unique_product_branch_barcode already exists");
  }

  const hasStockBranchId = await columnExists("stock_adjustments", "branch_id");

  if (!hasStockBranchId) {
    await safeQuery(
      "Add stock_adjustments.branch_id",
      `
      ALTER TABLE stock_adjustments
      ADD COLUMN branch_id INT NOT NULL DEFAULT 1 AFTER id
      `
    );
  } else {
    console.log("✅ stock_adjustments.branch_id already exists");
  }

  console.log("");
  console.log("📌 Product indexes:");

  const [indexes] = await pool.query(
    `
    SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_index
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    GROUP BY INDEX_NAME, NON_UNIQUE
    ORDER BY INDEX_NAME
    `
  );

  console.table(indexes);

  console.log("");
  console.log("✅ Product branch barcode index repair completed.");
}

main()
  .catch((error) => {
    console.error("❌ Product index repair failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
