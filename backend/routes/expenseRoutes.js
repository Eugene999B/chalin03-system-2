const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

async function logActivity(userId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (user_id, action, details)
     VALUES (?, ?, ?)`,
    [userId || null, action, details]
  );
}

// GET /api/expenses
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { search, from, to } = req.query;

      const params = [];
      let whereClause = "WHERE 1 = 1";

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
          e.category,
          e.description,
          e.amount,
          e.expense_date,
          e.recorded_by,
          e.created_at,
          u.full_name AS recorded_by_name
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
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
      const { category, description, amount, expense_date } = req.body;

      if (!category || !amount || !expense_date) {
        return res.status(400).json({
          status: "error",
          message: "Category, amount and expense date are required.",
        });
      }

      const cleanAmount = Number(amount);

      if (Number.isNaN(cleanAmount) || cleanAmount <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Amount must be a valid number greater than zero.",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO expenses (
          category,
          description,
          amount,
          expense_date,
          recorded_by
        )
        VALUES (?, ?, ?, ?, ?)`,
        [
          category,
          description || null,
          cleanAmount,
          expense_date,
          req.user.id,
        ]
      );

      await logActivity(
        req.user.id,
        "CREATE_EXPENSE",
        `Recorded expense "${category}" worth GHS ${cleanAmount.toFixed(2)}`
      );

      const [expenses] = await pool.query(
        `SELECT
          e.id,
          e.category,
          e.description,
          e.amount,
          e.expense_date,
          e.recorded_by,
          e.created_at,
          u.full_name AS recorded_by_name
         FROM expenses e
         LEFT JOIN users u ON e.recorded_by = u.id
         WHERE e.id = ?
         LIMIT 1`,
        [result.insertId]
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
      const { id } = req.params;

      const [expenses] = await pool.query(
        `SELECT id, category, amount
         FROM expenses
         WHERE id = ?
         LIMIT 1`,
        [id]
      );

      if (expenses.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Expense not found.",
        });
      }

      const expense = expenses[0];

      await pool.query(`DELETE FROM expenses WHERE id = ?`, [id]);

      await logActivity(
        req.user.id,
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