const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:feature-controls:20260828";

function env(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) throw new Error(`Missing database variable ${primary}.`);
  return value;
}

async function run() {
  const connection = await mysql.createConnection({
    host: env("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: env("DB_USER", "MYSQLUSER"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD"),
    database: env("DB_NAME", "MYSQLDATABASE"),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    ssl: String(process.env.DB_SSL || "").toLowerCase() === "true"
      ? { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase()) }
      : undefined,
    timezone: "Z",
  });

  let locked = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lock?.acquired) === 1;
    if (!locked) throw new Error("Could not acquire the feature-control migration lock.");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_feature_controls (
        branch_id INT NOT NULL PRIMARY KEY,
        customer_identity_editing_enabled TINYINT(1) NOT NULL DEFAULT 1,
        customer_merge_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_customer_feature_controls_branch
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      )
    `);

    await connection.query(`
      INSERT INTO customer_feature_controls (branch_id, customer_identity_editing_enabled, customer_merge_enabled)
      SELECT id, 1, 1 FROM branches
      ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id)
    `);

    await connection.query(`
      INSERT INTO notification_rules
        (rule_code, rule_name, workspace_code, category, default_severity, target_role, target_permission, escalation_minutes, sms_allowed, is_enabled, description)
      VALUES
        ('group.executive.weekly_business_intelligence', 'Weekly business intelligence', 'group', 'executive', 'high', 'admin,manager,auditor', 'notifications.view', 60, TRUE, TRUE, 'Weekly business performance, cash, debt, operations and risk intelligence.'),
        ('group.executive.monthly_business_intelligence', 'Monthly business intelligence', 'group', 'executive', 'high', 'admin,manager,auditor', 'notifications.view', 60, TRUE, TRUE, 'Monthly business performance and management intelligence.')
      ON DUPLICATE KEY UPDATE rule_name = VALUES(rule_name), description = VALUES(description)
    `);

    console.log("Customer feature controls and executive notification rules verified.");
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    await connection.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Feature-control production migration failed:");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { run };
