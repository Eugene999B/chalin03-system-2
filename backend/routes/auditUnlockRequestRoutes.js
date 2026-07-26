const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");

const router = express.Router();

/*
  Audit unlock requests are branch/store aware.

  This route now includes all important correction areas in the current system:
  sales, debts, expenses, purchases, returns, stock, stock adjustments,
  stock transfers, stock movement ledger source records, SMS, backup/restore,
  maintenance clear-data activity, reports/exports, audit signoff and
  re-approval records.
*/

const ALLOWED_REQUEST_AREAS = [
  "sale",
  "expense",
  "debt_payment",
  "stock",
  "stock_adjustment",
  "stock_transfer",
  "stock_ledger",
  "purchase",
  "return",
  "sms",
  "backup_restore",
  "maintenance",
  "audit_signoff",
  "audit_reapproval",
  "report",
  "export",
  "other",
];

const REQUEST_AREA_LABELS = {
  sale: "Sale",
  expense: "Expense",
  debt_payment: "Debt Payment",
  stock: "Stock",
  stock_adjustment: "Stock Adjustment",
  stock_transfer: "Stock Transfer",
  stock_ledger: "Stock Movement Ledger Source Records",
  purchase: "Purchase",
  return: "Return",
  sms: "SMS / SMS Log",
  backup_restore: "Backup / Restore",
  maintenance: "Maintenance / Clear Data",
  audit_signoff: "Audit Sign-Off",
  audit_reapproval: "Audit Re-Approval",
  report: "Reports",
  export: "Exports",
  other: "Other",
};

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

function cleanDate(value) {
  const text = cleanText(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function getUserId(req) {
  return Number(req.user?.id || req.user?.user_id || req.userId || 0);
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function getUserDisplayName(user) {
  return (
    cleanText(user?.full_name) ||
    cleanText(user?.username) ||
    cleanText(user?.email) ||
    "User"
  );
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

async function ensureAuditUnlockRequestTable(connection = pool) {
  try {
    await connection.query(
      "SELECT 1 FROM audit_unlock_requests LIMIT 1"
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      const schemaError = new Error(
        "Audit unlock request storage is not ready. Apply the approved database migration before using this feature."
      );
      schemaError.code = "AUDIT_UNLOCK_SCHEMA_NOT_READY";
      throw schemaError;
    }

    throw error;
  }
}

function normalizeRequestArea(value) {
  const cleanValue = cleanText(value)
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");

  const aliases = {
    debt: "debt_payment",
    debt_payment: "debt_payment",
    debt_payments: "debt_payment",

    stock_adjustments: "stock_adjustment",
    adjustment: "stock_adjustment",
    adjustments: "stock_adjustment",

    transfer: "stock_transfer",
    transfers: "stock_transfer",
    stock_transfers: "stock_transfer",

    ledger: "stock_ledger",
    stock_movement_ledger: "stock_ledger",
    stock_ledger_source: "stock_ledger",
    stock_ledger_source_records: "stock_ledger",

    purchases: "purchase",
    returns: "return",

    sms_log: "sms",
    sms_logs: "sms",
    sms_center: "sms",

    backup: "backup_restore",
    restore: "backup_restore",
    backups: "backup_restore",
    backup_and_restore: "backup_restore",

    clear_data: "maintenance",
    clear_business_data: "maintenance",
    maintenance_clear_data: "maintenance",

    signoff: "audit_signoff",
    sign_off: "audit_signoff",
    audit_signoffs: "audit_signoff",

    reapproval: "audit_reapproval",
    re_approval: "audit_reapproval",
    reapproval_log: "audit_reapproval",
    audit_reapproval_log: "audit_reapproval",

    reports: "report",
    exports: "export",
    export_routes: "export",
  };

  const normalized = aliases[cleanValue] || cleanValue;

  if (ALLOWED_REQUEST_AREAS.includes(normalized)) {
    return normalized;
  }

  return "other";
}

function formatRequestArea(value) {
  const normalized = normalizeRequestArea(value);
  return REQUEST_AREA_LABELS[normalized] || String(value || "Other").replace(/_/g, " ");
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

async function sendAuditUnlockRequestSecuritySmsAlert({
  unlockRequest,
  requestedByUser,
  branchId,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);

    const requestedBy =
      requestedByUser?.full_name ||
      requestedByUser?.username ||
      `User ID ${unlockRequest.requested_by || "-"}`;

    const message = `${businessName}: Security alert. Audit unlock request submitted for ${branch.name} (${branch.code}). Period: ${
      unlockRequest.period_label
    }. Area: ${formatRequestArea(
      unlockRequest.request_area
    )}. Action: ${unlockRequest.requested_action}. Requested by ${requestedBy}. Reason: ${
      unlockRequest.reason
    }. Date: ${formatSecurityDateTime()}.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: requestedByUser?.id || unlockRequest.requested_by || null,
    });
  } catch (error) {
    console.warn("Audit unlock request SMS alert skipped:", error.message);
  }
}

async function sendAuditUnlockReviewSecuritySmsAlert({
  reviewedRequest,
  reviewerUser,
  branchId,
  periodUnlocked,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);
    const reviewer = getUserDisplayName(reviewerUser);
    const decision = String(reviewedRequest.status || "reviewed").toUpperCase();

    const message = `${businessName}: Security alert. Audit unlock request #${
      reviewedRequest.id
    } ${decision} for ${branch.name} (${branch.code}). Period: ${
      reviewedRequest.period_label
    }. Area: ${formatRequestArea(
      reviewedRequest.request_area
    )}. Period reopened: ${periodUnlocked ? "Yes" : "No"}. Reviewed by ${reviewer}. Date: ${formatSecurityDateTime()}.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: reviewerUser?.id || null,
    });
  } catch (error) {
    console.warn("Audit unlock review SMS alert skipped:", error.message);
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

    const finalPeriodStart =
      signoff?.period_start || cleanDate(period_start) || null;
    const finalPeriodEnd = signoff?.period_end || cleanDate(period_end) || null;

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
router.get("/", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditUnlockRequestTable(pool);

    const branchId = getBranchId(req);
    const status = cleanText(req.query.status).toLowerCase();
    const area = cleanText(req.query.area || req.query.request_area).toLowerCase();
    const search = cleanText(req.query.search);

    const params = [branchId];
    let whereClause = "WHERE aur.branch_id = ?";

    if (status) {
      whereClause += " AND aur.status = ?";
      params.push(status);
    }

    if (area) {
      whereClause += " AND aur.request_area = ?";
      params.push(normalizeRequestArea(area));
    }

    if (search) {
      whereClause += `
        AND (
          aur.period_label LIKE ?
          OR aur.request_area LIKE ?
          OR aur.requested_action LIKE ?
          OR aur.reason LIKE ?
          OR requester.full_name LIKE ?
          OR requester.username LIKE ?
          OR reviewer.full_name LIKE ?
          OR reviewer.username LIKE ?
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
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected_count,
        COUNT(CASE WHEN request_area IN ('stock', 'stock_adjustment', 'stock_transfer', 'stock_ledger') THEN 1 END) AS stock_related_count,
        COUNT(CASE WHEN request_area = 'sms' THEN 1 END) AS sms_related_count,
        COUNT(CASE WHEN request_area IN ('backup_restore', 'maintenance') THEN 1 END) AS system_related_count,
        COUNT(CASE WHEN request_area IN ('audit_signoff', 'audit_reapproval') THEN 1 END) AS audit_related_count,
        COUNT(CASE WHEN request_area IN ('report', 'export') THEN 1 END) AS report_export_related_count
       FROM audit_unlock_requests
       WHERE branch_id = ?`,
      [branchId]
    );

    const [areaSummaryRows] = await pool.query(
      `SELECT request_area, COUNT(*) AS total_count
       FROM audit_unlock_requests
       WHERE branch_id = ?
       GROUP BY request_area
       ORDER BY total_count DESC, request_area ASC`,
      [branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      count: requests.length,
      summary: summaryRows[0] || {
        total_requests: 0,
        pending_count: 0,
        approved_count: 0,
        rejected_count: 0,
        stock_related_count: 0,
        sms_related_count: 0,
        system_related_count: 0,
        audit_related_count: 0,
        report_export_related_count: 0,
      },
      area_summary: areaSummaryRows,
      request_area_options: ALLOWED_REQUEST_AREAS.map((value) => ({
        value,
        label: REQUEST_AREA_LABELS[value] || value,
      })),
      requests,
    });
  } catch (error) {
    console.error("Get audit unlock requests error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching unlock requests.",
    });
  }
});

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
      request_area_options: ALLOWED_REQUEST_AREAS.map((value) => ({
        value,
        label: REQUEST_AREA_LABELS[value] || value,
      })),
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

      if (!cleanReviewNotes) {
        return res.status(400).json({
          status: "error",
          message: "Review notes are required before approving or rejecting.",
        });
      }

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
        [cleanStatus, reviewerId || null, cleanReviewNotes, id, branchId]
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
        }. Area: ${request.request_area}. Period unlocked: ${
          periodUnlocked ? "Yes" : "No"
        }.`
      );

      await connection.commit();

      const reviewedRequest = {
        ...request,
        status: cleanStatus,
        reviewed_by: reviewerId || null,
        review_notes: cleanReviewNotes,
      };

      await sendAuditUnlockReviewSecuritySmsAlert({
        reviewedRequest,
        reviewerUser: req.user,
        branchId,
        periodUnlocked,
      });

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
