const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || 0);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function toPositiveMoney(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number <= 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function cleanPaymentMethod(value) {
  const allowedMethods = ["cash", "momo", "bank"];
  const cleanValue = String(value || "cash").toLowerCase();

  if (allowedMethods.includes(cleanValue)) {
    return cleanValue;
  }

  return "cash";
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();

  return text || null;
}

function getDebtStatus(balance) {
  if (balance <= 0) {
    return "paid";
  }

  return "partial";
}

async function logActivity(connection, branchId, userId, action, details) {
  await writeAuditEvent({
    connection,
    branchId: branchId || null,
    userId: userId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType: "debt",
    actionType: action,
    outcome: "success",
    severity: "notice",
  });
}

function toDateOnly(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

async function findApprovedAuditLockForDate(connection, branchId, dateValue) {
  const dateOnly = toDateOnly(dateValue);

  try {
    const [locks] = await connection.query(
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

// GET /api/debts
router.get("/", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const { status, search, overdue } = req.query;

    let sql = `
      SELECT
        d.id,
        d.branch_id,
        b.name AS branch_name,
        b.branch_code,
        d.sale_id,
        s.receipt_number,
        d.customer_id,
        d.customer_name,
        d.customer_phone,
        d.amount_owed,
        d.amount_paid,
        d.balance,
        d.status,
        d.due_date,
        d.created_at,
        d.updated_at,
        DATEDIFF(CURDATE(), d.due_date) AS overdue_days
      FROM debts d
      LEFT JOIN sales s ON d.sale_id = s.id AND s.branch_id = d.branch_id
      LEFT JOIN branches b ON d.branch_id = b.id
      WHERE d.branch_id = ?
    `;

    const params = [branchId];

    if (status) {
      sql += ` AND d.status = ?`;
      params.push(status);
    }

    if (search) {
      sql += `
        AND (
          d.customer_name LIKE ?
          OR d.customer_phone LIKE ?
          OR s.receipt_number LIKE ?
        )
      `;

      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue, searchValue);
    }

    if (overdue === "true") {
      sql += `
        AND d.status != 'paid'
        AND d.due_date IS NOT NULL
        AND d.due_date < CURDATE()
      `;
    }

    sql += ` ORDER BY d.created_at DESC LIMIT 200`;

    const [debts] = await pool.query(sql, params);

    return res.json({
      status: "success",
      branch_id: branchId,
      count: debts.length,
      debts,
    });
  } catch (error) {
    console.error("Get debts error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching debts.",
    });
  }
});

// GET /api/debts/summary
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);

    const [rows] = await pool.query(
      `SELECT
        COUNT(*) AS total_debt_records,
        COALESCE(SUM(CASE WHEN status != 'paid' THEN balance ELSE 0 END), 0) AS outstanding_balance,
        COUNT(CASE WHEN status = 'unpaid' THEN 1 END) AS unpaid_count,
        COUNT(CASE WHEN status = 'partial' THEN 1 END) AS partial_count,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count,
        COUNT(
          CASE
            WHEN status != 'paid'
            AND due_date IS NOT NULL
            AND due_date < CURDATE()
            THEN 1
          END
        ) AS overdue_count
       FROM debts
       WHERE branch_id = ?`,
      [branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      summary: rows[0],
    });
  } catch (error) {
    console.error("Debt summary error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching debt summary.",
    });
  }
});

// GET /api/debts/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const { id } = req.params;

    const [debts] = await pool.query(
      `SELECT
        d.*,
        b.name AS branch_name,
        b.branch_code,
        s.receipt_number,
        s.total AS sale_total,
        s.payment_type,
        s.created_at AS sale_date
       FROM debts d
       LEFT JOIN branches b ON d.branch_id = b.id
       LEFT JOIN sales s ON d.sale_id = s.id AND s.branch_id = d.branch_id
       WHERE d.id = ?
       AND d.branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (debts.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Debt not found in the selected store.",
      });
    }

    const [payments] = await pool.query(
      `SELECT
        dp.id,
        dp.branch_id,
        dp.debt_id,
        dp.amount,
        dp.payment_method,
        dp.paid_at,
        dp.notes,
        u.full_name AS received_by_name
       FROM debt_payments dp
       LEFT JOIN users u ON dp.received_by = u.id
       WHERE dp.debt_id = ?
       AND dp.branch_id = ?
       ORDER BY dp.paid_at DESC, dp.id DESC`,
      [id, branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      debt: debts[0],
      payments,
    });
  } catch (error) {
    console.error("Get single debt error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching the debt.",
    });
  }
});

// POST /api/debts/:id/payments
router.post("/:id/payments", requireAuth, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = getBranchId(req);
    const { id } = req.params;
    const { amount, payment_method, notes } = req.body;

    const paymentAmount = toPositiveMoney(amount);
    const cleanMethod = cleanPaymentMethod(payment_method);
    const cleanNotes = cleanText(notes);

    if (paymentAmount === null) {
      return res.status(400).json({
        status: "error",
        message: "Payment amount must be greater than zero.",
      });
    }

    await connection.beginTransaction();

    const lockedPeriod = await findApprovedAuditLockForDate(
      connection,
      branchId,
      new Date()
    );

    if (lockedPeriod) {
      await connection.rollback();

      return sendAuditLockedResponse(
        res,
        lockedPeriod,
        "record a debt payment"
      );
    }

    const [debts] = await connection.query(
      `SELECT
        d.*,
        s.receipt_number,
        s.created_at AS sale_date
       FROM debts d
       LEFT JOIN sales s ON d.sale_id = s.id AND s.branch_id = d.branch_id
       WHERE d.id = ?
       AND d.branch_id = ?
       LIMIT 1
       FOR UPDATE`,
      [id, branchId]
    );

    if (debts.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        status: "error",
        message: "Debt not found in the selected store.",
      });
    }

    const debt = debts[0];

    if (debt.status === "paid" || Number(debt.balance) <= 0) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message: "This debt has already been fully paid.",
      });
    }

    const oldBalance = Number(debt.balance || 0);

    if (paymentAmount > oldBalance) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message: `Payment cannot be more than the remaining balance of GHS ${oldBalance.toFixed(
          2
        )}.`,
      });
    }

    const newAmountPaid = Number(
      (Number(debt.amount_paid || 0) + paymentAmount).toFixed(2)
    );

    const newBalance = Number(
      Math.max(Number(debt.amount_owed || 0) - newAmountPaid, 0).toFixed(2)
    );

    const newStatus = getDebtStatus(newBalance);

    const [paymentResult] = await connection.query(
      `INSERT INTO debt_payments (
        branch_id,
        debt_id,
        amount,
        payment_method,
        received_by,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?)`,
      [branchId, id, paymentAmount, cleanMethod, req.user.id, cleanNotes]
    );

    await connection.query(
      `UPDATE debts
       SET amount_paid = ?,
           balance = ?,
           status = ?
       WHERE id = ?
       AND branch_id = ?`,
      [newAmountPaid, newBalance, newStatus, id, branchId]
    );

    await connection.query(
      `UPDATE sales
       SET amount_paid = amount_paid + ?,
           balance = GREATEST(balance - ?, 0)
       WHERE id = ?
       AND branch_id = ?`,
      [paymentAmount, paymentAmount, debt.sale_id, branchId]
    );

    await logActivity(
      connection,
      branchId,
      req.user.id,
      "DEBT_PAYMENT",
      `Received GHS ${paymentAmount.toFixed(2)} by ${cleanMethod} from ${
        debt.customer_name
      }. New balance: GHS ${newBalance.toFixed(2)}`
    );

    await connection.commit();

    const [createdPayments] = await pool.query(
      `SELECT
        dp.id,
        dp.branch_id,
        dp.debt_id,
        dp.amount,
        dp.payment_method,
        dp.paid_at,
        dp.notes,
        u.full_name AS received_by_name
       FROM debt_payments dp
       LEFT JOIN users u ON dp.received_by = u.id
       WHERE dp.id = ?
       AND dp.branch_id = ?
       LIMIT 1`,
      [paymentResult.insertId, branchId]
    );

    const createdPayment = createdPayments[0];

    return res.status(201).json({
      status: "success",
      message: "Debt payment recorded successfully.",
      branch_id: branchId,
      receipt: {
        payment: createdPayment,
        debt: {
          id: debt.id,
          branch_id: branchId,
          sale_id: debt.sale_id,
          receipt_number: debt.receipt_number,
          customer_name: debt.customer_name,
          customer_phone: debt.customer_phone,
          amount_owed: Number(debt.amount_owed || 0),
          previous_amount_paid: Number(debt.amount_paid || 0),
          previous_balance: oldBalance,
          amount_paid: newAmountPaid,
          balance: newBalance,
          status: newStatus,
        },
      },
      payment: createdPayment,
      debt: {
        id: debt.id,
        branch_id: branchId,
        customer_name: debt.customer_name,
        customer_phone: debt.customer_phone,
        amount_owed: Number(debt.amount_owed || 0),
        amount_paid: newAmountPaid,
        balance: newBalance,
        status: newStatus,
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("Record debt payment error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while recording debt payment.",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
