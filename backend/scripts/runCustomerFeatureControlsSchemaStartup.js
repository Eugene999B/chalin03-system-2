require("dotenv").config();

const { pool } = require("../config/db");

async function main() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_feature_controls (
        branch_id INT NOT NULL PRIMARY KEY,
        customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
        customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      )
    `);

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'customer_feature_controls'`
    );

    if (Number(rows[0]?.table_count || 0) !== 1) {
      throw new Error("customer_feature_controls table verification failed.");
    }

    console.log("Customer feature controls schema is ready.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Customer feature controls schema startup failed:", error);
  process.exit(1);
});
