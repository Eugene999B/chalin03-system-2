const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { normalizeGhanaPhone, sendSms } = require("../services/smsService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function getUserId(req) {
  return Number(req.user?.id || req.user?.user_id || req.userId || 0);
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function isAdminOrManager(req) {
  const role = getUserRole(req);
  return role === "admin" || role === "manager";
}

function requireAdminOrManager(req, res, next) {
  if (isAdminOrManager(req)) {
    return next();
  }

  return res.status(403).json({
    status: "error",
    message: "Only admin and manager accounts can review unlock requests.",
  });
}

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

function formatSecurityDateTime() {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

async function ensureColumn(connection, tableName, columnName, columnDefinition) {
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [
    columnName,
  ]);

  if (columns.length === 0) {
    await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

async function ensureIndex(connection, tableName, indexName, indexDefinition) {
  const [indexes] = await connection.query(
    `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
    [indexName]
  );

  if (indexes.length === 0) {
    await connection.query(`ALTER TABLE ${tableName} ADD INDEX ${indexDefinition}`);
  }
}

async function safeLogActivity(connection, userId, branchId, action, details) {
  try {
    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [branchId || null, userId || null, action, details]
    );
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
}

async function ensureAuditUnlockRequestTable(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS audit_unlock_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,

      branch_id INT NOT NULL DEFAULT 1,
      audit_signoff_id INT NULL,

      period_label VARCHAR(255) NOT NULL,
      period_start DATE NULL,
      period_end DATE NULL,

      request_area ENUM(
        'sale',
        'expense',
        'debt_payment',
        'stock',
        'purchase',
        'return',
        'other'
      ) NOT NULL DEFAULT 'other',

      requested_action VARCHAR(150) NOT NULL DEFAULT 'Correction needed',
      reason TEXT NOT NULL,

      status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',

      requested_by INT NULL,
      reviewed_by INT NULL,
      reviewed_at TIMESTAMP NULL,

      review_notes TEXT,

      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      INDEX idx_unlock_request_branch (branch_id),
      INDEX idx_unlock_request_signoff (audit_signoff_id),
      INDEX idx_unlock_request_status (status),
      INDEX idx_unlock_request_area (request_area),
      INDEX idx_unlock_request_requested_by (requested_by),
      INDEX idx_unlock_request_reviewed_by (reviewed_by),
      INDEX idx_unlock_request_created_at (created_at)
    )
  `);

  await ensureColumn(
    connection,
    "audit_unlock_requests",
    "branch_id",
    "branch_id INT NOT NULL DEFAULT 1 AFTER id"
  );

  await ensureIndex(
    connection,
    "audit_unlock_requests",
    "idx_unlock_request_branch",
    "idx_unlock_request_branch (branch_id)"
  );
}

function normalizeRequestArea(value) {
  const cleanValue = cleanText(value).toLowerCase();

  const allowedAreas = [
    "sale",
    "expense",
    "debt_payment",
    "stock",
    "purchase",
    "return",
    "other",
  ];

  if (allowedAreas.includes(cleanValue)) {
    return cleanValue;
  }

  return "other";
}

function formatRequestArea(value) {
  return String(value || "other").replace(/_/g, " ");
}

async function findAuditSignoffById(connection, auditSignoffId, branchId) {
  if (!auditSignoffId) {
    return null;
  }

  const [rows] = await connection.query(
    `SELECT
      id,
      branch_id,
      period_type,
      period_label,
      period_start,
      period_end,
      period_status,
      audit_score,
      audit_status,
      approved_by_name,
      review_date
     FROM audit_signoffs
     WHERE id = ?
     AND branch_id = ?
     LIMIT 1`,
    [auditSignoffId, branchId]
  );

  return rows.length > 0 ? rows[0] : null;
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
  smsType,
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
        smsType || "security_alert",
        status,
        safeJson(providerResponse).slice(0, 6000),
        sentBy || null,
        sentAt,
      ]
    );
  } catch (error) {
    console.warn("Audit unlock SMS log skipped:", error.message);
  }
}

async function sendAuditUnlockRequestSecuritySmsAlert({
  unlockRequest,
  requestedByUser,
  branchId,
}) {
  try {
    const settings = await getSmsSettingsForBranch(branchId);

    const alertPhone = firstValidGhanaPhone(
      settings.owner_phone,
      settings.business_phone
    );

    if (!alertPhone) {
      console.warn(
        "Audit unlock request SMS alert skipped: no valid owner/admin phone found."
      );
      return;
    }

    const branch = await getBranchInfoById(branchId);
    const businessName = settings.business_name || "Chalin 03 Company Limited";
    const requestedBy =
      requestedByUser?.full_name ||
      requestedByUser?.username ||
      `User ID ${unlockRequest.requested_by || "-"}`;

    const alertMessage = truncateMessage(
      `${businessName}: Security alert. Audit unlock request submitted for ${branch.name} (${branch.code}). Period: ${
        unlockRequest.period_label
      }. Area: ${formatRequestArea(
        unlockRequest.request_area
      )}. Action: ${unlockRequest.requested_action}. Requested by ${requestedBy}. Reason: ${
        unlockRequest.reason
      }. Date: ${formatSecurityDateTime()}.`,
      480
    );

    try {
      const result = await sendSms({
        to: alertPhone,
        message: alertMessage,
      });

      await writeSmsLogSafe({
        branchId,
        phone: alertPhone,
        message: alertMessage,
        smsType: "security_alert",
        status: "sent",
        providerResponse: result.providerResponse,
        sentBy: requestedByUser?.id || unlockRequest.requested_by || null,
      });
    } catch (error) {
      await writeSmsLogSafe({
        branchId,
        phone: alertPhone,
        message: alertMessage,
        smsType: "security_alert",
        status: "failed",
        providerResponse: {
          error: error.message,
          statusCode: error.statusCode || null,
          providerResponse: error.providerResponse || null,
        },
        sentBy: requestedByUser?.id || unlockRequest.requested_by || null,
      });

      console.warn("Audit unlock request SMS alert failed:", error.message);
    }
  } catch (error) {
    console.warn("Audit unlock request SMS alert skipped:", error.message);
  }
}

// POST /api/audit-unlock-requests
router.post("/", requireAuth, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureAuditUnlockRequestTable(connection);

    const branchId = getBranchId(req);
    const userId = getUserId(req);

    const {
      audit_signoff_id,
      period_label,
      period_start,
      period_end,
      request_area,
      requested_action,
      reason,
    } = req.body;

    const cleanReason = cleanText(reason);

    if (!cleanReason) {
      return res.status(400).json({
        status: "error",
        message: "Reason is required before sending an unlock request.",
      });
    }

    await connection.beginTransaction();

    const auditSignoffId = audit_signoff_id ? Number(audit_signoff_id) : null;
    const signoff = await findAuditSignoffById(
      connection,
      auditSignoffId,
      branchId
    );

    if (auditSignoffId && !signoff) {
      await connection.rollback();

      return res.status(404).json({
        status: "error",
        message: "Audit sign-off not found in the selected store.",
      });
    }

    const finalPeriodLabel =
      signoff?.period_label ||
      cleanText(period_label) ||
      "Locked accounting period";

    const finalPeriodStart = signoff?.period_start || period_start || null;
    const finalPeriodEnd = signoff?.period_end || period_end || null;

    const finalRequestArea = normalizeRequestArea(request_area);
    const finalRequestedAction =
      cleanText(requested_action) || "Correction needed inside locked period";

    const [result] = await connection.query(
      `INSERT INTO audit_unlock_requests (
        branch_id,
        audit_signoff_id,
        period_label,
        period_start,
        period_end,
        request_area,
        requested_action,
        reason,
        status,
        requested_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        branchId,
        signoff ? signoff.id : null,
        finalPeriodLabel,
        finalPeriodStart,
        finalPeriodEnd,
        finalRequestArea,
        finalRequestedAction,
        cleanReason,
        userId || null,
      ]
    );

    await safeLogActivity(
      connection,
      userId,
      branchId,
      "CREATE_AUDIT_UNLOCK_REQUEST",
      `Requested unlock for ${finalPeriodLabel}. Area: ${finalRequestArea}. Reason: ${cleanReason}`
    );

    await connection.commit();

    const createdRequest = {
      id: result.insertId,
      branch_id: branchId,
      audit_signoff_id: signoff ? signoff.id : null,
      period_label: finalPeriodLabel,
      period_start: finalPeriodStart,
      period_end: finalPeriodEnd,
      request_area: finalRequestArea,
      requested_action: finalRequestedAction,
      reason: cleanReason,
      status: "pending",
      requested_by: userId || null,
    };

    await sendAuditUnlockRequestSecuritySmsAlert({
      unlockRequest: createdRequest,
      requestedByUser: req.user,
      branchId,
    });

    return res.status(201).json({
      status: "success",
      branch_id: branchId,
      message:
        "Unlock request sent successfully. An admin or manager must review it.",
      request: createdRequest,
    });
  } catch (error) {
    await connection.rollback();

    console.error("Create audit unlock request error:", error);

    return res.status(500).json({
      status: "error",
      message:
        error.message || "Something went wrong while sending unlock request.",
    });
  } finally {
    connection.release();
  }
});

// GET /api/audit-unlock-requests
router.get(
  "/",
  requireAuth,
  requireAdminOrManager,
  async (req, res) => {
    try {
      await ensureAuditUnlockRequestTable(pool);

      const branchId = getBranchId(req);
      const status = cleanText(req.query.status);
      const search = cleanText(req.query.search);

      const params = [branchId];
      let whereClause = "WHERE aur.branch_id = ?";

      if (status) {
        whereClause += " AND aur.status = ?";
        params.push(status);
      }

      if (search) {
        whereClause += `
          AND (
            aur.period_label LIKE ?
            OR aur.request_area LIKE ?
            OR aur.requested_action LIKE ?
            OR aur.reason LIKE ?
            OR requester.full_name LIKE ?
            OR reviewer.full_name LIKE ?
            OR b.name LIKE ?
            OR b.location LIKE ?
          )
        `;

        const searchValue = `%${search}%`;

        params.push(
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue
        );
      }

      const [requests] = await pool.query(
        `SELECT
          aur.id,
          aur.branch_id,
          aur.audit_signoff_id,
          aur.period_label,
          aur.period_start,
          aur.period_end,
          aur.request_area,
          aur.requested_action,
          aur.reason,
          aur.status,
          aur.requested_by,
          requester.full_name AS requested_by_name,
          requester.username AS requested_by_username,
          aur.reviewed_by,
          reviewer.full_name AS reviewed_by_name,
          reviewer.username AS reviewed_by_username,
          aur.reviewed_at,
          aur.review_notes,
          aur.created_at,
          aur.updated_at,
          aso.period_status AS current_period_status,
          aso.audit_score,
          aso.audit_status,
          b.name AS branch_name,
          b.location AS branch_location
         FROM audit_unlock_requests aur
         LEFT JOIN users requester ON aur.requested_by = requester.id
         LEFT JOIN users reviewer ON aur.reviewed_by = reviewer.id
         LEFT JOIN audit_signoffs aso
          ON aur.audit_signoff_id = aso.id
          AND aso.branch_id = aur.branch_id
         LEFT JOIN branches b ON aur.branch_id = b.id
         ${whereClause}
         ORDER BY
          CASE aur.status
            WHEN 'pending' THEN 1
            WHEN 'approved' THEN 2
            WHEN 'rejected' THEN 3
            ELSE 4
          END,
          aur.created_at DESC
         LIMIT 300`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT
          COUNT(*) AS total_requests,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
          COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved_count,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_count
         FROM audit_unlock_requests
         WHERE branch_id = ?`,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: requests.length,
        summary: summaryRows[0],
        requests,
      });
    } catch (error) {
      console.error("Get audit unlock requests error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching unlock requests.",
      });
    }
  }
);

// GET /api/audit-unlock-requests/mine
router.get("/mine", requireAuth, async (req, res) => {
  try {
    await ensureAuditUnlockRequestTable(pool);

    const branchId = getBranchId(req);
    const userId = getUserId(req);

    const [requests] = await pool.query(
      `SELECT
        id,
        branch_id,
        audit_signoff_id,
        period_label,
        period_start,
        period_end,
        request_area,
        requested_action,
        reason,
        status,
        reviewed_at,
        review_notes,
        created_at,
        updated_at
       FROM audit_unlock_requests
       WHERE branch_id = ?
       AND requested_by = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [branchId, userId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      count: requests.length,
      requests,
    });
  } catch (error) {
    console.error("Get my audit unlock requests error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching your unlock requests.",
    });
  }
});

// PATCH /api/audit-unlock-requests/:id/review
router.patch(
  "/:id/review",
  requireAuth,
  requireAdminOrManager,
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      await ensureAuditUnlockRequestTable(connection);

      const branchId = getBranchId(req);
      const { id } = req.params;
      const { status, review_notes, unlock_period } = req.body;

      const cleanStatus = cleanText(status).toLowerCase();

      if (!["approved", "rejected"].includes(cleanStatus)) {
        return res.status(400).json({
          status: "error",
          message: "Status must be approved or rejected.",
        });
      }

      const cleanReviewNotes = cleanText(review_notes);
      const shouldUnlockPeriod =
        cleanStatus === "approved" && unlock_period !== false;

      const reviewerId = getUserId(req);

      await connection.beginTransaction();

      const [requests] = await connection.query(
        `SELECT *
         FROM audit_unlock_requests
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      if (requests.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Unlock request not found in the selected store.",
        });
      }

      const request = requests[0];

      if (request.status !== "pending") {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Only pending unlock requests can be reviewed.",
        });
      }

      await connection.query(
        `UPDATE audit_unlock_requests
         SET
          status = ?,
          reviewed_by = ?,
          reviewed_at = NOW(),
          review_notes = ?
         WHERE id = ?
         AND branch_id = ?`,
        [cleanStatus, reviewerId || null, cleanReviewNotes || null, id, branchId]
      );

      let periodUnlocked = false;

      if (shouldUnlockPeriod && request.audit_signoff_id) {
        await connection.query(
          `UPDATE audit_signoffs
           SET
            period_status = 'reviewed',
            management_notes = CONCAT(
              COALESCE(management_notes, ''),
              ?,
              ?
            )
           WHERE id = ?
           AND branch_id = ?`,
          [
            "\n\nUNLOCK APPROVED: ",
            cleanReviewNotes ||
              `Unlock request #${id} approved. Period reopened for correction.`,
            request.audit_signoff_id,
            branchId,
          ]
        );

        periodUnlocked = true;
      }

      await safeLogActivity(
        connection,
        reviewerId,
        branchId,
        cleanStatus === "approved"
          ? "APPROVE_AUDIT_UNLOCK_REQUEST"
          : "REJECT_AUDIT_UNLOCK_REQUEST",
        `${cleanStatus.toUpperCase()} unlock request #${id} for ${
          request.period_label
        }. Period unlocked: ${periodUnlocked ? "Yes" : "No"}.`
      );

      await connection.commit();

      return res.json({
        status: "success",
        branch_id: branchId,
        message:
          cleanStatus === "approved"
            ? periodUnlocked
              ? "Unlock request approved and accounting period reopened for correction."
              : "Unlock request approved."
            : "Unlock request rejected.",
        period_unlocked: periodUnlocked,
      });
    } catch (error) {
      await connection.rollback();

      console.error("Review audit unlock request error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while reviewing request.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;