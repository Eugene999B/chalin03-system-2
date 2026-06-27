const express = require("express");
const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

const router = express.Router();

function toNonNegativeNumber(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  return text;
}

function generateReceiptNumber() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);

  return `CHL-${year}${month}${day}-${hour}${minute}${second}-${random}`;
}

function getDebtStatus(balance, amountPaid) {
  if (balance <= 0) {
    return "paid";
  }

  if (amountPaid > 0) {
    return "partial";
  }

  return "unpaid";
}

async function getSettings(connection) {
  const [settingsRows] = await connection.query(
    `SELECT tax_rate, debt_reminder_days
     FROM settings
     ORDER BY id ASC
     LIMIT 1`
  );

  if (settingsRows.length === 0) {
    return {
      tax_rate: 0,
      debt_reminder_days: 7,
    };
  }

  return settingsRows[0];
}

function calculateDueDate(daysToAdd) {
  const date = new Date();
  date.setDate(date.getDate() + Number(daysToAdd || 7));

  return date.toISOString().slice(0, 10);
}

async function findOrCreateCustomer(
  connection,
  customerName,
  customerPhone,
  customerLocation
) {
  const cleanName = cleanText(customerName);
  const cleanPhone = cleanText(customerPhone);
  const cleanLocation = cleanText(customerLocation);

  if (!cleanName && !cleanPhone) {
    return null;
  }

  if (cleanPhone) {
    const [existingCustomers] = await connection.query(
      `SELECT id, name, phone, location
       FROM customers
       WHERE phone = ?
       LIMIT 1`,
      [cleanPhone]
    );

    if (existingCustomers.length > 0) {
      const existingCustomer = existingCustomers[0];

      if (cleanName && existingCustomer.name !== cleanName) {
        await connection.query(
          `UPDATE customers
           SET name = ?, location = COALESCE(?, location)
           WHERE id = ?`,
          [cleanName, cleanLocation, existingCustomer.id]
        );

        return {
          ...existingCustomer,
          name: cleanName,
          location: cleanLocation || existingCustomer.location,
        };
      }

      return existingCustomer;
    }
  }

  const finalName = cleanName || "Walk-in Customer";

  const [result] = await connection.query(
    `INSERT INTO customers (name, phone, location)
     VALUES (?, ?, ?)`,
    [finalName, cleanPhone, cleanLocation]
  );

  return {
    id: result.insertId,
    name: finalName,
    phone: cleanPhone,
    location: cleanLocation,
  };
}

// POST /api/sales
router.post("/", requireAuth, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const {
      customer_name,
      customer_phone,
      customer_location,
      payment_type,
      amount_paid,
      discount_amount,
      items,
    } = req.body;

    const cleanCustomerName = cleanText(customer_name);
    const cleanCustomerPhone = cleanText(customer_phone);
    const cleanCustomerLocation = cleanText(customer_location);

    const allowedPaymentTypes = ["cash", "momo", "bank", "credit", "mixed"];

    if (!allowedPaymentTypes.includes(payment_type)) {
      return res.status(400).json({
        status: "error",
        message: "payment_type must be cash, momo, bank, credit, or mixed.",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Sale must contain at least one item.",
      });
    }

    const paidAmount = toNonNegativeNumber(amount_paid ?? 0);

    if (paidAmount === null) {
      return res.status(400).json({
        status: "error",
        message: "Amount paid must be a valid number and cannot be negative.",
      });
    }

    const discountAmount = toNonNegativeNumber(discount_amount ?? 0);

    if (discountAmount === null) {
      return res.status(400).json({
        status: "error",
        message: "Discount must be a valid number and cannot be negative.",
      });
    }

    if (payment_type === "credit" && !cleanCustomerName && !cleanCustomerPhone) {
      return res.status(400).json({
        status: "error",
        message: "Customer name or phone is required for credit sales.",
      });
    }

    await connection.beginTransaction();

    const settings = await getSettings(connection);
    const taxRate = Number(settings.tax_rate || 0);
    const receiptNumber = generateReceiptNumber();

    const saleItems = [];
    let subtotal = 0;

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = toPositiveInt(Number(item.quantity));

      if (!productId || quantity === null) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "Each item must have a valid product_id and quantity.",
        });
      }

      const [products] = await connection.query(
        `SELECT id, name, cost_price, selling_price, quantity, is_active
         FROM products
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [productId]
      );

      if (products.length === 0 || !products[0].is_active) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: `Product with ID ${productId} was not found.`,
        });
      }

      const product = products[0];

      if (product.quantity < quantity) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: `Not enough stock for ${product.name}. Available: ${product.quantity}, requested: ${quantity}.`,
        });
      }

      const unitPrice = Number(product.selling_price);
      const costPriceAtSale = Number(product.cost_price);
      const lineTotal = Number((unitPrice * quantity).toFixed(2));

      subtotal += lineTotal;

      saleItems.push({
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        cost_price_at_sale: costPriceAtSale,
      });
    }

    subtotal = Number(subtotal.toFixed(2));

    if (discountAmount > subtotal) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message: "Discount cannot be greater than subtotal.",
      });
    }

    const taxableAmount = Number((subtotal - discountAmount).toFixed(2));
    const taxAmount = Number(((taxableAmount * taxRate) / 100).toFixed(2));
    const total = Number((taxableAmount + taxAmount).toFixed(2));
    const balance = Number(Math.max(total - paidAmount, 0).toFixed(2));

    if (
      payment_type !== "credit" &&
      payment_type !== "mixed" &&
      paidAmount < total
    ) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message:
          "For cash, momo, or bank sales, amount paid must cover the total.",
      });
    }

    const customer = await findOrCreateCustomer(
      connection,
      cleanCustomerName,
      cleanCustomerPhone,
      cleanCustomerLocation
    );

    const finalCustomerName =
      cleanCustomerName || customer?.name || "Walk-in Customer";

    const finalCustomerPhone = cleanCustomerPhone || customer?.phone || null;

    const [saleResult] = await connection.query(
      `INSERT INTO sales (
        receipt_number,
        customer_id,
        customer_name,
        customer_phone,
        staff_id,
        subtotal,
        discount_amount,
        tax_amount,
        total,
        payment_type,
        amount_paid,
        balance,
        sale_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [
        receiptNumber,
        customer ? customer.id : null,
        finalCustomerName,
        finalCustomerPhone,
        req.user.id,
        subtotal,
        discountAmount,
        taxAmount,
        total,
        payment_type,
        paidAmount,
        balance,
      ]
    );

    const saleId = saleResult.insertId;

    for (const saleItem of saleItems) {
      await connection.query(
        `INSERT INTO sale_items (
          sale_id,
          product_id,
          product_name,
          quantity,
          unit_price,
          line_total,
          cost_price_at_sale
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          saleItem.product_id,
          saleItem.product_name,
          saleItem.quantity,
          saleItem.unit_price,
          saleItem.line_total,
          saleItem.cost_price_at_sale,
        ]
      );

      await connection.query(
        `UPDATE products
         SET quantity = quantity - ?
         WHERE id = ?`,
        [saleItem.quantity, saleItem.product_id]
      );
    }

    let debt = null;

    if (balance > 0 || payment_type === "credit" || payment_type === "mixed") {
      const debtStatus = getDebtStatus(balance, paidAmount);
      const dueDate = calculateDueDate(settings.debt_reminder_days);

      const [debtResult] = await connection.query(
        `INSERT INTO debts (
          sale_id,
          customer_id,
          customer_name,
          customer_phone,
          amount_owed,
          amount_paid,
          balance,
          status,
          due_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          customer ? customer.id : null,
          finalCustomerName,
          finalCustomerPhone,
          total,
          paidAmount,
          balance,
          debtStatus,
          dueDate,
        ]
      );

      debt = {
        id: debtResult.insertId,
        sale_id: saleId,
        customer_name: finalCustomerName,
        customer_phone: finalCustomerPhone,
        amount_owed: total,
        amount_paid: paidAmount,
        balance,
        status: debtStatus,
        due_date: dueDate,
      };
    }

    await connection.query(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`,
      [
        req.user.id,
        "CREATE_SALE",
        `Created sale ${receiptNumber} for ${finalCustomerName} with total GHS ${total} and discount GHS ${discountAmount}`,
      ]
    );

    await connection.commit();

    return res.status(201).json({
      status: "success",
      message: "Sale recorded successfully.",
      receipt: {
        sale_id: saleId,
        receipt_number: receiptNumber,
        business_name: "Chalin 03 Company Limited",
        business_address: "Dunkwa Police Barrier",
        staff: {
          id: req.user.id,
          full_name: req.user.full_name,
          username: req.user.username,
        },
        customer: {
          id: customer ? customer.id : null,
          name: finalCustomerName,
          phone: finalCustomerPhone,
          location: cleanCustomerLocation,
        },
        items: saleItems.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
        })),
        subtotal,
        discount_amount: discountAmount,
        taxable_amount: taxableAmount,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total,
        payment_type,
        amount_paid: paidAmount,
        balance,
        debt,
        created_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("Create sale error:", error);

    return res.status(500).json({
      status: "error",
      message: error.message || "Something went wrong while recording the sale.",
    });
  } finally {
    connection.release();
  }
});

// GET /api/sales
router.get("/", requireAuth, async (req, res) => {
  try {
    const { search, from, to } = req.query;

    let sql = `
      SELECT
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
        s.void_reason,
        s.voided_at,
        s.created_at,
        u.full_name AS staff_name,
        vu.full_name AS voided_by_name
      FROM sales s
      LEFT JOIN users u ON s.staff_id = u.id
      LEFT JOIN users vu ON s.voided_by = vu.id
      WHERE 1 = 1
    `;

    const params = [];

    if (search) {
      sql += `
        AND (
          s.receipt_number LIKE ?
          OR s.customer_name LIKE ?
          OR s.customer_phone LIKE ?
        )
      `;

      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue, searchValue);
    }

    if (from) {
      sql += ` AND DATE(s.created_at) >= ?`;
      params.push(from);
    }

    if (to) {
      sql += ` AND DATE(s.created_at) <= ?`;
      params.push(to);
    }

    sql += ` ORDER BY s.created_at DESC LIMIT 100`;

    const [sales] = await pool.query(sql, params);

    return res.json({
      status: "success",
      count: sales.length,
      sales,
    });
  } catch (error) {
    console.error("Get sales error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching sales.",
    });
  }
});

// GET /api/sales/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [sales] = await pool.query(
      `SELECT
        s.*,
        u.full_name AS staff_name,
        vu.full_name AS voided_by_name
       FROM sales s
       LEFT JOIN users u ON s.staff_id = u.id
       LEFT JOIN users vu ON s.voided_by = vu.id
       WHERE s.id = ?
       LIMIT 1`,
      [id]
    );

    if (sales.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Sale not found.",
      });
    }

    const [items] = await pool.query(
      `SELECT
        id,
        product_id,
        product_name,
        quantity,
        unit_price,
        line_total,
        cost_price_at_sale
       FROM sale_items
       WHERE sale_id = ?
       ORDER BY id ASC`,
      [id]
    );

    const [debts] = await pool.query(
      `SELECT *
       FROM debts
       WHERE sale_id = ?
       LIMIT 1`,
      [id]
    );

    return res.json({
      status: "success",
      sale: sales[0],
      items,
      debt: debts.length > 0 ? debts[0] : null,
    });
  } catch (error) {
    console.error("Get single sale error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching the sale.",
    });
  }
});

// PATCH /api/sales/:id/void
router.patch(
  "/:id/void",
  requireAuth,
  requireRole(["admin"]),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({
          status: "error",
          message: "Void reason is required.",
        });
      }

      await connection.beginTransaction();

      const [sales] = await connection.query(
        `SELECT
          id,
          receipt_number,
          sale_status,
          is_voided
         FROM sales
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (sales.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Sale not found.",
        });
      }

      const sale = sales[0];

      if (
        Number(sale.is_voided) === 1 ||
        sale.sale_status === "cancelled" ||
        sale.sale_status === "voided"
      ) {
        await connection.rollback();

        return res.status(400).json({
          status: "error",
          message: "This sale has already been voided.",
        });
      }

      const [items] = await connection.query(
        `SELECT
          si.id,
          si.product_id,
          si.product_name,
          si.quantity AS sold_quantity,
          COALESCE(SUM(r.quantity), 0) AS returned_quantity
         FROM sale_items si
         LEFT JOIN returns r
          ON r.sale_id = si.sale_id
          AND r.product_id = si.product_id
         WHERE si.sale_id = ?
         GROUP BY
          si.id,
          si.product_id,
          si.product_name,
          si.quantity`,
        [id]
      );

      for (const item of items) {
        const soldQuantity = Number(item.sold_quantity || 0);
        const returnedQuantity = Number(item.returned_quantity || 0);
        const quantityToRestore = soldQuantity - returnedQuantity;

        if (quantityToRestore > 0) {
          await connection.query(
            `UPDATE products
             SET quantity = quantity + ?
             WHERE id = ?`,
            [quantityToRestore, item.product_id]
          );
        }
      }

      await connection.query(
        `UPDATE sales
         SET
          sale_status = 'cancelled',
          is_voided = 1,
          void_reason = ?,
          voided_by = ?,
          voided_at = NOW()
         WHERE id = ?`,
        [reason.trim(), req.user.id, id]
      );

      await connection.query(
        `UPDATE debts
         SET
          amount_paid = amount_owed,
          balance = 0,
          status = 'paid'
         WHERE sale_id = ?`,
        [id]
      );

      await connection.query(
        `INSERT INTO activity_log (user_id, action, details)
         VALUES (?, ?, ?)`,
        [
          req.user.id,
          "VOID_SALE",
          `Voided sale ${sale.receipt_number}. Reason: ${reason.trim()}`,
        ]
      );

      await connection.commit();

      return res.json({
        status: "success",
        message: "Sale voided successfully. Stock has been restored.",
      });
    } catch (error) {
      await connection.rollback();

      console.error("Void sale error:", error);

      return res.status(500).json({
        status: "error",
        message: error.message || "Failed to void sale.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;