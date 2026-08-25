const mysql = require("mysql2/promise");
require("dotenv").config();

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) throw new Error(`Missing ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function sslConfig() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  return { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) };
}

const options = {
  host: requiredEnv("DB_HOST", "MYSQLHOST"),
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
  user: requiredEnv("DB_USER", "MYSQLUSER"),
  password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
  database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
  ssl: sslConfig(),
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
  multipleStatements: false,
  timezone: "Z",
};

const TRIGGER_SQL = `
CREATE TRIGGER trg_equipment_finance_commitment_gate_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_opening_deposit_total DECIMAL(14,2) DEFAULT 0.00;
    DECLARE v_active_lock_count INT DEFAULT 0;
    DECLARE v_active_hire_count INT DEFAULT 0;
    DECLARE v_application_status VARCHAR(60) DEFAULT NULL;

    IF NEW.activation_source = 'approved_credit_application' THEN
        SELECT COALESCE(SUM(payment.amount), 0)
          INTO v_opening_deposit_total
          FROM equipment_sale_payments payment
         WHERE payment.agreement_id = NEW.id
           AND payment.payment_stage = 'opening_deposit'
           AND payment.payment_category = 'deposit'
           AND payment.is_voided = FALSE;

        IF NEW.deposit_received <> v_opening_deposit_total THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance deposit balance must match controlled opening-deposit receipts.';
        END IF;

        IF NEW.deposit_received > NEW.deposit_required THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Finance deposit received cannot exceed the required deposit.';
        END IF;

        IF OLD.equipment_commitment_status <> 'reserved'
           AND NEW.equipment_commitment_status = 'reserved' THEN
            SELECT application.application_status
              INTO v_application_status
              FROM equipment_credit_applications application
             WHERE application.id = NEW.credit_application_id
             LIMIT 1;

            IF v_application_status IS NULL OR v_application_status <> 'approved' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Equipment commitment requires an explicitly approved Finance application.';
            END IF;

            IF NEW.deposit_received < NEW.deposit_required THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Required deposit must be complete before equipment commitment.';
            END IF;

            SELECT COUNT(*)
              INTO v_active_lock_count
              FROM equipment_asset_sale_locks sale_lock
             WHERE sale_lock.agreement_id = NEW.id
               AND sale_lock.asset_id = NEW.asset_id
               AND (sale_lock.hire_location_id <=> NEW.hire_location_id)
               AND sale_lock.lock_status = 'installment_active'
               AND sale_lock.released_at IS NULL;

            IF v_active_lock_count <> 1 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'A matching active Finance reservation is required.';
            END IF;

            SELECT COUNT(*)
              INTO v_active_hire_count
              FROM hire_contract_assets hire_asset
             WHERE hire_asset.asset_id = NEW.asset_id
               AND hire_asset.status IN ('assigned','dispatched','active');

            IF v_active_hire_count <> 0 THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Equipment active on Hire cannot become committed to Finance.';
            END IF;

            IF NEW.reservation_activated_at IS NULL
               OR NEW.reservation_activated_by IS NULL THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Finance reservation activation evidence is required.';
            END IF;
        END IF;

        IF OLD.agreement_status NOT IN ('active','due_soon','payment_due','overdue')
           AND NEW.agreement_status IN ('active','due_soon','payment_due','overdue')
           AND NEW.equipment_commitment_status <> 'reserved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A controlled Finance agreement cannot become active before equipment reservation.';
        END IF;
    END IF;
END`;

async function main() {
  const connection = await mysql.createConnection(options);
  try {
    await connection.query("DROP TRIGGER IF EXISTS trg_equipment_finance_commitment_gate_before_update");
    await connection.query(TRIGGER_SQL);
    const [rows] = await connection.query(
      `SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = DATABASE()
         AND TRIGGER_NAME = 'trg_equipment_finance_commitment_gate_before_update'`
    );
    if (rows.length !== 1 || rows[0].EVENT_MANIPULATION !== "UPDATE" || rows[0].ACTION_TIMING !== "BEFORE") {
      throw new Error("Commitment trigger verification failed.");
    }
    console.log("Opening Deposit commitment trigger repaired and verified.");
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Opening Deposit commitment trigger repair failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };
