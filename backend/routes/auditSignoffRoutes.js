const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

const allowedPeriodTypes = ["all", "today", "week", "month", "year", "custom"];
const allowedPeriodStatuses = ["draft", "reviewed", "approved", "rejected"];

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();

  return text === "" ? null : text;
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

function cleanInteger(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isInteger(number)) {
    return fallback;
  }

  return number;
}

function cleanBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanPeriodType(value) {
  const cleanValue = String(value || "month").toLowerCase();

  if (allowedPeriodTypes.includes(cleanValue)) {
    return cleanValue;
  }

  return "month";
}

function cleanPeriodStatus(value) {
  const cleanValue = String(value || "draft").toLowerCase();

  if (allowedPeriodStatuses.includes(cleanValue)) {
    return cleanValue;
  }

  return "draft";
}

function getUserId(req) {
  return req.user?.id || req.user?.user_id || null;
}

function getApprovedBy(req, periodStatus) {
  if (periodStatus === "approved") {
    return getUserId(req);
  }

  return null;
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );
}

async function logActivity(connection, userId, action, details, ipAddress) {
  await connection.query(
    `INSERT INTO activity_log (user_id, action, details, ip_address)
     VALUES (?, ?, ?, ?)`,
    [userId || null, action, details || null, ipAddress || null]
  );
}

function normalizeSignoff(row) {
  if (!row) {
    return null;
  }

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

// GET /api/audit-signoffs
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { period_type, period_status, search } = req.query;

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

      if (period_type && allowedPeriodTypes.includes(period_type)) {
        sql += ` AND a.period_type = ?`;
        params.push(period_type);
      }

      if (period_status && allowedPeriodStatuses.includes(period_status)) {
        sql += ` AND a.period_status = ?`;
        params.push(period_status);
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

      sql += ` ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 200`;

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
  }
);

// GET /api/audit-signoffs/latest
router.get(
  "/latest",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
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

      if (periodStart) {
        sql += ` AND a.period_start = ?`;
        params.push(periodStart);
      }

      if (periodEnd) {
        sql += ` AND a.period_end = ?`;
        params.push(periodEnd);
      }

      if (!periodStart && !periodEnd && periodLabel) {
        sql += ` AND a.period_label = ?`;
        params.push(periodLabel);
      }

      sql += ` ORDER BY a.updated_at DESC, a.created_at DESC LIMIT 1`;

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
  }
);

// GET /api/audit-signoffs/:id
router.get(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid sign-off ID.",
        });
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
        return res.status(404).json({
          status: "error",
          message: "Audit sign-off not found.",
        });
      }

      return res.json({
        status: "success",
        signoff: normalizeSignoff(rows[0]),
      });
    } catch (error) {
      console.error("Get audit signoff error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching audit sign-off.",
      });
    }
  }
);

// POST /api/audit-signoffs
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
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

      const salesChecked = cleanBoolean(req.body.sales_checked);
      const expensesChecked = cleanBoolean(req.body.expenses_checked);
      const debtsChecked = cleanBoolean(req.body.debts_checked);
      const stockChecked = cleanBoolean(req.body.stock_checked);
      const warningsChecked = cleanBoolean(req.body.warnings_checked);
      const reportsChecked = cleanBoolean(req.body.reports_checked);

      const accountantNotes = cleanText(req.body.accountant_notes);
      const managementNotes = cleanText(req.body.management_notes);

      const approvedBy = getApprovedBy(req, periodStatus);

      if (!periodLabel) {
        return res.status(400).json({
          status: "error",
          message: "Period label is required.",
        });
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
          [
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
            salesChecked,
            expensesChecked,
            debtsChecked,
            stockChecked,
            warningsChecked,
            reportsChecked,
            accountantNotes,
            managementNotes,
            approvedBy,
            signoffId,
          ]
        );

        await logActivity(
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
          [
            periodType,
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
            salesChecked,
            expensesChecked,
            debtsChecked,
            stockChecked,
            warningsChecked,
            reportsChecked,
            accountantNotes,
            managementNotes,
            userId,
            approvedBy,
          ]
        );

        signoffId = insertResult.insertId;

        await logActivity(
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
        message:
          existingRows.length > 0
            ? "Audit sign-off updated successfully."
            : "Audit sign-off saved successfully.",
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
  }
);

// DELETE /api/audit-signoffs/:id
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Invalid sign-off ID.",
        });
      }

      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT id, period_label FROM audit_signoffs WHERE id = ? LIMIT 1`,
        [id]
      );

      if (rows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Audit sign-off not found.",
        });
      }

      await connection.query(`DELETE FROM audit_signoffs WHERE id = ?`, [id]);

      await logActivity(
        connection,
        getUserId(req),
        "DELETE_AUDIT_SIGNOFF",
        `Deleted audit sign-off for ${rows[0].period_label}.`,
        getClientIp(req)
      );

      await connection.commit();

      return res.json({
        status: "success",
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
  }
);

module.exports = router;