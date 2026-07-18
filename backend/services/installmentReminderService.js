const { refreshBranchAgreements } = require("./installmentService");
const { pool } = require("../config/db");
const { getSmsConfig, normalizeGhanaPhone, sendSms } = require("./smsService");

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 12000);
  } catch {
    return null;
  }
}

function reminderTypeForRow(row, today) {
  if (row.due_date < today) return "overdue";
  if (row.due_date === today) return "due_today";
  return "due_soon";
}

function dayDifference(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function overdueReminderDays(value) {
  return new Set(
    String(value || "1,3,7")
      .split(",")
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isInteger(item) && item > 0 && item <= 365)
  );
}

function shouldSendScheduledReminder(row, today) {
  const type = reminderTypeForRow(row, today);
  const daysUntilDue = dayDifference(today, row.due_date);

  if (type === "due_today") return true;

  if (type === "due_soon") {
    return daysUntilDue === Math.max(Number(row.reminder_days_before || 0), 0);
  }

  const daysOverdue = Math.abs(daysUntilDue);
  return overdueReminderDays(row.overdue_reminder_days).has(daysOverdue);
}

function buildReminderMessage(row, type) {
  const remaining = Math.max(
    Number(row.scheduled_amount || 0) +
      Number(row.late_charge_amount || 0) -
      Number(row.waived_charge_amount || 0) -
      Number(row.amount_paid || 0),
    0
  );

  if (type === "overdue") {
    return `CHALIN03: ${row.customer_name}, payment of GHS ${remaining.toFixed(
      2
    )} on installment ${row.agreement_number} was due ${row.due_date}. Outstanding balance is GHS ${Number(
      row.outstanding_balance || 0
    ).toFixed(2)}. Please contact us.`;
  }

  if (type === "due_today") {
    return `CHALIN03: ${row.customer_name}, installment payment GHS ${remaining.toFixed(
      2
    )} for ${row.agreement_number} is due today. Outstanding balance is GHS ${Number(
      row.outstanding_balance || 0
    ).toFixed(2)}. Thank you.`;
  }

  return `CHALIN03: ${row.customer_name}, installment payment GHS ${remaining.toFixed(
    2
  )} for ${row.agreement_number} is due ${row.due_date}. Outstanding balance is GHS ${Number(
    row.outstanding_balance || 0
  ).toFixed(2)}. Thank you.`;
}

async function writeSmsLog(connection, {
  branchId,
  phone,
  message,
  sourceReference,
  result,
  errorMessage,
}) {
  const status = result?.status || "failed";
  const [insert] = await connection.query(
    `INSERT INTO sms_log (
      branch_id, recipient_phone, message, sms_type, status,
      provider, sender_id, provider_message_id, provider_status,
      status_reason, segment_count, estimated_credits,
      source_reference, provider_response, sent_by,
      sent_at, submitted_at, last_status_at
    ) VALUES (?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NOW())`,
    [
      branchId,
      phone,
      message,
      status,
      result?.provider || getSmsConfig().provider || null,
      result?.senderId || getSmsConfig().senderId || null,
      result?.providerMessageId || null,
      result?.providerStatus || null,
      errorMessage || null,
      Math.max(Number(result?.segmentCount || 1), 1),
      Math.max(Number(result?.estimatedCredits || 1), 0),
      sourceReference,
      safeJson(result?.providerResponse || { error: errorMessage }),
      result?.submittedAt ? new Date(result.submittedAt) : null,
      result?.submittedAt ? new Date(result.submittedAt) : null,
    ]
  );

  return insert.insertId;
}

async function sendScheduledReminder(connection, row, type, runDate) {
  const phone = normalizeGhanaPhone(row.customer_phone);
  if (!phone) {
    return { sent: false, skipped: true, reason: "invalid_phone" };
  }

  const reminderKey = `${row.agreement_id}:${row.schedule_id}:${type}:${runDate}`;
  const message = buildReminderMessage(row, type);

  const [claim] = await connection.query(
    `INSERT IGNORE INTO installment_reminder_log (
      branch_id, agreement_id, schedule_id, reminder_key,
      reminder_type, recipient_phone, delivery_status,
      message_preview, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NOW())`,
    [
      row.branch_id,
      row.agreement_id,
      row.schedule_id,
      reminderKey,
      type,
      phone,
      message.slice(0, 500),
    ]
  );

  if (!claim.affectedRows) {
    return { sent: false, skipped: true, reason: "already_processed" };
  }

  let result = null;
  let errorMessage = null;

  try {
    result = await sendSms({ to: phone, message });
  } catch (error) {
    errorMessage = error.message;
  }

  const smsLogId = await writeSmsLog(connection, {
    branchId: row.branch_id,
    phone,
    message,
    sourceReference: `installment:${row.agreement_id}:${type}:${runDate}`,
    result,
    errorMessage,
  });
  const deliveryStatus = result?.status || "failed";

  await connection.query(
    `UPDATE installment_reminder_log
     SET sms_log_id = ?,
         delivery_status = ?,
         sent_at = ?
     WHERE reminder_key = ?`,
    [
      smsLogId,
      deliveryStatus,
      result?.submittedAt ? new Date(result.submittedAt) : null,
      reminderKey,
    ]
  );

  return {
    sent: Boolean(result?.success),
    skipped: false,
    delivery_status: deliveryStatus,
    reason: errorMessage,
  };
}

async function runInstallmentReminderSync({ branchId = null } = {}) {
  const connection = await pool.getConnection();
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (Number.isInteger(Number(branchId)) && Number(branchId) > 0) {
      await refreshBranchAgreements(connection, Number(branchId));
    } else {
      const [branches] = await connection.query(
        `SELECT id FROM branches ORDER BY id LIMIT 100`
      );
      for (const branch of branches) {
        await refreshBranchAgreements(connection, Number(branch.id));
      }
    }

    const params = [];
    let branchFilter = "";

    if (Number.isInteger(Number(branchId)) && Number(branchId) > 0) {
      branchFilter = "AND ia.branch_id = ?";
      params.push(Number(branchId));
    }

    const [rows] = await connection.query(
      `SELECT
        ia.id AS agreement_id,
        ia.branch_id,
        ia.agreement_number,
        ia.customer_name,
        ia.customer_phone,
        ia.outstanding_balance,
        sc.id AS schedule_id,
        sc.due_date,
        sc.scheduled_amount,
        sc.amount_paid,
        sc.late_charge_amount,
        sc.waived_charge_amount,
        settings.reminder_days_before,
        settings.overdue_reminder_days
       FROM installment_agreements ia
       INNER JOIN installment_schedule sc
         ON sc.agreement_id = ia.id
        AND sc.schedule_status NOT IN ('paid','cancelled','waived')
       INNER JOIN installment_settings settings
         ON settings.branch_id = ia.branch_id
        AND settings.sms_reminders_enabled = 1
       WHERE ia.agreement_status IN ('active','due_soon','payment_due','overdue')
         ${branchFilter}
         AND sc.due_date <= DATE_ADD(CURRENT_DATE, INTERVAL settings.reminder_days_before DAY)
       ORDER BY sc.due_date, ia.id, sc.sequence_number
       LIMIT 500`,
      params
    );

    const result = {
      checked: rows.length,
      sent: 0,
      failed: 0,
      skipped: 0,
    };

    for (const row of rows) {
      if (!shouldSendScheduledReminder(row, today)) {
        result.skipped += 1;
        continue;
      }

      const type = reminderTypeForRow(row, today);
      const sendResult = await sendScheduledReminder(connection, row, type, today);
      if (sendResult.skipped) result.skipped += 1;
      else if (sendResult.sent) result.sent += 1;
      else result.failed += 1;
    }

    return result;
  } finally {
    connection.release();
  }
}

let scheduler = null;

function startInstallmentReminderScheduler() {
  const enabled =
    String(process.env.INSTALLMENT_SMS_REMINDERS_ENABLED || "false")
      .trim()
      .toLowerCase() === "true";

  if (!enabled || scheduler) return;

  const intervalMinutes = Math.max(
    60,
    Number(process.env.INSTALLMENT_REMINDER_INTERVAL_MINUTES || 180)
  );

  const execute = async () => {
    try {
      const result = await runInstallmentReminderSync();
      console.log(
        `Installment reminder sync: checked ${result.checked}, sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}.`
      );
    } catch (error) {
      console.error("Installment reminder sync failed:", error.message);
    }
  };

  scheduler = setInterval(execute, intervalMinutes * 60 * 1000);
  scheduler.unref?.();
  setTimeout(execute, 30 * 1000).unref?.();
}

function buildEventMessage(agreement, type, details = {}) {
  const name = agreement.customer_name || "Customer";
  const number = agreement.agreement_number;
  const outstanding = Number(
    details.outstanding_balance ?? agreement.outstanding_balance ?? 0
  ).toFixed(2);

  if (type === "agreement_created") {
    return `CHALIN03: ${name}, installment agreement ${number} was created. Deposit GHS ${Number(
      agreement.deposit_amount || 0
    ).toFixed(2)}. Balance GHS ${outstanding}. First payment is due ${
      agreement.first_due_date
    }. Thank you.`;
  }

  if (type === "payment_receipt") {
    return `CHALIN03: ${name}, payment GHS ${Number(details.amount || 0).toFixed(
      2
    )} received for ${number}. Receipt ${details.receipt_number || "-"}. Remaining balance GHS ${outstanding}. Thank you.`;
  }

  if (type === "completed") {
    return `CHALIN03: ${name}, installment agreement ${number} is fully paid. Receipt ${
      details.receipt_number || "-"
    }. Thank you for completing your payments.`;
  }

  if (type === "rescheduled") {
    return `CHALIN03: ${name}, installment ${number} was rescheduled. Next payment is due ${
      details.next_due_date || agreement.next_due_date || "-"
    }. Outstanding balance GHS ${outstanding}.`;
  }

  return buildReminderMessage(
    {
      ...agreement,
      scheduled_amount: details.scheduled_amount || agreement.outstanding_balance,
      amount_paid: 0,
      late_charge_amount: 0,
      waived_charge_amount: 0,
      due_date: details.due_date || agreement.next_due_date,
    },
    type
  );
}

async function sendInstallmentEventSms({
  agreementId,
  branchId,
  type,
  details = {},
  sentBy = null,
}) {
  const [[agreement]] = await pool.query(
    `SELECT * FROM installment_agreements
     WHERE id = ? AND branch_id = ?
     LIMIT 1`,
    [agreementId, branchId]
  );

  if (!agreement) {
    throw new Error("Installment agreement was not found for SMS.");
  }

  const phone = normalizeGhanaPhone(agreement.customer_phone);
  if (!phone) {
    throw new Error("Customer phone number is not valid for SMS.");
  }

  const message = buildEventMessage(agreement, type, details);
  const reminderKey = `${type}:${agreementId}:${
    details.receipt_number || details.event_key || Date.now()
  }`;

  const [claim] = await pool.query(
    `INSERT IGNORE INTO installment_reminder_log (
      branch_id, agreement_id, schedule_id, reminder_key,
      reminder_type, recipient_phone, delivery_status,
      message_preview, sent_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW())`,
    [
      branchId,
      agreementId,
      details.schedule_id || null,
      reminderKey,
      type,
      phone,
      message.slice(0, 500),
      sentBy,
    ]
  );

  if (!claim.affectedRows) {
    return {
      success: true,
      skipped: true,
      status: "already_recorded",
      message,
    };
  }

  let result = null;
  let errorMessage = null;

  try {
    result = await sendSms({ to: phone, message });
  } catch (error) {
    errorMessage = error.message;
  }

  const connection = await pool.getConnection();

  try {
    const smsLogId = await writeSmsLog(connection, {
      branchId,
      phone,
      message,
      sourceReference: `installment:${agreementId}:${type}`,
      result,
      errorMessage,
    });
    const deliveryStatus = result?.status || "failed";

    await connection.query(
      `UPDATE installment_reminder_log
       SET sms_log_id = ?,
           delivery_status = ?,
           sent_at = ?
       WHERE reminder_key = ?`,
      [
        smsLogId,
        deliveryStatus,
        result?.submittedAt ? new Date(result.submittedAt) : null,
        reminderKey,
      ]
    );

    return {
      success: Boolean(result?.success),
      skipped: false,
      status: deliveryStatus,
      provider_status: result?.providerStatus || null,
      sms_log_id: smsLogId,
      error: errorMessage,
      message,
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  buildEventMessage,
  buildReminderMessage,
  runInstallmentReminderSync,
  sendInstallmentEventSms,
  startInstallmentReminderScheduler,
};
