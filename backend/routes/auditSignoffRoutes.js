const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

const allowedPeriodTypes = ["all", "today", "week", "month", "year", "custom"];
const allowedPeriodStatuses = ["draft", "reviewed", "approved", "rejected"];

let tableReadyPromise = null;
let reapprovalTableReadyPromise = null;

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 1);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function cleanInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number);
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanPeriodType(value) {
  const cleanValue = String(value || "month").toLowerCase();
  return allowedPeriodTypes.includes(cleanValue) ? cleanValue : "month";
}

function cleanPeriodStatus(value) {
  const cleanValue = String(value || "draft").toLowerCase();
  return allowedPeriodStatuses.includes(cleanValue) ? cleanValue : "draft";
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function getUserRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function getUserDisplayName(req) {
  return (
    cleanText(req.user?.full_name) ||
    cleanText(req.user?.username) ||
    cleanText(req.user?.email) ||
    null
  );
}

function requireAdminOrManager(req, res, next) {
  const role = getUserRole(req);

  if (role !== "admin" && role !== "manager") {
    return res.status(403).json({
      status: "error",
      message: "Only admin or manager can access audit sign-offs.",
    });
  }

  return next();
}

function requireAdmin(req, res, next) {
  const role = getUserRole(req);

  if (role !== "admin") {
    return res.status(403).json({
      status: "error",
      message: "Only admin can delete audit sign-offs.",
    });
  }

  return next();
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );
}

async function ensureColumn(tableName, columnName, columnDefinition) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [
    columnName,
  ]);

  if (columns.length === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

async function ensureIndex(tableName, indexName, indexDefinition) {
  const [indexes] = await pool.query(
    `SHOW INDEX FROM ${tableName} WHERE Key_name = ?`,
    [indexName]
  );

  if (indexes.length === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD INDEX ${indexDefinition}`);
  }
}

async function ensureAuditSignoffsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_signoffs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id INT NOT NULL DEFAULT 1,
          period_type ENUM('all', 'today', 'week', 'month', 'year', 'custom') NOT NULL DEFAULT 'month',
          period_label VARCHAR(255) NOT NULL,
          period_start DATE NULL,
          period_end DATE NULL,
          audit_score INT NOT NULL DEFAULT 0,
          audit_status VARCHAR(50) NOT NULL DEFAULT 'Needs Review',
          prepared_by_name VARCHAR(150),
          reviewed_by_name VARCHAR(150),
          approved_by_name VARCHAR(150),
          review_date DATE NULL,
          period_status ENUM('draft', 'reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
          sales_checked BOOLEAN NOT NULL DEFAULT FALSE,
          expenses_checked BOOLEAN NOT NULL DEFAULT FALSE,
          debts_checked BOOLEAN NOT NULL DEFAULT FALSE,
          stock_checked BOOLEAN NOT NULL DEFAULT FALSE,
          warnings_checked BOOLEAN NOT NULL DEFAULT FALSE,
          reports_checked BOOLEAN NOT NULL DEFAULT FALSE,
          accountant_notes TEXT,
          management_notes TEXT,
          created_by INT,
          approved_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_audit_signoff_branch (branch_id),
          INDEX idx_audit_signoff_period_type (period_type),
          INDEX idx_audit_signoff_period_dates (period_start, period_end),
          INDEX idx_audit_signoff_status (period_status),
          INDEX idx_audit_signoff_created_by (created_by),
          INDEX idx_audit_signoff_approved_by (approved_by),
          INDEX idx_audit_signoff_created_at (created_at)
        )
      `);

      await ensureColumn(
        "audit_signoffs",
        "branch_id",
        "branch_id INT NOT NULL DEFAULT 1 AFTER id"
      );

      await ensureIndex(
        "audit_signoffs",
        "idx_audit_signoff_branch",
        "idx_audit_signoff_branch (branch_id)"
      );
    })().catch((error) => {
      tableReadyPromise = null;
      throw error;
    });
  }

  await tableReadyPromise;
}

async function ensureAuditReapprovalLogTable() {
  if (!reapprovalTableReadyPromise) {
    reapprovalTableReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_reapproval_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id INT NOT NULL DEFAULT 1,

          audit_signoff_id INT NULL,
          unlock_request_id INT NULL,

          period_label VARCHAR(255) NOT NULL,
          period_start DATE NULL,
          period_end DATE NULL,

          previous_status VARCHAR(50) NULL,
          new_status VARCHAR(50) NOT NULL DEFAULT 'approved',

          audit_score INT NOT NULL DEFAULT 0,
          audit_status VARCHAR(50) NULL,

          reapproved_by INT NULL,
          reapproved_by_name VARCHAR(150) NULL,
          reapproved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

          reapproval_notes TEXT,
          accountant_notes TEXT,
          management_notes TEXT,

          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

          INDEX idx_reapproval_branch (branch_id),
          INDEX idx_reapproval_signoff (audit_signoff_id),
          INDEX idx_reapproval_unlock_request (unlock_request_id),
          INDEX idx_reapproval_period_dates (period_start, period_end),
          INDEX idx_reapproval_user (reapproved_by),
          INDEX idx_reapproval_date (reapproved_at)
        )
      `);

      await ensureColumn(
        "audit_reapproval_log",
        "branch_id",
        "branch_id INT NOT NULL DEFAULT 1 AFTER id"
      );

      await ensureIndex(
        "audit_reapproval_log",
        "idx_reapproval_branch",
        "idx_reapproval_branch (branch_id)"
      );
    })().catch((error) => {
      reapprovalTableReadyPromise = null;
      throw error;
    });
  }

  await reapprovalTableReadyPromise;
}

async function safeLogActivity(
  connection,
  userId,
  branchId,
  action,
  details,
  ipAddress
) {
  try {
    await connection.query(
      `INSERT INTO activity_log (branch_id, user_id, action, details, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [branchId || null, userId || null, action, details || null, ipAddress || null]
    );
  } catch (error) {
    console.warn("Could not write audit signoff activity log:", error.message);
  }
}

async function findLatestApprovedUnlockRequest(connection, signoffId, branchId) {
  if (!signoffId) return null;

  try {
    const [rows] = await connection.query(
      `
      SELECT
        id,
        branch_id,
        audit_signoff_id,
        reason,
        review_notes,
        reviewed_by,
        reviewed_at,
        created_at
      FROM audit_unlock_requests
      WHERE branch_id = ?
      AND audit_signoff_id = ?
      AND status = 'approved'
      ORDER BY reviewed_at DESC, updated_at DESC, id DESC
      LIMIT 1
      `,
      [branchId, signoffId]
    );

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.warn(
      "Could not check latest approved audit unlock request:",
      error.message
    );

    return null;
  }
}

async function createReapprovalLogIfNeeded({
  connection,
  branchId,
  signoffId,
  latestApprovedUnlockRequest,
  previousStatus,
  periodStatus,
  periodLabel,
  periodStart,
  periodEnd,
  auditScore,
  auditStatus,
  reapprovedBy,
  reapprovedByName,
  reapprovalNotes,
  accountantNotes,
  managementNotes,
}) {
  if (!branchId) return false;
  if (!signoffId) return false;
  if (!latestApprovedUnlockRequest?.id) return false;
  if (previousStatus === "approved") return false;
  if (periodStatus !== "approved") return false;

  await ensureAuditReapprovalLogTable();

  const [existingLogRows] = await connection.query(
    `
    SELECT id
    FROM audit_reapproval_log
    WHERE branch_id = ?
    AND audit_signoff_id = ?
    AND unlock_request_id = ?
    LIMIT 1
    `,
    [branchId, signoffId, latestApprovedUnlockRequest.id]
  );

  if (existingLogRows.length > 0) {
    return false;
  }

  const finalReapprovalNotes =
    reapprovalNotes ||
    managementNotes ||
    latestApprovedUnlockRequest.review_notes ||
    latestApprovedUnlockRequest.reason ||
    `Period re-approved after unlock request #${latestApprovedUnlockRequest.id}.`;

  await connection.query(
    `
    INSERT INTO audit_reapproval_log (
      branch_id,
      audit_signoff_id,
      unlock_request_id,
      period_label,
      period_start,
      period_end,
      previous_status,
      new_status,
      audit_score,
      audit_status,
      reapproved_by,
      reapproved_by_name,
      reapproval_notes,
      accountant_notes,
      management_notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      branchId,
      signoffId,
      latestApprovedUnlockRequest.id,
      periodLabel,
      periodStart,
      periodEnd,
      previousStatus || null,
      auditScore,
      auditStatus,
      reapprovedBy || null,
      reapprovedByName || null,
      finalReapprovalNotes,
      accountantNotes || null,
      managementNotes || null,
    ]
  );

  return true;
}

function normalizeSignoff(row) {
  if (!row) return null;

  return {
    id: row.id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_location: row.branch_location,
    period_type: row.period_type,
    period_label: row.period_label,
    period_start: row.period_start,
    period_end: row.period_end,
    audit_score: Number(row.audit_score || 0),
    audit_status: row.audit_status,
    prepared_by_name: row.prepared_by_name,
    reviewed_by_name: row.reviewed_by_name,
    approved_by_name: row.approved_by_name,
    review_date: row.review_date,
    period_status: row.period_status,
    sales_checked: Boolean(row.sales_checked),
    expenses_checked: Boolean(row.expenses_checked),
    debts_checked: Boolean(row.debts_checked),
    stock_checked: Boolean(row.stock_checked),
    warnings_checked: Boolean(row.warnings_checked),
    reports_checked: Boolean(row.reports_checked),
    accountant_notes: row.accountant_notes,
    management_notes: row.management_notes,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    approved_by: row.approved_by,
    approved_by_user_name: row.approved_by_user_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeReapprovalLog(row) {
  if (!row) return null;

  return {
    id: row.id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_location: row.branch_location,
    audit_signoff_id: row.audit_signoff_id,
    unlock_request_id: row.unlock_request_id,
    period_label: row.period_label,
    period_start: row.period_start,
    period_end: row.period_end,
    previous_status: row.previous_status,
    new_status: row.new_status,
    audit_score: Number(row.audit_score || 0),
    audit_status: row.audit_status,
    reapproved_by: row.reapproved_by,
    reapproved_by_name: row.reapproved_by_name,
    reapproved_at: row.reapproved_at,
    reapproval_notes: row.reapproval_notes,
    accountant_notes: row.accountant_notes,
    management_notes: row.management_notes,
    unlock_reason: row.unlock_reason,
    unlock_review_notes: row.unlock_review_notes,
    created_at: row.created_at,
  };
}

router.get("/", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const periodType = cleanText(req.query.period_type);
    const periodStatus = cleanText(req.query.period_status);
    const search = cleanText(req.query.search);

    let sql = `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.branch_id = ?
    `;

    const params = [branchId];

    if (periodType && allowedPeriodTypes.includes(periodType)) {
      sql += " AND a.period_type = ?";
      params.push(periodType);
    }

    if (periodStatus && allowedPeriodStatuses.includes(periodStatus)) {
      sql += " AND a.period_status = ?";
      params.push(periodStatus);
    }

    if (search) {
      sql += `
        AND (
          a.period_label LIKE ?
          OR a.prepared_by_name LIKE ?
          OR a.reviewed_by_name LIKE ?
          OR a.approved_by_name LIKE ?
        )
      `;
      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    sql += " ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 300";

    const [rows] = await pool.query(sql, params);

    return res.json({
      status: "success",
      branch_id: branchId,
      count: rows.length,
      signoffs: rows.map(normalizeSignoff),
    });
  } catch (error) {
    console.error("Get audit signoffs error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching audit sign-offs.",
    });
  }
});

router.get("/latest", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const periodType = cleanPeriodType(req.query.period_type);
    const periodLabel = cleanText(req.query.period_label);
    const periodStart = cleanDate(req.query.period_start);
    const periodEnd = cleanDate(req.query.period_end);

    let sql = `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.branch_id = ?
      AND a.period_type = ?
    `;

    const params = [branchId, periodType];

    if (periodStart || periodEnd) {
      sql += " AND a.period_start <=> ? AND a.period_end <=> ?";
      params.push(periodStart, periodEnd);
    } else if (periodLabel) {
      sql += " AND a.period_label = ?";
      params.push(periodLabel);
    }

    sql += " ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 1";

    const [rows] = await pool.query(sql, params);

    return res.json({
      status: "success",
      branch_id: branchId,
      signoff: rows.length > 0 ? normalizeSignoff(rows[0]) : null,
    });
  } catch (error) {
    console.error("Get latest audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching latest audit sign-off.",
    });
  }
});

router.get(
  "/reapproval-log",
  requireAuth,
  requireAdminOrManager,
  async (req, res) => {
    try {
      await ensureAuditReapprovalLogTable();

      const branchId = getBranchId(req);
      const signoffId = Number(req.query.audit_signoff_id || 0);
      const search = cleanText(req.query.search);
      const from = cleanDate(req.query.from);
      const to = cleanDate(req.query.to);

      let sql = `
        SELECT
          arl.*,
          aur.reason AS unlock_reason,
          aur.review_notes AS unlock_review_notes,
          b.name AS branch_name,
          b.location AS branch_location
        FROM audit_reapproval_log arl
        LEFT JOIN audit_unlock_requests aur
          ON arl.unlock_request_id = aur.id
          AND aur.branch_id = arl.branch_id
        LEFT JOIN branches b ON arl.branch_id = b.id
        WHERE arl.branch_id = ?
      `;

      const params = [branchId];

      if (Number.isInteger(signoffId) && signoffId > 0) {
        sql += " AND arl.audit_signoff_id = ?";
        params.push(signoffId);
      }

      if (from) {
        sql += " AND DATE(arl.reapproved_at) >= ?";
        params.push(from);
      }

      if (to) {
        sql += " AND DATE(arl.reapproved_at) <= ?";
        params.push(to);
      }

      if (search) {
        sql += `
          AND (
            arl.period_label LIKE ?
            OR arl.reapproved_by_name LIKE ?
            OR arl.reapproval_notes LIKE ?
            OR arl.accountant_notes LIKE ?
            OR arl.management_notes LIKE ?
            OR aur.reason LIKE ?
            OR aur.review_notes LIKE ?
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
          searchValue
        );
      }

      sql += " ORDER BY arl.reapproved_at DESC, arl.id DESC LIMIT 300";

      const [rows] = await pool.query(sql, params);

      const [summaryRows] = await pool.query(
        `
        SELECT
          COUNT(*) AS total_reapprovals,
          MAX(reapproved_at) AS latest_reapproval_at
        FROM audit_reapproval_log
        WHERE branch_id = ?
        `,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: rows.length,
        summary: summaryRows[0] || {
          total_reapprovals: 0,
          latest_reapproval_at: null,
        },
        logs: rows.map(normalizeReapprovalLog),
      });
    } catch (error) {
      console.error("Get audit reapproval log error:", error);
      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching audit re-approval log.",
      });
    }
  }
);

router.get("/:id", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid sign-off ID." });
    }

    const [rows] = await pool.query(
      `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.id = ?
      AND a.branch_id = ?
      LIMIT 1
      `,
      [id, branchId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Audit sign-off not found in the selected store.",
      });
    }

    return res.json({
      status: "success",
      branch_id: branchId,
      signoff: normalizeSignoff(rows[0]),
    });
  } catch (error) {
    console.error("Get audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching audit sign-off.",
    });
  }
});

router.post("/", requireAuth, requireAdminOrManager, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureAuditSignoffsTable();
    await ensureAuditReapprovalLogTable();

    const branchId = getBranchId(req);
    const userId = getUserId(req);
    const ipAddress = getClientIp(req);

    const periodType = cleanPeriodType(req.body.period_type);
    const periodLabel = cleanText(req.body.period_label);
    const periodStart = cleanDate(req.body.period_start);
    const periodEnd = cleanDate(req.body.period_end);
    const auditScore = cleanInteger(req.body.audit_score, 0);
    const auditStatus = cleanText(req.body.audit_status) || "Needs Review";
    const preparedByName = cleanText(req.body.prepared_by_name);
    const reviewedByName = cleanText(req.body.reviewed_by_name);
    const approvedByName = cleanText(req.body.approved_by_name);
    const reviewDate = cleanDate(req.body.review_date);
    const periodStatus = cleanPeriodStatus(req.body.period_status);
    const accountantNotes = cleanText(req.body.accountant_notes);
    const managementNotes = cleanText(req.body.management_notes);
    const reapprovalNotes = cleanText(req.body.reapproval_notes);
    const approvedBy = periodStatus === "approved" ? userId : null;

    if (!periodLabel) {
      return res
        .status(400)
        .json({ status: "error", message: "Period label is required." });
    }

    if (auditScore < 0 || auditScore > 100) {
      return res.status(400).json({
        status: "error",
        message: "Audit score must be between 0 and 100.",
      });
    }

    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
      SELECT id, period_status
      FROM audit_signoffs
      WHERE branch_id = ?
      AND period_type = ?
      AND (
        (period_start <=> ? AND period_end <=> ?)
        OR period_label = ?
      )
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
      `,
      [branchId, periodType, periodStart, periodEnd, periodLabel]
    );

    let signoffId;
    let previousStatus = null;
    let reapprovalLogged = false;

    const values = [
      periodLabel,
      periodStart,
      periodEnd,
      auditScore,
      auditStatus,
      preparedByName,
      reviewedByName,
      approvedByName,
      reviewDate,
      periodStatus,
      cleanBoolean(req.body.sales_checked),
      cleanBoolean(req.body.expenses_checked),
      cleanBoolean(req.body.debts_checked),
      cleanBoolean(req.body.stock_checked),
      cleanBoolean(req.body.warnings_checked),
      cleanBoolean(req.body.reports_checked),
      accountantNotes,
      managementNotes,
      approvedBy,
    ];

    if (existingRows.length > 0) {
      signoffId = existingRows[0].id;
      previousStatus = existingRows[0].period_status || null;

      const latestApprovedUnlockRequest =
        await findLatestApprovedUnlockRequest(connection, signoffId, branchId);

      await connection.query(
        `
        UPDATE audit_signoffs
        SET
          period_label = ?,
          period_start = ?,
          period_end = ?,
          audit_score = ?,
          audit_status = ?,
          prepared_by_name = ?,
          reviewed_by_name = ?,
          approved_by_name = ?,
          review_date = ?,
          period_status = ?,
          sales_checked = ?,
          expenses_checked = ?,
          debts_checked = ?,
          stock_checked = ?,
          warnings_checked = ?,
          reports_checked = ?,
          accountant_notes = ?,
          management_notes = ?,
          approved_by = ?
        WHERE id = ?
        AND branch_id = ?
        `,
        [...values, signoffId, branchId]
      );

      reapprovalLogged = await createReapprovalLogIfNeeded({
        connection,
        branchId,
        signoffId,
        latestApprovedUnlockRequest,
        previousStatus,
        periodStatus,
        periodLabel,
        periodStart,
        periodEnd,
        auditScore,
        auditStatus,
        reapprovedBy: userId,
        reapprovedByName: approvedByName || getUserDisplayName(req),
        reapprovalNotes,
        accountantNotes,
        managementNotes,
      });

      await safeLogActivity(
        connection,
        userId,
        branchId,
        reapprovalLogged ? "REAPPROVE_AUDIT_SIGNOFF" : "UPDATE_AUDIT_SIGNOFF",
        reapprovalLogged
          ? `Re-approved audit sign-off for ${periodLabel} after unlock request.`
          : `Updated audit sign-off for ${periodLabel} with status ${periodStatus}.`,
        ipAddress
      );
    } else {
      const [insertResult] = await connection.query(
        `
        INSERT INTO audit_signoffs (
          branch_id,
          period_type,
          period_label,
          period_start,
          period_end,
          audit_score,
          audit_status,
          prepared_by_name,
          reviewed_by_name,
          approved_by_name,
          review_date,
          period_status,
          sales_checked,
          expenses_checked,
          debts_checked,
          stock_checked,
          warnings_checked,
          reports_checked,
          accountant_notes,
          management_notes,
          created_by,
          approved_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [branchId, periodType, ...values.slice(0, 18), userId, approvedBy]
      );

      signoffId = insertResult.insertId;

      await safeLogActivity(
        connection,
        userId,
        branchId,
        "CREATE_AUDIT_SIGNOFF",
        `Created audit sign-off for ${periodLabel} with status ${periodStatus}.`,
        ipAddress
      );
    }

    const [savedRows] = await connection.query(
      `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name,
        b.name AS branch_name,
        b.location AS branch_location
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      LEFT JOIN branches b ON a.branch_id = b.id
      WHERE a.id = ?
      AND a.branch_id = ?
      LIMIT 1
      `,
      [signoffId, branchId]
    );

    await connection.commit();

    return res.status(existingRows.length > 0 ? 200 : 201).json({
      status: "success",
      branch_id: branchId,
      message: reapprovalLogged
        ? "Audit period re-approved and re-approval log saved successfully."
        : existingRows.length > 0
        ? "Audit sign-off updated successfully."
        : "Audit sign-off saved successfully.",
      reapproval_logged: reapprovalLogged,
      previous_status: previousStatus,
      signoff: normalizeSignoff(savedRows[0]),
    });
  } catch (error) {
    await connection.rollback();
    console.error("Save audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while saving audit sign-off.",
    });
  } finally {
    connection.release();
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await ensureAuditSignoffsTable();

    const branchId = getBranchId(req);
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid sign-off ID." });
    }

    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, period_label
       FROM audit_signoffs
       WHERE id = ?
       AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        status: "error",
        message: "Audit sign-off not found in the selected store.",
      });
    }

    await connection.query(
      `DELETE FROM audit_signoffs
       WHERE id = ?
       AND branch_id = ?`,
      [id, branchId]
    );

    await safeLogActivity(
      connection,
      getUserId(req),
      branchId,
      "DELETE_AUDIT_SIGNOFF",
      `Deleted audit sign-off for ${rows[0].period_label}.`,
      getClientIp(req)
    );

    await connection.commit();

    return res.json({
      status: "success",
      branch_id: branchId,
      message: "Audit sign-off deleted successfully.",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Delete audit signoff error:", error);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while deleting audit sign-off.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
