const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { assertProfessionalSchema, getProfessionalSettings } = require("./equipmentFinanceProfessionalService");
const { applyEligibleLateFees } = require("./equipmentFinanceLateFeeApplicationService");
const {
  agreementLateFeePolicy,
  calculateProspectiveLateFee,
  ghanaToday,
  nextDueFromSchedule,
  describeDueDate,
} = require("./equipmentFinanceAuthoritativePolicyService");

function ghanaDate(value = new Date()) {
  return ghanaToday(value);
}

const SCHEDULER_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.EQUIPMENT_FINANCE_REMINDER_INTERVAL_MS || 60 * 60 * 1000)
);

let schedulerStarted = false;
let schedulerRunning = false;

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function ghanaParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dayDifference(leftDate, rightDate) {
  const left = new Date(`${String(leftDate).slice(0, 10)}T00:00:00Z`);
  const right = new Date(`${String(rightDate).slice(0, 10)}T00:00:00Z`);
  return Math.round((left.getTime() - right.getTime()) / 86400000);
}

function parseDueSoonDays(value) {
  return [...new Set(String(value || "7,3,1").split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0 && item <= 365))].sort((a, b) => b - a);
}

function replaceTemplate(template, values) {
  return String(template || "").replace(/\{([a-z0-9_]+)\}/gi, (_match, key) =>
    values[key] === undefined || values[key] === null ? "" : String(values[key])
  );
}

function money(value) {
  return Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lateFeeMessage(agreement, row) {
  const policy = agreementLateFeePolicy(agreement);
  const fee = calculateProspectiveLateFee({
    agreement,
    overdueBalance: Number(row.line_balance || 0),
    alreadyApplied: Number(row.late_charge_amount || 0),
  });
  if (policy.legacyReviewRequired) return { amount: 0, sentence: "Your account's late-payment policy is awaiting Finance review; no new late fee will be communicated automatically." };
  if (fee <= 0) return { amount: 0, sentence: "No additional late payment fee is due under the agreement policy." };
  return {
    amount: fee,
    sentence: `A late payment fee of GHS ${money(fee)} will be added if this installment remains unpaid after its due date.`,
  };
}

function classifyReminder(row, agreement, settings, today) {
  const dueDate = String(row.due_date || "").slice(0, 10);
  if (!dueDate) return null;
  const daysUntil = dayDifference(dueDate, today);
  const fee = lateFeeMessage(agreement, row);
  if (daysUntil > 0 && parseDueSoonDays(settings.due_soon_days).includes(daysUntil)) {
    if (!Number(settings.customer_due_soon_sms_enabled ?? 1)) return null;
    return { type: "due_soon", days: daysUntil, due_sentence: `GHS ${money(row.line_balance)} is due on ${dueDate}. ${fee.sentence}`, fee };
  }
  if (daysUntil === 0) {
    if (!Number(settings.customer_due_today_sms_enabled ?? 1)) return null;
    return { type: "due_today", days: 0, due_sentence: `GHS ${money(row.line_balance)} is due today. ${fee.sentence}`, fee };
  }
  if (daysUntil < 0) {
    const daysPast = Math.abs(daysUntil);
    const repeat = Math.max(1, Number(settings.overdue_repeat_days || 3));
    if ((daysPast === 1 || daysPast % repeat === 0) && Number(settings.customer_overdue_sms_enabled ?? 1)) {
      return { type: "overdue", days: daysPast, due_sentence: `GHS ${money(row.line_balance)} has been overdue for ${daysPast} day${daysPast === 1 ? "" : "s"}. ${fee.sentence}`, fee };
    }
  }
  return null;
}

async function reminderCandidates({ today = ghanaDate(), limit = 500, applyLateFees = false, sendLateFeeNotifications = true, sentBy = null } = {}) {
  await assertProfessionalSchema();
  if (applyLateFees) {
    await applyEligibleLateFees({ today, sendNotifications: sendLateFeeNotifications, sentBy });
  }
  const settings = await getProfessionalSettings();
  const [rows] = await pool.query(
    `SELECT schedule.id AS schedule_id, schedule.sequence_number, schedule.due_date,
            GREATEST(schedule.scheduled_amount + schedule.late_charge_amount - schedule.waived_charge_amount - schedule.amount_paid, 0) AS line_balance,
            schedule.late_charge_amount, schedule.waived_charge_amount, schedule.amount_paid, schedule.scheduled_amount,
            agreement.*,
            customer.customer_name, customer.phone AS customer_phone,
            asset.asset_name, location.phone AS payment_phone
       FROM equipment_installment_schedule schedule
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = schedule.agreement_id
       INNER JOIN hire_customers customer ON customer.id = agreement.customer_id
       INNER JOIN fleet_assets asset ON asset.id = agreement.asset_id
       LEFT JOIN business_locations location ON location.id = agreement.hire_location_id
      WHERE agreement.sale_type = 'installment'
        AND agreement.activation_source = 'approved_credit_application'
        AND agreement.agreement_status IN ('active','due_soon','payment_due','overdue')
        AND agreement.outstanding_balance > 0.01
        AND schedule.schedule_status NOT IN ('paid','cancelled','waived','rescheduled')
        AND schedule.due_date <= DATE_ADD(?, INTERVAL 365 DAY)
      ORDER BY schedule.due_date, agreement.id, schedule.sequence_number
      LIMIT ?`,
    [today, Math.max(1, Math.min(Number(limit || 500), 1000))]
  );

  const reminders = [];
  for (const row of rows) {
    const classification = classifyReminder(row, row, settings, today);
    if (!classification) continue;
    const customerName = row.customer_name_snapshot || row.customer_name || "Customer";
    const phone = row.customer_phone_snapshot || row.customer_phone || "";
    const equipmentName = row.asset_name_snapshot || row.asset_name || "equipment";
    const message = replaceTemplate(settings.reminder_template, {
      customer_name: customerName,
      agreement_number: row.agreement_number,
      equipment_name: equipmentName,
      outstanding_balance: money(row.outstanding_balance),
      due_sentence: classification.due_sentence,
      due_date: String(row.due_date).slice(0, 10),
      amount_due: money(row.line_balance),
      late_fee_amount: money(classification.fee.amount),
      late_fee_sentence: classification.fee.sentence,
      payment_phone: row.payment_phone || "",
    }).slice(0, 480);

    reminders.push({
      ...row,
      customer_name: customerName,
      customer_phone: phone,
      equipment_name: equipmentName,
      reminder_type: classification.type,
      days: classification.days,
      late_fee_amount: classification.fee.amount,
      late_fee_sentence: classification.fee.sentence,
      message,
      reminder_key: `finance:${row.agreement_id}:${row.schedule_id}:${classification.type}:${today}`,
    });
  }

  return { settings, today, reminders };
}

async function previewProfessionalReminders(options = {}) {
  const result = await reminderCandidates({ ...options, applyLateFees: false, sendLateFeeNotifications: false });
  return {
    today: result.today,
    automatic_sms_enabled: Boolean(result.settings.automatic_reminders_enabled),
    count: result.reminders.length,
    reminders: result.reminders,
  };
}

function insideAllowedTime(settings, now = new Date()) {
  const parts = ghanaParts(now);
  const scheduled = cleanText(settings.reminder_time, 5).slice(0, 5) || "09:00";
  const scheduledMinutes = Number(scheduled.slice(0, 2)) * 60 + Number(scheduled.slice(3, 5));
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  return currentMinutes >= scheduledMinutes && currentMinutes < scheduledMinutes + 60;
}

function weekendBlocked(settings, now = new Date()) {
  const weekday = ghanaParts(now).weekday;
  return Boolean(settings.skip_weekends) && ["Sat", "Sun"].includes(weekday);
}

async function automaticLimitReason(reminder, settings) {
  const [rows] = await pool.query(
    `SELECT SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS count_7_days,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS count_30_days,
            MAX(sent_at) AS last_sent_at
       FROM equipment_sales_reminder_log
      WHERE agreement_id = ?
        AND reminder_type IN ('due_soon','due_today','overdue')
        AND delivery_status IN ('accepted','delivered','delivery_unknown')`,
    [reminder.agreement_id]
  );
  const row = rows[0] || {};
  if (Number(row.count_7_days || 0) >= Number(settings.max_sms_7_days || 3)) return "maximum_7_day_limit";
  if (Number(row.count_30_days || 0) >= Number(settings.max_sms_30_days || 8)) return "maximum_30_day_limit";
  if (row.last_sent_at) {
    const hours = (Date.now() - new Date(row.last_sent_at).getTime()) / 3600000;
    if (hours < Number(settings.minimum_hours_between_sms || 24)) return "minimum_hours_not_reached";
  }
  return null;
}

async function runProfessionalReminderSync({ source = "scheduler", sentBy = null, bypassTime = false, today = ghanaDate() } = {}) {
  const { settings, reminders } = await reminderCandidates({ today, applyLateFees: true, sendLateFeeNotifications: true, sentBy });
  const automatic = source === "scheduler";
  if (automatic && !settings.automatic_reminders_enabled) return { sent: 0, failed: 0, skipped: reminders.length, reason: "automatic_disabled" };
  if (!bypassTime && !insideAllowedTime(settings)) return { sent: 0, failed: 0, skipped: reminders.length, reason: "outside_reminder_hour" };
  if (!bypassTime && weekendBlocked(settings)) return { sent: 0, failed: 0, skipped: reminders.length, reason: "weekend_blocked" };

  const result = { sent: 0, failed: 0, skipped: 0, boss_sent: 0, boss_failed: 0, details: [] };
  for (const reminder of reminders.slice(0, 100)) {
    if (!cleanText(reminder.customer_phone, 40)) {
      result.skipped += 1;
      result.details.push({ agreement_id: reminder.agreement_id, status: "skipped", reason: "missing_phone" });
      continue;
    }
    const limitReason = await automaticLimitReason(reminder, settings);
    if (limitReason) {
      result.skipped += 1;
      result.details.push({ agreement_id: reminder.agreement_id, status: "skipped", reason: limitReason });
      continue;
    }
    const [claim] = await pool.query(
      `INSERT IGNORE INTO equipment_sales_reminder_log (
         hire_location_id, agreement_id, schedule_id, reminder_key,
         reminder_type, recipient_phone, delivery_status, message_preview, sent_by
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [reminder.hire_location_id, reminder.agreement_id, reminder.schedule_id, reminder.reminder_key, reminder.reminder_type, reminder.customer_phone, reminder.message, sentBy || null]
    );
    if (!claim.affectedRows) {
      result.skipped += 1;
      result.details.push({ agreement_id: reminder.agreement_id, status: "skipped", reason: "duplicate_claim" });
      continue;
    }

    const sms = await sendSmsAlertToPhone({
      branchId: null,
      phone: reminder.customer_phone,
      message: reminder.message,
      logMessage: `Finance ${reminder.reminder_type} reminder for ${reminder.agreement_number}.`,
      smsType: `equipment_finance_${reminder.reminder_type}`,
      sentBy,
      sourceReference: reminder.reminder_key,
    });
    const status = sms.skipped ? "failed" : ["accepted", "delivered", "delivery_unknown", "failed"].includes(sms.status) ? sms.status : sms.ok ? "accepted" : "failed";
    await pool.query(`UPDATE equipment_sales_reminder_log SET sms_log_id = ?, delivery_status = ?, sent_at = NOW() WHERE reminder_key = ?`, [sms.log_id || null, status, reminder.reminder_key]);
    if (["accepted", "delivered", "delivery_unknown"].includes(status)) result.sent += 1;
    else result.failed += 1;

    const bossEnabled = reminder.reminder_type === "overdue"
      ? Number(settings.boss_overdue_alert_enabled ?? 1)
      : Number(settings.boss_due_alert_enabled ?? 0);
    if (bossEnabled && Number(settings.boss_payment_alert_enabled ?? 1) && cleanText(settings.boss_payment_alert_phone, 40)) {
      const bossMessage = `CHALIN03 FINANCE: ${reminder.customer_name} / ${reminder.agreement_number}. ${reminder.reminder_type === "overdue" ? "OVERDUE" : "DUE ALERT"}. ${reminder.due_sentence} Balance GHS ${money(reminder.outstanding_balance)}.`;
      const bossSms = await sendSmsAlertToPhone({
        branchId: null,
        phone: settings.boss_payment_alert_phone,
        message: bossMessage.slice(0, 480),
        logMessage: `Finance boss ${reminder.reminder_type} alert for ${reminder.agreement_number}.`,
        smsType: `equipment_finance_boss_${reminder.reminder_type}`,
        sentBy,
        sourceReference: `${reminder.reminder_key}:boss`,
      });
      if (bossSms.ok) result.boss_sent += 1;
      else result.boss_failed += 1;
    }

    result.details.push({ agreement_id: reminder.agreement_id, reminder_type: reminder.reminder_type, status, sms_log_id: sms.log_id || null, late_fee_amount: reminder.late_fee_amount });
  }
  return result;
}

async function listProfessionalReminderHistory(limit = 200) {
  await assertProfessionalSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit || 200), 500));
  const [rows] = await pool.query(
    `SELECT reminder.*, agreement.agreement_number,
            agreement.customer_name_snapshot AS customer_name,
            agreement.asset_name_snapshot AS equipment_name,
            user.full_name AS sent_by_name
       FROM equipment_sales_reminder_log reminder
       INNER JOIN equipment_sale_agreements agreement ON agreement.id = reminder.agreement_id
       LEFT JOIN users user ON user.id = reminder.sent_by
      WHERE reminder.reminder_type IN ('due_soon','due_today','overdue')
      ORDER BY reminder.created_at DESC, reminder.id DESC
      LIMIT ?`,
    [safeLimit]
  );
  return rows;
}

function startProfessionalReminderScheduler() {
  if (schedulerStarted) return { started: false, reason: "already_started" };
  schedulerStarted = true;
  const run = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      await runProfessionalReminderSync({ source: "scheduler", bypassTime: false });
    } catch (error) {
      console.error("Professional Finance reminder scheduler failed:", error);
    } finally {
      schedulerRunning = false;
    }
  };
  setTimeout(run, 60000).unref?.();
  setInterval(run, SCHEDULER_INTERVAL_MS).unref?.();
  return { started: true, interval_ms: SCHEDULER_INTERVAL_MS };
}

module.exports = { reminderCandidates, classifyReminder, ghanaDate, listProfessionalReminderHistory, previewProfessionalReminders, runProfessionalReminderSync, startProfessionalReminderScheduler };
