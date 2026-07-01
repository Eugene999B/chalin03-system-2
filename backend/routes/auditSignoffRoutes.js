const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

const allowedPeriodTypes = ["all", "today", "week", "month", "year", "custom"];
const allowedPeriodStatuses = ["draft", "reviewed", "approved", "rejected"];

let tableReadyPromise = null;

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

async function ensureAuditSignoffsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS audit_signoffs (
        id INT AUTO_INCREMENT PRIMARY KEY,
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
        INDEX idx_audit_signoff_period_type (period_type),
        INDEX idx_audit_signoff_period_dates (period_start, period_end),
        INDEX idx_audit_signoff_status (period_status),
        INDEX idx_audit_signoff_created_by (created_by),
        INDEX idx_audit_signoff_approved_by (approved_by),
        INDEX idx_audit_signoff_created_at (created_at)
      )
    `).catch((error) => {
      tableReadyPromise = null;
      throw error;
    });
  }

  await tableReadyPromise;
}

async function safeLogActivity(connection, userId, action, details, ipAddress) {
  try {
    await connection.query(
      `INSERT INTO activity_log (user_id, action, details, ip_address)
       VALUES (?, ?, ?, ?)`,
      [userId || null, action, details || null, ipAddress || null]
    );
  } catch (error) {
    console.warn("Could not write audit signoff activity log:", error.message);
  }
}

function normalizeSignoff(row) {
  if (!row) return null;

  return {
    id: row.id,
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

router.get("/", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const periodType = cleanText(req.query.period_type);
    const periodStatus = cleanText(req.query.period_status);
    const search = cleanText(req.query.search);

    let sql = `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      WHERE 1 = 1
    `;

    const params = [];

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

    const periodType = cleanPeriodType(req.query.period_type);
    const periodLabel = cleanText(req.query.period_label);
    const periodStart = cleanDate(req.query.period_start);
    const periodEnd = cleanDate(req.query.period_end);

    let sql = `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      WHERE a.period_type = ?
    `;

    const params = [periodType];

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

router.get("/:id", requireAuth, requireAdminOrManager, async (req, res) => {
  try {
    await ensureAuditSignoffsTable();

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: "error", message: "Invalid sign-off ID." });
    }

    const [rows] = await pool.query(
      `
      SELECT
        a.*,
        creator.full_name AS created_by_name,
        approver.full_name AS approved_by_user_name
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      WHERE a.id = ?
      LIMIT 1
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: "error", message: "Audit sign-off not found." });
    }

    return res.json({ status: "success", signoff: normalizeSignoff(rows[0]) });
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
    const approvedBy = periodStatus === "approved" ? userId : null;

    if (!periodLabel) {
      return res.status(400).json({ status: "error", message: "Period label is required." });
    }

    if (auditScore < 0 || auditScore > 100) {
      return res.status(400).json({ status: "error", message: "Audit score must be between 0 and 100." });
    }

    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `
      SELECT id
      FROM audit_signoffs
      WHERE period_type = ?
      AND (
        (period_start <=> ? AND period_end <=> ?)
        OR period_label = ?
      )
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
      `,
      [periodType, periodStart, periodEnd, periodLabel]
    );

    let signoffId;

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
      cleanText(req.body.accountant_notes),
      cleanText(req.body.management_notes),
      approvedBy,
    ];

    if (existingRows.length > 0) {
      signoffId = existingRows[0].id;
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
        `,
        [...values, signoffId]
      );

      await safeLogActivity(
        connection,
        userId,
        "UPDATE_AUDIT_SIGNOFF",
        `Updated audit sign-off for ${periodLabel} with status ${periodStatus}.`,
        ipAddress
      );
    } else {
      const [insertResult] = await connection.query(
        `
        INSERT INTO audit_signoffs (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [periodType, ...values.slice(0, 18), userId, approvedBy]
      );

      signoffId = insertResult.insertId;

      await safeLogActivity(
        connection,
        userId,
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
        approver.full_name AS approved_by_user_name
      FROM audit_signoffs a
      LEFT JOIN users creator ON a.created_by = creator.id
      LEFT JOIN users approver ON a.approved_by = approver.id
      WHERE a.id = ?
      LIMIT 1
      `,
      [signoffId]
    );

    await connection.commit();

    return res.status(existingRows.length > 0 ? 200 : 201).json({
      status: "success",
      message: existingRows.length > 0 ? "Audit sign-off updated successfully." : "Audit sign-off saved successfully.",
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

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: "error", message: "Invalid sign-off ID." });
    }

    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT id, period_label FROM audit_signoffs WHERE id = ? LIMIT 1",
      [id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: "error", message: "Audit sign-off not found." });
    }

    await connection.query("DELETE FROM audit_signoffs WHERE id = ?", [id]);

    await safeLogActivity(
      connection,
      getUserId(req),
      "DELETE_AUDIT_SIGNOFF",
      `Deleted audit sign-off for ${rows[0].period_label}.`,
      getClientIp(req)
    );

    await connection.commit();

    return res.json({ status: "success", message: "Audit sign-off deleted successfully." });
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
