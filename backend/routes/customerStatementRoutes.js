const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function cleanSearch(value) {
  if (!value) return "";

  return String(value).trim();
}

function toNumber(value) {
  return Number(value || 0);
}

// GET /api/customer-statements/search?query=ama
router.get(
  "/search",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const query = cleanSearch(req.query.query);

      if (!query) {
        return res.json({
          status: "success",
          count: 0,
          customers: [],
        });
      }

      const searchValue = `%${query}%`;

      const [customers] = await pool.query(
        `SELECT
          customer_name,
          customer_phone,
          COUNT(*) AS sales_count,
          SUM(CASE
            WHEN COALESCE(is_voided, 0) = 0
            AND sale_status != 'cancelled'
            THEN total
            ELSE 0
          END) AS total_sales,
          SUM(CASE
            WHEN COALESCE(is_voided, 0) = 0
            AND sale_status != 'cancelled'
            THEN balance
            ELSE 0
          END) AS sales_balance
         FROM sales
         WHERE customer_name LIKE ?
         OR customer_phone LIKE ?
         GROUP BY customer_name, customer_phone
         ORDER BY customer_name ASC
         LIMIT 30`,
        [searchValue, searchValue]
      );

      return res.json({
        status: "success",
        count: customers.length,
        customers,
      });
    } catch (error) {
      console.error("Search customer statements error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while searching customers.",
      });
    }
  }
);

// GET /api/customer-statements?phone=0240000000&name=Customer
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const phone = cleanSearch(req.query.phone);
      const name = cleanSearch(req.query.name);

      if (!phone && !name) {
        return res.status(400).json({
          status: "error",
          message: "Customer phone or name is required.",
        });
      }

      const conditions = [];
      const params = [];

      if (phone) {
        conditions.push("s.customer_phone = ?");
        params.push(phone);
      }

      if (name) {
        conditions.push("s.customer_name = ?");
        params.push(name);
      }

      const whereCustomer = conditions.join(" OR ");

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.receipt_number,
          s.customer_name,
          s.customer_phone,
          s.subtotal,
          s.discount_amount,
          s.tax_amount,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.sale_status,
          s.is_voided,
          s.created_at,
          u.full_name AS staff_name
         FROM sales s
         LEFT JOIN users u ON s.staff_id = u.id
         WHERE ${whereCustomer}
         ORDER BY s.created_at DESC`,
        params
      );

      const saleIds = sales.map((sale) => sale.id);

      let debts = [];
      let debtPayments = [];

      if (saleIds.length > 0) {
        const placeholders = saleIds.map(() => "?").join(",");

        const [debtRows] = await pool.query(
          `SELECT
            d.id,
            d.sale_id,
            d.customer_name,
            d.customer_phone,
            d.amount_owed,
            d.amount_paid,
            d.balance,
            d.status,
            d.due_date,
            d.created_at,
            s.receipt_number
           FROM debts d
           INNER JOIN sales s ON d.sale_id = s.id
           WHERE d.sale_id IN (${placeholders})
           ORDER BY d.created_at DESC`,
          saleIds
        );

        debts = debtRows;

        const debtIds = debts.map((debt) => debt.id);

        if (debtIds.length > 0) {
          const debtPlaceholders = debtIds.map(() => "?").join(",");

          const [paymentRows] = await pool.query(
            `SELECT
              dp.id,
              dp.debt_id,
              dp.amount,
              dp.payment_method,
              dp.paid_at,
              dp.notes,
              d.customer_name,
              d.customer_phone,
              s.receipt_number,
              u.full_name AS received_by_name
             FROM debt_payments dp
             INNER JOIN debts d ON dp.debt_id = d.id
             INNER JOIN sales s ON d.sale_id = s.id
             LEFT JOIN users u ON dp.received_by = u.id
             WHERE dp.debt_id IN (${debtPlaceholders})
             ORDER BY dp.paid_at DESC, dp.id DESC`,
            debtIds
          );

          debtPayments = paymentRows;
        }
      }

      const validSales = sales.filter(
        (sale) =>
          Number(sale.is_voided || 0) === 0 && sale.sale_status !== "cancelled"
      );

      const totalSales = validSales.reduce(
        (sum, sale) => sum + toNumber(sale.total),
        0
      );

      const totalPaidOnSales = validSales.reduce(
        (sum, sale) => sum + toNumber(sale.amount_paid),
        0
      );

      const totalDebtPayments = debtPayments.reduce(
        (sum, payment) => sum + toNumber(payment.amount),
        0
      );

      const totalOutstanding = debts.reduce(
        (sum, debt) => sum + toNumber(debt.balance),
        0
      );

      const customerName =
        sales[0]?.customer_name || debts[0]?.customer_name || name || "";

      const customerPhone =
        sales[0]?.customer_phone || debts[0]?.customer_phone || phone || "";

      return res.json({
        status: "success",
        customer: {
          name: customerName,
          phone: customerPhone,
        },
        summary: {
          sales_count: sales.length,
          valid_sales_count: validSales.length,
          debts_count: debts.length,
          payments_count: debtPayments.length,
          total_sales: Number(totalSales.toFixed(2)),
          total_paid_on_sales: Number(totalPaidOnSales.toFixed(2)),
          total_debt_payments: Number(totalDebtPayments.toFixed(2)),
          total_received: Number(
            (totalPaidOnSales + totalDebtPayments).toFixed(2)
          ),
          total_outstanding: Number(totalOutstanding.toFixed(2)),
        },
        sales,
        debts,
        debt_payments: debtPayments,
      });
    } catch (error) {
      console.error("Customer statement error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while loading customer statement.",
      });
    }
  }
);

module.exports = router;