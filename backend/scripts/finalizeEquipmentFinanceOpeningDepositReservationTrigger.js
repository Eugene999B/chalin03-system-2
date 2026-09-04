const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:opening-deposit-foundation-repair";
const TRIGGER_NAME = "trg_equipment_finance_reservation_gate_before_insert";

function requiredEnv(primaryName, fallbackName) {
  const value = process.env[primaryName] || process.env[fallbackName];
  if (!String(value || "").trim()) {
    throw new Error(
      `Missing required database variable ${primaryName}${fallbackName ? ` or ${fallbackName}` : ""}.`
    );
  }
  return value;
}

function connectionOptions() {
  const sslEnabled = String(process.env.DB_SSL || "").trim().toLowerCase() === "true";
  const encodedCa = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl: sslEnabled
      ? encodedCa
        ? { ca: Buffer.from(encodedCa, "base64").toString("utf8"), rejectUnauthorized: true }
        : { rejectUnauthorized }
      : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

async function finalize() {
  const connection = await mysql.createConnection(connectionOptions());
  let lockAcquired = false;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(
      process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || ""
    ).trim();
    if (!databaseName || !expected || databaseName !== expected) {
      throw new Error(
        `Connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`
      );
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) {
      throw new Error("Could not acquire the Opening Deposit trigger finalization lock.");
    }

    await connection.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME}`);
    await connection.query(`
      CREATE TRIGGER ${TRIGGER_NAME}
      BEFORE INSERT ON equipment_asset_sale_locks
      FOR EACH ROW
      BEGIN
          DECLARE v_agreement_exists INT DEFAULT 0;
          DECLARE v_activation_source VARCHAR(60) DEFAULT NULL;
          DECLARE v_credit_application_id BIGINT DEFAULT NULL;
          DECLARE v_agreement_asset_id INT DEFAULT NULL;
          DECLARE v_agreement_location_id INT DEFAULT NULL;
          DECLARE v_agreement_status VARCHAR(60) DEFAULT NULL;
          DECLARE v_commitment_status VARCHAR(60) DEFAULT NULL;
          DECLARE v_deposit_required DECIMAL(14,2) DEFAULT 0.00;
          DECLARE v_deposit_received DECIMAL(14,2) DEFAULT 0.00;
          DECLARE v_application_status VARCHAR(60) DEFAULT NULL;
          DECLARE v_asset_available INT DEFAULT 0;
          DECLARE v_active_hire_count INT DEFAULT 0;

          SELECT COUNT(*),
                 MAX(agreement.activation_source),
                 MAX(agreement.credit_application_id),
                 MAX(agreement.asset_id),
                 MAX(agreement.hire_location_id),
                 MAX(agreement.agreement_status),
                 MAX(agreement.equipment_commitment_status),
                 MAX(agreement.deposit_required),
                 MAX(agreement.deposit_received),
                 MAX(application.application_status)
            INTO v_agreement_exists,
                 v_activation_source,
                 v_credit_application_id,
                 v_agreement_asset_id,
                 v_agreement_location_id,
                 v_agreement_status,
                 v_commitment_status,
                 v_deposit_required,
                 v_deposit_received,
                 v_application_status
            FROM equipment_sale_agreements agreement
            LEFT JOIN equipment_credit_applications application
              ON application.id = agreement.credit_application_id
           WHERE agreement.id = NEW.agreement_id;

          IF v_agreement_exists <> 1 THEN
              SIGNAL SQLSTATE '45000'
                  SET MESSAGE_TEXT = 'Finance reservation agreement was not found.';
          END IF;

          IF v_activation_source = 'approved_credit_application' THEN
              IF v_credit_application_id IS NULL OR v_application_status <> 'approved' THEN
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'The reservation is not linked to an explicitly approved Finance application.';
              END IF;

              IF NEW.asset_id <> v_agreement_asset_id
                 OR NOT (NEW.hire_location_id <=> v_agreement_location_id) THEN
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'Reservation asset or origin does not match the Finance agreement.';
              END IF;

              IF NEW.lock_status = 'installment_active' THEN
                  DO 0;
              ELSE
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'Approved-credit Finance reservations must use installment_active status.';
              END IF;

              IF v_agreement_status NOT IN ('approved','active')
                 OR v_commitment_status <> 'not_reserved' THEN
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'This Finance agreement cannot create another machine reservation.';
              END IF;

              IF v_deposit_received + 0.01 < v_deposit_required THEN
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'The required opening deposit must be complete before reservation.';
              END IF;

              SELECT COUNT(*)
                INTO v_asset_available
                FROM fleet_assets asset
               WHERE asset.id = NEW.asset_id
                 AND asset.is_active = TRUE
                 AND asset.operational_purpose IN ('sale_only','sale_or_hire')
                 AND asset.sale_status = 'available';

              IF v_asset_available <> 1 THEN
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'The equipment is not available for Finance reservation.';
              END IF;

              SELECT COUNT(*)
                INTO v_active_hire_count
                FROM hire_contract_assets hire_asset
               WHERE hire_asset.asset_id = NEW.asset_id
                 AND hire_asset.status IN ('assigned','dispatched','active');

              IF v_active_hire_count <> 0 THEN
                  SIGNAL SQLSTATE '45000'
                      SET MESSAGE_TEXT = 'Equipment active on Hire cannot be reserved for Finance.';
              END IF;
          END IF;
      END
    `);

    const [[trigger]] = await connection.query(
      `SELECT TRIGGER_NAME, ACTION_STATEMENT
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND TRIGGER_NAME = ?`,
      [TRIGGER_NAME]
    );
    const action = String(trigger?.ACTION_STATEMENT || "");
    if (!/NEW\.lock_status\s*=\s*'installment_active'/i.test(action)) {
      throw new Error("The Opening Deposit reservation trigger is missing the canonical installment_active guard.");
    }
    if (!/ELSE\s+SIGNAL SQLSTATE '45000'/i.test(action)) {
      throw new Error("The Opening Deposit reservation trigger is missing the invalid-status rejection branch.");
    }
    if (!/v_deposit_received\s*\+\s*0\.01\s*<\s*v_deposit_required/i.test(action)) {
      throw new Error("The Opening Deposit reservation trigger did not reach the canonical deposit threshold definition.");
    }

    console.log(JSON.stringify({ verified: true, database_name: databaseName, trigger: trigger.TRIGGER_NAME }, null, 2));
    return { verified: true, database_name: databaseName, trigger: trigger.TRIGGER_NAME };
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

if (require.main === module) {
  finalize().catch((error) => {
    console.error("Opening Deposit reservation trigger finalization failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { finalize };
