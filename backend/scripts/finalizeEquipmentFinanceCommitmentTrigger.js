const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:commitment-trigger-finalization";
const TRIGGER_NAME = "trg_equipment_finance_commitment_gate_before_update";

function env(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!String(value || "").trim()) {
    throw new Error(`Missing required database variable ${name}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function options() {
  const sslEnabled = String(process.env.DB_SSL || "").trim().toLowerCase() === "true";
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
  );
  return {
    host: env("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: env("DB_USER", "MYSQLUSER"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD"),
    database: env("DB_NAME", "MYSQLDATABASE"),
    ssl: sslEnabled
      ? ca
        ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true }
        : { rejectUnauthorized }
      : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

const CANONICAL_TRIGGER_SQL = `
CREATE TRIGGER ${TRIGGER_NAME}
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

        IF NEW.agreement_status IN ('active','due_soon','payment_due','overdue')
           AND OLD.agreement_status NOT IN ('active','due_soon','payment_due','overdue')
           AND NEW.equipment_commitment_status <> 'reserved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'A controlled Finance agreement cannot become active before equipment reservation.';
        END IF;
    END IF;
END`;

async function main() {
  const db = await mysql.createConnection(options());
  let locked = false;
  try {
    const [[identity]] = await db.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(
      process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || ""
    ).trim();
    if (!databaseName || databaseName !== expected) {
      throw new Error(
        `Connected database ${databaseName || "(unknown)"} does not match expected production database ${expected || "(unset)"}.`
      );
    }

    const [[lockRow]] = await db.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire the Finance commitment trigger finalization lock.");

    await db.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME}`);
    await db.query(CANONICAL_TRIGGER_SQL);

    const [[trigger]] = await db.query(
      `SELECT TRIGGER_NAME, ACTION_STATEMENT
         FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND TRIGGER_NAME = ?`,
      [TRIGGER_NAME]
    );
    const action = String(trigger?.ACTION_STATEMENT || "").toLowerCase();
    const valid =
      action.includes("old.agreement_status") &&
      action.includes("old.equipment_commitment_status") &&
      action.includes("new.equipment_commitment_status") &&
      action.includes("new.agreement_status in (") &&
      action.includes("v_active_lock_count") &&
      action.includes("v_active_hire_count");
    if (!valid) throw new Error("Finance commitment trigger did not reach the canonical final definition.");

    console.log(
      JSON.stringify(
        { verified: true, database_name: databaseName, trigger: TRIGGER_NAME },
        null,
        2
      )
    );
  } finally {
    if (locked) {
      try {
        await db.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
      } catch {}
    }
    await db.end();
  }
}

main().catch((error) => {
  console.error("Finance commitment trigger finalization failed.");
  console.error(error.message);
  process.exit(1);
});
