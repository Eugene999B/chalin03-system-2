const { pool } = require("../config/db");
const { getSmsConfig, normalizeGhanaPhone, sendSms } = require("./smsService");
const {
  estimateSmsSegments,
  humanizeSmsStatus,
  isSubmissionAccepted,
} = require("./smsReliabilityService");

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return String(value || "");
  }
}

function truncateMessage(message, maxLength = 480) {
  const cleanSmsMessage = String(message || "").trim();

  if (cleanSmsMessage.length <= maxLength) {
    return cleanSmsMessage;
  }

  return `${cleanSmsMessage.slice(0, maxLength - 3)}...`;
}

function firstValidGhanaPhone(...values) {
  for (const value of values) {
    const rawValue = String(value || "").trim();

    if (!rawValue) {
      continue;
    }

    const possiblePhones = rawValue
      .split(/[\/,;|]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    for (const possiblePhone of possiblePhones) {
      const normalizedPhone = normalizeGhanaPhone(possiblePhone);

      if (normalizedPhone) {
        return normalizedPhone;
      }
    }

    const normalizedFullValue = normalizeGhanaPhone(rawValue);

    if (normalizedFullValue) {
      return normalizedFullValue;
    }
  }

  return "";
}

function formatSecurityDateTime(value = new Date()) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
}

async function columnExists(connection, tableName, columnName) {
  try {
    const [columns] = await connection.query(
      `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
      [columnName]
    );

    return columns.length > 0;
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      return false;
    }

    throw error;
  }
}

async function getBranchInfoById(branchId) {
  const cleanBranchId = Number(branchId || 1);

  if (!(await tableExists(pool, "branches"))) {
    return {
      id: cleanBranchId || 1,
      code: `BR-${cleanBranchId || 1}`,
      name: `Branch ${cleanBranchId || 1}`,
      location: "",
    };
  }

  const hasBranchCode = await columnExists(pool, "branches", "branch_code");
  const hasCode = await columnExists(pool, "branches", "code");
  const hasName = await columnExists(pool, "branches", "name");
  const hasBranchName = await columnExists(pool, "branches", "branch_name");
  const hasLocation = await columnExists(pool, "branches", "location");
  const hasBranchLocation = await columnExists(
    pool,
    "branches",
    "branch_location"
  );
  const hasIsActive = await columnExists(pool, "branches", "is_active");

  const codeSql = hasBranchCode
    ? "branch_code AS code"
    : hasCode
    ? "code"
    : "CONCAT('BR-', id) AS code";

  const nameSql = hasName
    ? "name"
    : hasBranchName
    ? "branch_name AS name"
    : "CONCAT('Branch ', id) AS name";

  const locationSql = hasLocation
    ? "location"
    : hasBranchLocation
    ? "branch_location AS location"
    : "'' AS location";

  const activeWhere = hasIsActive ? "AND is_active = TRUE" : "";

  const [branches] = await pool.query(
    `SELECT
      id,
      ${codeSql},
      ${nameSql},
      ${locationSql}
     FROM branches
     WHERE id = ?
     ${activeWhere}
     LIMIT 1`,
    [cleanBranchId || 1]
  );

  if (branches.length > 0) {
    return branches[0];
  }

  return {
    id: cleanBranchId || 1,
    code: `BR-${cleanBranchId || 1}`,
    name: `Branch ${cleanBranchId || 1}`,
    location: "",
  };
}

async function getSmsSettingsForBranch(branchId) {
  if (!(await tableExists(pool, "settings"))) {
    return {};
  }

  const hasBranchId = await columnExists(pool, "settings", "branch_id");
  const hasBusinessName = await columnExists(pool, "settings", "business_name");
  const hasBusinessPhone = await columnExists(pool, "settings", "business_phone");
  const hasOwnerPhone = await columnExists(pool, "settings", "owner_phone");

  const businessNameSql = hasBusinessName
    ? "business_name"
    : "'Chalin 03 Company Limited' AS business_name";

  const businessPhoneSql = hasBusinessPhone
    ? "business_phone"
    : "NULL AS business_phone";

  const ownerPhoneSql = hasOwnerPhone ? "owner_phone" : "NULL AS owner_phone";

  const whereSql = hasBranchId ? "WHERE branch_id = ?" : "";
  const params = hasBranchId ? [branchId || 1] : [];

  const [settingsRows] = await pool.query(
    `SELECT
      ${businessNameSql},
      ${businessPhoneSql},
      ${ownerPhoneSql}
     FROM settings
     ${whereSql}
     LIMIT 1`,
    params
  );

  return settingsRows[0] || {};
}

async function writeSmsLogSafe({
  branchId,
  phone,
  message,
  smsType = "security_alert",
  status,
  providerResponse,
  sentBy,
  provider = null,
  senderId = null,
  providerMessageId = null,
  providerStatus = null,
  statusReason = null,
  segmentCount = null,
  estimatedCredits = null,
  retryCount = 0,
  originalLogId = null,
  sourceReference = null,
  submittedAt = null,
  deliveryConfirmedAt = null,
}) {
  try {
    if (!(await tableExists(pool, "sms_log"))) {
      return null;
    }

    const metrics = estimateSmsSegments(message);
    const finalStatus = String(status || "delivery_unknown").toLowerCase();
    const acceptedAt = isSubmissionAccepted(finalStatus)
      ? submittedAt || new Date()
      : null;
    const deliveredAt =
      finalStatus === "delivered"
        ? deliveryConfirmedAt || submittedAt || new Date()
        : deliveryConfirmedAt || null;

    const [result] = await pool.query(
      `INSERT INTO sms_log (
        branch_id,
        recipient_phone,
        message,
        sms_type,
        status,
        provider_response,
        sent_by,
        sent_at,
        provider,
        sender_id,
        provider_message_id,
        provider_status,
        status_reason,
        segment_count,
        estimated_credits,
        retry_count,
        original_log_id,
        source_reference,
        submitted_at,
        delivery_confirmed_at,
        last_status_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branchId || null,
        phone,
        message,
        smsType,
        finalStatus,
        safeJson(providerResponse).slice(0, 6000),
        sentBy || null,
        acceptedAt,
        provider,
        senderId,
        providerMessageId,
        providerStatus,
        statusReason,
        Number(segmentCount || metrics.segment_count || 1),
        Number(
          estimatedCredits === null || estimatedCredits === undefined
            ? metrics.estimated_credits
            : estimatedCredits
        ),
        Number(retryCount || 0),
        originalLogId || null,
        sourceReference || null,
        submittedAt || acceptedAt,
        deliveredAt,
        new Date(),
      ]
    );

    return result.insertId;
  } catch (error) {
    console.warn("SMS alert log skipped:", error.message);
    return null;
  }
}

async function sendOwnerSmsAlert({
  branchId,
  message,
  smsType = "security_alert",
  sentBy = null,
  sourceReference = null,
}) {
  try {
    const settings = await getSmsSettingsForBranch(branchId);
    const config = getSmsConfig();

    const alertPhone = firstValidGhanaPhone(
      settings.owner_phone,
      settings.business_phone
    );

    if (!alertPhone) {
      console.warn("SMS alert skipped: no valid owner/admin phone found.");
      return {
        ok: false,
        skipped: true,
        status: "failed",
        status_label: "Failed",
        reason: "No valid owner/admin phone found.",
      };
    }

    const finalMessage = truncateMessage(message, 480);

    try {
      const result = await sendSms({
        to: alertPhone,
        message: finalMessage,
      });
      const finalStatus = result.status || "delivery_unknown";
      const accepted = isSubmissionAccepted(finalStatus);

      const logId = await writeSmsLogSafe({
        branchId,
        phone: alertPhone,
        message: finalMessage,
        smsType,
        status: finalStatus,
        providerResponse: result.providerResponse,
        sentBy,
        provider: result.provider || config.provider,
        senderId: result.senderId || config.senderId,
        providerMessageId: result.providerMessageId,
        providerStatus: result.providerStatus,
        segmentCount: result.segmentCount,
        estimatedCredits: result.estimatedCredits,
        sourceReference,
        submittedAt: result.submittedAt || new Date(),
        deliveryConfirmedAt:
          finalStatus === "delivered" ? new Date() : null,
      });

      return {
        ok: accepted,
        skipped: false,
        log_id: logId,
        phone: alertPhone,
        status: finalStatus,
        status_label: humanizeSmsStatus(finalStatus),
        provider: result.provider || config.provider,
        sender_id: result.senderId || config.senderId,
        provider_message_id: result.providerMessageId || null,
        provider_status: result.providerStatus || null,
        segment_count: result.segmentCount || 1,
        estimated_credits: Number(result.estimatedCredits || 0),
        submitted_at: result.submittedAt || new Date(),
        delivery_confirmed: finalStatus === "delivered",
        message:
          finalStatus === "delivered"
            ? "SMS delivery was confirmed."
            : finalStatus === "accepted"
              ? "SMS was accepted by the provider; phone delivery is still pending confirmation."
              : "SMS submission completed, but phone delivery could not be confirmed.",
        providerResponse: result.providerResponse,
      };
    } catch (error) {
      const submissionUncertain =
        !error.statusCode ||
        error.statusCode === 408 ||
        /timeout|timed out|network|socket|connection reset|fetch failed/i.test(
          String(error.message || "")
        );
      const failureStatus = submissionUncertain
        ? "delivery_unknown"
        : "failed";
      const providerResponse = {
        error: error.message,
        statusCode: error.statusCode || null,
        providerResponse: error.providerResponse || null,
      };

      const logId = await writeSmsLogSafe({
        branchId,
        phone: alertPhone,
        message: finalMessage,
        smsType,
        status: failureStatus,
        providerResponse,
        sentBy,
        provider: error.provider || config.provider,
        senderId: config.senderId,
        providerMessageId: error.providerMessageId,
        providerStatus: error.providerStatus,
        statusReason: error.message,
        sourceReference,
        submittedAt: failureStatus === "delivery_unknown" ? new Date() : null,
      });

      console.warn("SMS alert failed:", error.message);

      return {
        ok: failureStatus === "delivery_unknown",
        skipped: false,
        log_id: logId,
        phone: alertPhone,
        status: failureStatus,
        status_label: humanizeSmsStatus(failureStatus),
        delivery_confirmed: false,
        error: error.message,
        message:
          failureStatus === "delivery_unknown"
            ? "SMS delivery is unknown. Check the provider dashboard before retrying to avoid duplicate credit charges."
            : "SMS failed before provider acceptance was confirmed.",
      };
    }
  } catch (error) {
    console.warn("SMS alert skipped:", error.message);

    return {
      ok: false,
      skipped: true,
      status: "failed",
      status_label: "Failed",
      reason: error.message,
    };
  }
}

async function buildOwnerAlertContext(branchId) {
  const settings = await getSmsSettingsForBranch(branchId);
  const branch = await getBranchInfoById(branchId);

  return {
    settings,
    branch,
    businessName: settings.business_name || "Chalin 03 Company Limited",
  };
}

module.exports = {
  buildOwnerAlertContext,
  firstValidGhanaPhone,
  formatMoney,
  formatSecurityDateTime,
  getBranchInfoById,
  getSmsSettingsForBranch,
  sendOwnerSmsAlert,
  truncateMessage,
  writeSmsLogSafe,
};