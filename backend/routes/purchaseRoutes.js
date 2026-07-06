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

async function logActivity(userId, branchId, action, details) {
  await pool.query(
    `INSERT INTO activity_log (branch_id, user_id, action, details)
     VALUES (?, ?, ?, ?)`,
    [branchId || null, userId || null, action, details]
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

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
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
      const branchId = getBranchId(req);

      const [suppliers] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          contact_person,
          phone,
          email,
          address,
          is_active,
          created_at
         FROM suppliers
         WHERE branch_id = ?
         AND is_active = TRUE
         ORDER BY name ASC`,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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
      const branchId = getBranchId(req);
      const { name, contact_person, phone, email, address } = req.body;

      const cleanName = cleanText(name);

      if (!cleanName) {
        return res.status(400).json({
          status: "error",
          message: "Supplier name is required.",
        });
      }

      const [result] = await pool.query(
        `INSERT INTO suppliers (
          branch_id,
          name,
          contact_person,
          phone,
          email,
          address,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [
          branchId,
          cleanName,
          cleanNullableText(contact_person),
          cleanNullableText(phone),
          cleanNullableText(email),
          cleanNullableText(address),
        ]
      );

      await logActivity(
        req.user.id,
        branchId,
        "CREATE_SUPPLIER",
        `Created supplier "${cleanName}"`
      );

      const [suppliers] = await pool.query(
        `SELECT
          id,
          branch_id,
          name,
          contact_person,
          phone,
          email,
          address,
          is_active,
          created_at
         FROM suppliers
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1`,
        [result.insertId, branchId]
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
      const branchId = getBranchId(req);
      const search = cleanText(req.query.search);
      const from = cleanText(req.query.from);
      const to = cleanText(req.query.to);

      const params = [branchId];
      let whereClause = "WHERE p.branch_id = ?";

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
          p.branch_id,
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
          u.full_name AS created_by_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM purchases p
         LEFT JOIN suppliers s
          ON p.supplier_id = s.id
          AND s.branch_id = p.branch_id
         LEFT JOIN users u ON p.created_by = u.id
         LEFT JOIN branches b ON p.branch_id = b.id
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
         LEFT JOIN suppliers s
          ON p.supplier_id = s.id
          AND s.branch_id = p.branch_id
         LEFT JOIN users u ON p.created_by = u.id
         ${whereClause}`,
        params
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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
      const branchId = getBranchId(req);
      const { id } = req.params;

      const [purchases] = await pool.query(
        `SELECT
          p.id,
          p.branch_id,
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
          u.full_name AS created_by_name,
          b.name AS branch_name,
          b.location AS branch_location
         FROM purchases p
         LEFT JOIN suppliers s
          ON p.supplier_id = s.id
          AND s.branch_id = p.branch_id
         LEFT JOIN users u ON p.created_by = u.id
         LEFT JOIN branches b ON p.branch_id = b.id
         WHERE p.id = ?
         AND p.branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      if (purchases.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Purchase not found in the selected store.",
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
          pp.branch_id,
          pp.purchase_id,
          pp.amount,
          pp.payment_method,
          pp.notes,
          pp.paid_at,
          u.full_name AS paid_by_name
         FROM purchase_payments pp
         LEFT JOIN users u ON pp.paid_by = u.id
         WHERE pp.purchase_id = ?
         AND pp.branch_id = ?
         ORDER BY pp.paid_at ASC, pp.id ASC`,
        [id, branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
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
      const branchId = getBranchId(req);
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
          branch_id,
          invoice_number,
          total_amount,
          amount_paid,
          balance,
          payment_status
         FROM purchases
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      if (purchases.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Purchase not found in the selected store.",
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
         WHERE id = ?
         AND branch_id = ?`,
        [newAmountPaid, newBalance, newPaymentStatus, id, branchId]
      );

      await connection.query(
        `INSERT INTO purchase_payments (
          branch_id,
          purchase_id,
          amount,
          payment_method,
          paid_by,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          id,
          paymentAmount,
          cleanPaymentMethod,
          req.user.id,
          cleanNullableText(notes),
        ]
      );

      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [
          branchId,
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
          branch_id: branchId,
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
      const branchId = getBranchId(req);

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

      const supplierId = supplier_id ? Number(supplier_id) : null;

      if (supplierId) {
        const [suppliers] = await connection.query(
          `SELECT id
           FROM suppliers
           WHERE id = ?
           AND branch_id = ?
           AND is_active = TRUE
           LIMIT 1`,
          [supplierId, branchId]
        );

        if (suppliers.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            status: "error",
            message: "Supplier not found in the selected store.",
          });
        }
      }

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
          `SELECT id, branch_id, name
           FROM products
           WHERE id = ?
           AND branch_id = ?
           AND is_active = TRUE
           LIMIT 1`,
          [productId, branchId]
        );

        if (products.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            status: "error",
            message: `Product with ID ${productId} was not found in the selected store.`,
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
          branch_id,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          supplierId,
          cleanNullableText(invoice_number),
          purchase_date,
          totalAmount,
          totalAmount,
          cleanAmountPaid,
          balance,
          paymentStatus,
          cleanNullableText(notes),
          req.user.id,
        ]
      );

      const purchaseId = purchaseResult.insertId;

      if (cleanAmountPaid > 0) {
        await connection.query(
          `INSERT INTO purchase_payments (
            branch_id,
            purchase_id,
            amount,
            payment_method,
            paid_by,
            notes
          )
          VALUES (?, ?, ?, ?, ?, ?)`,
          [
            branchId,
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
           WHERE id = ?
           AND branch_id = ?`,
          [item.quantity, item.cost_price, item.product_id, branchId]
        );
      }

      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [
          branchId,
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
          branch_id: branchId,
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
