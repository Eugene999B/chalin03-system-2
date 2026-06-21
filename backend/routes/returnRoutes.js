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

// GET /api/returns/sales
router.get(
  "/sales",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { search } = req.query;

      const params = [];
      let whereClause = "WHERE s.sale_status = 'completed'";

      if (search) {
        whereClause += ` AND (
          s.receipt_number LIKE ?
          OR c.name LIKE ?
          OR c.phone LIKE ?
        )`;

        const searchValue = `%${search}%`;
        params.push(searchValue, searchValue, searchValue);
      }

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.receipt_number,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.created_at,
          c.name AS customer_name,
          c.phone AS customer_phone
         FROM sales s
         LEFT JOIN customers c ON s.customer_id = c.id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT 50`,
        params
      );

      return res.json({
        status: "success",
        count: sales.length,
        sales,
      });
    } catch (error) {
      console.error("Search sales for returns error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while searching sales.",
      });
    }
  }
);

// GET /api/returns/sales/:saleId/items
router.get(
  "/sales/:saleId/items",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { saleId } = req.params;

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.receipt_number,
          s.total,
          s.payment_type,
          s.created_at,
          c.name AS customer_name,
          c.phone AS customer_phone
         FROM sales s
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.id = ?
         LIMIT 1`,
        [saleId]
      );

      if (sales.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Sale not found.",
        });
      }

      const [items] = await pool.query(
        `SELECT
          si.product_id,
          si.product_name,
          SUM(si.quantity) AS quantity_sold,
          MAX(si.unit_price) AS unit_price,
          SUM(si.line_total) AS line_total,
          COALESCE((
            SELECT SUM(r.quantity)
            FROM returns r
            WHERE r.sale_id = si.sale_id
            AND r.product_id = si.product_id
          ), 0) AS returned_quantity
         FROM sale_items si
         WHERE si.sale_id = ?
         GROUP BY si.sale_id, si.product_id, si.product_name
         ORDER BY si.product_name ASC`,
        [saleId]
      );

      const cleanItems = items.map((item) => {
        const quantitySold = Number(item.quantity_sold || 0);
        const returnedQuantity = Number(item.returned_quantity || 0);

        return {
          product_id: item.product_id,
          product_name: item.product_name,
          quantity_sold: quantitySold,
          unit_price: Number(item.unit_price || 0),
          line_total: Number(item.line_total || 0),
          returned_quantity: returnedQuantity,
          remaining_quantity: quantitySold - returnedQuantity,
        };
      });

      return res.json({
        status: "success",
        sale: sales[0],
        items: cleanItems,
      });
    } catch (error) {
      console.error("Get sale items for return error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching sale items.",
      });
    }
  }
);

// GET /api/returns
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
          s.receipt_number LIKE ?
          OR c.name LIKE ?
          OR c.phone LIKE ?
          OR p.name LIKE ?
          OR r.reason LIKE ?
        )`;

        const searchValue = `%${search}%`;
        params.push(
          searchValue,
          searchValue,
          searchValue,
          searchValue,
          searchValue
        );
      }

      if (from) {
        whereClause += ` AND DATE(r.returned_at) >= ?`;
        params.push(from);
      }

      if (to) {
        whereClause += ` AND DATE(r.returned_at) <= ?`;
        params.push(to);
      }

      const [returns] = await pool.query(
        `SELECT
          r.id,
          r.sale_id,
          r.product_id,
          r.quantity,
          r.reason,
          r.returned_at,
          s.receipt_number,
          c.name AS customer_name,
          c.phone AS customer_phone,
          p.name AS product_name
         FROM returns r
         LEFT JOIN sales s ON r.sale_id = s.id
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN products p ON r.product_id = p.id
         ${whereClause}
         ORDER BY r.returned_at DESC, r.id DESC`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT
          COUNT(*) AS return_count,
          COALESCE(SUM(r.quantity), 0) AS total_quantity_returned
         FROM returns r
         LEFT JOIN sales s ON r.sale_id = s.id
         LEFT JOIN customers c ON s.customer_id = c.id
         LEFT JOIN products p ON r.product_id = p.id
         ${whereClause}`,
        params
      );

      return res.json({
        status: "success",
        count: returns.length,
        summary: {
          return_count: Number(summaryRows[0].return_count || 0),
          total_quantity_returned: Number(
            summaryRows[0].total_quantity_returned || 0
          ),
        },
        returns,
      });
    } catch (error) {
      console.error("Get returns error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching returns.",
      });
    }
  }
);

// POST /api/returns
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { sale_id, product_id, quantity, reason } = req.body;

      if (!sale_id || !product_id || !quantity || !reason) {
        return res.status(400).json({
          status: "error",
          message: "Sale, product, quantity and reason are required.",
        });
      }

      const cleanSaleId = Number(sale_id);
      const cleanProductId = Number(product_id);
      const cleanQuantity = Number(quantity);

      if (
        !cleanSaleId ||
        !cleanProductId ||
        !Number.isInteger(cleanQuantity) ||
        cleanQuantity <= 0
      ) {
        return res.status(400).json({
          status: "error",
          message: "Quantity must be a positive whole number.",
        });
      }

      await connection.beginTransaction();

      const [sales] = await connection.query(
        `SELECT
          id,
          receipt_number,
          sale_status
         FROM sales
         WHERE id = ?
         LIMIT 1`,
        [cleanSaleId]
      );

      if (sales.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Sale not found.",
        });
      }

      if (sales[0].sale_status !== "completed") {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Only completed sales can be returned.",
        });
      }

      const [saleItems] = await connection.query(
        `SELECT
          product_id,
          product_name,
          SUM(quantity) AS quantity_sold,
          MAX(unit_price) AS unit_price
         FROM sale_items
         WHERE sale_id = ?
         AND product_id = ?
         GROUP BY product_id, product_name
         LIMIT 1`,
        [cleanSaleId, cleanProductId]
      );

      if (saleItems.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "This product was not found in the selected sale.",
        });
      }

      const saleItem = saleItems[0];

      const [previousReturns] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS returned_quantity
         FROM returns
         WHERE sale_id = ?
         AND product_id = ?`,
        [cleanSaleId, cleanProductId]
      );

      const quantitySold = Number(saleItem.quantity_sold || 0);
      const alreadyReturned = Number(
        previousReturns[0].returned_quantity || 0
      );
      const remainingQuantity = quantitySold - alreadyReturned;

      if (cleanQuantity > remainingQuantity) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: `You cannot return ${cleanQuantity}. Only ${remainingQuantity} remaining from this sale.`,
        });
      }

      await connection.query(
        `INSERT INTO returns (
          sale_id,
          product_id,
          quantity,
          reason,
          returned_at
        )
        VALUES (?, ?, ?, ?, NOW())`,
        [cleanSaleId, cleanProductId, cleanQuantity, reason]
      );

      await connection.query(
        `UPDATE products
         SET quantity = quantity + ?
         WHERE id = ?`,
        [cleanQuantity, cleanProductId]
      );

      const returnAmount = Number(saleItem.unit_price || 0) * cleanQuantity;

      await connection.query(
        `INSERT INTO activity_log (user_id, action, details)
         VALUES (?, ?, ?)`,
        [
          req.user.id,
          "CREATE_RETURN",
          `Returned ${cleanQuantity} x ${saleItem.product_name} from receipt ${sales[0].receipt_number}`,
        ]
      );

      await connection.commit();

      return res.status(201).json({
        status: "success",
        message: "Return recorded successfully. Stock has been increased.",
        return_record: {
          sale_id: cleanSaleId,
          product_id: cleanProductId,
          product_name: saleItem.product_name,
          quantity: cleanQuantity,
          reason,
          estimated_return_amount: returnAmount,
        },
      });
    } catch (error) {
      await connection.rollback();

      console.error("Create return error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while recording return.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;