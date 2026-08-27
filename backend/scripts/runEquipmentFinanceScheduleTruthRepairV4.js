const mysql = require("mysql2/promise");
require("dotenv").config();

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) throw new Error(`Missing ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  return value;
}

function sslConfig() {
  if (String(process.env.DB_SSL || "").trim().toLowerCase() !== "true") return undefined;
  const ca = String(process.env.DB_SSL_CA_BASE64 || "").trim();
  return ca
    ? { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) };
}

function options() {
  return {
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
}

async function main() {
  const connection = await mysql.createConnection(options());
  try {
    const [[db]] = await connection.query("SELECT DATABASE() AS database_name");
    if (!db?.database_name) throw new Error("No production database is selected.");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS equipment_finance_shortfall_proposals (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        agreement_id BIGINT NOT NULL,
        schedule_id BIGINT NULL,
        proposal_type ENUM('underpayment','missed_payment') NOT NULL,
        proposal_status ENUM('pending','accepted','declined','superseded') NOT NULL DEFAULT 'pending',
        amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        due_date DATE NULL,
        basis_json TEXT NULL,
        proposed_by INT NULL,
        decided_by INT NULL,
        decided_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_finance_shortfall_agreement (agreement_id, proposal_status, created_at),
        INDEX idx_finance_shortfall_schedule (schedule_id, proposal_status),
        INDEX idx_finance_shortfall_due_date (due_date, proposal_status)
      )
    `);

    await connection.query("DROP TRIGGER IF EXISTS trg_equipment_finance_schedule_truth_after_allocation");
    await connection.query("DROP PROCEDURE IF EXISTS rebalance_equipment_finance_future_schedule");

    await connection.query(`
      CREATE PROCEDURE rebalance_equipment_finance_future_schedule(IN p_agreement_id BIGINT)
      BEGIN
        DECLARE v_financed DECIMAL(14,2) DEFAULT 0.00;
        DECLARE v_allocated DECIMAL(14,2) DEFAULT 0.00;
        DECLARE v_fixed_unallocated DECIMAL(14,2) DEFAULT 0.00;
        DECLARE v_distributable DECIMAL(14,2) DEFAULT 0.00;
        DECLARE v_unpaid_count INT DEFAULT 0;
        DECLARE v_index INT DEFAULT 0;
        DECLARE v_running DECIMAL(14,2) DEFAULT 0.00;
        DECLARE v_share DECIMAL(14,2) DEFAULT 0.00;
        DECLARE done INT DEFAULT 0;
        DECLARE v_schedule_id BIGINT;
        DECLARE cur CURSOR FOR
          SELECT s.id FROM equipment_installment_schedule s
          WHERE s.agreement_id = p_agreement_id
            AND s.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
            AND s.amount_paid <= 0.009
          ORDER BY s.due_date, s.sequence_number, s.id;
        DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

        SELECT COALESCE(financed_amount, 0) INTO v_financed
        FROM equipment_sale_agreements WHERE id = p_agreement_id LIMIT 1;

        SELECT COALESCE(SUM(a.allocated_amount), 0) INTO v_allocated
        FROM equipment_sale_payment_allocations a
        INNER JOIN equipment_sale_payments p ON p.id = a.payment_id
        INNER JOIN equipment_installment_schedule s ON s.id = a.schedule_id
        WHERE s.agreement_id = p_agreement_id
          AND p.is_voided = FALSE
          AND s.schedule_status <> 'rescheduled';

        SELECT COALESCE(SUM(GREATEST(s.scheduled_amount - COALESCE(x.allocated_amount, 0), 0)), 0)
          INTO v_fixed_unallocated
        FROM equipment_installment_schedule s
        LEFT JOIN (
          SELECT a.schedule_id, SUM(a.allocated_amount) AS allocated_amount
          FROM equipment_sale_payment_allocations a
          INNER JOIN equipment_sale_payments p ON p.id = a.payment_id
          WHERE p.is_voided = FALSE
          GROUP BY a.schedule_id
        ) x ON x.schedule_id = s.id
        WHERE s.agreement_id = p_agreement_id
          AND s.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
          AND COALESCE(x.allocated_amount, 0) > 0;

        SET v_distributable = GREATEST(v_financed - v_allocated - v_fixed_unallocated, 0.00);

        SELECT COUNT(*) INTO v_unpaid_count
        FROM equipment_installment_schedule s
        WHERE s.agreement_id = p_agreement_id
          AND s.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
          AND s.amount_paid <= 0.009;

        IF v_unpaid_count > 0 AND v_distributable > 0 THEN
          OPEN cur;
          rebalance_loop: LOOP
            FETCH cur INTO v_schedule_id;
            IF done = 1 THEN LEAVE rebalance_loop; END IF;
            SET v_index = v_index + 1;
            IF v_index = v_unpaid_count THEN
              SET v_share = v_distributable - v_running;
            ELSE
              SET v_share = FLOOR((v_distributable / v_unpaid_count) * 100) / 100;
              SET v_running = v_running + v_share;
            END IF;
            UPDATE equipment_installment_schedule
            SET scheduled_amount = GREATEST(v_share, 0.01), updated_at = NOW()
            WHERE id = v_schedule_id;
          END LOOP;
          CLOSE cur;
        END IF;

        UPDATE equipment_sale_agreements agreement
        SET agreement.next_due_date = (
              SELECT MIN(s.due_date) FROM equipment_installment_schedule s
              WHERE s.agreement_id = p_agreement_id
                AND s.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
                AND GREATEST(s.scheduled_amount - COALESCE((
                  SELECT SUM(a.allocated_amount)
                  FROM equipment_sale_payment_allocations a
                  INNER JOIN equipment_sale_payments p ON p.id = a.payment_id
                  WHERE a.schedule_id = s.id AND p.is_voided = FALSE
                ), 0), 0) > 0.009
            ),
            agreement.final_due_date = (
              SELECT MAX(s.due_date) FROM equipment_installment_schedule s
              WHERE s.agreement_id = p_agreement_id AND s.schedule_status <> 'rescheduled'
            ),
            agreement.updated_at = NOW()
        WHERE agreement.id = p_agreement_id;
      END
    `);

    await connection.query(`
      CREATE TRIGGER trg_equipment_finance_schedule_truth_after_allocation
      AFTER INSERT ON equipment_sale_payment_allocations
      FOR EACH ROW
      BEGIN
        DECLARE v_agreement_id BIGINT DEFAULT NULL;
        SELECT agreement_id INTO v_agreement_id
        FROM equipment_installment_schedule
        WHERE id = NEW.schedule_id LIMIT 1;
        IF v_agreement_id IS NOT NULL THEN
          CALL rebalance_equipment_finance_future_schedule(v_agreement_id);
        END IF;
      END
    `);

    await connection.query(`
      UPDATE equipment_installment_schedule s
      INNER JOIN equipment_sale_agreements a ON a.id = s.agreement_id
      INNER JOIN equipment_credit_applications c ON c.id = a.credit_application_id
      LEFT JOIN equipment_sales_quotations q ON q.id = c.quotation_id
      SET s.due_date = CASE
        WHEN a.payment_frequency = 'monthly' THEN DATE_ADD(
          CASE
            WHEN q.proposed_first_due_date IS NOT NULL AND q.proposed_first_due_date >= DATE(a.created_at)
              THEN q.proposed_first_due_date
            ELSE DATE_ADD(DATE(a.created_at), INTERVAL 30 DAY)
          END,
          INTERVAL GREATEST(s.sequence_number - 1, 0) MONTH
        )
        ELSE DATE_ADD(
          CASE
            WHEN q.proposed_first_due_date IS NOT NULL AND q.proposed_first_due_date >= DATE(a.created_at)
              THEN q.proposed_first_due_date
            ELSE DATE_ADD(DATE(a.created_at), INTERVAL 30 DAY)
          END,
          INTERVAL GREATEST(s.sequence_number - 1, 0) * GREATEST(
            COALESCE(a.payment_interval_days,
              CASE a.payment_frequency WHEN 'weekly' THEN 7 WHEN 'fortnightly' THEN 14 ELSE 30 END
            ), 1
          ) DAY
        )
      END,
      s.updated_at = NOW()
      WHERE s.due_date < DATE(a.created_at)
    `);

    await connection.query(`
      UPDATE equipment_sale_agreements a
      SET a.first_due_date = (
            SELECT MIN(s.due_date) FROM equipment_installment_schedule s
            WHERE s.agreement_id = a.id AND s.schedule_status <> 'rescheduled'
          ),
          a.next_due_date = (
            SELECT MIN(s.due_date) FROM equipment_installment_schedule s
            WHERE s.agreement_id = a.id
              AND s.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
              AND GREATEST(s.scheduled_amount - COALESCE((
                SELECT SUM(al.allocated_amount)
                FROM equipment_sale_payment_allocations al
                INNER JOIN equipment_sale_payments p ON p.id = al.payment_id
                WHERE al.schedule_id = s.id AND p.is_voided = FALSE
              ), 0), 0) > 0.009
          ),
          a.final_due_date = (
            SELECT MAX(s.due_date) FROM equipment_installment_schedule s
            WHERE s.agreement_id = a.id AND s.schedule_status <> 'rescheduled'
          ),
          a.updated_at = NOW()
      WHERE a.sale_type = 'installment'
        AND a.activation_source = 'approved_credit_application'
    `);

    console.log(`Finance schedule truth repair V4 completed on ${db.database_name}.`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Finance schedule truth repair V4 failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };
