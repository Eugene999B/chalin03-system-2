const mysql = require("mysql2/promise");
require("dotenv").config();

const LOCK_NAME = "chalin03:equipment-finance:date-evidence-repair-v3";

function required(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${name}.`);
  return value;
}

function dbOptions() {
  const ssl = String(process.env.DB_SSL || "").trim().toLowerCase() === "true"
    ? { rejectUnauthorized: !["0", "false", "no", "off"].includes(String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").trim().toLowerCase()) }
    : undefined;
  return {
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    ssl,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
    timezone: "Z",
  };
}

function dateText(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000-")) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function addMonths(value, months) {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(months || 0), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function scheduleDate(baseDate, frequency, intervalDays, sequence) {
  const index = Math.max(0, Number(sequence || 1) - 1);
  if (frequency === "weekly") return addDays(baseDate, index * 7);
  if (frequency === "fortnightly") return addDays(baseDate, index * 14);
  if (frequency === "custom") return addDays(baseDate, index * Math.max(1, Number(intervalDays || 30)));
  return addMonths(baseDate, index);
}

async function main() {
  const connection = await mysql.createConnection(dbOptions());
  let locked = false;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || "").trim();
    if (!databaseName || databaseName !== expected) throw new Error(`Finance date repair refused for database ${databaseName || "(unknown)"}.`);

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire the Finance date-evidence repair lock.");

    const [agreements] = await connection.query(
      `SELECT agreement.id,
              CAST(agreement.created_at AS CHAR) AS created_at_text,
              CAST(agreement.first_due_date AS CHAR) AS first_due_text,
              CAST(agreement.next_due_date AS CHAR) AS next_due_text,
              CAST(agreement.final_due_date AS CHAR) AS final_due_text,
              agreement.payment_frequency,
              agreement.payment_interval_days,
              CAST(quotation.proposed_first_due_date AS CHAR) AS quotation_first_due_text
         FROM equipment_sale_agreements agreement
         LEFT JOIN equipment_sales_quotations quotation ON quotation.id = agreement.quotation_id
        WHERE agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'`
    );

    let repairedAgreements = 0;
    let repairedScheduleRows = 0;

    for (const agreement of agreements) {
      const createdDate = dateText(agreement.created_at_text);
      if (!createdDate) continue;
      const quotationFirst = dateText(agreement.quotation_first_due_text);
      const storedFirst = dateText(agreement.first_due_text);
      const baseDate = quotationFirst && quotationFirst >= createdDate
        ? quotationFirst
        : storedFirst && storedFirst >= createdDate
          ? storedFirst
          : addDays(createdDate, 30);

      const [scheduleRows] = await connection.query(
        `SELECT id, sequence_number, schedule_status, CAST(due_date AS CHAR) AS due_date_text
           FROM equipment_installment_schedule
          WHERE agreement_id = ?
          ORDER BY sequence_number, id`,
        [agreement.id]
      );
      const activeSchedule = scheduleRows.filter((row) => String(row.schedule_status || "") !== "rescheduled");
      const badSchedule = activeSchedule.some((row) => {
        const due = dateText(row.due_date_text);
        return !due || due < createdDate;
      });

      if (badSchedule) {
        for (const row of activeSchedule) {
          const due = dateText(row.due_date_text);
          if (!due || due < createdDate) {
            const repairedDue = scheduleDate(baseDate, String(agreement.payment_frequency || "monthly"), agreement.payment_interval_days, row.sequence_number);
            await connection.query("UPDATE equipment_installment_schedule SET due_date = ? WHERE id = ?", [repairedDue, row.id]);
            repairedScheduleRows += 1;
          }
        }
      }

      const [evidenceRows] = await connection.query(
        `SELECT MIN(CASE WHEN schedule_status <> 'rescheduled' THEN due_date END) AS first_schedule_due_date,
                MAX(CASE WHEN schedule_status <> 'rescheduled' THEN due_date END) AS final_schedule_due_date,
                MIN(CASE WHEN schedule_status IN ('upcoming','due','partial','overdue') THEN due_date END) AS next_schedule_due_date
           FROM equipment_installment_schedule
          WHERE agreement_id = ?`,
        [agreement.id]
      );
      const evidence = evidenceRows[0] || {};
      const firstDue = dateText(evidence.first_schedule_due_date) || baseDate;
      const finalDue = dateText(evidence.final_schedule_due_date) || firstDue;
      const nextDue = dateText(evidence.next_schedule_due_date);
      const currentFirst = dateText(agreement.first_due_text);
      const currentNext = dateText(agreement.next_due_text);
      const currentFinal = dateText(agreement.final_due_text);

      if (badSchedule || currentFirst !== firstDue || currentNext !== nextDue || currentFinal !== finalDue) {
        await connection.query(
          `UPDATE equipment_sale_agreements
              SET first_due_date = ?,
                  next_due_date = ?,
                  final_due_date = ?,
                  updated_at = NOW()
            WHERE id = ?`,
          [firstDue, nextDue, finalDue, agreement.id]
        );
        repairedAgreements += 1;
      }
    }

    const [[verify]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM equipment_sale_agreements
           WHERE activation_source = 'approved_credit_application'
             AND sale_type = 'installment'
             AND first_due_date IS NOT NULL
             AND CAST(first_due_date AS CHAR) < CAST(DATE(created_at) AS CHAR)) AS impossible_first_dates,
         (SELECT COUNT(*) FROM equipment_installment_schedule schedule
           INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
           WHERE agreement.activation_source = 'approved_credit_application'
             AND agreement.sale_type = 'installment'
             AND schedule.schedule_status <> 'rescheduled'
             AND schedule.due_date IS NOT NULL
             AND CAST(schedule.due_date AS CHAR) < CAST(DATE(agreement.created_at) AS CHAR)) AS impossible_schedule_dates`
    );
    if (Number(verify?.impossible_first_dates || 0) !== 0 || Number(verify?.impossible_schedule_dates || 0) !== 0) {
      throw new Error(`Finance date-evidence verification failed: ${JSON.stringify(verify)}`);
    }

    console.log(JSON.stringify({ verified: true, database_name: databaseName, repaired_agreements: repairedAgreements, repaired_schedule_rows: repairedScheduleRows }, null, 2));
  } finally {
    if (locked) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Finance date-evidence repair V3 failed.");
  console.error(error.stack || error.message);
  process.exit(1);
});
