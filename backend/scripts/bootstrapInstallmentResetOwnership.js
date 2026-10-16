const mysql = require("mysql2/promise");
require("dotenv").config();

const WORKSPACE = "equipment_installment_finance";
const LOCK = "chalin03:installment-reset-ownership-bootstrap";

function required(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : "");
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${name}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function ssl() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  return ca
    ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) };
}

async function main() {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    return;
  }

  const db = await mysql.createConnection({
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    ssl: ssl(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  });

  let locked = false;
  try {
    const [[current]] = await db.query("SELECT DATABASE() AS database_name");
    const actual = String(current?.database_name || "").trim();
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || "").trim();
    if (expected && expected !== actual) {
      throw new Error(`Connected database ${actual} does not match CHALIN03_EXPECTED_DATABASE.`);
    }

    const [[lock]] = await db.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK]);
    locked = Number(lock?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire Installment ownership bootstrap lock.");

    await db.query(`
      CREATE TABLE IF NOT EXISTS installment_reset_ownership (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        workspace_code VARCHAR(80) NOT NULL,
        entity_type ENUM('customer','fleet_asset') NOT NULL,
        entity_id BIGINT UNSIGNED NOT NULL,
        ownership_source VARCHAR(120) NOT NULL,
        first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_installment_reset_ownership_entity (workspace_code, entity_type, entity_id),
        KEY idx_installment_reset_ownership_lookup (entity_type, entity_id),
        KEY idx_installment_reset_ownership_workspace (workspace_code, entity_type)
      ) ENGINE=InnoDB
    `);

    await db.query(`
      INSERT IGNORE INTO installment_reset_ownership
        (workspace_code, entity_type, entity_id, ownership_source)
      SELECT DISTINCT ?, 'fleet_asset', CAST(registration.entity_id AS UNSIGNED),
        'activity_log_installment_machine_registration'
      FROM activity_log registration
      WHERE registration.entity_type = 'fleet_asset'
        AND registration.entity_id REGEXP '^[0-9]+$'
        AND (registration.action_type = 'equipment.finance.machine.register'
          OR registration.action = 'EQUIPMENT_FINANCE_MACHINE_REGISTERED')
        AND (registration.workspace_code = ? OR registration.workspace_code IS NULL)
    `, [WORKSPACE, WORKSPACE]);

    await db.query(`
      INSERT IGNORE INTO installment_reset_ownership
        (workspace_code, entity_type, entity_id, ownership_source)
      SELECT DISTINCT ?, 'customer', CAST(registration.entity_id AS UNSIGNED),
        'activity_log_installment_customer_registration'
      FROM activity_log registration
      WHERE registration.entity_id REGEXP '^[0-9]+$'
        AND registration.entity_type IN ('customer','customers','customer_profile','customer_identity')
        AND (
          LOWER(COALESCE(registration.action_type,'')) LIKE '%customer%register%'
          OR LOWER(COALESCE(registration.action_type,'')) LIKE '%customer%create%'
          OR LOWER(COALESCE(registration.action,'')) LIKE '%customer%register%'
          OR LOWER(COALESCE(registration.action,'')) LIKE '%customer%create%'
        )
        AND registration.workspace_code = ?
    `, [WORKSPACE, WORKSPACE]);

    const [[counts]] = await db.query(`
      SELECT
        SUM(entity_type = 'customer') AS customers,
        SUM(entity_type = 'fleet_asset') AS fleet_assets
      FROM installment_reset_ownership
      WHERE workspace_code = ?
    `, [WORKSPACE]);

    console.log(`Installment ownership bootstrap verified on ${actual}: customers=${Number(counts?.customers || 0)}, fleet_assets=${Number(counts?.fleet_assets || 0)}`);
  } finally {
    if (locked) {
      try { await db.query("SELECT RELEASE_LOCK(?)", [LOCK]); } catch (_) {}
    }
    await db.end();
  }
}

main().catch((error) => {
  console.error("Installment ownership bootstrap failed:", error.message);
  process.exit(1);
});
