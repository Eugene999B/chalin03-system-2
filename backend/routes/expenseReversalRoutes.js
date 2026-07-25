const express = require("express");

const { pool } = require("../config/db");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { markClosingStale } = require("../services/dailyClosingSecurityService");
const {
  verifyIndependentBranchApprover,
} = require("../services/independentApproverService");

const router = express.Router();

function cleanText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dateOnly(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

function voidReference(expenseId) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `EXP-VOID-${stamp}-${String(expenseId).padStart(6, "0")}`;
}

async function approvedAuditLock(connection, branchId, expenseDate) {
  const day = dateOnly(expenseDate);
  if (!day) return null;

  try {
    const [rows] = await connection.query(
      `SELECT
         id, branch_id, period_type, period_label, period_start, period_end,
         audit_score, audit_status, period_status, approved_by_name,
         review_date, updated_at
       FROM audit_signoffs
       WHERE branch_id = ?
         AND period_status = 'approved'
         AND (
           period_type = 'all'
           OR (period_start IS NOT NULL AND period_end IS NOT NULL AND ? BETWEEN period_start AND period_end)
           OR (period_start IS NOT NULL AND period_end IS NULL AND ? >= period_start)
           OR (period_start IS NULL AND period_end IS NOT NULL AND ? <= period_end)
         )
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [branchId, day, day, day]
    );
    return rows[0] || null;
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error?.code)) {
      return null;
    }
    throw error;
  }
}

function lockedResponse(res, lock) {
  return res.status(423).json({
    status: "error",
    code: "AUDIT_PERIOD_LOCKED",
    message:
      "This accounting period is approved and locked. Request an authorised unlock before voiding the expense.",
    locked_period: lock,
  });
}

router.get("/", requireRole("admin", "manager"), async (req, res) => {
  try {
    const branchId = Number(req.user.branch_id);
    const search = cleanText(req.query.search, 180);
    const from = cleanText(req.query.from, 20);
    const to = cleanText(req.query.to, 20);
    const includeVoided =
      String(req.query.include_voided || "").toLowerCase() === "true" &&
      String(req.user.role || "").toLowerCase() === "admin";

    const where = ["e.branch_id = ?"];
    const params = [branchId];

    if (!includeVoided) where.push("e.is_voided = 0");
    if (search) {
      const value = `%${search}%`;
      where.push(`(
        e.category LIKE ? OR e.description LIKE ? OR recorder.full_name LIKE ?
        OR e.void_reason LIKE ? OR e.void_reference LIKE ?
      )`);
      params.push(value, value, value, value, value);
    }
    if (from) {
      where.push("e.expense_date >= ?");
      params.push(from);
    }
    if (to) {
      where.push("e.expense_date <= ?");
      params.push(to);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [expenses] = await pool.query(
      `SELECT
         e.id, e.branch_id, e.category, e.description, e.amount,
         e.payment_method, e.funding_source, e.affects_daily_closing,
         e.closing_treatment_note, e.expense_date, e.recorded_by,
         e.is_voided, e.void_reason, e.void_reference, e.voided_by,
         e.voided_at, e.void_approved_by, e.void_approved_at, e.created_at,
         recorder.full_name AS recorded_by_name,
         voider.full_name AS voided_by_name,
         approver.full_name AS void_approved_by_name,
         b.code AS store_code,
         b.branch_code,
         b.name AS branch_name,
         b.location AS branch_location
       FROM expenses e
       LEFT JOIN users recorder ON recorder.id = e.recorded_by
       LEFT JOIN users voider ON voider.id = e.voided_by
       LEFT JOIN users approver ON approver.id = e.void_approved_by
       LEFT JOIN branches b ON b.id = e.branch_id
       ${whereSql}
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      params
    );

    const [summaryRows] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN e.is_voided = 0 THEN e.amount ELSE 0 END), 0) AS total_expenses,
         SUM(e.is_voided = 0) AS expense_count,
         COALESCE(SUM(CASE WHEN e.is_voided = 0 AND e.affects_daily_closing = 1 THEN e.amount ELSE 0 END), 0) AS closing_expenses,
         COALESCE(SUM(CASE WHEN e.is_voided = 0 AND e.affects_daily_closing = 0 THEN e.amount ELSE 0 END), 0) AS externally_funded_expenses,
         SUM(e.is_voided = 1) AS voided_expense_count
       FROM expenses e
       LEFT JOIN users recorder ON recorder.id = e.recorded_by
       ${whereSql}`,
      params
    );

    const summary = summaryRows[0] || {};
    return res.json({
      status: "success",
      branch_id: branchId,
      count: expenses.length,
      summary: {
        total_expenses: Number(summary.total_expenses || 0),
        expense_count: Number(summary.expense_count || 0),
        closing_expenses: Number(summary.closing_expenses || 0),
        externally_funded_expenses: Number(
          summary.externally_funded_expenses || 0
        ),
        voided_expense_count: Number(summary.voided_expense_count || 0),
      },
      expenses,
    });
  } catch (error) {
    console.error("Get immutable expense ledger error:", error);
    return res.status(500).json({
      status: "error",
      code: "EXPENSE_LEDGER_LOAD_FAILED",
      message: "The expense ledger could not be loaded safely.",
    });
  }
});

router.delete("/:id", requireRole("admin", "manager"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const expenseId = positiveId(req.params.id);
    const branchId = Number(req.user.branch_id);
    const reason = cleanText(req.body?.reason || req.body?.void_reason, 1000);

    if (!expenseId) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_EXPENSE_ID",
        message: "Choose a valid expense to void.",
      });
    }

    if (reason.length < 8) {
      return res.status(400).json({
        status: "error",
        code: "EXPENSE_VOID_REASON_REQUIRED",
        message: "Enter a clear void reason using at least 8 characters.",
      });
    }

    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT *
       FROM expenses
       WHERE id = ? AND branch_id = ?
       LIMIT 1
       FOR UPDATE`,
      [expenseId, branchId]
    );
    const expense = rows[0];

    if (!expense) {
      await connection.rollback();
      return res.status(404).json({
        status: "error",
        code: "EXPENSE_NOT_FOUND",
        message: "Expense not found in the selected store.",
      });
    }
    if (Number(expense.is_voided || 0) === 1) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        code: "EXPENSE_ALREADY_VOIDED",
        message: "This expense has already been voided and remains in the ledger.",
      });
    }

    const lock = await approvedAuditLock(
      connection,
      branchId,
      expense.expense_date
    );
    if (lock) {
      await connection.rollback();
      return lockedResponse(res, lock);
    }

    const approval = await verifyIndependentBranchApprover(connection, {
      currentUserId: req.user.id,
      branchId,
      approverUsername: req.body?.approver_username,
      approverPassword: req.body?.approver_password,
    });
    if (approval.error) {
      await connection.rollback();
      return res.status(403).json({
        status: "error",
        code: "INDEPENDENT_APPROVER_REQUIRED",
        message: approval.error,
      });
    }

    const reference = voidReference(expenseId);
    const [updateResult] = await connection.query(
      `UPDATE expenses
       SET is_voided = 1,
           void_reason = ?,
           void_reference = ?,
           voided_by = ?,
           voided_at = NOW(),
           void_approved_by = ?,
           void_approved_at = NOW()
       WHERE id = ? AND branch_id = ? AND is_voided = 0`,
      [
        reason,
        reference,
        req.user.id,
        approval.approver.id,
        expenseId,
        branchId,
      ]
    );

    if (Number(updateResult.affectedRows || 0) !== 1) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        code: "EXPENSE_VOID_CONFLICT",
        message: "The expense changed before the void could be completed. Refresh and try again.",
      });
    }

    const affectedClosing = await markClosingStale(connection, {
      branchId,
      transactionDate: expense.expense_date,
      reason: `Expense ${expenseId} (${expense.category}) worth GHS ${Number(
        expense.amount || 0
      ).toFixed(2)} was voided under ${reference}. The original row remains preserved.`,
      sourceEntityType: "expense_void",
      sourceEntityId: expenseId,
      changedBy: req.user.id,
      approvedBy: approval.approver.id,
    });

    await writeAuditEvent({
      connection,
      req,
      branchId,
      userId: req.user.id,
      action: "VOID_EXPENSE",
      actionType: "expense.void",
      entityType: "expense",
      entityId: expenseId,
      workspaceCode: "spare_parts",
      outcome: "success",
      severity: "critical",
      details: `Voided expense ${expenseId} under ${reference}; the original financial record was preserved and independently approved by ${approval.approver.full_name}.`,
      metadata: {
        void_reference: reference,
        void_reason: reason,
        independent_approver: approval.approver,
        original_expense: {
          category: expense.category,
          description: expense.description,
          amount: Number(expense.amount || 0),
          payment_method: expense.payment_method,
          funding_source: expense.funding_source,
          affects_daily_closing: Number(expense.affects_daily_closing || 0),
          expense_date: expense.expense_date,
          recorded_by: expense.recorded_by,
          created_at: expense.created_at,
        },
      },
    });

    await connection.commit();
    return res.json({
      status: "success",
      code: "EXPENSE_VOIDED",
      message:
        "Expense voided successfully. The original financial row and independent approval evidence were preserved.",
      expense_id: expenseId,
      void_reference: reference,
      approved_by: approval.approver.full_name,
      affected_closing: affectedClosing,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    console.error("Void expense error:", error);
    return res.status(500).json({
      status: "error",
      code: "EXPENSE_VOID_FAILED",
      message: "The expense could not be voided safely.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
