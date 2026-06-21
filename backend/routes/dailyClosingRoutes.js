const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toMoney(value) {
  const number = Number(value || 0);

  if (Number.isNaN(number)) {
    return 0;
  }

  return Number(number.toFixed(2));
}

function toCountedMoney(value, fallbackValue) {
  if (value === undefined || value === null || value === "") {
    return toMoney(fallbackValue);
  }

  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

async function logActivity(connection, userId, action, details) {
  await connection.query(
    `INSERT INTO activity_log (user_id, action, details)
     VALUES (?, ?, ?)`,
    [userId || null, action, details]
  );
}

async function calculateClosingSummary(closingDate) {
  const [salesRows] = await pool.query(
    `SELECT
      COUNT(*) AS sales_count,
      COALESCE(SUM(total), 0) AS sales_total,
      COALESCE(SUM(amount_paid), 0) AS sales_received,

      COALESCE(SUM(CASE WHEN payment_type = 'cash' THEN amount_paid ELSE 0 END), 0) AS cash_sales,
      COALESCE(SUM(CASE WHEN payment_type = 'momo' THEN amount_paid ELSE 0 END), 0) AS momo_sales,
      COALESCE(SUM(CASE WHEN payment_type = 'bank' THEN amount_paid ELSE 0 END), 0) AS bank_sales,
      COALESCE(SUM(CASE WHEN payment_type = 'mixed' THEN amount_paid ELSE 0 END), 0) AS mixed_sales,

      COALESCE(SUM(CASE WHEN payment_type = 'credit' THEN total ELSE 0 END), 0) AS credit_sales_total,
      COALESCE(SUM(CASE WHEN payment_type = 'credit' THEN amount_paid ELSE 0 END), 0) AS credit_sales_received
     FROM sales
     WHERE DATE(created_at) = ?
     AND sale_status = 'completed'
     AND COALESCE(is_voided, 0) = 0`,
    [closingDate]
  );

  const [debtPaymentRows] = await pool.query(
    `SELECT
      COUNT(*) AS debt_payment_count,
      COALESCE(SUM(dp.amount), 0) AS debt_payments_total,
      COALESCE(SUM(CASE WHEN dp.payment_method = 'cash' THEN dp.amount ELSE 0 END), 0) AS debt_cash,
      COALESCE(SUM(CASE WHEN dp.payment_method = 'momo' THEN dp.amount ELSE 0 END), 0) AS debt_momo,
      COALESCE(SUM(CASE WHEN dp.payment_method = 'bank' THEN dp.amount ELSE 0 END), 0) AS debt_bank
     FROM debt_payments dp
     INNER JOIN debts d ON dp.debt_id = d.id
     INNER JOIN sales s ON d.sale_id = s.id
     WHERE DATE(dp.paid_at) = ?
     AND COALESCE(s.is_voided, 0) = 0
     AND s.sale_status != 'cancelled'`,
    [closingDate]
  );

  const [expenseRows] = await pool.query(
    `SELECT
      COUNT(*) AS expenses_count,
      COALESCE(SUM(amount), 0) AS expenses_total
     FROM expenses
     WHERE expense_date = ?`,
    [closingDate]
  );

  const sales = salesRows[0] || {};
  const debts = debtPaymentRows[0] || {};
  const expenses = expenseRows[0] || {};

  const salesCount = Number(sales.sales_count || 0);
  const salesTotal = toMoney(sales.sales_total);
  const salesReceived = toMoney(sales.sales_received);

  const cashSales = toMoney(sales.cash_sales);
  const momoSales = toMoney(sales.momo_sales);
  const bankSales = toMoney(sales.bank_sales);
  const mixedSales = toMoney(sales.mixed_sales);
  const creditSalesTotal = toMoney(sales.credit_sales_total);
  const creditSalesReceived = toMoney(sales.credit_sales_received);

  const debtPaymentCount = Number(debts.debt_payment_count || 0);
  const debtPaymentsTotal = toMoney(debts.debt_payments_total);
  const debtCash = toMoney(debts.debt_cash);
  const debtMomo = toMoney(debts.debt_momo);
  const debtBank = toMoney(debts.debt_bank);

  const expensesCount = Number(expenses.expenses_count || 0);
  const expensesTotal = toMoney(expenses.expenses_total);

  const expectedCash = toMoney(cashSales + debtCash - expensesTotal);
  const expectedMomo = toMoney(momoSales + debtMomo);
  const expectedBank = toMoney(bankSales + debtBank);
  const expectedOther = toMoney(mixedSales + creditSalesReceived);

  const expectedTotal = toMoney(
    expectedCash + expectedMomo + expectedBank + expectedOther
  );

  return {
    closing_date: closingDate,

    sales_count: salesCount,
    sales_total: salesTotal,
    sales_received: salesReceived,

    cash_sales: cashSales,
    momo_sales: momoSales,
    bank_sales: bankSales,
    mixed_sales: mixedSales,
    credit_sales_total: creditSalesTotal,
    credit_sales_received: creditSalesReceived,

    debt_payment_count: debtPaymentCount,
    debt_payments_total: debtPaymentsTotal,
    debt_cash: debtCash,
    debt_momo: debtMomo,
    debt_bank: debtBank,

    expenses_count: expensesCount,
    expenses_total: expensesTotal,

    expected_cash: expectedCash,
    expected_momo: expectedMomo,
    expected_bank: expectedBank,
    expected_other: expectedOther,
    expected_total: expectedTotal,
  };
}

// GET /api/daily-closing/summary?date=YYYY-MM-DD
router.get(
  "/summary",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const closingDate = req.query.date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Date must be in YYYY-MM-DD format.",
        });
      }

      const summary = await calculateClosingSummary(closingDate);

      const [existingRows] = await pool.query(
        `SELECT id, closed_at
         FROM daily_closings
         WHERE closing_date = ?
         LIMIT 1`,
        [closingDate]
      );

      return res.json({
        status: "success",
        already_closed: existingRows.length > 0,
        existing_closing: existingRows[0] || null,
        summary,
      });
    } catch (error) {
      console.error("Daily closing summary error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while calculating daily closing summary.",
      });
    }
  }
);

// GET /api/daily-closing
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const [closings] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         ORDER BY dc.closing_date DESC
         LIMIT 100`
      );

      return res.json({
        status: "success",
        count: closings.length,
        closings,
      });
    } catch (error) {
      console.error("Get daily closings error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching daily closings.",
      });
    }
  }
);

// GET /api/daily-closing/:id
router.get(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const [closings] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         WHERE dc.id = ?
         LIMIT 1`,
        [id]
      );

      if (closings.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Daily closing record not found.",
        });
      }

      return res.json({
        status: "success",
        closing: closings[0],
      });
    } catch (error) {
      console.error("Get single daily closing error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching daily closing record.",
      });
    }
  }
);

// POST /api/daily-closing
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const {
        closing_date,
        cash_counted,
        momo_counted,
        bank_counted,
        other_counted,
        notes,
      } = req.body;

      const closingDate = closing_date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Closing date must be in YYYY-MM-DD format.",
        });
      }

      const summary = await calculateClosingSummary(closingDate);

      const countedCash = toCountedMoney(cash_counted, summary.expected_cash);
      const countedMomo = toCountedMoney(momo_counted, summary.expected_momo);
      const countedBank = toCountedMoney(bank_counted, summary.expected_bank);
      const countedOther = toCountedMoney(other_counted, summary.expected_other);

      if (
        countedCash === null ||
        countedMomo === null ||
        countedBank === null ||
        countedOther === null
      ) {
        return res.status(400).json({
          status: "error",
          message: "Counted amounts must be valid numbers and cannot be negative.",
        });
      }

      const totalCounted = toMoney(
        countedCash + countedMomo + countedBank + countedOther
      );

      const differenceTotal = toMoney(totalCounted - summary.expected_total);

      await connection.beginTransaction();

      const [existingRows] = await connection.query(
        `SELECT id
         FROM daily_closings
         WHERE closing_date = ?
         LIMIT 1
         FOR UPDATE`,
        [closingDate]
      );

      if (existingRows.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          status: "error",
          message: "This day has already been closed.",
        });
      }

      const [result] = await connection.query(
        `INSERT INTO daily_closings (
          closing_date,

          sales_count,
          sales_total,
          sales_received,

          cash_sales,
          momo_sales,
          bank_sales,
          mixed_sales,
          credit_sales_total,
          credit_sales_received,

          debt_payment_count,
          debt_payments_total,
          debt_cash,
          debt_momo,
          debt_bank,

          expenses_count,
          expenses_total,

          expected_cash,
          expected_momo,
          expected_bank,
          expected_other,
          expected_total,

          cash_counted,
          momo_counted,
          bank_counted,
          other_counted,
          total_counted,

          difference_total,

          notes,
          closed_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          closingDate,

          summary.sales_count,
          summary.sales_total,
          summary.sales_received,

          summary.cash_sales,
          summary.momo_sales,
          summary.bank_sales,
          summary.mixed_sales,
          summary.credit_sales_total,
          summary.credit_sales_received,

          summary.debt_payment_count,
          summary.debt_payments_total,
          summary.debt_cash,
          summary.debt_momo,
          summary.debt_bank,

          summary.expenses_count,
          summary.expenses_total,

          summary.expected_cash,
          summary.expected_momo,
          summary.expected_bank,
          summary.expected_other,
          summary.expected_total,

          countedCash,
          countedMomo,
          countedBank,
          countedOther,
          totalCounted,

          differenceTotal,

          notes || null,
          req.user.id,
        ]
      );

      await logActivity(
        connection,
        req.user.id,
        "DAILY_CLOSING",
        `Closed business day ${closingDate}. Expected total: GHS ${summary.expected_total.toFixed(
          2
        )}, Counted total: GHS ${totalCounted.toFixed(
          2
        )}, Difference: GHS ${differenceTotal.toFixed(2)}`
      );

      await connection.commit();

      const [createdRows] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         WHERE dc.id = ?
         LIMIT 1`,
        [result.insertId]
      );

      return res.status(201).json({
        status: "success",
        message: "Daily closing saved successfully.",
        closing: createdRows[0],
      });
    } catch (error) {
      await connection.rollback();

      console.error("Save daily closing error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "This day has already been closed.",
        });
      }

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while saving daily closing.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;