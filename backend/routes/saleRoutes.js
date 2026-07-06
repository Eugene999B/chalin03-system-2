const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  buildOwnerAlertContext,
  formatMoney,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");

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

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return null;
  }

  return branchId;
}

function getBranchInfo(req) {
  return {
    id: getBranchId(req),
    branch_code: req.user?.branch_code || null,
    name: req.user?.branch_name || null,
    location: req.user?.branch_location || null,
  };
}

function requireSelectedBranch(req, res) {
  const branchId = getBranchId(req);

  if (!branchId) {
    res.status(400).json({
      status: "error",
      message:
        "No store selected. Please logout, choose a store, and login again.",
    });

    return null;
  }

  return branchId;
}

function cleanReceiptPrefix(prefix, branchCode) {
  const value = cleanText(prefix) || `CHL-${cleanText(branchCode) || "STORE"}`;

  return value
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 20);
}

function generateReceiptNumber(prefix) {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);

  return `${prefix}-${year}${month}${day}-${hour}${minute}${second}-${random}`;
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

async function sendSaleVoidedSecuritySmsAlert({
  sale,
  voidedByUser,
  branchId,
  reason,
}) {
  try {
    const { businessName, branch } = await buildOwnerAlertContext(branchId);

    const voidedBy =
      voidedByUser?.full_name || voidedByUser?.username || "Admin";

    const message = `${businessName}: Security alert. Sale ${
      sale.receipt_number || sale.id
    } was voided at ${branch.name} (${branch.code}). Total: GHS ${formatMoney(
      sale.total
    )}. Paid: GHS ${formatMoney(sale.amount_paid)}. Balance: GHS ${formatMoney(
      sale.balance
    )}. Customer: ${
      sale.customer_name || "Walk-in Customer"
    }. Voided by ${voidedBy}. Reason: ${reason}. Date: ${formatSecurityDateTime()}.`;

    await sendOwnerSmsAlert({
      branchId,
      message,
      smsType: "security_alert",
      sentBy: voidedByUser?.id || null,
    });
  } catch (error) {
    console.warn("Sale voided SMS alert skipped:", error.message);
  }
}

async function getSettings(connection, branchId) {
  const [settingsRows] = await connection.query(
    `SELECT
      s.tax_rate,
      s.debt_reminder_days,
      s.business_name,
      s.business_address,
      s.business_phone,
      s.owner_phone,
      s.branch_name,
      s.receipt_prefix,
      b.code AS branch_code,
      b.name AS branch_table_name,
      b.location AS branch_location
     FROM settings s
     LEFT JOIN branches b ON s.branch_id = b.id
     WHERE s.branch_id = ?
     ORDER BY s.id DESC
     LIMIT 1`,
    [branchId]
  );

  if (settingsRows.length === 0) {
    const [fallbackRows] = await connection.query(
      `SELECT
        id,
        code AS branch_code,
        name,
        location
       FROM branches
       WHERE id = ?
       LIMIT 1`,
      [branchId]
    );

    const fallbackBranch = fallbackRows[0] || {};

    return {
      tax_rate: 0,
      debt_reminder_days: 7,
      business_name: "Chalin 03 Company Limited",
      business_address: fallbackBranch.location || "",
      business_phone: "0249469080 / 0249995510",
      owner_phone: "0543421127",
      branch_name: fallbackBranch.name || "Selected Store",
      receipt_prefix: cleanReceiptPrefix(null, fallbackBranch.branch_code),
      branch_code: fallbackBranch.branch_code || "STORE",
      branch_table_name: fallbackBranch.name || "Selected Store",
      branch_location: fallbackBranch.location || "",
    };
  }

  const settings = settingsRows[0];

  return {
    ...settings,
    receipt_prefix: cleanReceiptPrefix(
      settings.receipt_prefix,
      settings.branch_code
    ),
  };
}

function calculateDueDate(daysToAdd) {
  const date = new Date();
  date.setDate(date.getDate() + Number(daysToAdd || 7));

  return date.toISOString().slice(0, 10);
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
      error.code === "ER_BAD_TABLE_ERROR" ||
      error.code === "ER_BAD_FIELD_ERROR"
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

async function findOrCreateCustomer(
  connection,
  branchId,
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
      `SELECT id, branch_id, name, phone, location
       FROM customers
       WHERE branch_id = ?
       AND phone = ?
       LIMIT 1`,
      [branchId, cleanPhone]
    );

    if (existingCustomers.length > 0) {
      const existingCustomer = existingCustomers[0];

      if (cleanName && existingCustomer.name !== cleanName) {
        await connection.query(
          `UPDATE customers
           SET name = ?, location = COALESCE(?, location)
           WHERE id = ?
           AND branch_id = ?`,
          [cleanName, cleanLocation, existingCustomer.id, branchId]
        );

        return {
          ...existingCustomer,
          name: cleanName,
          location: cleanLocation || existingCustomer.location,
        };
      }

      if (cleanLocation && existingCustomer.location !== cleanLocation) {
        await connection.query(
          `UPDATE customers
           SET location = ?
           WHERE id = ?
           AND branch_id = ?`,
          [cleanLocation, existingCustomer.id, branchId]
        );

        return {
          ...existingCustomer,
          location: cleanLocation,
        };
      }

      return existingCustomer;
    }
  }

  const finalName = cleanName || "Walk-in Customer";

  const [result] = await connection.query(
    `INSERT INTO customers (branch_id, name, phone, location)
     VALUES (?, ?, ?, ?)`,
    [branchId, finalName, cleanPhone, cleanLocation]
  );

  return {
    id: result.insertId,
    branch_id: branchId,
    name: finalName,
    phone: cleanPhone,
    location: cleanLocation,
  };
}

// POST /api/sales
router.post("/", requireAuth, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

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

    const lockedPeriod = await findApprovedAuditLockForDate(
      connection,
      branchId,
      new Date()
    );

    if (lockedPeriod) {
      await connection.rollback();

      return sendAuditLockedResponse(res, lockedPeriod, "record a sale");
    }

    const settings = await getSettings(connection, branchId);
    const taxRate = Number(settings.tax_rate || 0);
    const receiptNumber = generateReceiptNumber(settings.receipt_prefix);

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
        `SELECT
          id,
          branch_id,
          name,
          cost_price,
          selling_price,
          quantity,
          is_active
         FROM products
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [productId, branchId]
      );

      if (products.length === 0 || !products[0].is_active) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message:
            "Product was not found in the selected store. Please refresh products and try again.",
        });
      }

      const product = products[0];

      if (Number(product.quantity) < quantity) {
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
      branchId,
      cleanCustomerName,
      cleanCustomerPhone,
      cleanCustomerLocation
    );

    const finalCustomerName =
      cleanCustomerName || customer?.name || "Walk-in Customer";

    const finalCustomerPhone = cleanCustomerPhone || customer?.phone || null;

    const [saleResult] = await connection.query(
      `INSERT INTO sales (
        branch_id,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [
        branchId,
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
         WHERE id = ?
         AND branch_id = ?`,
        [saleItem.quantity, saleItem.product_id, branchId]
      );
    }

    let debt = null;

    if (balance > 0 || payment_type === "credit" || payment_type === "mixed") {
      const debtStatus = getDebtStatus(balance, paidAmount);
      const dueDate = calculateDueDate(settings.debt_reminder_days);

      const [debtResult] = await connection.query(
        `INSERT INTO debts (
          branch_id,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
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
        branch_id: branchId,
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
      `INSERT INTO activity_log (branch_id, user_id, action, details)
       VALUES (?, ?, ?, ?)`,
      [
        branchId,
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
        branch_id: branchId,
        branch_code: settings.branch_code || req.user.branch_code || null,
        branch_name:
          settings.branch_name ||
          settings.branch_table_name ||
          req.user.branch_name ||
          null,
        branch_location:
          settings.business_address ||
          settings.branch_location ||
          req.user.branch_location ||
          null,
        sale_id: saleId,
        receipt_number: receiptNumber,
        business_name: settings.business_name || "Chalin 03 Company Limited",
        business_address:
          settings.business_address ||
          settings.branch_location ||
          req.user.branch_location ||
          "",
        business_phone: settings.business_phone || null,
        owner_phone: settings.owner_phone || null,
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
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

    const { search, from, to } = req.query;

    let sql = `
      SELECT
        s.id,
        s.branch_id,
        b.code AS branch_code,
        b.name AS branch_name,
        b.location AS branch_location,
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
      LEFT JOIN branches b ON s.branch_id = b.id
      LEFT JOIN users u ON s.staff_id = u.id
      LEFT JOIN users vu ON s.voided_by = vu.id
      WHERE s.branch_id = ?
    `;

    const params = [branchId];

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
      branch_id: branchId,
      branch: getBranchInfo(req),
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
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

    const { id } = req.params;

    const [sales] = await pool.query(
      `SELECT
        s.*,
        b.code AS branch_code,
        b.name AS branch_name,
        b.location AS branch_location,
        u.full_name AS staff_name,
        vu.full_name AS voided_by_name
       FROM sales s
       LEFT JOIN branches b ON s.branch_id = b.id
       LEFT JOIN users u ON s.staff_id = u.id
       LEFT JOIN users vu ON s.voided_by = vu.id
       WHERE s.id = ?
       AND s.branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (sales.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "Sale not found in the selected store.",
      });
    }

    const [items] = await pool.query(
      `SELECT
        si.id,
        si.product_id,
        si.product_name,
        si.quantity,
        si.unit_price,
        si.line_total,
        si.cost_price_at_sale
       FROM sale_items si
       INNER JOIN sales s ON si.sale_id = s.id
       WHERE si.sale_id = ?
       AND s.branch_id = ?
       ORDER BY si.id ASC`,
      [id, branchId]
    );

    const [debts] = await pool.query(
      `SELECT *
       FROM debts
       WHERE sale_id = ?
       AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
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
  requireRole("admin"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = requireSelectedBranch(req, res);

      if (!branchId) {
        return;
      }

      const { id } = req.params;
      const { reason } = req.body;
      const cleanReason = cleanText(reason);

      if (!cleanReason) {
        return res.status(400).json({
          status: "error",
          message: "Void reason is required.",
        });
      }

      await connection.beginTransaction();

      const [sales] = await connection.query(
        `SELECT
          id,
          branch_id,
          receipt_number,
          customer_name,
          customer_phone,
          subtotal,
          discount_amount,
          tax_amount,
          total,
          payment_type,
          amount_paid,
          balance,
          sale_status,
          is_voided,
          created_at
         FROM sales
         WHERE id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      if (sales.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          status: "error",
          message: "Sale not found in the selected store.",
        });
      }

      const sale = sales[0];

      const lockedPeriod = await findApprovedAuditLockForDate(
        connection,
        branchId,
        sale.created_at
      );

      if (lockedPeriod) {
        await connection.rollback();

        return sendAuditLockedResponse(res, lockedPeriod, "void a sale");
      }

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
          AND r.branch_id = ?
         WHERE si.sale_id = ?
         GROUP BY
          si.id,
          si.product_id,
          si.product_name,
          si.quantity`,
        [branchId, id]
      );

      for (const item of items) {
        const soldQuantity = Number(item.sold_quantity || 0);
        const returnedQuantity = Number(item.returned_quantity || 0);
        const quantityToRestore = soldQuantity - returnedQuantity;

        if (quantityToRestore > 0) {
          await connection.query(
            `UPDATE products
             SET quantity = quantity + ?
             WHERE id = ?
             AND branch_id = ?`,
            [quantityToRestore, item.product_id, branchId]
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
         WHERE id = ?
         AND branch_id = ?`,
        [cleanReason, req.user.id, id, branchId]
      );

      await connection.query(
        `UPDATE debts
         SET
          amount_paid = amount_owed,
          balance = 0,
          status = 'paid'
         WHERE sale_id = ?
         AND branch_id = ?`,
        [id, branchId]
      );

      await connection.query(
        `INSERT INTO activity_log (branch_id, user_id, action, details)
         VALUES (?, ?, ?, ?)`,
        [
          branchId,
          req.user.id,
          "VOID_SALE",
          `Voided sale ${sale.receipt_number}. Reason: ${cleanReason}`,
        ]
      );

      await connection.commit();

      await sendSaleVoidedSecuritySmsAlert({
        sale,
        voidedByUser: req.user,
        branchId,
        reason: cleanReason,
      });

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