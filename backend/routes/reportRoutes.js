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

function buildCustomDateFilter(alias, column, from, to, params) {
  let filter = "";

  if (from) {
    filter += ` AND DATE(${alias}.${column}) >= ?`;
    params.push(from);
  }

  if (to) {
    filter += ` AND DATE(${alias}.${column}) <= ?`;
    params.push(to);
  }

  return filter;
}

function buildExpenseDateFilter(alias, from, to, params) {
  let filter = "";

  if (from) {
    filter += ` AND ${alias}.expense_date >= ?`;
    params.push(from);
  }

  if (to) {
    filter += ` AND ${alias}.expense_date <= ?`;
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
      const branchId = getBranchId(req);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const salesParams = [branchId];
      const salesDateFilter = buildDateFilter("s", from, to, salesParams);

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
         WHERE s.branch_id = ?
         AND ${activeCompletedSalesFilter("s")}
         ${salesDateFilter}`,
        salesParams
      );

      const profitParams = [branchId];
      const profitDateFilter = buildDateFilter("s", from, to, profitParams);

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
         WHERE s.branch_id = ?
         AND ${activeCompletedSalesFilter("s")}
         ${profitDateFilter}`,
        profitParams
      );

      const expenseParams = [branchId];
      const expenseDateFilter = buildExpenseDateFilter(
        "e",
        from,
        to,
        expenseParams
      );

      const [expenseRows] = await pool.query(
        `SELECT
          COALESCE(SUM(e.amount), 0) AS total_expenses
         FROM expenses e
         WHERE e.branch_id = ?
         ${expenseDateFilter}`,
        expenseParams
      );

      const debtParams = [branchId, branchId];
      const debtDateFilter = buildDateFilter("s", from, to, debtParams);

      const [debtRows] = await pool.query(
        `SELECT
          COALESCE(SUM(d.balance), 0) AS outstanding_debts,
          COUNT(*) AS active_debt_count
         FROM debts d
         INNER JOIN sales s ON d.sale_id = s.id
         WHERE d.branch_id = ?
         AND s.branch_id = ?
         AND d.status != 'paid'
         AND ${activeCompletedSalesFilter("s")}
         ${debtDateFilter}`,
        debtParams
      );

      const [lowStockRows] = await pool.query(
        `SELECT COUNT(*) AS low_stock_count
         FROM products
         WHERE branch_id = ?
         AND is_active = TRUE
         AND quantity <= low_stock_threshold`,
        [branchId]
      );

      const topProductsParams = [branchId];
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
         WHERE s.branch_id = ?
         AND ${activeCompletedSalesFilter("s")}
         ${topProductsDateFilter}
         GROUP BY si.product_id, si.product_name
         ORDER BY quantity_sold DESC, revenue DESC
         LIMIT 10`,
        topProductsParams
      );

      const paymentParams = [branchId];
      const paymentDateFilter = buildDateFilter("s", from, to, paymentParams);

      const [paymentBreakdown] = await pool.query(
        `SELECT
          s.payment_type,
          COUNT(*) AS count,
          COALESCE(SUM(s.total), 0) AS total
         FROM sales s
         WHERE s.branch_id = ?
         AND ${activeCompletedSalesFilter("s")}
         ${paymentDateFilter}
         GROUP BY s.payment_type
         ORDER BY total DESC`,
        paymentParams
      );

      const transferParams = [
        branchId,
        branchId,
        branchId,
        branchId,
        branchId,
        branchId,
      ];

      const transferDateFilter = buildDateFilter(
        "st",
        from,
        to,
        transferParams
      );

      const [stockTransferRows] = await pool.query(
        `SELECT
          COUNT(*) AS total_transfer_count,

          COALESCE(SUM(CASE WHEN st.from_branch_id = ? THEN 1 ELSE 0 END), 0) AS transfer_out_count,
          COALESCE(SUM(CASE WHEN st.to_branch_id = ? THEN 1 ELSE 0 END), 0) AS transfer_in_count,

          COALESCE(SUM(CASE WHEN st.from_branch_id = ? THEN transfer_totals.total_requested_quantity ELSE 0 END), 0) AS total_transfer_out_quantity,
          COALESCE(SUM(CASE WHEN st.to_branch_id = ? THEN transfer_totals.total_received_quantity ELSE 0 END), 0) AS total_transfer_in_quantity,

          COALESCE(SUM(CASE WHEN st.status = 'requested' THEN 1 ELSE 0 END), 0) AS requested_count,
          COALESCE(SUM(CASE WHEN st.status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN st.status = 'dispatched' THEN 1 ELSE 0 END), 0) AS dispatched_count,
          COALESCE(SUM(CASE WHEN st.status = 'received' THEN 1 ELSE 0 END), 0) AS received_count,
          COALESCE(SUM(CASE WHEN st.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
          COALESCE(SUM(CASE WHEN st.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count

         FROM stock_transfers st
         LEFT JOIN (
          SELECT
            transfer_id,
            COALESCE(SUM(requested_quantity), 0) AS total_requested_quantity,
            COALESCE(SUM(dispatched_quantity), 0) AS total_dispatched_quantity,
            COALESCE(SUM(received_quantity), 0) AS total_received_quantity
          FROM stock_transfer_items
          GROUP BY transfer_id
         ) transfer_totals ON transfer_totals.transfer_id = st.id

         WHERE (st.from_branch_id = ? OR st.to_branch_id = ?)
         ${transferDateFilter}`,
        transferParams
      );

      const recentTransferParams = [branchId, branchId];
      const recentTransferDateFilter = buildDateFilter(
        "st",
        from,
        to,
        recentTransferParams
      );

      const [recentStockTransfers] = await pool.query(
        `SELECT
          st.id,
          st.transfer_number,
          st.from_branch_id,
          st.to_branch_id,
          st.status,
          st.requested_at,
          st.approved_at,
          st.dispatched_at,
          st.received_at,
          st.created_at,

          fb.branch_code AS from_branch_code,
          fb.name AS from_branch_name,

          tb.branch_code AS to_branch_code,
          tb.name AS to_branch_name,

          u.full_name AS requested_by_name,

          COUNT(sti.id) AS item_count,
          COALESCE(SUM(sti.requested_quantity), 0) AS total_requested_quantity,
          COALESCE(SUM(sti.dispatched_quantity), 0) AS total_dispatched_quantity,
          COALESCE(SUM(sti.received_quantity), 0) AS total_received_quantity

         FROM stock_transfers st
         LEFT JOIN branches fb ON fb.id = st.from_branch_id
         LEFT JOIN branches tb ON tb.id = st.to_branch_id
         LEFT JOIN users u ON u.id = st.requested_by
         LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id

         WHERE (st.from_branch_id = ? OR st.to_branch_id = ?)
         ${recentTransferDateFilter}

         GROUP BY st.id
         ORDER BY st.id DESC
         LIMIT 10`,
        recentTransferParams
      );

      const adjustmentParams = [branchId];
      const adjustmentDateFilter = buildCustomDateFilter(
        "sa",
        "adjusted_at",
        from,
        to,
        adjustmentParams
      );

      const [stockAdjustmentRows] = await pool.query(
        `SELECT
          COUNT(*) AS total_adjustment_count,

          COALESCE(SUM(CASE WHEN sa.adjustment_type = 'increase' THEN 1 ELSE 0 END), 0) AS increase_count,
          COALESCE(SUM(CASE WHEN sa.adjustment_type = 'decrease' THEN 1 ELSE 0 END), 0) AS decrease_count,
          COALESCE(SUM(CASE WHEN sa.adjustment_type = 'set' THEN 1 ELSE 0 END), 0) AS set_count,

          COALESCE(SUM(CASE WHEN sa.adjustment_type = 'increase' THEN sa.quantity ELSE 0 END), 0) AS total_increased_quantity,
          COALESCE(SUM(CASE WHEN sa.adjustment_type = 'decrease' THEN sa.quantity ELSE 0 END), 0) AS total_decreased_quantity,

          COALESCE(SUM(CASE WHEN LOWER(sa.reason) LIKE '%damaged%' THEN 1 ELSE 0 END), 0) AS damaged_count,
          COALESCE(SUM(CASE WHEN LOWER(sa.reason) LIKE '%lost%' THEN 1 ELSE 0 END), 0) AS lost_count,
          COALESCE(SUM(CASE WHEN LOWER(sa.reason) LIKE '%physical%' OR LOWER(sa.reason) LIKE '%count%' THEN 1 ELSE 0 END), 0) AS physical_count_count,
          COALESCE(SUM(CASE WHEN LOWER(sa.reason) LIKE '%wrong%' THEN 1 ELSE 0 END), 0) AS wrong_entry_count

         FROM stock_adjustments sa
         WHERE sa.branch_id = ?
         ${adjustmentDateFilter}`,
        adjustmentParams
      );

      const recentAdjustmentParams = [branchId];
      const recentAdjustmentDateFilter = buildCustomDateFilter(
        "sa",
        "adjusted_at",
        from,
        to,
        recentAdjustmentParams
      );

      const [recentStockAdjustments] = await pool.query(
        `SELECT
          sa.id,
          sa.branch_id,
          sa.product_id,
          sa.adjustment_type,
          sa.quantity,
          sa.old_quantity,
          sa.new_quantity,
          sa.reason,
          sa.adjusted_at,

          p.name AS product_name,
          p.barcode,
          p.category,
          p.size,

          u.full_name AS adjusted_by_name

         FROM stock_adjustments sa
         LEFT JOIN products p ON p.id = sa.product_id
         LEFT JOIN users u ON u.id = sa.adjusted_by
         WHERE sa.branch_id = ?
         ${recentAdjustmentDateFilter}
         ORDER BY sa.adjusted_at DESC, sa.id DESC
         LIMIT 10`,
        recentAdjustmentParams
      );

      const salesSummary = salesSummaryRows[0] || {};
      const profitSummary = profitRows[0] || {};
      const expenseSummary = expenseRows[0] || {};
      const debtSummary = debtRows[0] || {};
      const lowStockSummary = lowStockRows[0] || {};
      const stockTransferSummary = stockTransferRows[0] || {};
      const stockAdjustmentSummary = stockAdjustmentRows[0] || {};

      const grossProfit = Number(profitSummary.gross_profit || 0);
      const totalExpenses = Number(expenseSummary.total_expenses || 0);
      const netProfit = grossProfit - totalExpenses;

      return res.json({
        status: "success",
        branch_id: branchId,
        filters: {
          branch_id: branchId,
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

          outstanding_debts: Number(debtSummary.outstanding_debts || 0),
          active_debt_count: Number(debtSummary.active_debt_count || 0),
          low_stock_count: Number(lowStockSummary.low_stock_count || 0),
        },
        stock_transfer_summary: {
          total_transfer_count: Number(
            stockTransferSummary.total_transfer_count || 0
          ),
          transfer_out_count: Number(
            stockTransferSummary.transfer_out_count || 0
          ),
          transfer_in_count: Number(
            stockTransferSummary.transfer_in_count || 0
          ),
          total_transfer_out_quantity: Number(
            stockTransferSummary.total_transfer_out_quantity || 0
          ),
          total_transfer_in_quantity: Number(
            stockTransferSummary.total_transfer_in_quantity || 0
          ),
          requested_count: Number(stockTransferSummary.requested_count || 0),
          approved_count: Number(stockTransferSummary.approved_count || 0),
          dispatched_count: Number(stockTransferSummary.dispatched_count || 0),
          received_count: Number(stockTransferSummary.received_count || 0),
          cancelled_count: Number(stockTransferSummary.cancelled_count || 0),
          rejected_count: Number(stockTransferSummary.rejected_count || 0),
        },
        stock_adjustment_summary: {
          total_adjustment_count: Number(
            stockAdjustmentSummary.total_adjustment_count || 0
          ),
          increase_count: Number(stockAdjustmentSummary.increase_count || 0),
          decrease_count: Number(stockAdjustmentSummary.decrease_count || 0),
          set_count: Number(stockAdjustmentSummary.set_count || 0),
          total_increased_quantity: Number(
            stockAdjustmentSummary.total_increased_quantity || 0
          ),
          total_decreased_quantity: Number(
            stockAdjustmentSummary.total_decreased_quantity || 0
          ),
          damaged_count: Number(stockAdjustmentSummary.damaged_count || 0),
          lost_count: Number(stockAdjustmentSummary.lost_count || 0),
          physical_count_count: Number(
            stockAdjustmentSummary.physical_count_count || 0
          ),
          wrong_entry_count: Number(
            stockAdjustmentSummary.wrong_entry_count || 0
          ),
        },
        top_products: topProducts,
        payment_breakdown: paymentBreakdown,
        recent_stock_transfers: recentStockTransfers,
        recent_stock_adjustments: recentStockAdjustments,
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
      const branchId = getBranchId(req);

      const [products] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          size,
          category,
          quantity,
          low_stock_threshold,
          selling_price
         FROM products
         WHERE branch_id = ?
         AND is_active = TRUE
         AND quantity <= low_stock_threshold
         ORDER BY quantity ASC, name ASC`,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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