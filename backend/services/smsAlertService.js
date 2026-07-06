const { pool } = require("../config/db");
const { normalizeGhanaPhone, sendSms } = require("./smsService");

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
}) {
  try {
    if (!(await tableExists(pool, "sms_log"))) {
      return;
    }

    const sentAt = status === "sent" ? new Date() : null;

    await pool.query(
      `INSERT INTO sms_log (
        branch_id,
        recipient_phone,
        message,
        sms_type,
        status,
        provider_response,
        sent_by,
        sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branchId || null,
        phone,
        message,
        smsType,
        status,
        safeJson(providerResponse).slice(0, 6000),
        sentBy || null,
        sentAt,
      ]
    );
  } catch (error) {
    console.warn("SMS alert log skipped:", error.message);
  }
}

async function sendOwnerSmsAlert({
  branchId,
  message,
  smsType = "security_alert",
  sentBy = null,
}) {
  try {
    const settings = await getSmsSettingsForBranch(branchId);

    const alertPhone = firstValidGhanaPhone(
      settings.owner_phone,
      settings.business_phone
    );

    if (!alertPhone) {
      console.warn("SMS alert skipped: no valid owner/admin phone found.");
      return {
        ok: false,
        skipped: true,
        reason: "No valid owner/admin phone found.",
      };
    }

    const finalMessage = truncateMessage(message, 480);

    try {
      const result = await sendSms({
        to: alertPhone,
        message: finalMessage,
      });

      await writeSmsLogSafe({
        branchId,
        phone: alertPhone,
        message: finalMessage,
        smsType,
        status: "sent",
        providerResponse: result.providerResponse,
        sentBy,
      });

      return {
        ok: true,
        skipped: false,
        phone: alertPhone,
        providerResponse: result.providerResponse,
      };
    } catch (error) {
      await writeSmsLogSafe({
        branchId,
        phone: alertPhone,
        message: finalMessage,
        smsType,
        status: "failed",
        providerResponse: {
          error: error.message,
          statusCode: error.statusCode || null,
          providerResponse: error.providerResponse || null,
        },
        sentBy,
      });

      console.warn("SMS alert failed:", error.message);

      return {
        ok: false,
        skipped: false,
        phone: alertPhone,
        error: error.message,
      };
    }
  } catch (error) {
    console.warn("SMS alert skipped:", error.message);

    return {
      ok: false,
      skipped: true,
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