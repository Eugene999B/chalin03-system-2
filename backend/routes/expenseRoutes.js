const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { markClosingStale } = require("../services/dailyClosingSecurityService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateExpenseCreateRequest } = require("../validation/operationsRequestValidators");

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

const EXPENSE_FUNDING_SOURCES = new Set([
  "today_sales_receipts",
  "petty_cash",
  "prior_business_funds",
  "owner_manager_funds",
  "bank_account",
  "momo_wallet",
  "unpaid_credit",
  "other",
]);

function parseRequiredBoolean(value) {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }

  return null;
}

function fundingSourceLabel(value) {
  return cleanText(value || "other")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toDateOnly(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

async function logActivity(userId, branchId, action, details, connection = pool) {
  await writeAuditEvent({
    connection,
    branchId: branchId || null,
    userId: userId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType: "expense",
    actionType: action,
    outcome: "success",
    severity: "notice",
  });
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
          e.payment_method,
          e.funding_source,
          e.affects_daily_closing,
          e.closing_treatment_note,
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
          COUNT(*) AS expense_count,
          COALESCE(SUM(CASE WHEN e.affects_daily_closing = 1 THEN e.amount ELSE 0 END), 0) AS closing_expenses,
          COALESCE(SUM(CASE WHEN e.affects_daily_closing = 0 THEN e.amount ELSE 0 END), 0) AS externally_funded_expenses
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
          closing_expenses: Number(summaryRows[0].closing_expenses || 0),
          externally_funded_expenses: Number(
            summaryRows[0].externally_funded_expenses || 0
          ),
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
  validateRequest(validateExpenseCreateRequest),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);

      const {
        category,
        description,
        amount: cleanAmount,
        payment_method: paymentMethod,
        funding_source: fundingSource,
        affects_daily_closing: affectsDailyClosing,
        closing_treatment_note: closingTreatmentNote,
        expense_date: expenseDate,
      } = req.validated.body;

      if (!category || !expenseDate || cleanAmount === undefined || cleanAmount === null) {
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

      if (!["cash", "momo", "bank", "other"].includes(paymentMethod)) {
        return res.status(400).json({
          status: "error",
          message: "Expense payment method must be cash, momo, bank, or other.",
        });
      }

      if (!EXPENSE_FUNDING_SOURCES.has(fundingSource)) {
        return res.status(400).json({
          status: "error",
          message: "Choose a valid source of funds for this expense.",
        });
      }

      if (affectsDailyClosing === null) {
        return res.status(400).json({
          status: "error",
          message:
            "Confirm whether this expense used money collected during this business day.",
        });
      }

      if (affectsDailyClosing && fundingSource !== "today_sales_receipts") {
        return res.status(400).json({
          status: "error",
          message:
            "An expense may reduce Daily Closing only when its source is Today's Sales Receipts.",
        });
      }

      if (!affectsDailyClosing && fundingSource === "today_sales_receipts") {
        return res.status(400).json({
          status: "error",
          message:
            "Today's Sales Receipts must be marked to reduce the selected Daily Closing payment channel.",
        });
      }

      if (fundingSource === "unpaid_credit" && paymentMethod !== "other") {
        return res.status(400).json({
          status: "error",
          message:
            "An unpaid credit expense must use Other as its payment method until it is actually paid.",
        });
      }

      if (fundingSource === "other" && closingTreatmentNote.length < 8) {
        return res.status(400).json({
          status: "error",
          message:
            "Describe the other funding source using at least 8 characters.",
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

      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO expenses (
          branch_id,
          category,
          description,
          amount,
          payment_method,
          funding_source,
          affects_daily_closing,
          closing_treatment_note,
          expense_date,
          recorded_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          category,
          description || null,
          cleanAmount,
          paymentMethod,
          fundingSource,
          affectsDailyClosing ? 1 : 0,
          closingTreatmentNote || null,
          expenseDate,
          req.user.id,
        ]
      );

      await logActivity(
        req.user.id,
        branchId,
        "CREATE_EXPENSE",
        `Recorded ${paymentMethod} expense "${category}" worth GHS ${cleanAmount.toFixed(
          2
        )}. Funding: ${fundingSourceLabel(fundingSource)}. Daily Closing: ${
          affectsDailyClosing ? "deduct from selected channel" : "accounting only"
        }.`,
        connection
      );

      const affectedClosing = await markClosingStale(connection, {
        branchId,
        transactionDate: expenseDate,
        reason: `${paymentMethod} expense "${category}" worth GHS ${cleanAmount.toFixed(
          2
        )} was recorded after the business day had already been closed. Funding: ${fundingSourceLabel(
          fundingSource
        )}. Daily Closing treatment: ${
          affectsDailyClosing ? "deduct from expected settlement" : "report only"
        }.`,
        sourceEntityType: "expense",
        sourceEntityId: result.insertId,
        changedBy: req.user.id,
      });

      await connection.commit();

      const [expenses] = await pool.query(
        `SELECT
          e.id,
          e.branch_id,
          e.category,
          e.description,
          e.amount,
          e.payment_method,
          e.funding_source,
          e.affects_daily_closing,
          e.closing_treatment_note,
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
        affected_closing: affectedClosing,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Create expense error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording expense.",
      });
    } finally {
      connection.release();
    }
  }
);


module.exports = router;
