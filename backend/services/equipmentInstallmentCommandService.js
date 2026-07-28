const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { getSmsConfig, normalizeGhanaPhone } = require("./smsService");
const { sendSmsAlertToPhone } = require("./smsAlertService");

const SETTING_PREFIX = "equipment_installments.location.";
const MAX_HISTORY_LIMIT = 200;
const FOLLOW_UP_ACTION = "EQUIPMENT_INSTALLMENT_FOLLOW_UP_RECORDED";
const DEFAULT_MESSAGE_TEMPLATE =
  "CHALIN03: Dear {customer_name}, your equipment installment {agreement_number} for {equipment_name} has GHS {outstanding_balance} outstanding. {due_sentence}{payment_sentence} Thank you.";

const FOLLOW_UP_TYPES = new Set([
  "phone_call",
  "sms",
  "whatsapp",
  "field_visit",
  "promise_to_pay",
  "guarantor_contact",
  "recovery_review",
  "account_note",
]);
const FOLLOW_UP_OUTCOMES = new Set([
  "reached",
  "not_reached",
  "promised_payment",
  "paid_or_settled",
  "disputed",
  "reschedule_requested",
  "guarantor_engaged",
  "escalated",
  "note_only",
]);

function appError(message, statusCode = 400, code = "EQUIPMENT_INSTALLMENT_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 16000);
  } catch {
    return null;
  }
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function booleanValue(value, fallback = false) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  const text = cleanText(value, 20).toLowerCase();
  if (["true", "yes", "on", "enabled"].includes(text)) return true;
  if (["false", "no", "off", "disabled"].includes(text)) return false;
  return fallback;
}

function wholeNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

function decimalValue(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Number(Math.min(Math.max(number, minimum), maximum).toFixed(2));
}

function dateOnly(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseDueSoonDays(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(
    source
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isInteger(item) && item > 0 && item <= 365)
  )]
    .sort((left, right) => right - left)
    .slice(0, 12);
}

function normalizeReminderTime(value) {
  const time = cleanText(value, 8);
  const match = time.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "09:00";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "09:00";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function legacyDueSoonDays() {
  const days = Number(process.env.EQUIPMENT_SALES_REMINDER_DAYS_BEFORE || 3);
  return Number.isInteger(days) && days >= 0 && days <= 30 ? [days] : [3];
}

function legacyOverdueDays() {
  return String(process.env.EQUIPMENT_SALES_OVERDUE_REMINDER_DAYS || "1,3,7,14,30")
    .split(",")
    .map((value) => Number(String(value).trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 365);
}

function defaultInstallmentReminderSettings() {
  const legacyOverdue = legacyOverdueDays();
  return {
    automatic_sms_enabled: false,
    manual_sms_enabled: true,
    manual_whatsapp_enabled: true,
    reminder_time: "09:00",
    timezone: "Africa/Accra",
    due_soon_enabled: true,
    due_soon_days: legacyDueSoonDays().length ? legacyDueSoonDays() : [7, 3, 1],
    due_today_enabled: true,
    overdue_enabled: true,
    overdue_start_days: legacyOverdue[0] || 1,
    overdue_repeat_days: 3,
    max_sms_7_days: 3,
    max_sms_30_days: 8,
    minimum_hours_between_sms: 24,
    minimum_balance: 1,
    max_messages_per_run: 50,
    skip_weekends: false,
    include_payment_phone: true,
    message_template: DEFAULT_MESSAGE_TEMPLATE,
  };
}

function normalizeInstallmentReminderSettings(input = {}, existing = {}) {
  const defaults = { ...defaultInstallmentReminderSettings(), ...existing };
  const dueSoonDays = parseDueSoonDays(
    input.due_soon_days === undefined ? defaults.due_soon_days : input.due_soon_days
  );
  const messageTemplate = cleanText(
    input.message_template === undefined
      ? defaults.message_template
      : input.message_template,
    1000
  );

  if (!messageTemplate) {
    throw appError("Installment reminder message template cannot be empty.");
  }
  if (
    !messageTemplate.includes("{customer_name}") ||
    !messageTemplate.includes("{outstanding_balance}")
  ) {
    throw appError(
      "The installment reminder template must contain {customer_name} and {outstanding_balance}."
    );
  }

  return {
    automatic_sms_enabled: booleanValue(
      input.automatic_sms_enabled,
      defaults.automatic_sms_enabled
    ),
    manual_sms_enabled: booleanValue(input.manual_sms_enabled, defaults.manual_sms_enabled),
    manual_whatsapp_enabled: booleanValue(
      input.manual_whatsapp_enabled,
      defaults.manual_whatsapp_enabled
    ),
    reminder_time: normalizeReminderTime(
      input.reminder_time === undefined ? defaults.reminder_time : input.reminder_time
    ),
    timezone: "Africa/Accra",
    due_soon_enabled: booleanValue(input.due_soon_enabled, defaults.due_soon_enabled),
    due_soon_days: dueSoonDays.length ? dueSoonDays : [7, 3, 1],
    due_today_enabled: booleanValue(input.due_today_enabled, defaults.due_today_enabled),
    overdue_enabled: booleanValue(input.overdue_enabled, defaults.overdue_enabled),
    overdue_start_days: wholeNumber(
      input.overdue_start_days,
      defaults.overdue_start_days,
      1,
      365
    ),
    overdue_repeat_days: wholeNumber(
      input.overdue_repeat_days,
      defaults.overdue_repeat_days,
      1,
      365
    ),
    max_sms_7_days: wholeNumber(input.max_sms_7_days, defaults.max_sms_7_days, 1, 50),
    max_sms_30_days: wholeNumber(
      input.max_sms_30_days,
      defaults.max_sms_30_days,
      1,
      200
    ),
    minimum_hours_between_sms: wholeNumber(
      input.minimum_hours_between_sms,
      defaults.minimum_hours_between_sms,
      1,
      720
    ),
    minimum_balance: decimalValue(
      input.minimum_balance,
      defaults.minimum_balance,
      0,
      1000000000
    ),
    max_messages_per_run: wholeNumber(
      input.max_messages_per_run,
      defaults.max_messages_per_run,
      1,
      500
    ),
    skip_weekends: booleanValue(input.skip_weekends, defaults.skip_weekends),
    include_payment_phone: booleanValue(
      input.include_payment_phone,
      defaults.include_payment_phone
    ),
    message_template: messageTemplate,
  };
}

function settingKey(locationId) {
  return `${SETTING_PREFIX}${Number(locationId)}`;
}

async function ensureCommandStorage(connection = pool) {
  const requiredTables = [
    "equipment_sale_agreements",
    "equipment_installment_schedule",
    "equipment_sale_payments",
    "equipment_sales_reminder_log",
    "group_configuration",
    "group_configuration_history",
    "sms_log",
    "activity_log",
  ];
  const placeholders = requiredTables.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    requiredTables
  );
  const found = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = requiredTables.filter((tableName) => !found.has(tableName));
  if (missing.length) {
    throw appError(
      `Installment Command Centre storage is unavailable. Missing: ${missing.join(", ")}.`,
      503,
      "INSTALLMENT_COMMAND_STORAGE_UNAVAILABLE"
    );
  }
}

async function getLocationProfile(connection, locationId) {
  const [rows] = await connection.query(
    `SELECT
       bl.id AS hire_location_id,
       bl.code AS hire_location_code,
       bl.name AS hire_location_name,
       bl.address AS hire_location_address,
       bl.phone AS payment_phone,
       bu.id AS business_unit_id,
       bu.code AS business_unit_code,
       bu.name AS business_unit_name
     FROM business_locations bl
     INNER JOIN business_units bu ON bu.id = bl.business_unit_id
     WHERE bl.id = ?
       AND bu.code = 'equipment_hire'
       AND bl.is_active = TRUE
       AND bu.is_enabled = TRUE
     LIMIT 1`,
    [Number(locationId)]
  );
  if (!rows.length) {
    throw appError(
      "The selected Equipment Sales & Hire location was not found.",
      404,
      "INSTALLMENT_LOCATION_NOT_FOUND"
    );
  }
  return rows[0];
}

async function ensureSettingsRow(connection, locationId) {
  await ensureCommandStorage(connection);
  const location = await getLocationProfile(connection, locationId);
  const key = settingKey(locationId);
  const defaults = defaultInstallmentReminderSettings();

  await connection.query(
    `INSERT IGNORE INTO group_configuration (
       setting_key, setting_group, setting_label, setting_description,
       value_type, value_text, is_sensitive, is_editable, sort_order, updated_by
     ) VALUES (?, 'equipment_installments', ?, ?, 'text', ?, FALSE, FALSE, ?, NULL)`,
    [
      key,
      `Equipment installment reminders — ${location.hire_location_code || location.hire_location_name}`,
      "Managed from the Equipment Installment Command Centre. Stores timing, frequency and customer-protection controls.",
      JSON.stringify(defaults),
      Number(locationId),
    ]
  );

  const [rows] = await connection.query(
    `SELECT * FROM group_configuration WHERE setting_key = ? LIMIT 1`,
    [key]
  );
  if (!rows.length) {
    throw appError(
      "Installment reminder settings could not be initialized.",
      503,
      "INSTALLMENT_SETTINGS_UNAVAILABLE"
    );
  }
  const saved = parseJson(rows[0].value_text, {});
  return {
    row: rows[0],
    location,
    settings: normalizeInstallmentReminderSettings(saved),
  };
}

function requestIp(req) {
  return cleanText(
    String(
      req?.headers?.["x-forwarded-for"] || req?.ip || req?.socket?.remoteAddress || ""
    ).split(",")[0],
    50
  );
}

function requestUserAgent(req) {
  return cleanText(req?.headers?.["user-agent"], 500);
}

function getPublicSmsStatus() {
  const config = getSmsConfig();
  const provider = String(config.provider || "mock").toLowerCase();
  const arkeselReady = Boolean(config.arkeselApiKey && config.senderId);
  const hubtelReady = Boolean(
    config.hubtelClientId && config.hubtelClientSecret && config.senderId
  );
  const providerReady =
    provider === "mock" ||
    (provider === "arkesel" && arkeselReady) ||
    (provider === "hubtel" && hubtelReady);
  const automaticAvailable = Boolean(config.enabled && providerReady);

  let modeMessage = "SMS is disabled in the backend environment.";
  if (config.enabled && provider === "mock") {
    modeMessage =
      "Mock mode is active. Reminder evidence will be recorded, but no real SMS credit will be used.";
  } else if (automaticAvailable) {
    modeMessage = `${provider.toUpperCase()} live SMS is ready for equipment installment reminders.`;
  } else if (config.enabled) {
    modeMessage = `${provider.toUpperCase()} is selected, but its credentials or Sender ID are incomplete.`;
  }

  return {
    enabled: Boolean(config.enabled),
    provider,
    sender_id: config.senderId || "",
    provider_ready: providerReady,
    automatic_available: automaticAvailable,
    live_sending: automaticAvailable && provider !== "mock",
    mode_message: modeMessage,
  };
}

async function getInstallmentReminderSettings(locationId) {
  const current = await ensureSettingsRow(pool, Number(locationId));
  const sms = getPublicSmsStatus();
  return {
    location: current.location,
    settings: current.settings,
    sms,
    automatic_effective:
      current.settings.automatic_sms_enabled && sms.automatic_available,
  };
}

async function saveInstallmentReminderSettings({
  locationId,
  input,
  userId,
  reason,
  req,
}) {
  const cleanReason = cleanText(reason, 500);
  if (cleanReason.length < 5) {
    throw appError("Enter a clear settings change reason of at least 5 characters.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await ensureSettingsRow(connection, Number(locationId));
    const normalized = normalizeInstallmentReminderSettings(input, current.settings);
    const oldValue = JSON.stringify(current.settings);
    const newValue = JSON.stringify(normalized);

    if (oldValue !== newValue) {
      await connection.query(
        `UPDATE group_configuration
         SET value_text = ?, updated_by = ?, updated_at = NOW()
         WHERE setting_key = ?`,
        [newValue, userId || null, current.row.setting_key]
      );
      await connection.query(
        `INSERT INTO group_configuration_history (
           setting_key, old_value_text, new_value_text, change_reason,
           changed_by, request_id, ip_address, user_agent, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          current.row.setting_key,
          oldValue,
          newValue,
          cleanReason,
          userId || null,
          req?.requestId || null,
          requestIp(req),
          requestUserAgent(req),
        ]
      );
      await writeAuditEvent({
        connection,
        req,
        userId,
        workspaceCode: "equipment_hire",
        businessUnitId: current.location.business_unit_id,
        hireLocationId: Number(locationId),
        action: "EQUIPMENT_INSTALLMENT_SETTINGS_UPDATED",
        actionType: "EQUIPMENT_INSTALLMENT_SETTINGS_UPDATED",
        entityType: "equipment_installment_settings",
        entityId: Number(locationId),
        severity: "warning",
        details: `Updated equipment installment reminder settings. Reason: ${cleanReason}`,
        metadata: {
          automatic_sms_enabled: normalized.automatic_sms_enabled,
          reminder_time: normalized.reminder_time,
          due_soon_days: normalized.due_soon_days,
          max_sms_7_days: normalized.max_sms_7_days,
          max_sms_30_days: normalized.max_sms_30_days,
          minimum_hours_between_sms: normalized.minimum_hours_between_sms,
          max_messages_per_run: normalized.max_messages_per_run,
        },
      });
    }

    await connection.commit();
    return {
      changed: oldValue !== newValue,
      location: current.location,
      settings: normalized,
      sms: getPublicSmsStatus(),
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function refreshEquipmentInstallmentStatuses(connection = pool) {
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

function locationFilter(alias, locationId) {
  if (!positiveId(locationId)) return { sql: "", params: [] };
  return { sql: ` AND ${alias}.hire_location_id = ?`, params: [Number(locationId)] };
}

function dateText(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dayDifference(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function ghanaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    weekday: values.weekday,
  };
}

function riskProfile(row, today = ghanaClock().date) {
  const total = Number(row.total_amount || 0);
  const outstanding = Number(row.outstanding_balance || 0);
  const overdue = Number(row.overdue_amount || 0);
  const daysPastDue = Math.max(Number(row.days_past_due || 0), 0);
  const lastPaymentDate = dateText(row.last_payment_at);
  const daysSincePayment = lastPaymentDate
    ? Math.max(-(dayDifference(today, lastPaymentDate) || 0), 0)
    : null;

  let score = 0;
  if (row.agreement_status === "defaulted") score += 100;
  else {
    if (daysPastDue > 0) score += Math.min(45, 10 + daysPastDue * 0.8);
    if (total > 0) score += Math.min(20, (outstanding / total) * 20);
    if (outstanding > 0 && overdue / outstanding >= 0.5) score += 15;
    if (!row.customer_phone_snapshot) score += 10;
    if (!row.customer_id_number) score += 5;
    if (!row.guarantor_name && total >= 100000) score += 5;
    if (daysSincePayment === null && Number(row.amount_paid || 0) <= 0.01) score += 10;
    else if (daysSincePayment !== null && daysSincePayment > 45) score += 10;
  }
  score = Math.min(100, Math.round(score));

  let band = "low";
  if (score >= 75) band = "critical";
  else if (score >= 50) band = "high";
  else if (score >= 25) band = "medium";

  let recommendedAction = "Monitor the next scheduled payment.";
  if (row.agreement_status === "defaulted") {
    recommendedAction = "Management recovery review is required.";
  } else if (daysPastDue >= 90) {
    recommendedAction = "Escalate for management, guarantor and recovery review.";
  } else if (daysPastDue >= 31) {
    recommendedAction = "Call customer, contact guarantor and record a payment plan.";
  } else if (daysPastDue >= 8) {
    recommendedAction = "Contact customer today and secure a promise-to-pay date.";
  } else if (daysPastDue > 0) {
    recommendedAction = "Send reminder and call before arrears increase.";
  } else if (Number(row.days_until_due || 999) <= 3) {
    recommendedAction = "Confirm the upcoming payment before its due date.";
  }

  return {
    risk_score: score,
    risk_band: band,
    recommended_action: recommendedAction,
    days_since_payment: daysSincePayment,
  };
}

async function loadInstallmentRows(connection = pool, locationId = null) {
  const filter = locationFilter("esa", locationId);
  const [rows] = await connection.query(
    `SELECT
       esa.*,
       bl.name AS hire_location_name,
       bl.code AS hire_location_code,
       hc.email AS customer_email,
       hc.customer_type,
       fa.registration_number,
       fa.chassis_number,
       fa.engine_number,
       fa.current_status AS asset_current_status,
       (
         SELECT MAX(esp.payment_date)
         FROM equipment_sale_payments esp
         WHERE esp.agreement_id = esa.id
           AND esp.is_voided = FALSE
           AND esp.payment_category <> 'refund'
       ) AS last_payment_at,
       (
         SELECT esp.amount
         FROM equipment_sale_payments esp
         WHERE esp.agreement_id = esa.id
           AND esp.is_voided = FALSE
           AND esp.payment_category <> 'refund'
         ORDER BY esp.payment_date DESC, esp.id DESC
         LIMIT 1
       ) AS last_payment_amount,
       (
         SELECT eis.due_date
         FROM equipment_installment_schedule eis
         WHERE eis.agreement_id = esa.id
           AND eis.schedule_status NOT IN ('paid','cancelled','waived')
         ORDER BY eis.due_date, eis.sequence_number
         LIMIT 1
       ) AS next_schedule_due_date,
       (
         SELECT GREATEST(
           eis.scheduled_amount + eis.late_charge_amount - eis.waived_charge_amount - eis.amount_paid,
           0
         )
         FROM equipment_installment_schedule eis
         WHERE eis.agreement_id = esa.id
           AND eis.schedule_status NOT IN ('paid','cancelled','waived')
         ORDER BY eis.due_date, eis.sequence_number
         LIMIT 1
       ) AS next_payment_amount,
       (
         SELECT MIN(eis.due_date)
         FROM equipment_installment_schedule eis
         WHERE eis.agreement_id = esa.id
           AND eis.schedule_status = 'overdue'
       ) AS oldest_overdue_date,
       COALESCE((
         SELECT DATEDIFF(CURDATE(), MIN(eis.due_date))
         FROM equipment_installment_schedule eis
         WHERE eis.agreement_id = esa.id
           AND eis.schedule_status = 'overdue'
       ), 0) AS days_past_due,
       CASE
         WHEN esa.next_due_date IS NULL THEN NULL
         ELSE DATEDIFF(esa.next_due_date, CURDATE())
       END AS days_until_due,
       (
         SELECT MAX(esrl.created_at)
         FROM equipment_sales_reminder_log esrl
         WHERE esrl.agreement_id = esa.id
       ) AS last_reminder_at,
       (
         SELECT COUNT(*)
         FROM equipment_sales_reminder_log esrl
         WHERE esrl.agreement_id = esa.id
           AND esrl.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           AND COALESCE(esrl.delivery_status, 'failed') <> 'failed'
       ) AS reminders_30_days,
       (
         SELECT MAX(al.created_at)
         FROM activity_log al
         WHERE al.workspace_code = 'equipment_hire'
           AND al.entity_type = 'equipment_sale_agreement'
           AND al.entity_id = CAST(esa.id AS CHAR)
           AND al.action = '${FOLLOW_UP_ACTION}'
       ) AS last_follow_up_at
     FROM equipment_sale_agreements esa
     INNER JOIN business_locations bl ON bl.id = esa.hire_location_id
     INNER JOIN hire_customers hc ON hc.id = esa.customer_id
     INNER JOIN fleet_assets fa ON fa.id = esa.asset_id
     WHERE esa.sale_type = 'installment'
       ${filter.sql}
     ORDER BY
       CASE WHEN esa.agreement_status = 'defaulted' THEN 0
            WHEN esa.agreement_status = 'overdue' THEN 1
            WHEN esa.agreement_status = 'payment_due' THEN 2
            WHEN esa.agreement_status = 'due_soon' THEN 3
            ELSE 4 END,
       esa.next_due_date,
       esa.id`,
    filter.params
  );
  return rows.map((row) => ({ ...row, ...riskProfile(row) }));
}

function agingBucket(row) {
  const days = Math.max(Number(row.days_past_due || 0), 0);
  if (days === 0) return "current";
  if (days <= 7) return "1_7_days";
  if (days <= 30) return "8_30_days";
  if (days <= 60) return "31_60_days";
  if (days <= 90) return "61_90_days";
  return "over_90_days";
}

async function getInstallmentPortfolio({ locationId = null } = {}) {
  await refreshEquipmentInstallmentStatuses(pool);
  const rows = await loadInstallmentRows(pool, locationId);
  const active = rows.filter(
    (row) => !["completed", "cancelled"].includes(row.agreement_status)
  );
  const today = ghanaClock().date;
  const summary = active.reduce(
    (result, row) => {
      result.active_accounts += 1;
      result.total_sales_value += Number(row.total_amount || 0);
      result.financed_amount += Number(row.financed_amount || 0);
      result.collected_amount += Number(row.amount_paid || 0);
      result.outstanding_amount += Number(row.outstanding_balance || 0);
      result.overdue_amount += Number(row.overdue_amount || 0);
      if (row.agreement_status === "overdue") result.overdue_accounts += 1;
      if (row.agreement_status === "defaulted") result.defaulted_accounts += 1;
      if (row.risk_band === "critical") result.critical_risk_accounts += 1;
      if (row.risk_band === "high") result.high_risk_accounts += 1;
      const due = dateText(row.next_due_date);
      const diff = due ? dayDifference(today, due) : null;
      if (diff === 0) result.due_today_accounts += 1;
      if (diff !== null && diff >= 0 && diff <= 7) {
        result.due_next_7_days += Number(row.next_payment_amount || 0);
      }
      if (diff !== null && diff >= 0 && diff <= 30) {
        result.due_next_30_days += Number(row.next_payment_amount || 0);
      }
      return result;
    },
    {
      active_accounts: 0,
      overdue_accounts: 0,
      defaulted_accounts: 0,
      critical_risk_accounts: 0,
      high_risk_accounts: 0,
      due_today_accounts: 0,
      total_sales_value: 0,
      financed_amount: 0,
      collected_amount: 0,
      outstanding_amount: 0,
      overdue_amount: 0,
      due_next_7_days: 0,
      due_next_30_days: 0,
    }
  );
  summary.collection_rate = summary.total_sales_value > 0
    ? Number(((summary.collected_amount / summary.total_sales_value) * 100).toFixed(2))
    : 0;
  summary.portfolio_at_risk_rate = summary.outstanding_amount > 0
    ? Number(((summary.overdue_amount / summary.outstanding_amount) * 100).toFixed(2))
    : 0;

  const agingMap = new Map();
  for (const row of active) {
    const bucket = agingBucket(row);
    const current = agingMap.get(bucket) || {
      aging_bucket: bucket,
      accounts: 0,
      outstanding_amount: 0,
      overdue_amount: 0,
    };
    current.accounts += 1;
    current.outstanding_amount += Number(row.outstanding_balance || 0);
    current.overdue_amount += Number(row.overdue_amount || 0);
    agingMap.set(bucket, current);
  }
  const order = [
    "current",
    "1_7_days",
    "8_30_days",
    "31_60_days",
    "61_90_days",
    "over_90_days",
  ];
  const aging = order.map((bucket) => agingMap.get(bucket) || {
    aging_bucket: bucket,
    accounts: 0,
    outstanding_amount: 0,
    overdue_amount: 0,
  });

  const filter = locationFilter("esa", locationId);
  const [forecast] = await pool.query(
    `SELECT
       eis.due_date,
       COUNT(DISTINCT esa.id) AS accounts,
       COALESCE(SUM(GREATEST(
         eis.scheduled_amount + eis.late_charge_amount - eis.waived_charge_amount - eis.amount_paid,
         0
       )), 0) AS expected_amount
     FROM equipment_installment_schedule eis
     INNER JOIN equipment_sale_agreements esa ON esa.id = eis.agreement_id
     WHERE esa.sale_type = 'installment'
       AND esa.agreement_status NOT IN ('completed','cancelled','defaulted')
       AND eis.schedule_status NOT IN ('paid','cancelled','waived')
       AND eis.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)
       ${filter.sql}
     GROUP BY eis.due_date
     ORDER BY eis.due_date`,
    filter.params
  );

  return {
    generated_at: new Date().toISOString(),
    summary,
    aging,
    forecast,
    urgent_accounts: active
      .filter((row) => ["critical", "high"].includes(row.risk_band))
      .sort((left, right) => right.risk_score - left.risk_score)
      .slice(0, 12),
    upcoming_accounts: active
      .filter((row) => Number(row.days_until_due) >= 0 && Number(row.days_until_due) <= 7)
      .sort((left, right) => Number(left.days_until_due) - Number(right.days_until_due))
      .slice(0, 12),
  };
}

async function listInstallmentCollections({
  locationId = null,
  search = "",
  status = "",
  risk = "",
  aging = "",
  limit = 500,
} = {}) {
  await refreshEquipmentInstallmentStatuses(pool);
  const rows = await loadInstallmentRows(pool, locationId);
  const term = cleanText(search, 150).toLowerCase();
  const cleanStatus = cleanText(status, 40).toLowerCase();
  const cleanRisk = cleanText(risk, 20).toLowerCase();
  const cleanAging = cleanText(aging, 30).toLowerCase();
  const filtered = rows.filter((row) => {
    if (cleanStatus && row.agreement_status !== cleanStatus) return false;
    if (cleanRisk && row.risk_band !== cleanRisk) return false;
    if (cleanAging && agingBucket(row) !== cleanAging) return false;
    if (!term) return true;
    return [
      row.agreement_number,
      row.customer_name_snapshot,
      row.customer_phone_snapshot,
      row.asset_code_snapshot,
      row.asset_name_snapshot,
      row.hire_location_name,
      row.guarantor_name,
      row.guarantor_phone,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });

  return {
    count: filtered.length,
    accounts: filtered.slice(0, Math.max(1, Math.min(Number(limit) || 500, 500))),
  };
}

async function requireInstallmentAgreement(connection, agreementId, locationId = null) {
  const filter = locationFilter("esa", locationId);
  const [rows] = await connection.query(
    `SELECT
       esa.*,
       bl.name AS hire_location_name,
       bl.code AS hire_location_code,
       bl.phone AS payment_phone,
       bu.id AS business_unit_id,
       hc.email AS customer_email,
       hc.customer_type,
       fa.registration_number,
       fa.chassis_number,
       fa.engine_number,
       fa.current_status AS asset_current_status,
       fa.main_image_url,
       creator.full_name AS created_by_name,
       approver.full_name AS approved_by_name
     FROM equipment_sale_agreements esa
     INNER JOIN business_locations bl ON bl.id = esa.hire_location_id
     INNER JOIN business_units bu ON bu.id = bl.business_unit_id
     INNER JOIN hire_customers hc ON hc.id = esa.customer_id
     INNER JOIN fleet_assets fa ON fa.id = esa.asset_id
     LEFT JOIN users creator ON creator.id = esa.created_by
     LEFT JOIN users approver ON approver.id = esa.approved_by
     WHERE esa.id = ?
       AND esa.sale_type = 'installment'
       ${filter.sql}
     LIMIT 1`,
    [Number(agreementId), ...filter.params]
  );
  if (!rows.length) {
    throw appError(
      "The equipment installment agreement was not found in the selected location.",
      404,
      "INSTALLMENT_ACCOUNT_NOT_FOUND"
    );
  }
  return rows[0];
}

async function loadFollowUps(connection, agreementId, locationId = null) {
  const params = [String(agreementId)];
  let locationSql = "";
  if (positiveId(locationId)) {
    locationSql = " AND al.hire_location_id = ?";
    params.push(Number(locationId));
  }
  const [rows] = await connection.query(
    `SELECT
       al.id,
       al.action,
       al.details,
       al.outcome,
       al.severity,
       al.metadata_json,
       al.created_at,
       u.full_name AS recorded_by_name,
       u.username AS recorded_by_username
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.workspace_code = 'equipment_hire'
       AND al.entity_type = 'equipment_sale_agreement'
       AND al.entity_id = ?
       AND al.action = '${FOLLOW_UP_ACTION}'
       ${locationSql}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT 200`,
    params
  );
  return rows.map((row) => ({
    ...row,
    metadata: parseJson(row.metadata_json, {}),
  }));
}

async function getInstallmentAccount({ agreementId, locationId = null }) {
  await refreshEquipmentInstallmentStatuses(pool);
  const agreement = await requireInstallmentAgreement(pool, agreementId, locationId);
  const [schedule] = await pool.query(
    `SELECT *
     FROM equipment_installment_schedule
     WHERE agreement_id = ?
     ORDER BY sequence_number`,
    [Number(agreementId)]
  );
  const [payments] = await pool.query(
    `SELECT esp.*, u.full_name AS received_by_name
     FROM equipment_sale_payments esp
     LEFT JOIN users u ON u.id = esp.received_by
     WHERE esp.agreement_id = ?
     ORDER BY esp.payment_date DESC, esp.id DESC`,
    [Number(agreementId)]
  );
  const [reminders] = await pool.query(
    `SELECT esrl.*, sl.provider, sl.provider_status, sl.status_reason,
            sl.delivery_confirmed_at
     FROM equipment_sales_reminder_log esrl
     LEFT JOIN sms_log sl ON sl.id = esrl.sms_log_id
     WHERE esrl.agreement_id = ?
     ORDER BY esrl.created_at DESC, esrl.id DESC
     LIMIT 100`,
    [Number(agreementId)]
  );
  const [deliveries] = await pool.query(
    `SELECT * FROM equipment_deliveries WHERE agreement_id = ? ORDER BY created_at DESC`,
    [Number(agreementId)]
  );
  const [ownership] = await pool.query(
    `SELECT * FROM equipment_ownership_transfers WHERE agreement_id = ? ORDER BY created_at DESC`,
    [Number(agreementId)]
  );
  const followUps = await loadFollowUps(pool, agreementId, locationId);
  const workRows = await loadInstallmentRows(pool, agreement.hire_location_id);
  const work = workRows.find((row) => Number(row.id) === Number(agreementId));

  return {
    agreement: work || { ...agreement, ...riskProfile(agreement) },
    schedule,
    payments,
    reminders,
    deliveries,
    ownership,
    follow_ups: followUps,
  };
}

async function recordInstallmentFollowUp({
  agreementId,
  locationId,
  userId,
  input,
  req,
}) {
  const followUpType = cleanText(input.follow_up_type, 50).toLowerCase();
  const outcome = cleanText(input.outcome, 50).toLowerCase();
  const notes = cleanText(input.notes, 2000);
  const promiseDate = dateOnly(input.promise_date);
  const promiseAmount = decimalValue(input.promise_amount, 0, 0, 1000000000);
  const nextActionDate = dateOnly(input.next_action_date);

  if (!FOLLOW_UP_TYPES.has(followUpType)) {
    throw appError("Choose a valid installment follow-up type.");
  }
  if (!FOLLOW_UP_OUTCOMES.has(outcome)) {
    throw appError("Choose a valid installment follow-up outcome.");
  }
  if (notes.length < 3) {
    throw appError("Enter a clear installment follow-up note.");
  }
  if (outcome === "promised_payment" && !promiseDate) {
    throw appError("Enter the customer’s promise-to-pay date.");
  }

  const agreement = await requireInstallmentAgreement(pool, agreementId, locationId);
  await writeAuditEvent({
    connection: pool,
    req,
    userId,
    workspaceCode: "equipment_hire",
    businessUnitId: agreement.business_unit_id,
    hireLocationId: agreement.hire_location_id,
    action: FOLLOW_UP_ACTION,
    actionType: FOLLOW_UP_ACTION,
    entityType: "equipment_sale_agreement",
    entityId: agreement.id,
    outcome,
    severity: ["escalated", "disputed"].includes(outcome) ? "warning" : "notice",
    details: `${followUpType.replaceAll("_", " ")}: ${notes}`,
    metadata: {
      follow_up_type: followUpType,
      outcome,
      promise_date: promiseDate,
      promise_amount: promiseAmount,
      next_action_date: nextActionDate,
      notes,
      agreement_number: agreement.agreement_number,
      customer_name: agreement.customer_name_snapshot,
      outstanding_balance: agreement.outstanding_balance,
    },
  });

  const followUps = await loadFollowUps(pool, agreementId, locationId);
  return followUps[0] || null;
}

function humanDate(value) {
  const date = dateText(value);
  if (!date) return "not set";
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function classifyScheduledReminder(account, settings, today = ghanaClock().date) {
  const oldestOverdue = dateText(account.oldest_overdue_date);
  if (settings.overdue_enabled && oldestOverdue) {
    const daysPastDue = Math.max(dayDifference(oldestOverdue, today) || 0, 0);
    if (
      daysPastDue >= settings.overdue_start_days &&
      (daysPastDue - settings.overdue_start_days) % settings.overdue_repeat_days === 0
    ) {
      return { type: "overdue", target_date: oldestOverdue, days: daysPastDue };
    }
  }

  const nextDue = dateText(account.next_schedule_due_date || account.next_due_date);
  if (!nextDue) return null;
  const daysUntilDue = dayDifference(today, nextDue);
  if (settings.due_today_enabled && daysUntilDue === 0) {
    return { type: "due_today", target_date: nextDue, days: 0 };
  }
  if (
    settings.due_soon_enabled &&
    settings.due_soon_days.includes(daysUntilDue)
  ) {
    return { type: "due_soon", target_date: nextDue, days: daysUntilDue };
  }
  return null;
}

function manualReminderType(account, today = ghanaClock().date) {
  if (Number(account.days_past_due || 0) > 0 || Number(account.overdue_amount || 0) > 0) {
    return {
      type: "overdue",
      target_date: dateText(account.oldest_overdue_date),
      days: Number(account.days_past_due || 0),
    };
  }
  const nextDue = dateText(account.next_schedule_due_date || account.next_due_date);
  const days = nextDue ? dayDifference(today, nextDue) : null;
  return {
    type: days === 0 ? "due_today" : "due_soon",
    target_date: nextDue,
    days,
  };
}

function dueSentence(account, reminder) {
  const amount = Number(account.next_payment_amount || account.outstanding_balance || 0)
    .toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (reminder.type === "overdue") {
    return `GHS ${amount} has been overdue since ${humanDate(reminder.target_date)}.`;
  }
  if (reminder.type === "due_today") {
    return `Your next payment of GHS ${amount} is due today.`;
  }
  return `Your next payment of GHS ${amount} is due ${humanDate(reminder.target_date)}.`;
}

function buildInstallmentReminderMessage({ account, location, settings, reminder }) {
  const paymentPhone = cleanText(location.payment_phone, 30);
  const replacements = {
    customer_name: account.customer_name_snapshot || "Customer",
    agreement_number: account.agreement_number || "",
    equipment_name: [account.asset_code_snapshot, account.asset_name_snapshot]
      .filter(Boolean)
      .join(" - "),
    outstanding_balance: Number(account.outstanding_balance || 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    overdue_amount: Number(account.overdue_amount || 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    next_payment_amount: Number(
      account.next_payment_amount || account.outstanding_balance || 0
    ).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    next_due_date: humanDate(account.next_schedule_due_date || account.next_due_date),
    location_name: location.hire_location_name || "Equipment Sales & Hire",
    payment_phone: paymentPhone,
    due_sentence: dueSentence(account, reminder),
    payment_sentence:
      settings.include_payment_phone && paymentPhone
        ? ` Pay or contact ${paymentPhone}.`
        : "",
  };

  let message = settings.message_template;
  for (const [key, value] of Object.entries(replacements)) {
    message = message.replaceAll(`{${key}}`, String(value ?? ""));
  }
  message = message.replace(/\s+/g, " ").trim();
  if (message.length > 480) message = `${message.slice(0, 477).trim()}...`;
  return message;
}

async function reminderFrequencyStats(connection, locationId, agreementId) {
  const newPattern = `equipment-installment:${Number(agreementId)}:%`;
  const legacyPattern = `equipment-sale:${Number(agreementId)}:%`;
  const [rows] = await connection.query(
    `SELECT
       SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                 AND COALESCE(status, 'failed') <> 'failed' THEN 1 ELSE 0 END) AS count_7_days,
       SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                 AND COALESCE(status, 'failed') <> 'failed' THEN 1 ELSE 0 END) AS count_30_days,
       MAX(CASE WHEN COALESCE(status, 'failed') <> 'failed' THEN created_at END) AS last_sent_at
     FROM sms_log
     WHERE workspace_code = 'equipment_hire'
       AND hire_location_id = ?
       AND (source_reference LIKE ? OR source_reference LIKE ?)`,
    [Number(locationId), newPattern, legacyPattern]
  );
  const row = rows[0] || {};
  return {
    count_7_days: Number(row.count_7_days || 0),
    count_30_days: Number(row.count_30_days || 0),
    last_sent_at: row.last_sent_at || null,
  };
}

function reminderLimitReason(stats, settings, now = new Date()) {
  if (stats.count_7_days >= settings.max_sms_7_days) return "maximum_7_day_limit";
  if (stats.count_30_days >= settings.max_sms_30_days) return "maximum_30_day_limit";
  if (stats.last_sent_at) {
    const last = new Date(stats.last_sent_at);
    if (!Number.isNaN(last.getTime())) {
      const hours = (now.getTime() - last.getTime()) / 3600000;
      if (hours < settings.minimum_hours_between_sms) {
        return "minimum_hours_not_reached";
      }
    }
  }
  return "";
}

async function claimScheduledReminder(connection, account, reminder, runDate, message) {
  const reminderKey = `command:${account.id}:${reminder.type}:${runDate}`;
  const [result] = await connection.query(
    `INSERT IGNORE INTO equipment_sales_reminder_log (
       hire_location_id, agreement_id, schedule_id, reminder_key,
       reminder_type, recipient_phone, delivery_status,
       message_preview, sent_by, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?, NULL, NOW())`,
    [
      account.hire_location_id,
      account.id,
      reminderKey,
      reminder.type,
      account.customer_phone_snapshot,
      message.slice(0, 500),
    ]
  );
  return { claimed: Boolean(result.affectedRows), reminderKey };
}

async function updateReminderEvidence({
  connection,
  account,
  reminder,
  reminderKey,
  message,
  result,
  sentBy,
}) {
  const deliveryStatus = cleanText(
    result?.status || (result?.ok || result?.success ? "accepted" : "failed"),
    40
  );
  await connection.query(
    `UPDATE equipment_sales_reminder_log
     SET sms_log_id = ?, delivery_status = ?,
         sent_at = CASE WHEN ? IN ('accepted','sent','delivered','success') THEN NOW() ELSE sent_at END,
         message_preview = ?, sent_by = COALESCE(?, sent_by)
     WHERE reminder_key = ?`,
    [
      result?.log_id || null,
      deliveryStatus,
      deliveryStatus,
      `${message}${result?.message && !result?.ok ? ` | ${result.message}` : ""}`.slice(0, 500),
      sentBy || null,
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
        account.hire_location_id,
        String(account.id),
        reminder.type,
        reminderKey,
        result.log_id,
      ]
    );
  }
  return {
    success: Boolean(result?.ok || result?.success),
    status: deliveryStatus,
    sms_log_id: result?.log_id || null,
  };
}

async function sendInstallmentReminder({
  connection,
  account,
  location,
  settings,
  reminder,
  reminderKey,
  message,
  sentBy = null,
}) {
  const phone = normalizeGhanaPhone(account.customer_phone_snapshot);
  if (!phone) {
    return { success: false, skipped: true, reason: "invalid_phone" };
  }
  let result;
  try {
    result = await sendSmsAlertToPhone({
      branchId: Math.max(1, Number(process.env.EQUIPMENT_SALES_SMS_BRANCH_ID || 1)),
      phone,
      message,
      logMessage: message,
      smsType: "equipment_sales",
      sentBy,
      sourceReference: reminderKey.startsWith("command:")
        ? `equipment-installment:${account.id}:scheduled:${reminder.type}:${reminderKey.split(":").at(-1)}`
        : `equipment-installment:${account.id}:manual:${Date.now()}`,
    });
  } catch (error) {
    result = { ok: false, success: false, status: "failed", message: error.message };
  }
  const evidence = await updateReminderEvidence({
    connection,
    account,
    reminder,
    reminderKey,
    message,
    result,
    sentBy,
  });
  return {
    ...evidence,
    recipient_phone: phone,
    message,
    reminder_type: reminder.type,
    account_id: account.id,
    agreement_number: account.agreement_number,
    customer_name: account.customer_name_snapshot,
    location_name: location.hire_location_name,
    error: evidence.success ? null : result?.message || "SMS submission failed.",
  };
}

async function previewInstallmentReminders(locationId) {
  const current = await ensureSettingsRow(pool, Number(locationId));
  await refreshEquipmentInstallmentStatuses(pool);
  const accounts = (await loadInstallmentRows(pool, Number(locationId))).filter(
    (account) =>
      !["completed", "cancelled", "defaulted"].includes(account.agreement_status) &&
      Number(account.outstanding_balance || 0) >= current.settings.minimum_balance
  );
  const clock = ghanaClock();
  const preview = {
    checked: accounts.length,
    eligible: 0,
    due_soon: 0,
    due_today: 0,
    overdue: 0,
    invalid_phone: 0,
    already_sent_today: 0,
    limited: 0,
    not_due_today: 0,
    sample: [],
  };

  for (const account of accounts) {
    const reminder = classifyScheduledReminder(account, current.settings, clock.date);
    if (!reminder) {
      preview.not_due_today += 1;
      continue;
    }
    if (!normalizeGhanaPhone(account.customer_phone_snapshot)) {
      preview.invalid_phone += 1;
      continue;
    }
    const reminderKey = `command:${account.id}:${reminder.type}:${clock.date}`;
    const [existing] = await pool.query(
      `SELECT id FROM equipment_sales_reminder_log
       WHERE reminder_key = ? AND COALESCE(delivery_status, 'failed') <> 'failed'
       LIMIT 1`,
      [reminderKey]
    );
    if (existing.length) {
      preview.already_sent_today += 1;
      continue;
    }
    const stats = await reminderFrequencyStats(
      pool,
      account.hire_location_id,
      account.id
    );
    if (reminderLimitReason(stats, current.settings)) {
      preview.limited += 1;
      continue;
    }
    preview.eligible += 1;
    preview[reminder.type] += 1;
    if (preview.sample.length < 12) {
      preview.sample.push({
        id: account.id,
        agreement_number: account.agreement_number,
        customer_name: account.customer_name_snapshot,
        customer_phone: account.customer_phone_snapshot,
        equipment_name: account.asset_name_snapshot,
        outstanding_balance: account.outstanding_balance,
        next_payment_amount: account.next_payment_amount,
        reminder_type: reminder.type,
        target_date: reminder.target_date,
        risk_band: account.risk_band,
      });
    }
  }

  return {
    location: current.location,
    settings: current.settings,
    sms: getPublicSmsStatus(),
    preview,
    generated_at: new Date().toISOString(),
  };
}

async function runLocationReminders({
  locationId,
  source = "automatic",
  sentBy = null,
  bypassTime = false,
}) {
  const connection = await pool.getConnection();
  const lockName = `chalin03:equipment-installments:${Number(locationId)}`;
  let lockAcquired = false;
  try {
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [
      lockName,
    ]);
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) {
      return {
        hire_location_id: Number(locationId),
        source,
        checked: 0,
        sent: 0,
        failed: 0,
        skipped: 1,
        reason: "another_installment_reminder_run_is_active",
      };
    }

    const current = await ensureSettingsRow(connection, Number(locationId));
    const sms = getPublicSmsStatus();
    const clock = ghanaClock();
    const summary = {
      hire_location_id: Number(locationId),
      hire_location_name: current.location.hire_location_name,
      source,
      checked: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      invalid_phone: 0,
      limited: 0,
      already_processed: 0,
      not_due_today: 0,
      automatic_effective:
        current.settings.automatic_sms_enabled && sms.automatic_available,
    };

    if (source === "automatic" && !current.settings.automatic_sms_enabled) {
      return { ...summary, skipped: 1, reason: "automatic_sms_disabled" };
    }
    if (!sms.automatic_available) {
      return { ...summary, skipped: 1, reason: "sms_provider_not_ready" };
    }
    if (
      source === "automatic" &&
      !bypassTime &&
      clock.time < current.settings.reminder_time
    ) {
      return { ...summary, skipped: 1, reason: "scheduled_time_not_reached" };
    }
    if (
      source === "automatic" &&
      !bypassTime &&
      current.settings.skip_weekends &&
      ["Sat", "Sun"].includes(clock.weekday)
    ) {
      return { ...summary, skipped: 1, reason: "weekend_skipped" };
    }

    await refreshEquipmentInstallmentStatuses(connection);
    const accounts = (await loadInstallmentRows(connection, Number(locationId))).filter(
      (account) =>
        !["completed", "cancelled", "defaulted"].includes(account.agreement_status) &&
        Number(account.outstanding_balance || 0) >= current.settings.minimum_balance
    );
    summary.checked = accounts.length;

    for (const account of accounts) {
      if (summary.sent + summary.failed >= current.settings.max_messages_per_run) {
        summary.skipped += 1;
        summary.reason = "maximum_messages_per_run_reached";
        break;
      }
      const reminder = classifyScheduledReminder(account, current.settings, clock.date);
      if (!reminder) {
        summary.not_due_today += 1;
        summary.skipped += 1;
        continue;
      }
      if (!normalizeGhanaPhone(account.customer_phone_snapshot)) {
        summary.invalid_phone += 1;
        summary.skipped += 1;
        continue;
      }
      const stats = await reminderFrequencyStats(
        connection,
        account.hire_location_id,
        account.id
      );
      if (reminderLimitReason(stats, current.settings)) {
        summary.limited += 1;
        summary.skipped += 1;
        continue;
      }
      const message = buildInstallmentReminderMessage({
        account,
        location: current.location,
        settings: current.settings,
        reminder,
      });
      const claim = await claimScheduledReminder(
        connection,
        account,
        reminder,
        clock.date,
        message
      );
      if (!claim.claimed) {
        summary.already_processed += 1;
        summary.skipped += 1;
        continue;
      }
      const sent = await sendInstallmentReminder({
        connection,
        account,
        location: current.location,
        settings: current.settings,
        reminder,
        reminderKey: claim.reminderKey,
        message,
        sentBy,
      });
      if (sent.success) summary.sent += 1;
      else summary.failed += 1;
    }

    await writeAuditEvent({
      connection,
      userId: sentBy,
      workspaceCode: "equipment_hire",
      businessUnitId: current.location.business_unit_id,
      hireLocationId: Number(locationId),
      action: "EQUIPMENT_INSTALLMENT_REMINDER_RUN_COMPLETED",
      actionType: "EQUIPMENT_INSTALLMENT_REMINDER_RUN_COMPLETED",
      entityType: "equipment_installment_portfolio",
      entityId: Number(locationId),
      severity: summary.failed ? "warning" : "notice",
      details: `Equipment installment reminder run: ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped.`,
      metadata: summary,
    });
    return summary;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      } catch {
        // The connection also releases the named lock when it closes.
      }
    }
    connection.release();
  }
}

async function configuredLocationIds() {
  await ensureCommandStorage(pool);
  const [rows] = await pool.query(
    `SELECT setting_key
     FROM group_configuration
     WHERE setting_key LIKE ?
     ORDER BY setting_key`,
    [`${SETTING_PREFIX}%`]
  );
  return rows
    .map((row) => Number(String(row.setting_key).slice(SETTING_PREFIX.length)))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function runEquipmentSalesReminderSync({
  locationId = null,
  source = "run_now",
  sentBy = null,
  bypassTime = true,
} = {}) {
  const locationIds = positiveId(locationId)
    ? [Number(locationId)]
    : await configuredLocationIds();
  const result = {
    source,
    locations_checked: locationIds.length,
    checked: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    locations: [],
  };

  for (const id of locationIds) {
    try {
      const locationResult = await runLocationReminders({
        locationId: id,
        source,
        sentBy,
        bypassTime,
      });
      result.locations.push(locationResult);
      result.checked += Number(locationResult.checked || 0);
      result.sent += Number(locationResult.sent || 0);
      result.failed += Number(locationResult.failed || 0);
      result.skipped += Number(locationResult.skipped || 0);
    } catch (error) {
      result.failed += 1;
      result.locations.push({
        hire_location_id: id,
        failed: 1,
        error: error.message,
      });
    }
  }
  return result;
}

async function getAgreementReminderPreview({ agreementId, locationId }) {
  const accountDetail = await getInstallmentAccount({ agreementId, locationId });
  const account = accountDetail.agreement;
  const current = await ensureSettingsRow(pool, Number(account.hire_location_id));
  const reminder = manualReminderType(account, ghanaClock().date);
  const message = buildInstallmentReminderMessage({
    account,
    location: current.location,
    settings: current.settings,
    reminder,
  });
  return {
    account,
    location: current.location,
    settings: {
      manual_sms_enabled: current.settings.manual_sms_enabled,
      manual_whatsapp_enabled: current.settings.manual_whatsapp_enabled,
    },
    sms: getPublicSmsStatus(),
    reminder,
    recipient_phone: normalizeGhanaPhone(account.customer_phone_snapshot),
    message,
  };
}

async function sendManualInstallmentReminder({
  agreementId,
  locationId,
  sentBy = null,
}) {
  const connection = await pool.getConnection();
  try {
    const accountRows = await loadInstallmentRows(connection, Number(locationId));
    const account = accountRows.find((row) => Number(row.id) === Number(agreementId));
    if (!account) {
      throw appError(
        "The equipment installment account was not found in the selected location.",
        404,
        "INSTALLMENT_ACCOUNT_NOT_FOUND"
      );
    }
    const current = await ensureSettingsRow(connection, Number(locationId));
    if (!current.settings.manual_sms_enabled) {
      throw appError(
        "Manual equipment installment SMS reminders are disabled in Installment Settings.",
        403,
        "MANUAL_INSTALLMENT_SMS_DISABLED"
      );
    }
    const sms = getPublicSmsStatus();
    if (!sms.automatic_available) {
      throw appError(sms.mode_message, 503, "SMS_PROVIDER_NOT_READY");
    }
    const stats = await reminderFrequencyStats(connection, locationId, agreementId);
    const limitReason = reminderLimitReason(stats, current.settings);
    if (limitReason) {
      const descriptions = {
        maximum_7_day_limit: `This account has reached the saved limit of ${current.settings.max_sms_7_days} installment SMS in 7 days.`,
        maximum_30_day_limit: `This account has reached the saved limit of ${current.settings.max_sms_30_days} installment SMS in 30 days.`,
        minimum_hours_not_reached: `Wait at least ${current.settings.minimum_hours_between_sms} hours between installment SMS for this account.`,
      };
      throw appError(
        descriptions[limitReason] || "This reminder is blocked by Installment Settings.",
        429,
        "MANUAL_INSTALLMENT_SMS_LIMIT_REACHED"
      );
    }
    const reminder = manualReminderType(account, ghanaClock().date);
    const message = buildInstallmentReminderMessage({
      account,
      location: current.location,
      settings: current.settings,
      reminder,
    });
    const reminderKey = `manual-command:${account.id}:${Date.now()}:${sentBy || 0}`;
    await connection.query(
      `INSERT INTO equipment_sales_reminder_log (
         hire_location_id, agreement_id, schedule_id, reminder_key,
         reminder_type, recipient_phone, delivery_status,
         message_preview, sent_by, created_at
       ) VALUES (?, ?, NULL, ?, 'manual', ?, 'pending', ?, ?, NOW())`,
      [
        account.hire_location_id,
        account.id,
        reminderKey,
        account.customer_phone_snapshot,
        message.slice(0, 500),
        sentBy || null,
      ]
    );
    const sent = await sendInstallmentReminder({
      connection,
      account,
      location: current.location,
      settings: current.settings,
      reminder: { ...reminder, type: "manual" },
      reminderKey,
      message,
      sentBy,
    });
    await writeAuditEvent({
      connection,
      userId: sentBy,
      workspaceCode: "equipment_hire",
      businessUnitId: current.location.business_unit_id,
      hireLocationId: account.hire_location_id,
      action: "EQUIPMENT_INSTALLMENT_MANUAL_REMINDER_SENT",
      actionType: "EQUIPMENT_INSTALLMENT_MANUAL_REMINDER_SENT",
      entityType: "equipment_sale_agreement",
      entityId: account.id,
      outcome: sent.success ? "success" : "failed",
      severity: sent.success ? "notice" : "warning",
      details: `Manual installment reminder for ${account.agreement_number} recorded as ${sent.status}.`,
      metadata: {
        sms_log_id: sent.sms_log_id,
        customer_name: account.customer_name_snapshot,
        outstanding_balance: account.outstanding_balance,
      },
    });
    return sent;
  } finally {
    connection.release();
  }
}

async function listInstallmentReminderHistory(locationId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, MAX_HISTORY_LIMIT));
  const [rows] = await pool.query(
    `SELECT
       esrl.id,
       esrl.agreement_id,
       esrl.reminder_type,
       esrl.recipient_phone,
       esrl.delivery_status,
       esrl.message_preview,
       esrl.sent_at,
       esrl.created_at,
       esa.agreement_number,
       esa.customer_name_snapshot AS customer_name,
       esa.asset_name_snapshot AS equipment_name,
       sl.provider,
       sl.provider_status,
       sl.status_reason,
       sl.delivery_confirmed_at,
       u.full_name AS sent_by_name
     FROM equipment_sales_reminder_log esrl
     INNER JOIN equipment_sale_agreements esa ON esa.id = esrl.agreement_id
     LEFT JOIN sms_log sl ON sl.id = esrl.sms_log_id
     LEFT JOIN users u ON u.id = esrl.sent_by
     WHERE esrl.hire_location_id = ?
     ORDER BY esrl.id DESC
     LIMIT ${safeLimit}`,
    [Number(locationId)]
  );
  return rows;
}

let scheduler = null;

function startEquipmentSalesReminderScheduler() {
  const explicitlyDisabled = ["0", "false", "no", "off"].includes(
    String(process.env.EQUIPMENT_SALES_SMS_REMINDERS_ENABLED || "true")
      .trim()
      .toLowerCase()
  );
  if (explicitlyDisabled || scheduler) return;

  const intervalMinutes = Math.max(
    60,
    Number(process.env.EQUIPMENT_SALES_REMINDER_INTERVAL_MINUTES || 60)
  );
  const execute = async () => {
    try {
      const result = await runEquipmentSalesReminderSync({
        source: "automatic",
        bypassTime: false,
      });
      console.log(
        `Equipment installment reminder sync: locations ${result.locations_checked}, checked ${result.checked}, sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}.`
      );
    } catch (error) {
      console.error("Equipment installment reminder sync failed:", error.message);
    }
  };
  scheduler = setInterval(execute, intervalMinutes * 60 * 1000);
  scheduler.unref?.();
  setTimeout(execute, 45 * 1000).unref?.();
}

module.exports = {
  DEFAULT_MESSAGE_TEMPLATE,
  FOLLOW_UP_ACTION,
  FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_TYPES,
  agingBucket,
  buildInstallmentReminderMessage,
  classifyScheduledReminder,
  defaultInstallmentReminderSettings,
  getAgreementReminderPreview,
  getInstallmentAccount,
  getInstallmentPortfolio,
  getInstallmentReminderSettings,
  getPublicSmsStatus,
  ghanaClock,
  listInstallmentCollections,
  listInstallmentReminderHistory,
  normalizeInstallmentReminderSettings,
  previewInstallmentReminders,
  recordInstallmentFollowUp,
  refreshEquipmentInstallmentStatuses,
  reminderLimitReason,
  riskProfile,
  runEquipmentSalesReminderSync,
  saveInstallmentReminderSettings,
  sendManualInstallmentReminder,
  startEquipmentSalesReminderScheduler,
};
