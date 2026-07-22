const { pool } = require("../config/db");
const { getSmsConfig } = require("./smsService");
const { sendSmsAlertToPhone } = require("./smsAlertService");

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function toDateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dayDifference(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function overdueReminderDays() {
  return new Set(
    String(process.env.EQUIPMENT_SALES_OVERDUE_REMINDER_DAYS || "1,3,7,14,30")
      .split(",")
      .map((value) => Number(String(value).trim()))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 365)
  );
}

function reminderDaysBefore() {
  return Math.max(
    0,
    Math.min(Number(process.env.EQUIPMENT_SALES_REMINDER_DAYS_BEFORE || 3), 30)
  );
}

function reminderType(row, today) {
  const difference = dayDifference(today, row.due_date);
  if (difference < 0) return "overdue";
  if (difference === 0) return "due_today";
  return "due_soon";
}

function shouldSend(row, today) {
  const type = reminderType(row, today);
  const difference = dayDifference(today, row.due_date);

  if (type === "due_today") return true;
  if (type === "due_soon") return difference === reminderDaysBefore();
  return overdueReminderDays().has(Math.abs(difference));
}

function remainingLineAmount(row) {
  return Math.max(
    Number(row.scheduled_amount || 0) +
      Number(row.late_charge_amount || 0) -
      Number(row.waived_charge_amount || 0) -
      Number(row.amount_paid || 0),
    0
  );
}

function buildMessage(row, type) {
  const name = cleanText(row.customer_name, 80) || "Customer";
  const equipment = cleanText(
    [row.asset_code, row.asset_name].filter(Boolean).join(" - "),
    120
  );
  const dueAmount = remainingLineAmount(row).toFixed(2);
  const balance = Number(row.outstanding_balance || 0).toFixed(2);

  if (type === "overdue") {
    return `CHALIN03: ${name}, GHS ${dueAmount} for ${row.agreement_number} (${equipment}) was due ${row.due_date}. Outstanding balance: GHS ${balance}. Please contact Equipment Sales & Hire.`;
  }

  if (type === "due_today") {
    return `CHALIN03: ${name}, GHS ${dueAmount} for ${row.agreement_number} (${equipment}) is due today. Outstanding balance: GHS ${balance}. Thank you.`;
  }

  return `CHALIN03: ${name}, GHS ${dueAmount} for ${row.agreement_number} (${equipment}) is due ${row.due_date}. Outstanding balance: GHS ${balance}. Thank you.`;
}

async function refreshEquipmentInstallmentStatuses(connection) {
  await connection.query(
    `UPDATE equipment_installment_schedule
     SET schedule_status = CASE
       WHEN schedule_status IN ('cancelled','waived') THEN schedule_status
       WHEN amount_paid + 0.01 >= scheduled_amount + late_charge_amount - waived_charge_amount THEN 'paid'
       WHEN due_date < CURDATE() THEN 'overdue'
       WHEN due_date = CURDATE() THEN 'due'
       WHEN amount_paid > 0 THEN 'partial'
       ELSE 'upcoming'
     END,
     fully_paid_at = CASE
       WHEN amount_paid + 0.01 >= scheduled_amount + late_charge_amount - waived_charge_amount
       THEN COALESCE(fully_paid_at, NOW())
       ELSE fully_paid_at
     END`
  );

  await connection.query(
    `UPDATE equipment_sale_agreements esa
     LEFT JOIN (
       SELECT
         agreement_id,
         MIN(CASE WHEN schedule_status NOT IN ('paid','cancelled','waived') THEN due_date END) AS next_due_date,
         MAX(due_date) AS final_due_date,
         COALESCE(SUM(CASE WHEN schedule_status = 'overdue'
           THEN GREATEST(scheduled_amount + late_charge_amount - waived_charge_amount - amount_paid, 0)
           ELSE 0 END), 0) AS overdue_amount,
         SUM(schedule_status = 'overdue') AS overdue_lines
       FROM equipment_installment_schedule
       GROUP BY agreement_id
     ) schedule_summary ON schedule_summary.agreement_id = esa.id
     SET esa.next_due_date = schedule_summary.next_due_date,
         esa.final_due_date = COALESCE(schedule_summary.final_due_date, esa.final_due_date),
         esa.overdue_amount = COALESCE(schedule_summary.overdue_amount, 0),
         esa.agreement_status = CASE
           WHEN esa.agreement_status IN ('cancelled','defaulted') THEN esa.agreement_status
           WHEN esa.outstanding_balance <= 0.01 THEN 'completed'
           WHEN COALESCE(schedule_summary.overdue_lines, 0) > 0 THEN 'overdue'
           WHEN schedule_summary.next_due_date = CURDATE() THEN 'payment_due'
           WHEN schedule_summary.next_due_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY) THEN 'due_soon'
           WHEN esa.sale_type = 'installment' THEN 'active'
           ELSE esa.agreement_status
         END
     WHERE esa.sale_type = 'installment'
       AND esa.agreement_status NOT IN ('cancelled','defaulted')`
  );
}

async function claimReminder(connection, row, type, runDate, message) {
  const reminderKey = `${row.agreement_id}:${row.schedule_id}:${type}:${runDate}`;
  const [result] = await connection.query(
    `INSERT IGNORE INTO equipment_sales_reminder_log (
       hire_location_id, agreement_id, schedule_id, reminder_key,
       reminder_type, recipient_phone, delivery_status,
       message_preview, sent_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NOW())`,
    [
      row.hire_location_id,
      row.agreement_id,
      row.schedule_id,
      reminderKey,
      type,
      row.customer_phone,
      message.slice(0, 500),
    ]
  );

  return {
    claimed: Boolean(result.affectedRows),
    reminderKey,
  };
}

async function sendClaimedReminder(connection, row, type, runDate, reminderKey, message) {
  let result;
  let failureMessage = null;

  try {
    result = await sendSmsAlertToPhone({
      branchId: 1,
      phone: row.customer_phone,
      message,
      logMessage: message,
      smsType: "equipment_sales",
      sentBy: null,
      sourceReference: `equipment-sale:${row.agreement_id}:${row.schedule_id}:${type}:${runDate}`,
    });
  } catch (error) {
    failureMessage = error.message;
    result = { ok: false, status: "failed", message: error.message };
  }

  const deliveryStatus = cleanText(
    result?.status || (result?.ok ? "accepted" : "failed"),
    40
  );

  await connection.query(
    `UPDATE equipment_sales_reminder_log
     SET sms_log_id = ?,
         delivery_status = ?,
         sent_at = CASE WHEN ? IN ('accepted','sent','delivered','success') THEN NOW() ELSE sent_at END,
         message_preview = ?
     WHERE reminder_key = ?`,
    [
      result?.log_id || null,
      deliveryStatus,
      deliveryStatus,
      `${message}${failureMessage ? ` | ${failureMessage}` : ""}`.slice(0, 500),
      reminderKey,
    ]
  );

  if (result?.log_id) {
    await connection.query(
      `UPDATE sms_log
       SET workspace_code = 'equipment_hire',
           hire_location_id = ?,
           entity_type = 'equipment_sale_agreement',
           entity_id = ?,
           template_code = ?,
           deduplication_key = ?
       WHERE id = ?`,
      [
        row.hire_location_id,
        String(row.agreement_id),
        type,
        reminderKey,
        result.log_id,
      ]
    );
  }

  return {
    sent: Boolean(result?.ok || result?.success),
    status: deliveryStatus,
    failureMessage,
  };
}

async function runEquipmentSalesReminderSync() {
  const config = getSmsConfig();
  if (!config.enabled) {
    return { checked: 0, sent: 0, failed: 0, skipped: 0, disabled: true };
  }

  const connection = await pool.getConnection();
  const today = toDateOnly();

  try {
    await refreshEquipmentInstallmentStatuses(connection);

    const [rows] = await connection.query(
      `SELECT
         esa.id AS agreement_id,
         esa.hire_location_id,
         esa.agreement_number,
         esa.outstanding_balance,
         esa.asset_code_snapshot AS asset_code,
         esa.asset_name_snapshot AS asset_name,
         esa.customer_name_snapshot AS customer_name,
         esa.customer_phone_snapshot AS customer_phone,
         eis.id AS schedule_id,
         eis.due_date,
         eis.scheduled_amount,
         eis.amount_paid,
         eis.late_charge_amount,
         eis.waived_charge_amount
       FROM equipment_sale_agreements esa
       INNER JOIN equipment_installment_schedule eis
         ON eis.agreement_id = esa.id
        AND eis.schedule_status NOT IN ('paid','cancelled','waived')
       WHERE esa.sale_type = 'installment'
         AND esa.agreement_status IN ('active','due_soon','payment_due','overdue')
         AND esa.outstanding_balance > 0.01
         AND eis.due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY eis.due_date, esa.id, eis.sequence_number
       LIMIT 500`,
      [reminderDaysBefore()]
    );

    const summary = { checked: rows.length, sent: 0, failed: 0, skipped: 0 };

    for (const row of rows) {
      if (!row.customer_phone || !shouldSend(row, today)) {
        summary.skipped += 1;
        continue;
      }

      const type = reminderType(row, today);
      const message = buildMessage(row, type);
      const claim = await claimReminder(connection, row, type, today, message);

      if (!claim.claimed) {
        summary.skipped += 1;
        continue;
      }

      const sendResult = await sendClaimedReminder(
        connection,
        row,
        type,
        today,
        claim.reminderKey,
        message
      );

      if (sendResult.sent) summary.sent += 1;
      else summary.failed += 1;
    }

    return summary;
  } finally {
    connection.release();
  }
}

let scheduler = null;

function startEquipmentSalesReminderScheduler() {
  const explicitlyDisabled =
    String(process.env.EQUIPMENT_SALES_SMS_REMINDERS_ENABLED || "true")
      .trim()
      .toLowerCase() === "false";

  if (explicitlyDisabled || scheduler) return;

  const intervalMinutes = Math.max(
    60,
    Number(process.env.EQUIPMENT_SALES_REMINDER_INTERVAL_MINUTES || 180)
  );

  const execute = async () => {
    try {
      const result = await runEquipmentSalesReminderSync();
      if (!result.disabled) {
        console.log(
          `Equipment Sales reminder sync: checked ${result.checked}, sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}.`
        );
      }
    } catch (error) {
      console.error("Equipment Sales reminder sync failed:", error.message);
    }
  };

  scheduler = setInterval(execute, intervalMinutes * 60 * 1000);
  scheduler.unref?.();
  setTimeout(execute, 45 * 1000).unref?.();
}

module.exports = {
  buildMessage,
  refreshEquipmentInstallmentStatuses,
  runEquipmentSalesReminderSync,
  startEquipmentSalesReminderScheduler,
};
