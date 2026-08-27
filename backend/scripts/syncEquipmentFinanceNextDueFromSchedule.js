const mysql = require("mysql2/promise");
require("dotenv").config();

function required(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!String(value || "").trim()) throw new Error(`Missing required database variable ${name}.`);
  return value;
}

function dbOptions() {
  return {
    host: required("DB_HOST", "MYSQLHOST"),
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: required("DB_USER", "MYSQLUSER"),
    password: required("DB_PASSWORD", "MYSQLPASSWORD"),
    database: required("DB_NAME", "MYSQLDATABASE"),
    timezone: "Z",
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 15000),
  };
}

const LOCK_NAME = "chalin03:equipment-finance:sync-next-due-from-schedule-v1";

async function main() {
  const connection = await mysql.createConnection(dbOptions());
  let locked = false;
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS database_name");
    const databaseName = String(identity?.database_name || "").trim();
    const expected = String(
      process.env.CHALIN03_EXPECTED_DATABASE || process.env.DB_NAME || process.env.MYSQLDATABASE || ""
    ).trim();
    if (!databaseName || databaseName !== expected) {
      throw new Error(`Finance next-due repair refused for database ${databaseName || "(unknown)"}.`);
    }

    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [LOCK_NAME]);
    locked = Number(lockRow?.acquired || 0) === 1;
    if (!locked) throw new Error("Could not acquire the Finance next-due synchronization lock.");

    await connection.beginTransaction();

    const [result] = await connection.query(
      `UPDATE equipment_sale_agreements agreement
       INNER JOIN (
         SELECT agreement_id,
                MIN(due_date) AS next_due_date
           FROM equipment_installment_schedule
          WHERE schedule_status IN ('upcoming','due','partial','overdue')
            AND due_date IS NOT NULL
            AND due_date >= (
              SELECT DATE(parent.created_at)
                FROM equipment_sale_agreements parent
               WHERE parent.id = equipment_installment_schedule.agreement_id
            )
          GROUP BY agreement_id
       ) next_schedule ON next_schedule.agreement_id = agreement.id
          SET agreement.next_due_date = next_schedule.next_due_date,
              agreement.updated_at = NOW()
        WHERE agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
          AND (agreement.next_due_date IS NULL OR agreement.next_due_date <> next_schedule.next_due_date)`
    );

    const [[impossible]] = await connection.query(
      `SELECT COUNT(*) AS count
         FROM equipment_sale_agreements agreement
         INNER JOIN equipment_installment_schedule schedule
           ON schedule.agreement_id = agreement.id
        WHERE agreement.sale_type = 'installment'
          AND agreement.activation_source = 'approved_credit_application'
          AND schedule.schedule_status IN ('upcoming','due','partial','overdue')
          AND schedule.due_date IS NOT NULL
          AND schedule.due_date >= DATE(agreement.created_at)
          AND agreement.next_due_date <> (
              SELECT MIN(valid_schedule.due_date)
                FROM equipment_installment_schedule valid_schedule
               WHERE valid_schedule.agreement_id = agreement.id
                 AND valid_schedule.schedule_status IN ('upcoming','due','partial','overdue')
                 AND valid_schedule.due_date IS NOT NULL
                 AND valid_schedule.due_date >= DATE(agreement.created_at)
          )`
    );

    if (Number(impossible?.count || 0) !== 0) {
      throw new Error(`Finance next-due verification failed: ${JSON.stringify(impossible)}`);
    }

    await connection.commit();
    console.log(JSON.stringify({
      verified: true,
      database_name: databaseName,
      agreements_updated: result.affectedRows,
    }, null, 2));
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    if (locked) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error("Finance next-due schedule synchronization failed.");
  console.error(error.stack || error.message);
  process.exit(1);
});
