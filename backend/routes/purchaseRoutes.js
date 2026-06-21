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

function getPaymentStatus(totalAmount, amountPaid) {
  if (amountPaid <= 0) return "unpaid";
  if (amountPaid >= totalAmount) return "paid";
  return "partial";
}

function toNonNegativeNumber(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function toPositiveMoney(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number <= 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function cleanPurchasePaymentMethod(value) {
  const allowedMethods = ["cash", "momo", "bank", "mixed", "other"];
  const cleanValue = String(value || "cash").toLowerCase();

  if (allowedMethods.includes(cleanValue)) {
    return cleanValue;
  }

  return "cash";
}

// GET /api/purchases/suppliers
router.get(
  "/suppliers",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const [suppliers] = await pool.query(
        `SELECT
          id,
          name,
          contact_person,
          phone,
          email,
          address,
          is_active,
          created_at
         FROM suppliers
         WHERE is_active = TRUE
         ORDER BY name ASC`
      );

      return res.json({
        status: "success",
        count: suppliers.length,
        suppliers,
      });
    } catch (error) {
      console.error("Get suppliers error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching suppliers.",
      });
    }
  }
);

// POST /api/purchases/suppliers
router.post(
  "/suppliers",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { name, contact_person, phone, email, address } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Supplier name is required.",
        });
      }

      const cleanName = name.trim();

      const [result] = await pool.query(
        `INSERT INTO suppliers (
          name,
          contact_person,
          phone,
          email,
          address,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, TRUE)`,
        [
          cleanName,
          contact_person || null,
          phone || null,
          email || null,
          address || null,
        ]
      );

      await logActivity(
        req.user.id,
        "CREATE_SUPPLIER",
        `Created supplier "${cleanName}"`
      );

      const [suppliers] = await pool.query(
        `SELECT
          id,
          name,
          contact_person,
          phone,
          email,
          address,
          is_active,
          created_at
         FROM suppliers
         WHERE id = ?
         LIMIT 1`,
        [result.insertId]
      );

      return res.status(201).json({
        status: "success",
        message: "Supplier created successfully.",
        supplier: suppliers[0],
      });
    } catch (error) {
      console.error("Create supplier error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while creating supplier.",
      });
    }
  }
);

// GET /api/purchases
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
          p.invoice_number LIKE ?
          OR s.name LIKE ?
          OR u.full_name LIKE ?
          OR p.notes LIKE ?
        )`;

        const searchValue = `%${search}%`;
        params.push(searchValue, searchValue, searchValue, searchValue);
      }

      if (from) {
        whereClause += ` AND p.purchase_date >= ?`;
        params.push(from);
      }

      if (to) {
        whereClause += ` AND p.purchase_date <= ?`;
        params.push(to);
      }

      const [purchases] = await pool.query(
        `SELECT
          p.id,
          p.supplier_id,
          p.invoice_number,
          p.purchase_date,
          p.total_cost,
          p.total_amount,
          p.amount_paid,
          p.balance,
          p.payment_status,
          p.notes,
          p.created_at,
          s.name AS supplier_name,
          u.full_name AS created_by_name
         FROM purchases p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         LEFT JOIN users u ON p.created_by = u.id
         ${whereClause}
         ORDER BY p.purchase_date DESC, p.created_at DESC`,
        params
      );

      const [summaryRows] = await pool.query(
        `SELECT
          COALESCE(SUM(p.total_amount), 0) AS total_purchases,
          COALESCE(SUM(p.amount_paid), 0) AS total_paid,
          COALESCE(SUM(p.balance), 0) AS total_balance,
          COUNT(*) AS purchase_count
         FROM purchases p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         LEFT JOIN users u ON p.created_by = u.id
         ${whereClause}`,
        params
      );

      return res.json({
        status: "success",
        count: purchases.length,
        summary: {
          total_purchases: Number(summaryRows[0].total_purchases || 0),
          total_paid: Number(summaryRows[0].total_paid || 0),
          total_balance: Number(summaryRows[0].total_balance || 0),
          purchase_count: Number(summaryRows[0].purchase_count || 0),
        },
        purchases,
      });
    } catch (error) {
      console.error("Get purchases error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while fetching purchases.",
      });
    }
  }
);

// GET /api/purchases/:id
router.get(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const [purchases] = await pool.query(
        `SELECT
          p.id,
          p.supplier_id,
          p.invoice_number,
          p.purchase_date,
          p.total_cost,
          p.total_amount,
          p.amount_paid,
          p.balance,
          p.payment_status,
          p.notes,
          p.created_at,
          s.name AS supplier_name,
          s.phone AS supplier_phone,
          u.full_name AS created_by_name
         FROM purchases p
         LEFT JOIN suppliers s ON p.supplier_id = s.id
         LEFT JOIN users u ON p.created_by = u.id
         WHERE p.id = ?
         LIMIT 1`,
        [id]
      );

      if (purchases.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Purchase not found.",
        });
      }

      const [items] = await pool.query(
        `SELECT
          id,
          purchase_id,
          product_id,
          product_name,
          quantity,
          cost_price,
          line_total
         FROM purchase_items
         WHERE purchase_id = ?
         ORDER BY id ASC`,
        [id]
      );

      const [payments] = await pool.query(
        `SELECT
          pp.id,
          pp.purchase_id,
          pp.amount,
          pp.payment_method,
          pp.notes,
          pp.paid_at,
          u.full_name AS paid_by_name
         FROM purchase_payments pp
         LEFT JOIN users u ON pp.paid_by = u.id
         WHERE pp.purchase_id = ?
         ORDER BY pp.paid_at ASC, pp.id ASC`,
        [id]
      );

      return res.json({
        status: "success",
        purchase: purchases[0],
        items,
        payments,
      });
    } catch (error) {
      console.error("Get purchase details error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while fetching purchase details.",
      });
    }
  }
);

// PATCH /api/purchases/:id/pay
router.patch(
  "/:id/pay",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { id } = req.params;
      const { amount, payment_method, notes } = req.body;

      const paymentAmount = toPositiveMoney(amount);
      const cleanPaymentMethod = cleanPurchasePaymentMethod(payment_method);

      if (paymentAmount === null) {
        return res.status(400).json({
          status: "error",
          message: "Payment amount must be greater than zero.",
        });
      }

      await connection.beginTransaction();

      const [purchases] = await connection.query(
        `SELECT
          id,
          invoice_number,
          total_amount,
          amount_paid,
          balance,
          payment_status
         FROM purchases
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (purchases.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Purchase not found.",
        });
      }

      const purchase = purchases[0];

      const totalAmount = Number(purchase.total_amount || 0);
      const oldAmountPaid = Number(purchase.amount_paid || 0);
      const oldBalance = Number(purchase.balance || 0);

      if (oldBalance <= 0) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "This purchase has already been fully paid.",
        });
      }

      if (paymentAmount > oldBalance) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: `Payment cannot be greater than the balance of GHS ${oldBalance.toFixed(
            2
          )}.`,
        });
      }

      const newAmountPaid = Number((oldAmountPaid + paymentAmount).toFixed(2));
      const newBalance = Number(
        Math.max(totalAmount - newAmountPaid, 0).toFixed(2)
      );
      const newPaymentStatus = getPaymentStatus(totalAmount, newAmountPaid);

      await connection.query(
        `UPDATE purchases
         SET amount_paid = ?,
             balance = ?,
             payment_status = ?
         WHERE id = ?`,
        [newAmountPaid, newBalance, newPaymentStatus, id]
      );

      await connection.query(
        `INSERT INTO purchase_payments (
          purchase_id,
          amount,
          payment_method,
          paid_by,
          notes
        )
        VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          paymentAmount,
          cleanPaymentMethod,
          req.user.id,
          notes || null,
        ]
      );

      await connection.query(
        `INSERT INTO activity_log (user_id, action, details)
         VALUES (?, ?, ?)`,
        [
          req.user.id,
          "PAY_PURCHASE_BALANCE",
          `Paid GHS ${paymentAmount.toFixed(
            2
          )} by ${cleanPaymentMethod} for purchase ${
            purchase.invoice_number || `#${id}`
          }. New balance: GHS ${newBalance.toFixed(2)}`,
        ]
      );

      await connection.commit();

      return res.json({
        status: "success",
        message: "Purchase payment recorded successfully.",
        purchase: {
          id: Number(id),
          total_amount: totalAmount,
          amount_paid: newAmountPaid,
          balance: newBalance,
          payment_status: newPaymentStatus,
        },
      });
    } catch (error) {
      await connection.rollback();

      console.error("Pay purchase balance error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while recording purchase payment.",
      });
    } finally {
      connection.release();
    }
  }
);

// POST /api/purchases
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const {
        supplier_id,
        invoice_number,
        purchase_date,
        amount_paid,
        notes,
        items,
      } = req.body;

      if (!purchase_date) {
        return res.status(400).json({
          status: "error",
          message: "Purchase date is required.",
        });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "At least one purchase item is required.",
        });
      }

      await connection.beginTransaction();

      let totalAmount = 0;
      const cleanItems = [];

      for (const item of items) {
        const productId = Number(item.product_id);
        const quantity = Number(item.quantity);
        const costPrice = toNonNegativeNumber(item.cost_price);

        if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
          await connection.rollback();

          return res.status(400).json({
            status: "error",
            message:
              "Each item must have product and quantity greater than zero.",
          });
        }

        if (costPrice === null) {
          await connection.rollback();

          return res.status(400).json({
            status: "error",
            message: "Each item must have a valid cost price.",
          });
        }

        const [products] = await connection.query(
          `SELECT id, name
           FROM products
           WHERE id = ?
           AND is_active = TRUE
           LIMIT 1`,
          [productId]
        );

        if (products.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            status: "error",
            message: `Product with ID ${productId} was not found.`,
          });
        }

        const lineTotal = Number((quantity * costPrice).toFixed(2));
        totalAmount += lineTotal;

        cleanItems.push({
          product_id: productId,
          product_name: products[0].name,
          quantity,
          cost_price: costPrice,
          line_total: lineTotal,
        });
      }

      totalAmount = Number(totalAmount.toFixed(2));

      const cleanAmountPaid = toNonNegativeNumber(amount_paid || 0);

      if (cleanAmountPaid === null) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Amount paid must be a valid number.",
        });
      }

      if (cleanAmountPaid > totalAmount) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Amount paid cannot be greater than purchase total.",
        });
      }

      const balance = Number((totalAmount - cleanAmountPaid).toFixed(2));
      const paymentStatus = getPaymentStatus(totalAmount, cleanAmountPaid);

      const [purchaseResult] = await connection.query(
        `INSERT INTO purchases (
          supplier_id,
          invoice_number,
          purchase_date,
          total_cost,
          total_amount,
          amount_paid,
          balance,
          payment_status,
          notes,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          supplier_id || null,
          invoice_number || null,
          purchase_date,
          totalAmount,
          totalAmount,
          cleanAmountPaid,
          balance,
          paymentStatus,
          notes || null,
          req.user.id,
        ]
      );

      const purchaseId = purchaseResult.insertId;

      if (cleanAmountPaid > 0) {
        await connection.query(
          `INSERT INTO purchase_payments (
            purchase_id,
            amount,
            payment_method,
            paid_by,
            notes
          )
          VALUES (?, ?, ?, ?, ?)`,
          [
            purchaseId,
            cleanAmountPaid,
            "cash",
            req.user.id,
            "Initial amount paid when purchase was recorded",
          ]
        );
      }

      for (const item of cleanItems) {
        await connection.query(
          `INSERT INTO purchase_items (
            purchase_id,
            product_id,
            product_name,
            quantity,
            cost_price,
            line_total
          )
          VALUES (?, ?, ?, ?, ?, ?)`,
          [
            purchaseId,
            item.product_id,
            item.product_name,
            item.quantity,
            item.cost_price,
            item.line_total,
          ]
        );

        await connection.query(
          `UPDATE products
           SET quantity = quantity + ?,
               cost_price = ?
           WHERE id = ?`,
          [item.quantity, item.cost_price, item.product_id]
        );
      }

      await connection.query(
        `INSERT INTO activity_log (user_id, action, details)
         VALUES (?, ?, ?)`,
        [
          req.user.id,
          "CREATE_PURCHASE",
          `Recorded purchase worth GHS ${totalAmount.toFixed(2)}`,
        ]
      );

      await connection.commit();

      return res.status(201).json({
        status: "success",
        message: "Purchase recorded successfully. Stock has been updated.",
        purchase: {
          id: purchaseId,
          total_cost: totalAmount,
          total_amount: totalAmount,
          amount_paid: cleanAmountPaid,
          balance,
          payment_status: paymentStatus,
        },
      });
    } catch (error) {
      await connection.rollback();

      console.error("Create purchase error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while recording purchase.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;