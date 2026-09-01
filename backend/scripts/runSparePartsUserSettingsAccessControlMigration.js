const mysql = require("mysql2/promise");
require("dotenv").config();

const MIGRATION_NAME = "20260901_spare_parts_user_settings_access_control";
const COLUMN_NAME = "user_settings_system_admin_only";

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function connectionOptions() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: String(process.env.DB_SSL || "").trim().toLowerCase() === "true"
      ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase() !== "false" }
      : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

async function run() {
  const connection = await mysql.createConnection(connectionOptions());
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(150) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        description TEXT NULL
      )
    `);

    const [[existingMigration]] = await connection.query(
      "SELECT id FROM schema_migrations WHERE migration_name = ? LIMIT 1",
      [MIGRATION_NAME]
    );
    if (existingMigration) {
      console.log(JSON.stringify({ migration: MIGRATION_NAME, status: "already_applied" }));
      return;
    }

    const [columns] = await connection.query(
      "SHOW COLUMNS FROM settings LIKE ?",
      [COLUMN_NAME]
    );

    if (columns.length === 0) {
      await connection.query(
        `ALTER TABLE settings ADD COLUMN ${COLUMN_NAME} BOOLEAN NOT NULL DEFAULT FALSE AFTER receipt_prefix`
      );
    }

    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [
        MIGRATION_NAME,
        "Adds an additive Spare Parts User Settings access-control toggle. Existing admin access remains enabled by default.",
      ]
    );

    console.log(JSON.stringify({
      migration: MIGRATION_NAME,
      status: "applied",
      column: COLUMN_NAME,
      default_value: false,
    }));
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Spare Parts User Settings access-control migration failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { MIGRATION_NAME, COLUMN_NAME, connectionOptions, run };
