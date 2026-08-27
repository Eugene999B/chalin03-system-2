const mysql = require("mysql2/promise");
require("dotenv").config();

function requiredEnv(primary, fallback) {
  const value = process.env[primary] || process.env[fallback];
  if (!String(value || "").trim()) {
    throw new Error(`Missing ${primary}${fallback ? ` or ${fallback}` : ""}.`);
  }
  return value;
}

function options() {
  return {
    host: requiredEnv("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: requiredEnv("DB_USER", "MYSQLUSER"),
    password: requiredEnv("DB_PASSWORD", "MYSQLPASSWORD"),
    database: requiredEnv("DB_NAME", "MYSQLDATABASE"),
    ssl:
      String(process.env.DB_SSL || "").trim().toLowerCase() === "true"
        ? { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) }
        : undefined,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    multipleStatements: false,
    timezone: "Z",
  };
}

function intervalExpression(alias = "a") {
  return `GREATEST(CASE ${alias}.payment_frequency
    WHEN 'weekly' THEN 7
    WHEN 'fortnightly' THEN 14
    WHEN 'monthly' THEN 30
    ELSE COALESCE(${alias}.payment_interval_days, 30)
  END, 1)`;
}

async function main() {
  const connection = await mysql.createConnection(options());
  try {
    const [[db]] = await connection.query("SELECT DATABASE() AS database_name");
    if (!db?.database_name) throw new Error("No production database is selected.");

    const [candidates] = await connection.query(`
      SELECT
        a.id AS agreement_id,
        a.created_at,
        a.outstanding_balance,
        a.payment_frequency,
        a.payment_interval_days,
        a.next_due_date AS stored_next_due_date,
        MAX(s.due_date) AS last_schedule_due_date,
        MAX(s.sequence_number) AS last_sequence_number,
        COUNT(s.id) AS schedule_count,
        SUM(
          CASE
            WHEN s.schedule_status NOT IN ('cancelled','waived','rescheduled')
             AND GREATEST(
               s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
                 - COALESCE(x.allocated_amount, 0),
               0
             ) > 0.009
            THEN 1 ELSE 0
          END
        ) AS open_schedule_count
      FROM equipment_sale_agreements a
      LEFT JOIN equipment_installment_schedule s
        ON s.agreement_id = a.id
      LEFT JOIN (
        SELECT
          al.schedule_id,
          SUM(al.allocated_amount) AS allocated_amount
        FROM equipment_sale_payment_allocations al
        INNER JOIN equipment_sale_payments p ON p.id = al.payment_id
        WHERE p.is_voided = FALSE
        GROUP BY al.schedule_id
      ) x ON x.schedule_id = s.id
      WHERE a.sale_type = 'installment'
        AND a.activation_source = 'approved_credit_application'
        AND COALESCE(a.outstanding_balance, 0) > 0.009
      GROUP BY
        a.id, a.created_at, a.outstanding_balance, a.payment_frequency,
        a.payment_interval_days, a.next_due_date
      HAVING COALESCE(open_schedule_count, 0) = 0
    `);

    let repaired = 0;
    for (const candidate of candidates) {
      const [[existing]] = await connection.query(
        `SELECT id
         FROM equipment_installment_schedule
         WHERE agreement_id = ?
           AND scheduled_amount > 0.009
           AND schedule_status NOT IN ('cancelled','waived','rescheduled')
         ORDER BY sequence_number DESC, id DESC
         LIMIT 1`,
        [candidate.agreement_id]
      );
      if (existing) continue;

      const nextSequence = Number(candidate.last_sequence_number || 0) + 1;
      let dueDate;
      if (candidate.last_schedule_due_date) {
        const [[nextDate]] = await connection.query(
          `SELECT DATE_ADD(?, INTERVAL ${intervalExpression("a")} DAY) AS due_date
           FROM equipment_sale_agreements a
           WHERE a.id = ?`,
          [candidate.last_schedule_due_date, candidate.agreement_id]
        );
        dueDate = nextDate?.due_date;
      } else {
        const stored = candidate.stored_next_due_date
          ? String(candidate.stored_next_due_date).slice(0, 10)
          : null;
        const created = candidate.created_at ? String(candidate.created_at).slice(0, 10) : null;
        const saneStored = stored && created && stored >= created ? stored : null;
        const baseDate = saneStored || created;
        const [[nextDate]] = await connection.query(
          `SELECT DATE_ADD(?, INTERVAL ${intervalExpression("a")} DAY) AS due_date
           FROM equipment_sale_agreements a
           WHERE a.id = ?`,
          [baseDate, candidate.agreement_id]
        );
        dueDate = nextDate?.due_date;
      }

      if (!dueDate) {
        throw new Error(`Could not calculate a safe catch-up due date for agreement ${candidate.agreement_id}.`);
      }

      await connection.query(
        `INSERT INTO equipment_installment_schedule (
           agreement_id, sequence_number, due_date, scheduled_amount,
           amount_paid, schedule_status
         ) VALUES (?, ?, ?, ?, 0, CASE
           WHEN DATE(?) < CURDATE() THEN 'overdue'
           WHEN DATE(?) = CURDATE() THEN 'due'
           ELSE 'upcoming'
         END)`,
        [
          candidate.agreement_id,
          nextSequence,
          dueDate,
          Number(Number(candidate.outstanding_balance).toFixed(2)),
          dueDate,
          dueDate,
        ]
      );

      repaired += 1;
    }

    await connection.query(`
      UPDATE equipment_sale_agreements a
      SET a.next_due_date = (
            SELECT MIN(s.due_date)
            FROM equipment_installment_schedule s
            LEFT JOIN (
              SELECT al.schedule_id, SUM(al.allocated_amount) AS allocated_amount
              FROM equipment_sale_payment_allocations al
              INNER JOIN equipment_sale_payments p ON p.id = al.payment_id
              WHERE p.is_voided = FALSE
              GROUP BY al.schedule_id
            ) x ON x.schedule_id = s.id
            WHERE s.agreement_id = a.id
              AND s.schedule_status NOT IN ('cancelled','waived','rescheduled')
              AND GREATEST(
                s.scheduled_amount + s.late_charge_amount - s.waived_charge_amount
                  - COALESCE(x.allocated_amount, 0),
                0
              ) > 0.009
          ),
          a.final_due_date = (
            SELECT MAX(s.due_date)
            FROM equipment_installment_schedule s
            WHERE s.agreement_id = a.id AND s.schedule_status <> 'rescheduled'
          ),
          a.updated_at = NOW()
      WHERE a.sale_type = 'installment'
        AND a.activation_source = 'approved_credit_application'
    `);

    console.log(`Finance schedule catch-up repair V5 completed on ${db.database_name}; repaired ${repaired} agreement(s).`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Finance schedule catch-up repair V5 failed.");
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };
