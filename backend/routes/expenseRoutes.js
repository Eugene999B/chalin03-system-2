const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

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

function toDateOnly(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

async function logActivity(userId, branchId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [branchId || null, userId || null, action, details]
  );
}

async function findApprovedAuditLockForDate(dateValue, branchId) {
  const dateOnly = toDateOnly(dateValue);

  try {
    const [locks] = await pool.query(
      `SELECT
        id,
        branch_id,
        period_type,
        period_label,
        period_start,
        period_end,
        audit_score,
        audit_status,
        period_status,
        approved_by_name,
        review_date,
        updated_at
       FROM audit_signoffs
       WHERE branch_id = ?
       AND period_status = 'approved'
       AND (
        period_type = 'all'
        OR (
          period_start IS NOT NULL
          AND period_end IS NOT NULL
          AND ? BETWEEN period_start AND period_end
        )
        OR (
          period_start IS NOT NULL
          AND period_end IS NULL
          AND ? >= period_start
        )
        OR (
          period_start IS NULL
          AND period_end IS NOT NULL
          AND ? <= period_end
        )
       )
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [branchId, dateOnly, dateOnly, dateOnly]
    );

    return locks.length > 0 ? locks[0] : null;
  } catch (error) {
    if (
      error.code === "ER_NO_SUCH_TABLE" ||
      error.code === "ER_BAD_TABLE_ERROR"
    ) {
      return null;
    }

    throw error;
  }
}

function sendAuditLockedResponse(res, lock, actionText) {
  return res.status(423).json({
    status: "error",
    code: "AUDIT_PERIOD_LOCKED",
    message: `This accounting period is already approved and locked. You cannot ${actionText} inside this period.`,
    locked_period: {
      id: lock.id,
      branch_id: lock.branch_id,
      period_type: lock.period_type,
      period_label: lock.period_label,
      period_start: lock.period_start,
      period_end: lock.period_end,
      audit_score: lock.audit_score,
      audit_status: lock.audit_status,
      approved_by_name: lock.approved_by_name,
      review_date: lock.review_date,
    },
  });
}

// GET /api/expenses
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const search = cleanText(req.query.search);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      let whereClause = "WHERE e.branch_id = ?";

      if (search) {
        whereClause += ` AND (
          e.category LIKE ?
          OR e.description LIKE ?
          OR u.full_name LIKE ?
        )`;

        const searchValue = `%${search}%`;
        params.push(searchValue, searchValue, searchValue);
      }

      if (from) {
        whereClause += ` AND e.expense_date >= ?`;
        params.push(from);
      }

      if (to) {
        whereClause += ` AND e.expense_date <= ?`;
        params.push(to);
      }

      const [expenses] = await pool.query(
        `SELECT
          e.id,
          e.branch_id,
          e.category,
          e.description,
          e.amount,
          e.expense_date,
          e.recorded_by,
          e.created_at,
          u.full_name AS recorded_by_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
         LEFT JOIN branches b ON e.branch_id = b.id
         ${whereClause}
         ORDER BY e.expense_date DESC, e.created_at DESC`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT
          COALESCE(SUM(e.amount), 0) AS total_expenses,
          COUNT(*) AS expense_count
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
         ${whereClause}`,
        params
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: expenses.length,
        summary: {
          total_expenses: Number(summaryRows[0].total_expenses || 0),
          expense_count: Number(summaryRows[0].expense_count || 0),
        },
        expenses,
      });
    } catch (error) {
      console.error("Get expenses error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching expenses.",
      });
    }
  }
);

// POST /api/expenses
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      const category = cleanText(req.body.category);
      const description = cleanText(req.body.description);
      const expenseDate = cleanText(req.body.expense_date);
      const cleanAmount = Number(req.body.amount);

      if (!category || !expenseDate || req.body.amount === undefined || req.body.amount === null) {
        return res.status(400).json({
          status: "error",
          message: "Category, amount and expense date are required.",
        });
      }

      if (Number.isNaN(cleanAmount) || cleanAmount <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Amount must be a valid number greater than zero.",
        });
      }

      const lockedPeriod = await findApprovedAuditLockForDate(
        expenseDate,
        branchId
      );

      if (lockedPeriod) {
        return sendAuditLockedResponse(
          res,
          lockedPeriod,
          "record an expense"
        );
      }

      const [result] = await pool.query(
        `INSERT INTO expenses (
          branch_id,
          category,
          description,
          amount,
          expense_date,
          recorded_by
        )
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          category,
          description || null,
          cleanAmount,
          expenseDate,
          req.user.id,
        ]
      );

      await logActivity(
        req.user.id,
        branchId,
        "CREATE_EXPENSE",
        `Recorded expense "${category}" worth GHS ${cleanAmount.toFixed(2)}`
      );

      const [expenses] = await pool.query(
        `SELECT
          e.id,
          e.branch_id,
          e.category,
          e.description,
          e.amount,
          e.expense_date,
          e.recorded_by,
          e.created_at,
          u.full_name AS recorded_by_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.id = ?
         AND e.branch_id = ?
         LIMIT 1`,
        [result.insertId, branchId]
      );

      return res.status(201).json({
        status: "success",
        message: "Expense recorded successfully.",
        expense: expenses[0],
      });
    } catch (error) {
      console.error("Create expense error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording expense.",
      });
    }
  }
);

// DELETE /api/expenses/:id
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const { id } = req.params;

      const [expenses] = await pool.query(
        `SELECT id, branch_id, category, amount, expense_date
         FROM expenses
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      if (expenses.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Expense not found in the selected store.",
        });
      }

      const expense = expenses[0];

      const lockedPeriod = await findApprovedAuditLockForDate(
        expense.expense_date,
        branchId
      );

      if (lockedPeriod) {
        return sendAuditLockedResponse(
          res,
          lockedPeriod,
          "delete an expense"
        );
      }

      await pool.query(
        `DELETE FROM expenses
         WHERE id = ?
         AND branch_id = ?`,
        [id, branchId]
      );

      await logActivity(
        req.user.id,
        branchId,
        "DELETE_EXPENSE",
        `Deleted expense "${expense.category}" worth GHS ${Number(
          expense.amount
        ).toFixed(2)}`
      );

      return res.json({
        status: "success",
        message: "Expense deleted successfully.",
      });
    } catch (error) {
      console.error("Delete expense error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while deleting expense.",
      });
    }
  }
);

module.exports = router;
