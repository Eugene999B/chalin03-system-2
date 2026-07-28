const { pool } = require("../config/db");
const {
  getSmsConfig,
  normalizeGhanaPhone,
  sendSms,
} = require("./smsService");
const { estimateSmsSegments } = require("./smsReliabilityService");

const SETTING_PREFIX = "debt_reminders.branch.";
const DEFAULT_MESSAGE_TEMPLATE =
  "CHALIN03: Dear {customer_name}, your outstanding balance at {store_name} is GHS {outstanding_balance} across {debt_count} debt receipt(s). {due_sentence} Please make payment promptly.{payment_sentence} Thank you.";
const MAX_HISTORY_LIMIT = 200;

function appError(message, statusCode = 400, code = "DEBT_REMINDER_ERROR") {
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

function defaultDebtReminderSettings() {
  return {
    automatic_sms_enabled: false,
    manual_sms_enabled: true,
    manual_whatsapp_enabled: true,
    reminder_time: "09:00",
    timezone: "Africa/Accra",
    due_soon_enabled: true,
    due_soon_days: [7, 3, 1],
    due_today_enabled: true,
    overdue_enabled: true,
    overdue_start_days: 1,
    overdue_repeat_days: 3,
    max_sms_7_days: 3,
    max_sms_30_days: 8,
    minimum_hours_between_sms: 24,
    minimum_balance: 1,
    skip_weekends: false,
    include_payment_phone: true,
    message_template: DEFAULT_MESSAGE_TEMPLATE,
  };
}

function normalizeDebtReminderSettings(input = {}, existing = {}) {
  const defaults = { ...defaultDebtReminderSettings(), ...existing };
  const dueSoonDays = parseDueSoonDays(
    input.due_soon_days === undefined
      ? defaults.due_soon_days
      : input.due_soon_days
  );
  const messageTemplate = cleanText(
    input.message_template === undefined
      ? defaults.message_template
      : input.message_template,
    1000
  );

  if (!messageTemplate) {
    throw appError("Debt reminder message template cannot be empty.");
  }

  if (
    !messageTemplate.includes("{customer_name}") ||
    !messageTemplate.includes("{outstanding_balance}")
  ) {
    throw appError(
      "The message template must contain {customer_name} and {outstanding_balance}."
    );
  }

  return {
    automatic_sms_enabled: booleanValue(
      input.automatic_sms_enabled,
      defaults.automatic_sms_enabled
    ),
    manual_sms_enabled: booleanValue(
      input.manual_sms_enabled,
      defaults.manual_sms_enabled
    ),
    manual_whatsapp_enabled: booleanValue(
      input.manual_whatsapp_enabled,
      defaults.manual_whatsapp_enabled
    ),
    reminder_time: normalizeReminderTime(
      input.reminder_time === undefined
        ? defaults.reminder_time
        : input.reminder_time
    ),
    timezone: "Africa/Accra",
    due_soon_enabled: booleanValue(
      input.due_soon_enabled,
      defaults.due_soon_enabled
    ),
    due_soon_days: dueSoonDays.length ? dueSoonDays : [3, 1],
    due_today_enabled: booleanValue(
      input.due_today_enabled,
      defaults.due_today_enabled
    ),
    overdue_enabled: booleanValue(
      input.overdue_enabled,
      defaults.overdue_enabled
    ),
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
    max_sms_7_days: wholeNumber(
      input.max_sms_7_days,
      defaults.max_sms_7_days,
      1,
      50
    ),
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
    skip_weekends: booleanValue(
      input.skip_weekends,
      defaults.skip_weekends
    ),
    include_payment_phone: booleanValue(
      input.include_payment_phone,
      defaults.include_payment_phone
    ),
    message_template: messageTemplate,
  };
}

function requestIp(req) {
  return cleanText(
    String(
      req?.headers?.["x-forwarded-for"] ||
        req?.ip ||
        req?.socket?.remoteAddress ||
        ""
    ).split(",")[0],
    50
  );
}

function requestUserAgent(req) {
  return cleanText(req?.headers?.["user-agent"], 500);
}

function settingKey(branchId) {
  return `${SETTING_PREFIX}${Number(branchId)}`;
}

async function ensureConfigurationStorage(connection = pool) {
  const requiredTables = [
    "group_configuration",
    "group_configuration_history",
    "sms_log",
  ];
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (?, ?, ?)`,
    requiredTables
  );
  const existing = new Set(rows.map((row) => row.TABLE_NAME));
  const missing = requiredTables.filter((tableName) => !existing.has(tableName));

  if (missing.length) {
    throw appError(
      `Debt reminder storage is unavailable. Missing: ${missing.join(", ")}.`,
      503,
      "DEBT_REMINDER_STORAGE_UNAVAILABLE"
    );
  }
}

async function getBranchProfile(connection, branchId) {
  const [rows] = await connection.query(
    `SELECT
       b.id AS branch_id,
       b.code AS branch_code,
       b.name AS branch_name,
       b.location AS branch_location,
       COALESCE(s.business_name, 'Chalin 03 Company Limited') AS business_name,
       COALESCE(NULLIF(s.owner_phone, ''), NULLIF(s.business_phone, ''), '') AS payment_phone
     FROM branches b
     LEFT JOIN settings s ON s.branch_id = b.id
     WHERE b.id = ?
     ORDER BY s.id DESC
     LIMIT 1`,
    [branchId]
  );

  if (!rows.length) {
    throw appError("The selected store was not found.", 404, "BRANCH_NOT_FOUND");
  }

  return rows[0];
}

async function ensureSettingsRow(connection, branchId) {
  await ensureConfigurationStorage(connection);
  const branch = await getBranchProfile(connection, branchId);
  const key = settingKey(branchId);
  const defaults = defaultDebtReminderSettings();

  await connection.query(
    `INSERT IGNORE INTO group_configuration (
       setting_key,
       setting_group,
       setting_label,
       setting_description,
       value_type,
       value_text,
       is_sensitive,
       is_editable,
       sort_order,
       updated_by
     ) VALUES (?, 'debt_reminders', ?, ?, 'text', ?, FALSE, FALSE, ?, NULL)`,
    [
      key,
      `Debt reminders — ${branch.branch_code || branch.branch_name}`,
      "Managed from the Spare Parts Debts page. Stores automatic SMS frequency, timing and anti-spam rules.",
      JSON.stringify(defaults),
      Number(branchId),
    ]
  );

  const [rows] = await connection.query(
    `SELECT *
     FROM group_configuration
     WHERE setting_key = ?
     LIMIT 1`,
    [key]
  );

  if (!rows.length) {
    throw appError(
      "Debt reminder settings could not be initialized.",
      503,
      "DEBT_REMINDER_SETTINGS_UNAVAILABLE"
    );
  }

  let saved = {};
  try {
    saved = JSON.parse(rows[0].value_text || "{}");
  } catch {
    saved = {};
  }

  return {
    row: rows[0],
    branch,
    settings: normalizeDebtReminderSettings(saved),
  };
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
      "Mock mode is active. Reminder records will be created, but no real SMS credit will be used.";
  } else if (automaticAvailable) {
    modeMessage = `${provider.toUpperCase()} live SMS is ready for automatic reminders.`;
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

async function getDebtReminderSettings(branchId) {
  const result = await ensureSettingsRow(pool, Number(branchId));
  const sms = getPublicSmsStatus();

  return {
    branch: result.branch,
    settings: result.settings,
    sms,
    automatic_effective:
      result.settings.automatic_sms_enabled && sms.automatic_available,
  };
}

async function saveDebtReminderSettings({
  branchId,
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
    const current = await ensureSettingsRow(connection, Number(branchId));
    const normalized = normalizeDebtReminderSettings(input, current.settings);
    const oldValue = JSON.stringify(current.settings);
    const newValue = JSON.stringify(normalized);

    if (oldValue !== newValue) {
      await connection.query(
        `UPDATE group_configuration
         SET value_text = ?,
             updated_by = ?,
             updated_at = NOW()
         WHERE setting_key = ?`,
        [newValue, userId || null, current.row.setting_key]
      );

      await connection.query(
        `INSERT INTO group_configuration_history (
           setting_key,
           old_value_text,
           new_value_text,
           change_reason,
           changed_by,
           request_id,
           ip_address,
           user_agent,
           created_at
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

      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, 'DEBT_REMINDER_SETTINGS_UPDATED', ?)`,
        [
          Number(branchId),
          userId || null,
          safeJson({
            reason: cleanReason,
            automatic_sms_enabled: normalized.automatic_sms_enabled,
            reminder_time: normalized.reminder_time,
            due_soon_days: normalized.due_soon_days,
            overdue_repeat_days: normalized.overdue_repeat_days,
            max_sms_7_days: normalized.max_sms_7_days,
            max_sms_30_days: normalized.max_sms_30_days,
            minimum_hours_between_sms: normalized.minimum_hours_between_sms,
          }),
        ]
      );
    }

    await connection.commit();

    return {
      changed: oldValue !== newValue,
      branch: current.branch,
      settings: normalized,
      sms: getPublicSmsStatus(),
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function dateText(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dayDifference(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
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

function humanDate(value) {
  const text = dateText(value);
  if (!text) return "not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${text}T00:00:00Z`));
}

async function listCustomerDebtSummaries(connection, branchId, minimumBalance = 0) {
  const today = ghanaClock().date;
  const [rows] = await connection.query(
    `SELECT
       c.id AS customer_id,
       c.name AS customer_name,
       COALESCE(NULLIF(c.phone, ''), MAX(NULLIF(d.customer_phone, ''))) AS customer_phone,
       c.location AS customer_location,
       COUNT(d.id) AS debt_count,
       SUM(CASE WHEN d.status IN ('unpaid', 'partial') AND d.balance > 0 THEN 1 ELSE 0 END) AS active_debt_count,
       COALESCE(SUM(d.amount_owed), 0) AS total_owed,
       COALESCE(SUM(d.amount_paid), 0) AS total_paid,
       COALESCE(SUM(d.balance), 0) AS outstanding_balance,
       SUM(CASE WHEN DATE(d.due_date) < ? THEN 1 ELSE 0 END) AS overdue_count,
       MIN(CASE WHEN DATE(d.due_date) < ? THEN DATE(d.due_date) END) AS earliest_overdue_date,
       MIN(CASE WHEN DATE(d.due_date) >= ? THEN DATE(d.due_date) END) AS next_due_date,
       MIN(DATE(d.created_at)) AS first_debt_date,
       MAX(DATE(d.created_at)) AS last_debt_date
     FROM customers c
     INNER JOIN debts d
       ON d.customer_id = c.id
      AND d.branch_id = c.branch_id
      AND d.status IN ('unpaid', 'partial')
      AND d.balance > 0
     WHERE c.branch_id = ?
     GROUP BY c.id, c.name, c.phone, c.location
     HAVING COALESCE(SUM(d.balance), 0) >= ?
     ORDER BY overdue_count DESC, outstanding_balance DESC, c.name ASC
     LIMIT 500`,
    [today, today, today, Number(branchId), Number(minimumBalance || 0)]
  );

  return rows.map((row) => ({
    ...row,
    customer_id: Number(row.customer_id),
    debt_count: Number(row.debt_count || 0),
    active_debt_count: Number(row.active_debt_count || 0),
    total_owed: Number(row.total_owed || 0),
    total_paid: Number(row.total_paid || 0),
    outstanding_balance: Number(row.outstanding_balance || 0),
    overdue_count: Number(row.overdue_count || 0),
    earliest_overdue_date: dateText(row.earliest_overdue_date),
    next_due_date: dateText(row.next_due_date),
    first_debt_date: dateText(row.first_debt_date),
    last_debt_date: dateText(row.last_debt_date),
  }));
}

function classifyScheduledReminder(customer, settings, today) {
  if (customer.overdue_count > 0 && customer.earliest_overdue_date) {
    const daysOverdue = dayDifference(customer.earliest_overdue_date, today);
    if (
      settings.overdue_enabled &&
      daysOverdue >= settings.overdue_start_days &&
      (daysOverdue - settings.overdue_start_days) % settings.overdue_repeat_days === 0
    ) {
      return {
        type: "overdue",
        days: daysOverdue,
        target_date: customer.earliest_overdue_date,
      };
    }
    return null;
  }

  if (!customer.next_due_date) return null;
  const daysUntilDue = dayDifference(today, customer.next_due_date);

  if (daysUntilDue === 0 && settings.due_today_enabled) {
    return {
      type: "due_today",
      days: 0,
      target_date: customer.next_due_date,
    };
  }

  if (
    daysUntilDue > 0 &&
    settings.due_soon_enabled &&
    settings.due_soon_days.includes(daysUntilDue)
  ) {
    return {
      type: "due_soon",
      days: daysUntilDue,
      target_date: customer.next_due_date,
    };
  }

  return null;
}

function manualReminderType(customer, today) {
  if (customer.overdue_count > 0 && customer.earliest_overdue_date) {
    return {
      type: "overdue",
      days: dayDifference(customer.earliest_overdue_date, today),
      target_date: customer.earliest_overdue_date,
    };
  }
  if (customer.next_due_date) {
    const days = dayDifference(today, customer.next_due_date);
    return {
      type: days === 0 ? "due_today" : "manual",
      days,
      target_date: customer.next_due_date,
    };
  }
  return { type: "manual", days: null, target_date: null };
}

function dueSentence(customer, reminder) {
  if (reminder.type === "overdue") {
    return `${customer.overdue_count} debt record(s) are overdue from ${humanDate(
      customer.earliest_overdue_date
    )}.`;
  }
  if (reminder.type === "due_today") {
    return "The next debt payment is due today.";
  }
  if (reminder.target_date) {
    return `The next debt payment is due on ${humanDate(reminder.target_date)}.`;
  }
  return "Please review the attached debt account with our store.";
}

function buildCustomerDebtReminderMessage({ customer, branch, settings, reminder }) {
  const paymentPhone = cleanText(branch.payment_phone, 40);
  const replacements = {
    customer_name: customer.customer_name || "Customer",
    outstanding_balance: Number(customer.outstanding_balance || 0).toLocaleString(
      "en-GB",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    ),
    total_owed: Number(customer.total_owed || 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    total_paid: Number(customer.total_paid || 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    debt_count: String(customer.debt_count || 0),
    overdue_count: String(customer.overdue_count || 0),
    next_due_date: humanDate(customer.next_due_date),
    store_name: branch.branch_name || "Chalin 03",
    store_code: branch.branch_code || "MAIN",
    payment_phone: paymentPhone,
    reminder_type: reminder.type,
    due_sentence: dueSentence(customer, reminder),
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
  if (message.length > 480) {
    message = `${message.slice(0, 477).trim()}...`;
  }
  return message;
}

async function getCustomerDebtSummary(connection, branchId, customerId) {
  const customers = await listCustomerDebtSummaries(connection, branchId, 0);
  const customer = customers.find(
    (item) => Number(item.customer_id) === Number(customerId)
  );

  if (!customer) {
    throw appError(
      "This customer has no active debt in the selected store.",
      404,
      "CUSTOMER_DEBT_NOT_FOUND"
    );
  }
  return customer;
}

async function reminderFrequencyStats(connection, branchId, customerId) {
  const sourcePattern = `debt-customer:${Number(customerId)}:%`;
  const [rows] = await connection.query(
    `SELECT
       SUM(CASE
         WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          AND COALESCE(status, 'failed') <> 'failed'
         THEN 1 ELSE 0 END) AS count_7_days,
       SUM(CASE
         WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND COALESCE(status, 'failed') <> 'failed'
         THEN 1 ELSE 0 END) AS count_30_days,
       MAX(CASE
         WHEN COALESCE(status, 'failed') <> 'failed'
         THEN created_at END) AS last_sent_at
     FROM sms_log
     WHERE branch_id = ?
       AND sms_type = 'debt_reminder'
       AND source_reference LIKE ?`,
    [Number(branchId), sourcePattern]
  );
  const row = rows[0] || {};
  return {
    count_7_days: Number(row.count_7_days || 0),
    count_30_days: Number(row.count_30_days || 0),
    last_sent_at: row.last_sent_at || null,
  };
}

function automaticLimitReason(stats, settings, now = new Date()) {
  if (stats.count_7_days >= settings.max_sms_7_days) {
    return "maximum_7_day_limit";
  }
  if (stats.count_30_days >= settings.max_sms_30_days) {
    return "maximum_30_day_limit";
  }
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

async function wasScheduledReminderSent(
  connection,
  branchId,
  customerId,
  reminderType,
  runDate
) {
  const sourceReference = `debt-customer:${Number(
    customerId
  )}:scheduled:${reminderType}:${runDate}`;
  const [rows] = await connection.query(
    `SELECT id
     FROM sms_log
     WHERE branch_id = ?
       AND source_reference = ?
       AND COALESCE(status, 'failed') <> 'failed'
     LIMIT 1`,
    [Number(branchId), sourceReference]
  );
  return rows.length > 0;
}

async function writeSmsLog(connection, {
  branchId,
  phone,
  message,
  sourceReference,
  sentBy,
  result,
  error,
}) {
  const config = getSmsConfig();
  const metrics = estimateSmsSegments(message);
  const submittedAt = result?.submittedAt ? new Date(result.submittedAt) : null;
  const status = result?.status || "failed";
  const providerResponse =
    result?.providerResponse ||
    error?.providerResponse ||
    (error ? { error: error.message } : null);

  const [insert] = await connection.query(
    `INSERT INTO sms_log (
       branch_id,
       recipient_phone,
       message,
       sms_type,
       status,
       provider,
       sender_id,
       provider_message_id,
       provider_status,
       status_reason,
       segment_count,
       estimated_credits,
       source_reference,
       provider_response,
       sent_by,
       sent_at,
       submitted_at,
       last_status_at
     ) VALUES (?, ?, ?, 'debt_reminder', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      Number(branchId),
      phone,
      message,
      status,
      result?.provider || error?.provider || config.provider || null,
      result?.senderId || config.senderId || null,
      result?.providerMessageId || error?.providerMessageId || null,
      result?.providerStatus || error?.providerStatus || null,
      error?.message || null,
      Math.max(Number(result?.segmentCount || metrics.segment_count || 1), 1),
      Math.max(Number(result?.estimatedCredits || metrics.estimated_credits || 0), 0),
      sourceReference,
      safeJson(providerResponse),
      sentBy || null,
      submittedAt,
      submittedAt,
    ]
  );

  return {
    sms_log_id: insert.insertId,
    success: Boolean(result?.success),
    status,
    provider: result?.provider || config.provider || null,
    provider_message_id: result?.providerMessageId || null,
    error: error?.message || null,
  };
}

async function sendLoggedCustomerSms(connection, {
  branchId,
  customer,
  branch,
  settings,
  reminder,
  sourceReference,
  sentBy = null,
}) {
  const phone = normalizeGhanaPhone(customer.customer_phone);
  if (!phone) {
    return {
      success: false,
      skipped: true,
      reason: "invalid_phone",
      customer_id: customer.customer_id,
    };
  }

  const message = buildCustomerDebtReminderMessage({
    customer,
    branch,
    settings,
    reminder,
  });
  let result = null;
  let sendError = null;

  try {
    result = await sendSms({ to: phone, message });
  } catch (error) {
    sendError = error;
  }

  const log = await writeSmsLog(connection, {
    branchId,
    phone,
    message,
    sourceReference,
    sentBy,
    result,
    error: sendError,
  });

  return {
    ...log,
    skipped: false,
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    recipient_phone: phone,
    message,
    reminder_type: reminder.type,
  };
}

async function previewDebtReminders(branchId) {
  const current = await ensureSettingsRow(pool, Number(branchId));
  const clock = ghanaClock();
  const customers = await listCustomerDebtSummaries(
    pool,
    Number(branchId),
    current.settings.minimum_balance
  );
  const preview = {
    checked: customers.length,
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

  for (const customer of customers) {
    const reminder = classifyScheduledReminder(
      customer,
      current.settings,
      clock.date
    );
    if (!reminder) {
      preview.not_due_today += 1;
      continue;
    }
    if (!normalizeGhanaPhone(customer.customer_phone)) {
      preview.invalid_phone += 1;
      continue;
    }
    if (
      await wasScheduledReminderSent(
        pool,
        branchId,
        customer.customer_id,
        reminder.type,
        clock.date
      )
    ) {
      preview.already_sent_today += 1;
      continue;
    }
    const stats = await reminderFrequencyStats(
      pool,
      branchId,
      customer.customer_id
    );
    const limitReason = automaticLimitReason(stats, current.settings);
    if (limitReason) {
      preview.limited += 1;
      continue;
    }

    preview.eligible += 1;
    preview[reminder.type] += 1;
    if (preview.sample.length < 12) {
      preview.sample.push({
        customer_id: customer.customer_id,
        customer_name: customer.customer_name,
        customer_phone: customer.customer_phone,
        outstanding_balance: customer.outstanding_balance,
        debt_count: customer.debt_count,
        reminder_type: reminder.type,
        target_date: reminder.target_date,
      });
    }
  }

  return {
    branch: current.branch,
    settings: current.settings,
    sms: getPublicSmsStatus(),
    preview,
    generated_at: new Date().toISOString(),
  };
}

async function runBranchDebtReminders({
  branchId,
  source = "automatic",
  sentBy = null,
  bypassTime = false,
}) {
  const connection = await pool.getConnection();
  const lockName = `chalin03:debt-reminder:${Number(branchId)}`;
  let lockAcquired = false;

  try {
    const [[lockRow]] = await connection.query(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [lockName]
    );
    lockAcquired = Number(lockRow?.acquired || 0) === 1;
    if (!lockAcquired) {
      return {
        branch_id: Number(branchId),
        skipped: true,
        reason: "another_reminder_run_is_active",
      };
    }

    const current = await ensureSettingsRow(connection, Number(branchId));
    const sms = getPublicSmsStatus();
    const clock = ghanaClock();
    const result = {
      branch_id: Number(branchId),
      branch_code: current.branch.branch_code,
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
      return { ...result, skipped: 1, reason: "automatic_sms_disabled" };
    }
    if (!sms.automatic_available) {
      return { ...result, skipped: 1, reason: "sms_provider_not_ready" };
    }
    if (
      !bypassTime &&
      source === "automatic" &&
      clock.time < current.settings.reminder_time
    ) {
      return { ...result, skipped: 1, reason: "scheduled_time_not_reached" };
    }
    if (
      !bypassTime &&
      source === "automatic" &&
      current.settings.skip_weekends &&
      ["Sat", "Sun"].includes(clock.weekday)
    ) {
      return { ...result, skipped: 1, reason: "weekend_skipped" };
    }

    const customers = await listCustomerDebtSummaries(
      connection,
      Number(branchId),
      current.settings.minimum_balance
    );
    result.checked = customers.length;

    for (const customer of customers) {
      const reminder = classifyScheduledReminder(
        customer,
        current.settings,
        clock.date
      );
      if (!reminder) {
        result.not_due_today += 1;
        result.skipped += 1;
        continue;
      }
      if (!normalizeGhanaPhone(customer.customer_phone)) {
        result.invalid_phone += 1;
        result.skipped += 1;
        continue;
      }
      if (
        await wasScheduledReminderSent(
          connection,
          branchId,
          customer.customer_id,
          reminder.type,
          clock.date
        )
      ) {
        result.already_processed += 1;
        result.skipped += 1;
        continue;
      }

      const stats = await reminderFrequencyStats(
        connection,
        branchId,
        customer.customer_id
      );
      if (automaticLimitReason(stats, current.settings)) {
        result.limited += 1;
        result.skipped += 1;
        continue;
      }

      const sourceReference = `debt-customer:${customer.customer_id}:scheduled:${reminder.type}:${clock.date}`;
      const sent = await sendLoggedCustomerSms(connection, {
        branchId,
        customer,
        branch: current.branch,
        settings: current.settings,
        reminder,
        sourceReference,
        sentBy,
      });

      if (sent.success) result.sent += 1;
      else result.failed += 1;
    }

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, 'DEBT_REMINDER_RUN_COMPLETED', ?)`,
      [Number(branchId), sentBy || null, safeJson(result)]
    );

    return result;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
      } catch {
        // The database also releases named locks when the connection closes.
      }
    }
    connection.release();
  }
}

async function runDebtReminderSync({
  branchId = null,
  source = "automatic",
  sentBy = null,
  bypassTime = false,
} = {}) {
  let branchIds = [];
  if (Number.isInteger(Number(branchId)) && Number(branchId) > 0) {
    branchIds = [Number(branchId)];
  } else {
    await ensureConfigurationStorage(pool);
    const [rows] = await pool.query(
      `SELECT setting_key
       FROM group_configuration
       WHERE setting_key LIKE ?
       ORDER BY setting_key`,
      [`${SETTING_PREFIX}%`]
    );
    branchIds = rows
      .map((row) => Number(String(row.setting_key).slice(SETTING_PREFIX.length)))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  const result = {
    source,
    branches_checked: branchIds.length,
    checked: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    branches: [],
  };

  for (const id of branchIds) {
    try {
      const branchResult = await runBranchDebtReminders({
        branchId: id,
        source,
        sentBy,
        bypassTime,
      });
      result.branches.push(branchResult);
      result.checked += Number(branchResult.checked || 0);
      result.sent += Number(branchResult.sent || 0);
      result.failed += Number(branchResult.failed || 0);
      result.skipped += Number(branchResult.skipped || 0);
    } catch (error) {
      result.failed += 1;
      result.branches.push({
        branch_id: id,
        failed: 1,
        error: error.message,
      });
    }
  }
  return result;
}

async function getCustomerReminderPreview({ branchId, customerId }) {
  const current = await ensureSettingsRow(pool, Number(branchId));
  const customer = await getCustomerDebtSummary(
    pool,
    Number(branchId),
    Number(customerId)
  );
  const reminder = manualReminderType(customer, ghanaClock().date);
  const message = buildCustomerDebtReminderMessage({
    customer,
    branch: current.branch,
    settings: current.settings,
    reminder,
  });

  return {
    branch: current.branch,
    settings: {
      manual_sms_enabled: current.settings.manual_sms_enabled,
      manual_whatsapp_enabled: current.settings.manual_whatsapp_enabled,
    },
    sms: getPublicSmsStatus(),
    customer,
    reminder,
    recipient_phone: normalizeGhanaPhone(customer.customer_phone),
    message,
  };
}

async function sendCustomerDebtReminderSms({
  branchId,
  customerId,
  sentBy = null,
}) {
  const connection = await pool.getConnection();
  try {
    const current = await ensureSettingsRow(connection, Number(branchId));
    if (!current.settings.manual_sms_enabled) {
      throw appError(
        "Manual customer debt SMS reminders are disabled in Debt Reminder Settings.",
        403,
        "MANUAL_DEBT_SMS_DISABLED"
      );
    }
    const sms = getPublicSmsStatus();
    if (!sms.automatic_available) {
      throw appError(sms.mode_message, 503, "SMS_PROVIDER_NOT_READY");
    }

    const customer = await getCustomerDebtSummary(
      connection,
      Number(branchId),
      Number(customerId)
    );
    const reminder = manualReminderType(customer, ghanaClock().date);
    const sourceReference = `debt-customer:${customer.customer_id}:manual:${Date.now()}`;
    const result = await sendLoggedCustomerSms(connection, {
      branchId,
      customer,
      branch: current.branch,
      settings: current.settings,
      reminder,
      sourceReference,
      sentBy,
    });

    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, 'CUSTOMER_DEBT_SMS_REMINDER_SENT', ?)`,
      [
        Number(branchId),
        sentBy || null,
        safeJson({
          customer_id: customer.customer_id,
          customer_name: customer.customer_name,
          outstanding_balance: customer.outstanding_balance,
          sms_log_id: result.sms_log_id,
          status: result.status,
        }),
      ]
    );

    return result;
  } finally {
    connection.release();
  }
}

async function listDebtReminderHistory(branchId, limit = 50) {
  await ensureConfigurationStorage(pool);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, MAX_HISTORY_LIMIT));
  const [rows] = await pool.query(
    `SELECT
       sl.id,
       sl.recipient_phone,
       sl.message,
       sl.status,
       sl.provider,
       sl.provider_status,
       sl.status_reason,
       sl.source_reference,
       sl.sent_at,
       sl.submitted_at,
       sl.delivery_confirmed_at,
       sl.created_at,
       u.full_name AS sent_by_name,
       u.username AS sent_by_username
     FROM sms_log sl
     LEFT JOIN users u ON u.id = sl.sent_by
     WHERE sl.branch_id = ?
       AND sl.sms_type = 'debt_reminder'
       AND sl.source_reference LIKE 'debt-customer:%'
     ORDER BY sl.id DESC
     LIMIT ${safeLimit}`,
    [Number(branchId)]
  );
  return rows;
}

let scheduler = null;

function startDebtReminderScheduler() {
  const enabled = !["0", "false", "no", "off"].includes(
    String(process.env.DEBT_REMINDER_SCHEDULER_ENABLED || "true")
      .trim()
      .toLowerCase()
  );
  if (!enabled || scheduler) return;

  const intervalMinutes = Math.max(
    30,
    Number(process.env.DEBT_REMINDER_INTERVAL_MINUTES || 60)
  );
  const execute = async () => {
    try {
      const result = await runDebtReminderSync({ source: "automatic" });
      console.log(
        `Debt reminder sync: branches ${result.branches_checked}, checked ${result.checked}, sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}.`
      );
    } catch (error) {
      console.error("Debt reminder sync failed:", error.message);
    }
  };

  scheduler = setInterval(execute, intervalMinutes * 60 * 1000);
  scheduler.unref?.();
  setTimeout(execute, 45 * 1000).unref?.();
}

module.exports = {
  DEFAULT_MESSAGE_TEMPLATE,
  automaticLimitReason,
  buildCustomerDebtReminderMessage,
  classifyScheduledReminder,
  defaultDebtReminderSettings,
  getCustomerReminderPreview,
  getDebtReminderSettings,
  getPublicSmsStatus,
  ghanaClock,
  listDebtReminderHistory,
  normalizeDebtReminderSettings,
  previewDebtReminders,
  runDebtReminderSync,
  saveDebtReminderSettings,
  sendCustomerDebtReminderSms,
  startDebtReminderScheduler,
};
