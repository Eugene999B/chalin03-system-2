const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:runtime-contract-repair";
const MIGRATION_NAME = "20260827_equipment_finance_runtime_contract";
const REQUIRED_PAYMENT_STAGE_VALUES = [
  "legacy",
  "opening_deposit",
  "installment_collection",
  "settlement",
  "adjustment",
  "refund",
];
const REQUIRED_RESERVATION_EFFECT_VALUES = ["none", "reserved"];

function env(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
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
    : {
        rejectUnauthorized: !["0", "false", "no", "off"].includes(
          String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()
        ),
      };
}

function options() {
  return {
    host: env("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: env("DB_USER", "MYSQLUSER"),
    password: env("DB_PASSWORD", "MYSQLPASSWORD"),
    database: env("DB_NAME", "MYSQLDATABASE"),
    ssl: ssl(),
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

function quote(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

async function main() {
  const connection = await mysql.createConnection(options());
  let locked = false;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expectedDatabase = String(
      process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || ""
    ).trim();
    if (!databaseName || !expectedDatabase || databaseName !== expectedDatabase) {
      throw new Error(
        `Finance runtime-contract repair refused: connected database ${databaseName || "(unknown)"} does not match expected production database ${expectedDatabase || "(unset)"}.`
      );
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire the Finance runtime-contract repair lock.");

    // The original 20260729 migration only ADDED these ENUM columns when missing.
    // Existing production installations could therefore retain stale ENUM definitions.
    const [paymentStageRows] = await connection.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'equipment_sale_payments'
          AND COLUMN_NAME = 'payment_stage'
        LIMIT 1`
    );
    if (!paymentStageRows.length) throw new Error("equipment_sale_payments.payment_stage is missing.");
    const paymentStageType = String(paymentStageRows[0].COLUMN_TYPE || "");
    if (!REQUIRED_PAYMENT_STAGE_VALUES.every((value) => paymentStageType.includes(`'${value}'`))) {
      await connection.query(
        "UPDATE equipment_sale_payments SET payment_stage = 'legacy' WHERE CAST(payment_stage AS CHAR) NOT IN ('legacy','opening_deposit','installment_collection','settlement','adjustment','refund')"
      );
      await connection.query(
        "ALTER TABLE equipment_sale_payments MODIFY COLUMN payment_stage ENUM('legacy','opening_deposit','installment_collection','settlement','adjustment','refund') NOT NULL DEFAULT 'legacy'"
      );
    }

    const [reservationRows] = await connection.query(
      `SELECT COLUMN_TYPE
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'equipment_sale_payments'
          AND COLUMN_NAME = 'reservation_effect'
        LIMIT 1`
    );
    if (!reservationRows.length) throw new Error("equipment_sale_payments.reservation_effect is missing.");
    const reservationType = String(reservationRows[0].COLUMN_TYPE || "");
    if (!REQUIRED_RESERVATION_EFFECT_VALUES.every((value) => reservationType.includes(`'${value}'`))) {
      await connection.query(
        "UPDATE equipment_sale_payments SET reservation_effect = 'none' WHERE CAST(reservation_effect AS CHAR) NOT IN ('none','reserved')"
      );
      await connection.query(
        "ALTER TABLE equipment_sale_payments MODIFY COLUMN reservation_effect ENUM('none','reserved') NOT NULL DEFAULT 'none'"
      );
    }

    // Finance is company-wide. Location remains optional contextual origin data.
    for (const tableName of ["equipment_sale_agreements", "equipment_sale_payments", "equipment_asset_sale_locks"]) {
      const column = "hire_location_id";
      const [[row]] = await connection.query(
        `SELECT IS_NULLABLE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [tableName, column]
      );
      if (row && String(row.IS_NULLABLE).toUpperCase() !== "YES") {
        await connection.query(`ALTER TABLE ${quote(tableName)} MODIFY COLUMN ${quote(column)} INT NULL`);
      }
    }

    // Repair only dates that are impossible for the agreement lifecycle (earlier than
    // the agreement creation date). Legitimate overdue dates after activation remain intact.
    await connection.query(
      `UPDATE equipment_sale_agreements agreement
       LEFT JOIN equipment_credit_applications application
         ON application.id = agreement.credit_application_id
       SET agreement.first_due_date = COALESCE(
             CASE
               WHEN application.proposed_first_due_date IS NOT NULL
                AND application.proposed_first_due_date >= DATE(agreement.created_at)
               THEN application.proposed_first_due_date
             END,
             DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
           )
       WHERE agreement.sale_type = 'installment'
         AND agreement.activation_source = 'approved_credit_application'
         AND agreement.first_due_date < DATE(agreement.created_at)`
    );

    await connection.query(
      `UPDATE equipment_installment_schedule schedule
       INNER JOIN equipment_sale_agreements agreement
         ON agreement.id = schedule.agreement_id
       LEFT JOIN equipment_credit_applications application
         ON application.id = agreement.credit_application_id
       SET schedule.due_date = CASE
         WHEN agreement.payment_frequency = 'weekly' THEN DATE_ADD(
           COALESCE(
             CASE
               WHEN application.proposed_first_due_date IS NOT NULL
                AND application.proposed_first_due_date >= DATE(agreement.created_at)
               THEN application.proposed_first_due_date
             END,
             DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
           ), INTERVAL (schedule.sequence_number - 1) * 7 DAY
         )
         WHEN agreement.payment_frequency = 'fortnightly' THEN DATE_ADD(
           COALESCE(
             CASE
               WHEN application.proposed_first_due_date IS NOT NULL
                AND application.proposed_first_due_date >= DATE(agreement.created_at)
               THEN application.proposed_first_due_date
             END,
             DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
           ), INTERVAL (schedule.sequence_number - 1) * 14 DAY
         )
         WHEN agreement.payment_frequency = 'custom' THEN DATE_ADD(
           COALESCE(
             CASE
               WHEN application.proposed_first_due_date IS NOT NULL
                AND application.proposed_first_due_date >= DATE(agreement.created_at)
               THEN application.proposed_first_due_date
             END,
             DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
           ), INTERVAL (schedule.sequence_number - 1) * COALESCE(agreement.payment_interval_days, 30) DAY
         )
         ELSE DATE_ADD(
           COALESCE(
             CASE
               WHEN application.proposed_first_due_date IS NOT NULL
                AND application.proposed_first_due_date >= DATE(agreement.created_at)
               THEN application.proposed_first_due_date
             END,
             DATE_ADD(DATE(agreement.created_at), INTERVAL 30 DAY)
           ), INTERVAL (schedule.sequence_number - 1) MONTH
         )
       END
       WHERE agreement.sale_type = 'installment'
         AND agreement.activation_source = 'approved_credit_application'
         AND schedule.due_date < DATE(agreement.created_at)`
    );

    // Prevent recurrence: newly created/updated controlled Finance schedules may not carry
    // a due date before the agreement itself. Existing legitimate overdue rows are unaffected.
    await connection.query("DROP TRIGGER IF EXISTS trg_equipment_finance_schedule_date_gate_before_insert");
    await connection.query(
      `CREATE TRIGGER trg_equipment_finance_schedule_date_gate_before_insert
       BEFORE INSERT ON equipment_installment_schedule
       FOR EACH ROW
       BEGIN
         DECLARE v_created DATE DEFAULT NULL;
         SELECT DATE(created_at) INTO v_created
           FROM equipment_sale_agreements
          WHERE id = NEW.agreement_id
          LIMIT 1;
         IF v_created IS NOT NULL AND NEW.due_date < v_created THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Installment due date cannot precede the Finance agreement date.';
         END IF;
       END`
    );

    await connection.query("DROP TRIGGER IF EXISTS trg_equipment_finance_schedule_date_gate_before_update");
    await connection.query(
      `CREATE TRIGGER trg_equipment_finance_schedule_date_gate_before_update
       BEFORE UPDATE ON equipment_installment_schedule
       FOR EACH ROW
       BEGIN
         DECLARE v_created DATE DEFAULT NULL;
         SELECT DATE(created_at) INTO v_created
           FROM equipment_sale_agreements
          WHERE id = NEW.agreement_id
          LIMIT 1;
         IF v_created IS NOT NULL AND NEW.due_date < v_created THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Installment due date cannot precede the Finance agreement date.';
         END IF;
       END`
    );

    await connection.query("DROP TRIGGER IF EXISTS trg_equipment_finance_agreement_date_gate_before_insert");
    await connection.query(
      `CREATE TRIGGER trg_equipment_finance_agreement_date_gate_before_insert
       BEFORE INSERT ON equipment_sale_agreements
       FOR EACH ROW
       BEGIN
         IF NEW.activation_source = 'approved_credit_application'
            AND NEW.sale_type = 'installment'
            AND NEW.first_due_date IS NOT NULL
            AND NEW.first_due_date < DATE(COALESCE(NEW.created_at, CURRENT_TIMESTAMP)) THEN
           SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved Finance first installment date cannot precede agreement creation.';
         END IF;
       END`
    );

    await connection.query(
      `INSERT INTO schema_migrations (migration_name, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [
        MIGRATION_NAME,
        "Runtime Finance contract normalization: payment ENUMs, company-wide nullable origin fields, impossible-date repair and recurrence guards.",
      ]
    );

    const [[verify]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'equipment_sale_payments'
             AND COLUMN_NAME = 'payment_stage'
             AND COLUMN_TYPE LIKE "%installment_collection%") AS payment_stage_ok,
         (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'equipment_sale_payments'
             AND COLUMN_NAME = 'hire_location_id' AND IS_NULLABLE = 'YES') AS payment_location_nullable,
         (SELECT COUNT(*) FROM equipment_sale_agreements
           WHERE activation_source = 'approved_credit_application'
             AND sale_type = 'installment'
             AND first_due_date IS NOT NULL
             AND first_due_date < DATE(created_at)) AS impossible_agreement_dates,
         (SELECT COUNT(*) FROM equipment_installment_schedule schedule
           INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
           WHERE agreement.activation_source = 'approved_credit_application'
             AND agreement.sale_type = 'installment'
             AND schedule.due_date < DATE(agreement.created_at)) AS impossible_schedule_dates`
    );

    if (
      Number(verify?.payment_stage_ok || 0) !== 1 ||
      Number(verify?.payment_location_nullable || 0) !== 1 ||
      Number(verify?.impossible_agreement_dates || 0) !== 0 ||
      Number(verify?.impossible_schedule_dates || 0) !== 0
    ) {
      throw new Error(`Finance runtime-contract verification failed: ${JSON.stringify(verify)}`);
    }

    console.log(JSON.stringify({ verified: true, database_name: databaseName, migration: MIGRATION_NAME }, null, 2));
  } finally {
    if (locked) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Finance runtime-contract repair failed.");
  console.error(error.stack || error.message);
  process.exit(1);
});
