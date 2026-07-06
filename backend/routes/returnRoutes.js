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

async function logActivity(userId, branchId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [branchId || null, userId || null, action, details]
  );
}

// GET /api/returns/sales
router.get(
  "/sales",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const search = cleanText(req.query.search);

      const params = [branchId];
      let whereClause = `
        WHERE s.branch_id = ?
        AND s.sale_status = 'completed'
        AND COALESCE(s.is_voided, 0) = 0
      `;

      if (search) {
        whereClause += ` AND (
          s.receipt_number LIKE ?
          OR s.customer_name LIKE ?
          OR s.customer_phone LIKE ?
          OR c.name LIKE ?
          OR c.phone LIKE ?
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

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.total,
          s.payment_type,
          s.amount_paid,
          s.balance,
          s.created_at,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone
         FROM sales s
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = s.branch_id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT 50`,
        params
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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
      const branchId = getBranchId(req);
      const { saleId } = req.params;

      const [sales] = await pool.query(
        `SELECT
          s.id,
          s.branch_id,
          s.receipt_number,
          s.total,
          s.payment_type,
          s.created_at,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone
         FROM sales s
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = s.branch_id
         WHERE s.id = ?
         AND s.branch_id = ?
         LIMIT 1`,
        [saleId, branchId]
      );

      if (sales.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Sale not found in the selected store.",
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
            WHERE r.branch_id = ?
            AND r.sale_id = si.sale_id
            AND r.product_id = si.product_id
          ), 0) AS returned_quantity
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         WHERE si.sale_id = ?
         AND s.branch_id = ?
         GROUP BY si.sale_id, si.product_id, si.product_name
         ORDER BY si.product_name ASC`,
        [branchId, saleId, branchId]
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
        branch_id: branchId,
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
      const branchId = getBranchId(req);
      const search = cleanText(req.query.search);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      let whereClause = "WHERE r.branch_id = ?";

      if (search) {
        whereClause += ` AND (
          s.receipt_number LIKE ?
          OR s.customer_name LIKE ?
          OR s.customer_phone LIKE ?
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
          r.branch_id,
          r.sale_id,
          r.product_id,
          r.quantity,
          r.reason,
          r.returned_at,
          s.receipt_number,
          COALESCE(s.customer_name, c.name) AS customer_name,
          COALESCE(s.customer_phone, c.phone) AS customer_phone,
          p.name AS product_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = r.branch_id
         LEFT JOIN products p
          ON r.product_id = p.id
          AND p.branch_id = r.branch_id
         LEFT JOIN branches b ON r.branch_id = b.id
         ${whereClause}
         ORDER BY r.returned_at DESC, r.id DESC`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT
          COUNT(*) AS return_count,
          COALESCE(SUM(r.quantity), 0) AS total_quantity_returned
         FROM returns r
         LEFT JOIN sales s
          ON r.sale_id = s.id
          AND s.branch_id = r.branch_id
         LEFT JOIN customers c
          ON s.customer_id = c.id
          AND c.branch_id = r.branch_id
         LEFT JOIN products p
          ON r.product_id = p.id
          AND p.branch_id = r.branch_id
         ${whereClause}`,
        params
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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
      const branchId = getBranchId(req);
      const { sale_id, product_id, quantity, reason } = req.body;

      if (!sale_id || !product_id || !quantity || !cleanText(reason)) {
        return res.status(400).json({
          status: "error",
          message: "Sale, product, quantity and reason are required.",
        });
      }

      const cleanSaleId = Number(sale_id);
      const cleanProductId = Number(product_id);
      const cleanQuantity = Number(quantity);
      const cleanReason = cleanText(reason);

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
          branch_id,
          receipt_number,
          sale_status,
          is_voided
         FROM sales
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [cleanSaleId, branchId]
      );

      if (sales.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Sale not found in the selected store.",
        });
      }

      if (
        sales[0].sale_status !== "completed" ||
        Number(sales[0].is_voided || 0) === 1
      ) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Only active completed sales can be returned.",
        });
      }

      const [saleItems] = await connection.query(
        `SELECT
          si.product_id,
          si.product_name,
          SUM(si.quantity) AS quantity_sold,
          MAX(si.unit_price) AS unit_price
         FROM sale_items si
         INNER JOIN sales s ON si.sale_id = s.id
         WHERE si.sale_id = ?
         AND s.branch_id = ?
         AND si.product_id = ?
         GROUP BY si.product_id, si.product_name
         LIMIT 1`,
        [cleanSaleId, branchId, cleanProductId]
      );

      if (saleItems.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "This product was not found in the selected sale.",
        });
      }

      const [products] = await connection.query(
        `SELECT id, branch_id, name
         FROM products
         WHERE id = ?
         AND branch_id = ?
         AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [cleanProductId, branchId]
      );

      if (products.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Product not found in the selected store.",
        });
      }

      const saleItem = saleItems[0];

      const [previousReturns] = await connection.query(
        `SELECT COALESCE(SUM(quantity), 0) AS returned_quantity
         FROM returns
         WHERE branch_id = ?
         AND sale_id = ?
         AND product_id = ?`,
        [branchId, cleanSaleId, cleanProductId]
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
          branch_id,
          sale_id,
          product_id,
          quantity,
          reason,
          returned_by,
          returned_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          branchId,
          cleanSaleId,
          cleanProductId,
          cleanQuantity,
          cleanReason,
          req.user.id,
        ]
      );

      await connection.query(
        `UPDATE products
         SET quantity = quantity + ?
         WHERE id = ?
         AND branch_id = ?`,
        [cleanQuantity, cleanProductId, branchId]
      );

      const returnAmount = Number(saleItem.unit_price || 0) * cleanQuantity;

      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [
          branchId,
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
          branch_id: branchId,
          sale_id: cleanSaleId,
          product_id: cleanProductId,
          product_name: saleItem.product_name,
          quantity: cleanQuantity,
          reason: cleanReason,
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
