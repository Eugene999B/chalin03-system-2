const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function buildDateFilter(alias, from, to, params) {
  let filter = "";

  if (from) {
    filter += ` AND DATE(${alias}.created_at) >= ?`;
    params.push(from);
  }

  if (to) {
    filter += ` AND DATE(${alias}.created_at) <= ?`;
    params.push(to);
  }

  return filter;
}

function buildExpenseDateFilter(from, to, params) {
  let filter = "";

  if (from) {
    filter += ` AND expense_date >= ?`;
    params.push(from);
  }

  if (to) {
    filter += ` AND expense_date <= ?`;
    params.push(to);
  }

  return filter;
}

function activeCompletedSalesFilter(alias = "s") {
  return `
    ${alias}.sale_status = 'completed'
    AND COALESCE(${alias}.is_voided, 0) = 0
  `;
}

// GET /api/reports/summary
router.get(
  "/summary",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { from, to } = req.query;

      const salesParams = [];
      const salesDateFilter = buildDateFilter("s", from, to, salesParams);

      const expenseParams = [];
      const expenseDateFilter = buildExpenseDateFilter(from, to, expenseParams);

      const [salesSummaryRows] = await pool.query(
        `SELECT
          COUNT(*) AS total_sales_count,
          COALESCE(SUM(s.subtotal), 0) AS total_before_discount,
          COALESCE(SUM(s.discount_amount), 0) AS total_discount_amount,
          COALESCE(SUM(s.tax_amount), 0) AS total_tax_amount,
          COALESCE(SUM(s.total), 0) AS total_sales_amount,
          COALESCE(SUM(s.amount_paid), 0) AS total_amount_paid,
          COALESCE(SUM(s.balance), 0) AS total_sales_balance
         FROM sales s
         WHERE ${activeCompletedSalesFilter("s")}
         ${salesDateFilter}`,
        salesParams
      );

      const [profitRows] = await pool.query(
        `SELECT
          COALESCE(SUM(s.subtotal), 0) AS total_before_discount,
          COALESCE(SUM(s.discount_amount), 0) AS total_discount_amount,
          COALESCE(SUM(s.total - s.tax_amount), 0) AS net_sales_before_tax,
          COALESCE(SUM(sale_costs.total_cost), 0) AS total_cost,
          COALESCE(
            SUM((s.total - s.tax_amount) - sale_costs.total_cost),
            0
          ) AS gross_profit
         FROM sales s
         LEFT JOIN (
          SELECT
            sale_id,
            COALESCE(SUM(cost_price_at_sale * quantity), 0) AS total_cost
          FROM sale_items
          GROUP BY sale_id
         ) sale_costs ON sale_costs.sale_id = s.id
         WHERE ${activeCompletedSalesFilter("s")}
         ${salesDateFilter}`,
        salesParams
      );

      const [expenseRows] = await pool.query(
        `SELECT
          COALESCE(SUM(amount), 0) AS total_expenses
         FROM expenses
         WHERE 1 = 1
         ${expenseDateFilter}`,
        expenseParams
      );

      const debtParams = [];
      const debtDateFilter = buildDateFilter("s", from, to, debtParams);

      const [debtRows] = await pool.query(
        `SELECT
          COALESCE(SUM(d.balance), 0) AS outstanding_debts,
          COUNT(*) AS active_debt_count
         FROM debts d
         INNER JOIN sales s ON d.sale_id = s.id
         WHERE d.status != 'paid'
         AND ${activeCompletedSalesFilter("s")}
         ${debtDateFilter}`,
        debtParams
      );

      const [lowStockRows] = await pool.query(
        `SELECT COUNT(*) AS low_stock_count
         FROM products
         WHERE is_active = TRUE
         AND quantity <= low_stock_threshold`
      );

      const topProductsParams = [];
      const topProductsDateFilter = buildDateFilter(
        "s",
        from,
        to,
        topProductsParams
      );

      const [topProducts] = await pool.query(
        `SELECT
          si.product_id,
          si.product_name,
          SUM(si.quantity) AS quantity_sold,
          SUM(si.line_total) AS revenue
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         WHERE ${activeCompletedSalesFilter("s")}
         ${topProductsDateFilter}
         GROUP BY si.product_id, si.product_name
         ORDER BY quantity_sold DESC, revenue DESC
         LIMIT 10`,
        topProductsParams
      );

      const paymentParams = [];
      const paymentDateFilter = buildDateFilter("s", from, to, paymentParams);

      const [paymentBreakdown] = await pool.query(
        `SELECT
          s.payment_type,
          COUNT(*) AS count,
          COALESCE(SUM(s.total), 0) AS total
         FROM sales s
         WHERE ${activeCompletedSalesFilter("s")}
         ${paymentDateFilter}
         GROUP BY s.payment_type
         ORDER BY total DESC`,
        paymentParams
      );

      const salesSummary = salesSummaryRows[0];
      const profitSummary = profitRows[0];
      const expenseSummary = expenseRows[0];

      const grossProfit = Number(profitSummary.gross_profit || 0);
      const totalExpenses = Number(expenseSummary.total_expenses || 0);
      const netProfit = grossProfit - totalExpenses;

      return res.json({
        status: "success",
        filters: {
          from: from || null,
          to: to || null,
        },
        summary: {
          total_sales_count: Number(salesSummary.total_sales_count || 0),

          total_before_discount: Number(
            salesSummary.total_before_discount || 0
          ),
          total_subtotal_amount: Number(
            salesSummary.total_before_discount || 0
          ),
          total_discount_amount: Number(
            salesSummary.total_discount_amount || 0
          ),
          total_tax_amount: Number(salesSummary.total_tax_amount || 0),

          total_sales_amount: Number(salesSummary.total_sales_amount || 0),
          total_amount_paid: Number(salesSummary.total_amount_paid || 0),
          total_sales_balance: Number(salesSummary.total_sales_balance || 0),

          net_sales_before_tax: Number(
            profitSummary.net_sales_before_tax || 0
          ),
          total_cost: Number(profitSummary.total_cost || 0),
          gross_profit: grossProfit,
          total_expenses: totalExpenses,
          net_profit: netProfit,

          outstanding_debts: Number(debtRows[0].outstanding_debts || 0),
          active_debt_count: Number(debtRows[0].active_debt_count || 0),
          low_stock_count: Number(lowStockRows[0].low_stock_count || 0),
        },
        top_products: topProducts,
        payment_breakdown: paymentBreakdown,
      });
    } catch (error) {
      console.error("Report summary error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while generating report summary.",
      });
    }
  }
);

// GET /api/reports/low-stock
router.get(
  "/low-stock",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const [products] = await pool.query(
        `SELECT
          id,
          name,
          size,
          category,
          quantity,
          low_stock_threshold,
          selling_price
         FROM products
         WHERE is_active = TRUE
         AND quantity <= low_stock_threshold
         ORDER BY quantity ASC, name ASC`
      );

      return res.json({
        status: "success",
        count: products.length,
        products,
      });
    } catch (error) {
      console.error("Low stock report error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while fetching low-stock report.",
      });
    }
  }
);

module.exports = router;