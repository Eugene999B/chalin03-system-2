const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

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

async function safeLogActivity(connection, userId, action, details) {
  try {
    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [userId || null, action, details]
    );
  } catch (error) {
    console.error("Activity log error:", error.message);
  }
}

async function ensureAuditUnlockRequestTable(connection = pool) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS audit_unlock_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,

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

      INDEX idx_unlock_request_signoff (audit_signoff_id),
      INDEX idx_unlock_request_status (status),
      INDEX idx_unlock_request_area (request_area),
      INDEX idx_unlock_request_requested_by (requested_by),
      INDEX idx_unlock_request_reviewed_by (reviewed_by),
      INDEX idx_unlock_request_created_at (created_at)
    )
  `);
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

async function findAuditSignoffById(connection, auditSignoffId) {
  if (!auditSignoffId) {
    return null;
  }

  const [rows] = await connection.query(
    `SELECT
      id,
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
     LIMIT 1`,
    [auditSignoffId]
  );

  return rows.length > 0 ? rows[0] : null;
}

// POST /api/audit-unlock-requests
router.post("/", requireAuth, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureAuditUnlockRequestTable(connection);

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
    const signoff = await findAuditSignoffById(connection, auditSignoffId);

    const finalPeriodLabel =
      signoff?.period_label || cleanText(period_label) || "Locked accounting period";

    const finalPeriodStart = signoff?.period_start || period_start || null;
    const finalPeriodEnd = signoff?.period_end || period_end || null;

    const finalRequestArea = normalizeRequestArea(request_area);
    const finalRequestedAction =
      cleanText(requested_action) || "Correction needed inside locked period";

    const [result] = await connection.query(
      `INSERT INTO audit_unlock_requests (
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
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        signoff ? signoff.id : auditSignoffId,
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
      "CREATE_AUDIT_UNLOCK_REQUEST",
      `Requested unlock for ${finalPeriodLabel}. Area: ${finalRequestArea}. Reason: ${cleanReason}`
    );

    await connection.commit();

    return res.status(201).json({
      status: "success",
      message:
        "Unlock request sent successfully. An admin or manager must review it.",
      request: {
        id: result.insertId,
        audit_signoff_id: signoff ? signoff.id : auditSignoffId,
        period_label: finalPeriodLabel,
        period_start: finalPeriodStart,
        period_end: finalPeriodEnd,
        request_area: finalRequestArea,
        requested_action: finalRequestedAction,
        reason: cleanReason,
        status: "pending",
      },
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

      const { status, search } = req.query;

      const params = [];
      let whereClause = "WHERE 1 = 1";

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
          )
        `;

        const searchValue = `%${search}%`;

        params.push(
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
          aso.audit_status
         FROM audit_unlock_requests aur
         LEFT JOIN users requester ON aur.requested_by = requester.id
         LEFT JOIN users reviewer ON aur.reviewed_by = reviewer.id
         LEFT JOIN audit_signoffs aso ON aur.audit_signoff_id = aso.id
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
         FROM audit_unlock_requests`
      );

      return res.json({
        status: "success",
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

    const userId = getUserId(req);

    const [requests] = await pool.query(
      `SELECT
        id,
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
       WHERE requested_by = ?
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    return res.json({
      status: "success",
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
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (requests.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Unlock request not found.",
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
         WHERE id = ?`,
        [cleanStatus, reviewerId || null, cleanReviewNotes || null, id]
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
           WHERE id = ?`,
          [
            "\n\nUNLOCK APPROVED: ",
            cleanReviewNotes ||
              `Unlock request #${id} approved. Period reopened for correction.`,
            request.audit_signoff_id,
          ]
        );

        periodUnlocked = true;
      }

      await safeLogActivity(
        connection,
        reviewerId,
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