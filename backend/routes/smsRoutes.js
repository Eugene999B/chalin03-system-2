const express = require("express");
const db = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getSmsConfig,
  normalizeGhanaPhone,
  sendSms,
} = require("../services/smsService");

const router = express.Router();

/**
 * This project database config may expose execute(), query(), pool.execute(),
 * pool.query(), connection.execute(), or promise().execute().
 * This helper makes the SMS route work with the existing db.js structure.
 */
async function runQuery(sql, params = []) {
  const candidates = [];

  function addCandidate(client) {
    if (client && !candidates.includes(client)) {
      candidates.push(client);
    }
  }

  addCandidate(db);
  addCandidate(db?.pool);
  addCandidate(db?.connection);
  addCandidate(db?.db);

  try {
    if (typeof db?.promise === "function") {
      addCandidate(db.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  try {
    if (typeof db?.pool?.promise === "function") {
      addCandidate(db.pool.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  try {
    if (typeof db?.connection?.promise === "function") {
      addCandidate(db.connection.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  try {
    if (typeof db?.db?.promise === "function") {
      addCandidate(db.db.promise());
    }
  } catch {
    // Ignore unavailable promise wrapper.
  }

  for (const client of candidates) {
    if (typeof client.execute === "function") {
      return client.execute(sql, params);
    }

    if (typeof client.query === "function") {
      return client.query(sql, params);
    }
  }

  throw new Error(
    "Database connection error: no query/execute method found in config/db.js."
  );
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error("SMS route error:", error);

      res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while processing the SMS request.",
      });
    }
  };
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function getBranchId(req) {
  const possibleBranchId =
    req.body?.branch_id ||
    req.query?.branch_id ||
    req.headers["x-branch-id"] ||
    req.user?.branch_id ||
    req.user?.default_branch_id ||
    req.user?.selected_branch_id ||
    1;

  const branchId = Number(possibleBranchId);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function requireSmsPermission(req, res, next) {
  const role = getUserRole(req);

  if (!["admin", "manager"].includes(role)) {
    return res.status(403).json({
      status: "error",
      message: "Only admin or manager can send custom SMS messages.",
    });
  }

  next();
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return String(value || "");
  }
}

function cleanMessage(value) {
  return String(value || "").trim();
}

function cleanCustomerIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function writeSmsLog({
  branchId,
  phone,
  message,
  smsType,
  status,
  providerResponse,
  sentBy,
}) {
  const sentAt = status === "sent" ? new Date() : null;

  await runQuery(
    `
      INSERT INTO sms_log (
        branch_id,
        recipient_phone,
        message,
        sms_type,
        status,
        provider_response,
        sent_by,
        sent_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      branchId || null,
      phone,
      message,
      smsType || "other",
      status,
      safeJson(providerResponse).slice(0, 6000),
      sentBy || null,
      sentAt,
    ]
  );
}

async function sendAndLogSms({ branchId, phone, message, smsType, sentBy }) {
  const normalizedPhone = normalizeGhanaPhone(phone);

  if (!normalizedPhone) {
    await writeSmsLog({
      branchId,
      phone: phone || "",
      message,
      smsType,
      status: "failed",
      providerResponse: {
        error: "Invalid Ghana phone number.",
      },
      sentBy,
    });

    return {
      phone,
      normalized_phone: "",
      status: "failed",
      message: "Invalid Ghana phone number.",
    };
  }

  try {
    const result = await sendSms({
      to: normalizedPhone,
      message,
    });

    await writeSmsLog({
      branchId,
      phone: normalizedPhone,
      message,
      smsType,
      status: "sent",
      providerResponse: result.providerResponse,
      sentBy,
    });

    return {
      phone,
      normalized_phone: normalizedPhone,
      status: "sent",
      message: "SMS sent successfully.",
      provider: result.provider,
    };
  } catch (error) {
    await writeSmsLog({
      branchId,
      phone: normalizedPhone,
      message,
      smsType,
      status: "failed",
      providerResponse: {
        error: error.message,
        statusCode: error.statusCode || null,
        providerResponse: error.providerResponse || null,
      },
      sentBy,
    });

    return {
      phone,
      normalized_phone: normalizedPhone,
      status: "failed",
      message: error.message || "SMS failed.",
    };
  }
}

router.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const config = getSmsConfig();

    res.json({
      status: "success",
      sms: {
        enabled: config.enabled,
        provider: config.provider,
        sender_id: config.senderId,
        mode:
          config.provider === "mock"
            ? "Mock mode. No real SMS credit will be used."
            : "Live mode.",
      },
    });
  })
);

router.get(
  "/customers",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);

    const [customers] = await runQuery(
      `
        SELECT id, name, phone, location
        FROM customers
        WHERE branch_id = ?
          AND phone IS NOT NULL
          AND TRIM(phone) <> ''
        ORDER BY name ASC, id DESC
      `,
      [branchId]
    );

    res.json({
      status: "success",
      branch_id: branchId,
      count: customers.length,
      customers,
    });
  })
);

router.get(
  "/logs",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    const [logs] = await runQuery(
      `
        SELECT 
          sl.id,
          sl.branch_id,
          b.branch_code,
          b.name AS branch_name,
          sl.recipient_phone,
          sl.message,
          sl.sms_type,
          sl.status,
          sl.provider_response,
          sl.sent_at,
          sl.created_at,
          u.full_name AS sent_by_name,
          u.username AS sent_by_username
        FROM sms_log sl
        LEFT JOIN branches b ON sl.branch_id = b.id
        LEFT JOIN users u ON sl.sent_by = u.id
        WHERE sl.branch_id = ?
        ORDER BY sl.id DESC
        LIMIT ${limit}
      `,
      [branchId]
    );

    res.json({
      status: "success",
      branch_id: branchId,
      count: logs.length,
      logs,
    });
  })
);

router.post(
  "/test",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);

    const phone = String(req.body.phone || "").trim();
    const message =
      cleanMessage(req.body.message) ||
      "CHALIN03 test SMS. Your SMS setup is working.";

    const result = await sendAndLogSms({
      branchId,
      phone,
      message,
      smsType: "other",
      sentBy,
    });

    const statusCode = result.status === "sent" ? 200 : 400;

    res.status(statusCode).json({
      status: result.status === "sent" ? "success" : "error",
      result,
    });
  })
);

router.post(
  "/custom",
  requireAuth,
  requireSmsPermission,
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const sentBy = getUserId(req);

    const targetType = String(req.body.target_type || "").toLowerCase();
    const message = cleanMessage(req.body.message);
    const smsType = req.body.sms_type || "other";
    const customerIds = cleanCustomerIds(req.body.customer_ids);
    const manualPhone = String(req.body.phone || "").trim();

    if (!message) {
      return res.status(400).json({
        status: "error",
        message: "Type the SMS message before sending.",
      });
    }

    if (message.length > 480) {
      return res.status(400).json({
        status: "error",
        message: "SMS message is too long. Keep it under 480 characters.",
      });
    }

    let recipients = [];

    if (targetType === "single") {
      if (!manualPhone) {
        return res.status(400).json({
          status: "error",
          message: "Enter a phone number for single SMS.",
        });
      }

      recipients = [
        {
          id: null,
          name: "Manual Recipient",
          phone: manualPhone,
        },
      ];
    } else if (targetType === "selected") {
      if (customerIds.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Select at least one customer.",
        });
      }

      const placeholders = customerIds.map(() => "?").join(", ");

      const [customers] = await runQuery(
        `
          SELECT id, name, phone, location
          FROM customers
          WHERE branch_id = ?
            AND id IN (${placeholders})
            AND phone IS NOT NULL
            AND TRIM(phone) <> ''
          ORDER BY name ASC, id DESC
        `,
        [branchId, ...customerIds]
      );

      recipients = customers;
    } else if (targetType === "all") {
      const [customers] = await runQuery(
        `
          SELECT id, name, phone, location
          FROM customers
          WHERE branch_id = ?
            AND phone IS NOT NULL
            AND TRIM(phone) <> ''
          ORDER BY name ASC, id DESC
        `,
        [branchId]
      );

      recipients = customers;
    } else {
      return res.status(400).json({
        status: "error",
        message: "Invalid target type. Use single, selected, or all.",
      });
    }

    const maxBulkRecipients = Math.max(
      Number(process.env.SMS_MAX_BULK_RECIPIENTS || 200),
      1
    );

    const uniqueRecipients = [];
    const phoneTracker = new Set();

    for (const recipient of recipients) {
      const normalizedPhone = normalizeGhanaPhone(recipient.phone);

      if (!normalizedPhone) {
        continue;
      }

      if (phoneTracker.has(normalizedPhone)) {
        continue;
      }

      phoneTracker.add(normalizedPhone);

      uniqueRecipients.push({
        ...recipient,
        normalized_phone: normalizedPhone,
      });
    }

    if (uniqueRecipients.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No valid customer phone numbers found.",
      });
    }

    if (uniqueRecipients.length > maxBulkRecipients) {
      return res.status(400).json({
        status: "error",
        message: `Too many recipients. Maximum allowed at once is ${maxBulkRecipients}.`,
      });
    }

    const results = [];

    for (const recipient of uniqueRecipients) {
      const result = await sendAndLogSms({
        branchId,
        phone: recipient.normalized_phone,
        message,
        smsType,
        sentBy,
      });

      results.push({
        customer_id: recipient.id,
        customer_name: recipient.name,
        ...result,
      });
    }

    const sentCount = results.filter(
      (result) => result.status === "sent"
    ).length;

    const failedCount = results.filter(
      (result) => result.status === "failed"
    ).length;

    res.json({
      status: failedCount === 0 ? "success" : "partial",
      message: `SMS sending completed. Sent: ${sentCount}. Failed: ${failedCount}.`,
      branch_id: branchId,
      total_recipients: results.length,
      sent_count: sentCount,
      failed_count: failedCount,
      results,
    });
  })
);

module.exports = router;