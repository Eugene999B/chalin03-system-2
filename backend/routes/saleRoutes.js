const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const {
  buildOwnerAlertContext,
  formatMoney,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const { sendSaleReceiptWhatsApp } = require("../services/whatsappService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { createAgreementForSale } = require("../services/installmentService");
const { sendInstallmentEventSms } = require("../services/installmentReminderService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateSaleCreateRequest } = require("../validation/financialRequestValidators");
const {
  lockSaleTraceabilitySelections,
  markSaleUnitsSold,
} = require("../services/inventorySaleTraceabilityService");

const router = express.Router();

function toNonNegativeNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
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

function findDuplicateProductId(items) {
  const seen = new Set();

  for (const item of items || []) {
    const productId = Number(item?.product_id);

    if (!Number.isInteger(productId) || productId <= 0) {
      continue;
    }

    if (seen.has(productId)) {
      return productId;
    }

    seen.add(productId);
  }

  return null;
}

function getProductSearchInfo(productSearchValue, productIdValue) {
  const productText = cleanText(productSearchValue);
  const explicitProductId = toPositiveInt(Number(productIdValue));
  const textAsNumber = Number(productText);
  const textProductId =
    Number.isInteger(textAsNumber) && textAsNumber > 0 ? textAsNumber : null;

  return {
    text: productText,
    like: productText ? `%${productText}%` : null,
    productId: explicitProductId || textProductId || -1,
    active: Boolean(productText || explicitProductId),
  };
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

function calculateSalePayment(paymentType, rawTendered, rawPaid, total) {
  const tenderedInput = toNonNegativeNumber(rawTendered ?? rawPaid ?? 0);
  const paidInput = toNonNegativeNumber(rawPaid ?? rawTendered ?? 0);

  if (tenderedInput === null || paidInput === null) {
    return {
      error: "Amount tendered and amount paid must be valid numbers and cannot be negative.",
    };
  }

  const saleTotal = Number(total || 0);

  if (["cash", "momo", "bank"].includes(paymentType)) {
    if (tenderedInput < saleTotal) {
      return {
        error:
          "For cash, momo, or bank sales, amount tendered must cover the total.",
      };
    }

    return {
      amount_tendered: tenderedInput,
      amount_paid: Number(Math.min(tenderedInput, saleTotal).toFixed(2)),
      change_due: Number(Math.max(tenderedInput - saleTotal, 0).toFixed(2)),
      balance: 0,
    };
  }

  const amountPaid = Number(Math.min(paidInput, saleTotal).toFixed(2));

  return {
    amount_tendered: paidInput,
    amount_paid: amountPaid,
    change_due: 0,
    balance: Number(Math.max(saleTotal - amountPaid, 0).toFixed(2)),
  };
}


function normalizePaymentAllocations(paymentType, payment, rawAllocations = {}) {
  const channels = ["cash", "momo", "bank", "other"];
  const normalized = Object.fromEntries(channels.map((channel) => [channel, 0]));

  if (["cash", "momo", "bank"].includes(paymentType)) {
    normalized[paymentType] = Number(payment.amount_paid || 0);
    return { allocations: normalized };
  }

  const source = Array.isArray(rawAllocations)
    ? Object.fromEntries(
        rawAllocations.map((item) => [item?.payment_channel || item?.channel, item?.amount])
      )
    : rawAllocations || {};

  for (const channel of channels) {
    const value = toNonNegativeNumber(source[channel] ?? 0);
    if (value === null) {
      return { error: `Payment allocation for ${channel} must be a valid non-negative number.` };
    }
    normalized[channel] = value;
  }

  const allocatedTotal = Number(
    channels.reduce((sum, channel) => sum + normalized[channel], 0).toFixed(2)
  );
  const paidTotal = Number(payment.amount_paid || 0);

  if (Math.abs(allocatedTotal - paidTotal) >= 0.01) {
    return {
      error: `Payment channel allocation must equal the amount paid now. Allocated GHS ${allocatedTotal.toFixed(2)}, paid GHS ${paidTotal.toFixed(2)}.`,
    };
  }

  return { allocations: normalized };
}

async function replaceSalePaymentAllocations(
  connection,
  { branchId, saleId, userId, allocations }
) {
  await connection.query(`DELETE FROM sale_payment_allocations WHERE sale_id = ?`, [
    saleId,
  ]);

  for (const [paymentChannel, amount] of Object.entries(allocations || {})) {
    const cleanAmount = Number(amount || 0);
    if (cleanAmount <= 0) continue;

    await connection.query(
      `INSERT INTO sale_payment_allocations (
        branch_id,
        sale_id,
        payment_channel,
        amount,
        recorded_by
      ) VALUES (?, ?, ?, ?, ?)`,
      [branchId, saleId, paymentChannel, cleanAmount, userId || null]
    );
  }
}

async function getSalePaymentAllocations(connection, saleId) {
  const [rows] = await connection.query(
    `SELECT payment_channel, amount
     FROM sale_payment_allocations
     WHERE sale_id = ?
     ORDER BY FIELD(payment_channel, 'cash', 'momo', 'bank', 'other')`,
    [saleId]
  );

  const allocations = { cash: 0, momo: 0, bank: 0, other: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(allocations, row.payment_channel)) {
      allocations[row.payment_channel] = Number(row.amount || 0);
    }
  }
  return allocations;
}

async function verifyIndependentApprover(
  connection,
  { currentUserId, branchId, approverUsername, approverPassword }
) {
  const username = cleanText(approverUsername);
  const password = String(approverPassword || "");

  if (!username || !password) {
    return { error: "Independent manager username and password are required." };
  }

  const [rows] = await connection.query(
    `SELECT id, full_name, username, role, password_hash, is_active,
            default_branch_id, can_access_all_branches
     FROM users
     WHERE username = ?
     LIMIT 1
     FOR UPDATE`,
    [username]
  );

  const approver = rows[0];
  if (!approver || Number(approver.is_active) !== 1) {
    return { error: "Independent approver account was not found or is inactive." };
  }

  if (!["admin", "manager"].includes(String(approver.role || "").toLowerCase())) {
    return { error: "Independent approver must be an active admin or manager." };
  }

  if (Number(approver.id) === Number(currentUserId)) {
    return { error: "The person changing the sale cannot approve the same change." };
  }

  if (!Number(approver.can_access_all_branches || 0) && Number(approver.default_branch_id || 0) !== Number(branchId)) {
    const [accessRows] = await connection.query(
      `SELECT 1
       FROM user_branch_access
       WHERE user_id = ? AND branch_id = ? AND can_access = 1
       LIMIT 1`,
      [approver.id, branchId]
    );
    if (accessRows.length === 0) {
      return { error: "Independent approver is not authorized for the selected store." };
    }
  }

  const passwordMatches = await bcrypt.compare(password, approver.password_hash);
  if (!passwordMatches) {
    return { error: "Independent approver password is incorrect." };
  }

  return { approver };
}

async function loadCompleteSaleSnapshot(connection, saleId, branchId) {
  const [sales] = await connection.query(
    `SELECT * FROM sales WHERE id = ? AND branch_id = ? LIMIT 1`,
    [saleId, branchId]
  );
  if (!sales[0]) return null;

  const [items] = await connection.query(
    `SELECT id, product_id, product_name, quantity, unit_price, line_total, cost_price_at_sale
     FROM sale_items WHERE sale_id = ? ORDER BY id ASC`,
    [saleId]
  );
  const [debts] = await connection.query(
    `SELECT * FROM debts WHERE sale_id = ? AND branch_id = ? LIMIT 1`,
    [saleId, branchId]
  );
  const allocations = await getSalePaymentAllocations(connection, saleId);

  return {
    sale: sales[0],
    items,
    debt: debts[0] || null,
    payment_allocations: allocations,
  };
}

async function markAffectedClosingStale(
  connection,
  { branchId, transactionDate, reason, sourceEntityType, sourceEntityId, changedBy, approvedBy }
) {
  const closingDate = toDateOnly(transactionDate);
  const [rows] = await connection.query(
    `SELECT *
     FROM daily_closings
     WHERE branch_id = ? AND closing_date = ?
     LIMIT 1
     FOR UPDATE`,
    [branchId, closingDate]
  );

  const closing = rows[0];
  if (!closing) return null;

  const nextRevision = Number(closing.latest_revision_number || 1) + 1;
  const expectedSnapshot = JSON.stringify({
    cash: Number(closing.expected_cash || 0),
    momo: Number(closing.expected_momo || 0),
    bank: Number(closing.expected_bank || 0),
    other: Number(closing.expected_other || 0),
    total: Number(closing.expected_total || 0),
  });
  const countedSnapshot = JSON.stringify({
    cash: Number(closing.cash_counted || 0),
    momo: Number(closing.momo_counted || 0),
    bank: Number(closing.bank_counted || 0),
    other: Number(closing.other_counted || 0),
    total: Number(closing.total_counted || 0),
  });

  await connection.query(
    `INSERT INTO daily_closing_revisions (
      daily_closing_id,
      branch_id,
      closing_date,
      revision_number,
      revision_type,
      reason,
      expected_snapshot_json,
      counted_snapshot_json,
      difference_total,
      source_entity_type,
      source_entity_id,
      changed_by,
      approved_by
    ) VALUES (?, ?, ?, ?, 'post_closing_change', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      closing.id,
      branchId,
      closingDate,
      nextRevision,
      reason,
      expectedSnapshot,
      countedSnapshot,
      Number(closing.difference_total || 0),
      sourceEntityType || null,
      sourceEntityId ? String(sourceEntityId) : null,
      changedBy || null,
      approvedBy || null,
    ]
  );

  await connection.query(
    `UPDATE daily_closings
     SET stale_after_close = 1,
         stale_detected_at = NOW(),
         latest_revision_number = ?,
         verification_status = 'variance_review',
         verified_by = NULL,
         verified_at = NULL
     WHERE id = ?`,
    [nextRevision, closing.id]
  );

  return { id: closing.id, closing_date: closingDate, revision_number: nextRevision };
}

function buildReceiptPayload({
  sale,
  items,
  debt,
  settings,
  branchId,
  user,
  customer,
  paymentAllocations,
}) {
  return {
    branch_id: branchId,
    branch_code: settings.branch_code || user?.branch_code || sale.branch_code || null,
    branch_name:
      settings.branch_name ||
      settings.branch_table_name ||
      user?.branch_name ||
      sale.branch_name ||
      null,
    branch_location:
      settings.business_address ||
      settings.branch_location ||
      user?.branch_location ||
      sale.branch_location ||
      null,
    sale_id: sale.id,
    id: sale.id,
    receipt_number: sale.receipt_number,
    business_name: settings.business_name || "Chalin 03 Company Limited",
    business_address:
      settings.business_address ||
      settings.branch_location ||
      user?.branch_location ||
      "",
    business_phone: settings.business_phone || null,
    momo_number: settings.business_phone || null,
    owner_phone: settings.owner_phone || null,
    staff: {
      id: sale.staff_id || user?.id || null,
      full_name: sale.staff_name || user?.full_name || null,
      username: user?.username || null,
    },
    customer: {
      id: customer?.id || sale.customer_id || null,
      name: sale.customer_name || "Walk-in Customer",
      phone: sale.customer_phone || null,
      location: customer?.location || null,
    },
    customer_name: sale.customer_name || "Walk-in Customer",
    customer_phone: sale.customer_phone || null,
    items: items.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
    })),
    subtotal: sale.subtotal,
    discount_amount: sale.discount_amount,
    taxable_amount: Number(
      (Number(sale.subtotal || 0) - Number(sale.discount_amount || 0)).toFixed(2)
    ),
    tax_rate: Number(settings.tax_rate || 0),
    tax_amount: sale.tax_amount,
    total: sale.total,
    payment_type: sale.payment_type,
    payment_allocations: paymentAllocations || sale.payment_allocations || { cash: 0, momo: 0, bank: 0, other: 0 },
    amount_tendered: sale.amount_tendered,
    amount_paid: sale.amount_paid,
    change_due: sale.change_due,
    balance: sale.balance,
    debt,
    created_at: sale.created_at || new Date().toISOString(),
    edited_at: sale.edited_at || null,
    edit_reason: sale.edit_reason || null,
  };
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
  const parsedDays = Number(daysToAdd);
  const days = Number.isFinite(parsedDays) ? parsedDays : 7;
  date.setUTCDate(date.getUTCDate() + days);

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

// GET /api/sales/customers?search=name-or-phone
// Returns reusable customer identity records for the selected Spare Parts store.
// Financial amounts and purchased items remain transaction-specific and are never copied.
router.get("/customers", requireAuth, async (req, res) => {
  try {
    const branchId = requireSelectedBranch(req, res);
    if (!branchId) return;

    const search = cleanText(req.query.search);
    const params = [branchId];
    let searchSql = "";

    if (search) {
      const term = `%${search}%`;
      searchSql = " AND (c.name LIKE ? OR c.phone LIKE ? OR c.location LIKE ?)";
      params.push(term, term, term);
    }

    const [customers] = await pool.query(
      `SELECT
         c.id,
         c.branch_id,
         c.name,
         c.phone,
         c.location,
         c.created_at,
         c.updated_at,
         (
           SELECT COUNT(*)
           FROM sales s
           WHERE s.customer_id = c.id
             AND s.branch_id = c.branch_id
             AND s.sale_status = 'completed'
             AND COALESCE(s.is_voided, 0) = 0
         ) AS purchase_count,
         (
           SELECT MAX(s.created_at)
           FROM sales s
           WHERE s.customer_id = c.id
             AND s.branch_id = c.branch_id
             AND s.sale_status = 'completed'
             AND COALESCE(s.is_voided, 0) = 0
         ) AS last_purchase_at,
         COALESCE((
           SELECT SUM(s.total)
           FROM sales s
           WHERE s.customer_id = c.id
             AND s.branch_id = c.branch_id
             AND s.sale_status = 'completed'
             AND COALESCE(s.is_voided, 0) = 0
         ), 0) AS total_spent,
         COALESCE((
           SELECT SUM(d.balance)
           FROM debts d
           WHERE d.customer_id = c.id
             AND d.branch_id = c.branch_id
             AND d.balance > 0
         ), 0) AS outstanding_balance
       FROM customers c
       WHERE c.branch_id = ?${searchSql}
       ORDER BY last_purchase_at IS NULL, last_purchase_at DESC, c.name ASC
       LIMIT 25`,
      params
    );

    return res.json({
      status: "success",
      count: customers.length,
      customers,
    });
  } catch (error) {
    console.error("Search Spare Parts customers error:", error);
    return res.status(500).json({
      status: "error",
      message: "Could not search saved customers.",
    });
  }
});

async function findOrCreateCustomer(
  connection,
  branchId,
  customerId,
  customerName,
  customerPhone,
  customerLocation
) {
  const cleanId = toPositiveInt(customerId);
  const cleanName = cleanText(customerName);
  const cleanPhone = cleanText(customerPhone);
  const cleanLocation = cleanText(customerLocation);

  if (cleanId) {
    const [selectedCustomers] = await connection.query(
      `SELECT id, branch_id, name, phone, location
       FROM customers
       WHERE id = ? AND branch_id = ?
       LIMIT 1
       FOR UPDATE`,
      [cleanId, branchId]
    );

    if (selectedCustomers.length === 0) {
      const error = new Error(
        "The selected customer was not found in this store. Search again or use New Customer."
      );
      error.statusCode = 404;
      error.code = "CUSTOMER_NOT_FOUND_IN_STORE";
      throw error;
    }

    const selectedCustomer = selectedCustomers[0];
    const finalName = cleanName || selectedCustomer.name;
    const finalPhone = cleanPhone || selectedCustomer.phone;
    const finalLocation = cleanLocation || selectedCustomer.location;

    if (
      finalName !== selectedCustomer.name ||
      finalPhone !== selectedCustomer.phone ||
      finalLocation !== selectedCustomer.location
    ) {
      await connection.query(
        `UPDATE customers
         SET name = ?, phone = ?, location = ?
         WHERE id = ? AND branch_id = ?`,
        [finalName, finalPhone, finalLocation, cleanId, branchId]
      );
    }

    return {
      ...selectedCustomer,
      name: finalName,
      phone: finalPhone,
      location: finalLocation,
    };
  }

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
      const finalName = cleanName || existingCustomer.name;
      const finalLocation = cleanLocation || existingCustomer.location;

      if (
        finalName !== existingCustomer.name ||
        finalLocation !== existingCustomer.location
      ) {
        await connection.query(
          `UPDATE customers
           SET name = ?, location = ?
           WHERE id = ? AND branch_id = ?`,
          [finalName, finalLocation, existingCustomer.id, branchId]
        );
      }

      return {
        ...existingCustomer,
        name: finalName,
        location: finalLocation,
      };
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
router.post("/", requireAuth, validateRequest(validateSaleCreateRequest), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

    const {
      customer_id,
      customer_name,
      customer_phone,
      customer_location,
      payment_type,
      amount_tendered,
      amount_paid,
      discount_amount,
      payment_allocations,
      installment_plan,
      items,
    } = req.validated.body;

    const cleanCustomerName = cleanText(customer_name);
    const cleanCustomerPhone = cleanText(customer_phone);
    const cleanCustomerLocation = cleanText(customer_location);

    const allowedPaymentTypes = ["cash", "momo", "bank", "credit", "mixed", "installment"];

    if (!allowedPaymentTypes.includes(payment_type)) {
      return res.status(400).json({
        status: "error",
        message: "payment_type must be cash, momo, bank, credit, mixed, or installment.",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Sale must contain at least one item.",
      });
    }

    const duplicateProductId = findDuplicateProductId(items);

    if (duplicateProductId) {
      return res.status(400).json({
        status: "error",
        message:
          "The same product cannot appear more than once in one sale. Update its quantity instead.",
      });
    }

    const discountAmount = toNonNegativeNumber(discount_amount ?? 0);

    if (discountAmount === null) {
      return res.status(400).json({
        status: "error",
        message: "Discount must be a valid number and cannot be negative.",
      });
    }

    if (
      (["credit", "mixed", "installment"].includes(payment_type)) &&
      !cleanCustomerName &&
      !cleanCustomerPhone
    ) {
      return res.status(400).json({
        status: "error",
        message: "Customer name and phone are required for credit, mixed, or installment sales.",
      });
    }

    if (
      payment_type === "installment" &&
      (!cleanCustomerName || !cleanCustomerPhone)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Installment sales require both the customer name and a valid phone number.",
      });
    }

    await connection.beginTransaction();

    // Serialize new sales against Daily Closing for this store so a sale
    // cannot slip in while the closing snapshot is being committed.
    await connection.query(
      `SELECT id FROM branches WHERE id = ? LIMIT 1 FOR UPDATE`,
      [branchId]
    );

    const lockedPeriod = await findApprovedAuditLockForDate(
      connection,
      branchId,
      new Date()
    );

    if (lockedPeriod) {
      await connection.rollback();

      return sendAuditLockedResponse(res, lockedPeriod, "record a sale");
    }

    const today = new Date().toISOString().slice(0, 10);
    const [closedDayRows] = await connection.query(
      `SELECT id, verification_status
       FROM daily_closings
       WHERE branch_id = ? AND closing_date = ?
       LIMIT 1
       FOR UPDATE`,
      [branchId, today]
    );

    if (closedDayRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        message: "Today has already been closed for this store. A new sale cannot be added after Daily Closing. Ask a manager to review the closing before recording any further transaction.",
        closing_id: closedDayRows[0].id,
      });
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
          is_active,
          inventory_tracking_mode,
          inventory_traceability_state
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
        inventory_tracking_mode: product.inventory_tracking_mode || "quantity",
        inventory_traceability_state: product.inventory_traceability_state || "off",
        unit_ids: Array.isArray(item.unit_ids) ? item.unit_ids : [],
      });
    }

    // Lock every selected physical identity before any sale/payment record is committed.
    // Enforced serialized products require an exact one-ID-per-unit match here.
    const saleTraceabilitySelections = await lockSaleTraceabilitySelections(connection, {
      branchId,
      saleItems,
    });

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
    const payment = calculateSalePayment(
      payment_type,
      amount_tendered,
      amount_paid,
      total
    );

    if (payment.error) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message: payment.error,
      });
    }

    const allocationResult = normalizePaymentAllocations(
      payment_type,
      payment,
      payment_allocations
    );

    if (allocationResult.error) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: allocationResult.error });
    }

    const customer = await findOrCreateCustomer(
      connection,
      branchId,
      customer_id,
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
        amount_tendered,
        amount_paid,
        change_due,
        balance,
        sale_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
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
        payment.amount_tendered,
        payment.amount_paid,
        payment.change_due,
        payment.balance,
      ]
    );

    const saleId = saleResult.insertId;

    await replaceSalePaymentAllocations(connection, {
      branchId,
      saleId,
      userId: req.user.id,
      allocations: allocationResult.allocations,
    });

    for (const saleItem of saleItems) {
      const [saleItemResult] = await connection.query(
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

      const traceabilitySelection = saleTraceabilitySelections.get(Number(saleItem.product_id));
      const soldUnits = await markSaleUnitsSold(connection, {
        branchId,
        saleId,
        saleItemId: saleItemResult.insertId,
        productId: saleItem.product_id,
        unitCodes: traceabilitySelection?.unit_codes || [],
        actorUserId: req.user.id,
        receiptNumber,
        customerName: finalCustomerName,
        requestId: req.requestId || req.id || null,
      });
      saleItem.unit_ids = soldUnits.map((unit) => unit.unit_code);

      await connection.query(
        `UPDATE products
         SET quantity = quantity - ?
         WHERE id = ?
         AND branch_id = ?`,
        [saleItem.quantity, saleItem.product_id, branchId]
      );
    }

    let debt = null;

    if (payment.balance > 0 || payment_type === "credit" || payment_type === "mixed") {
      const debtStatus = getDebtStatus(payment.balance, payment.amount_paid);
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
          payment.amount_paid,
          payment.balance,
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
        amount_paid: payment.amount_paid,
        balance: payment.balance,
        status: debtStatus,
        due_date: dueDate,
      };
    }

    let installment = null;

    if (payment_type === "installment") {
      installment = await createAgreementForSale(connection, {
        branchId,
        branchCode: req.user?.branch_code || req.user?.selected_branch?.code,
        saleId,
        debtId: debt?.id || null,
        customer: {
          id: customer?.id || null,
          name: finalCustomerName,
          phone: finalCustomerPhone,
          location: cleanCustomerLocation || customer?.location || null,
        },
        saleItems,
        total,
        deposit: payment.amount_paid,
        plan: installment_plan || {},
        userId: req.user.id,
      });
    }

    await writeAuditEvent({
      connection,
      req,
      branchId,
      action: "CREATE_SALE",
      details: `Created sale ${receiptNumber} for ${finalCustomerName} with total GHS ${total} and discount GHS ${discountAmount}`,
      workspaceCode: "spare_parts",
      entityType: "sale",
      entityId: saleId,
      actionType: "CREATE_SALE",
      outcome: "success",
      severity: "notice",
      metadata: {
        receipt_number: receiptNumber,
        total,
        amount_paid: payment.amount_paid,
        balance: payment.balance,
        payment_allocations: allocationResult.allocations,
        installment_agreement_number: installment?.agreement_number || null,
      },
    });

    await connection.commit();

    let installmentSms = null;
    if (installment?.id) {
      try {
        installmentSms = await sendInstallmentEventSms({
          agreementId: installment.id,
          branchId,
          type: "agreement_created",
          details: {
            outstanding_balance: installment.outstanding_balance,
            event_key: saleId,
          },
          sentBy: req.user.id,
        });
      } catch (smsError) {
        installmentSms = {
          success: false,
          status: "failed",
          error: smsError.message,
        };
      }
    }

    return res.status(201).json({
      status: "success",
      message: "Sale recorded successfully.",
      installment,
      installment_sms: installmentSms,
      receipt: buildReceiptPayload({
        sale: {
          id: saleId,
          receipt_number: receiptNumber,
          staff_id: req.user.id,
          customer_id: customer ? customer.id : null,
          customer_name: finalCustomerName,
          customer_phone: finalCustomerPhone,
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total,
          payment_type,
          amount_tendered: payment.amount_tendered,
          amount_paid: payment.amount_paid,
          change_due: payment.change_due,
          balance: payment.balance,
          created_at: new Date().toISOString(),
        },
        items: saleItems,
        debt,
        settings,
        branchId,
        user: req.user,
        customer,
        paymentAllocations: allocationResult.allocations,
      }),
    });
  } catch (error) {
    await connection.rollback();

    console.error("Create sale error:", error);

    return res.status(error.statusCode || 500).json({
      status: "error",
      code: error.code || undefined,
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

    const { search, from, to, product_search, product_id } = req.query;
    const cleanSearch = cleanText(search);
    const productFilter = getProductSearchInfo(product_search, product_id);

    const params = [];

    const matchedProductSelect = productFilter.active
      ? `
        (
          SELECT GROUP_CONCAT(
            CONCAT(si_match.product_name, ' x', si_match.quantity)
            ORDER BY si_match.id
            SEPARATOR ', '
          )
          FROM sale_items si_match
          WHERE si_match.sale_id = s.id
          AND (
            si_match.product_name LIKE ?
            OR si_match.product_id = ?
          )
        ) AS matched_products,
        (
          SELECT COALESCE(SUM(si_match.quantity), 0)
          FROM sale_items si_match
          WHERE si_match.sale_id = s.id
          AND (
            si_match.product_name LIKE ?
            OR si_match.product_id = ?
          )
        ) AS matched_product_quantity,
        (
          SELECT COALESCE(SUM(si_match.line_total), 0)
          FROM sale_items si_match
          WHERE si_match.sale_id = s.id
          AND (
            si_match.product_name LIKE ?
            OR si_match.product_id = ?
          )
        ) AS matched_product_total,
      `
      : `
        NULL AS matched_products,
        0 AS matched_product_quantity,
        0 AS matched_product_total,
      `;

    if (productFilter.active) {
      params.push(
        productFilter.like,
        productFilter.productId,
        productFilter.like,
        productFilter.productId,
        productFilter.like,
        productFilter.productId
      );
    }

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
        s.amount_tendered,
        s.amount_paid,
        s.change_due,
        s.balance,
        s.sale_status,
        s.is_voided,
        s.void_reason,
        s.voided_at,
        s.created_at,
        u.full_name AS staff_name,
        vu.full_name AS voided_by_name,
        (
          SELECT GROUP_CONCAT(
            CONCAT(si_all.product_name, ' x', si_all.quantity)
            ORDER BY si_all.id
            SEPARATOR ', '
          )
          FROM sale_items si_all
          WHERE si_all.sale_id = s.id
        ) AS sold_products,
        (
          SELECT COALESCE(SUM(si_all.quantity), 0)
          FROM sale_items si_all
          WHERE si_all.sale_id = s.id
        ) AS total_items_sold,
        (
          SELECT COALESCE(SUM(si_all.line_total), 0)
          FROM sale_items si_all
          WHERE si_all.sale_id = s.id
        ) AS total_items_value,
        ${matchedProductSelect}
        CASE
          WHEN s.is_voided = 1 OR s.sale_status IN ('cancelled', 'voided')
          THEN 1
          ELSE 0
        END AS sale_is_voided
      FROM sales s
      LEFT JOIN branches b ON s.branch_id = b.id
      LEFT JOIN users u ON s.staff_id = u.id
      LEFT JOIN users vu ON s.voided_by = vu.id
      WHERE s.branch_id = ?
    `;

    params.push(branchId);

    if (cleanSearch) {
      sql += `
        AND (
          s.receipt_number LIKE ?
          OR s.customer_name LIKE ?
          OR s.customer_phone LIKE ?
          OR EXISTS (
            SELECT 1
            FROM sale_items si_search
            WHERE si_search.sale_id = s.id
            AND si_search.product_name LIKE ?
          )
        )
      `;

      const searchValue = `%${cleanSearch}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    if (productFilter.active) {
      sql += `
        AND EXISTS (
          SELECT 1
          FROM sale_items si_filter
          WHERE si_filter.sale_id = s.id
          AND (
            si_filter.product_name LIKE ?
            OR si_filter.product_id = ?
          )
        )
      `;

      params.push(productFilter.like, productFilter.productId);
    }

    if (from) {
      sql += ` AND DATE(s.created_at) >= ?`;
      params.push(from);
    }

    if (to) {
      sql += ` AND DATE(s.created_at) <= ?`;
      params.push(to);
    }

    sql += ` ORDER BY s.created_at DESC LIMIT 250`;

    const [sales] = await pool.query(sql, params);

    const activeSales = sales.filter(
      (sale) =>
        Number(sale.is_voided || sale.sale_is_voided || 0) !== 1 &&
        !["cancelled", "voided"].includes(
          String(sale.sale_status || "").toLowerCase()
        )
    );

    const productSummary = productFilter.active
      ? {
          product_search: productFilter.text || String(product_id || ""),
          receipt_count: activeSales.length,
          quantity_sold: activeSales.reduce(
            (sum, sale) => sum + Number(sale.matched_product_quantity || 0),
            0
          ),
          sales_value: activeSales.reduce(
            (sum, sale) => sum + Number(sale.matched_product_total || 0),
            0
          ),
        }
      : null;

    return res.json({
      status: "success",
      branch_id: branchId,
      branch: getBranchInfo(req),
      count: sales.length,
      filters: {
        search: cleanSearch || "",
        from: from || "",
        to: to || "",
        product_search: productFilter.text || "",
        product_id: product_id || "",
      },
      product_summary: productSummary,
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

    const paymentAllocations = await getSalePaymentAllocations(pool, id);
    const [changeHistory] = await pool.query(
      `SELECT
        sch.id,
        sch.change_type,
        sch.reason,
        sch.before_snapshot_json,
        sch.after_snapshot_json,
        sch.created_at,
        changer.full_name AS changed_by_name,
        approver.full_name AS approved_by_name,
        sch.affected_closing_id
       FROM sale_change_history sch
       LEFT JOIN users changer ON sch.changed_by = changer.id
       LEFT JOIN users approver ON sch.approved_by = approver.id
       WHERE sch.sale_id = ? AND sch.branch_id = ?
       ORDER BY sch.created_at DESC, sch.id DESC`,
      [id, branchId]
    );

    return res.json({
      status: "success",
      branch_id: branchId,
      sale: sales[0],
      items,
      debt: debts.length > 0 ? debts[0] : null,
      payment_allocations: paymentAllocations,
      change_history: changeHistory,
    });
  } catch (error) {
    console.error("Get single sale error:", error);

    return res.status(500).json({
      status: "error",
      message: "Something went wrong while fetching the sale.",
    });
  }
});

// PUT /api/sales/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = requireSelectedBranch(req, res);

    if (!branchId) {
      return;
    }

    const { id } = req.params;
    const {
      customer_name,
      customer_phone,
      customer_location,
      payment_type,
      amount_tendered,
      amount_paid,
      discount_amount,
      payment_allocations,
      items,
      edit_reason,
      approver_username,
      approver_password,
    } = req.body;

    const cleanReason = cleanText(edit_reason);

    if (!cleanReason) {
      return res.status(400).json({
        status: "error",
        message: "Edit reason is required.",
      });
    }

    const allowedPaymentTypes = ["cash", "momo", "bank", "credit", "mixed", "installment"];

    if (!allowedPaymentTypes.includes(payment_type)) {
      return res.status(400).json({
        status: "error",
        message: "payment_type must be cash, momo, bank, credit, mixed, or installment.",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Sale must contain at least one item.",
      });
    }

    const duplicateProductId = findDuplicateProductId(items);

    if (duplicateProductId) {
      return res.status(400).json({
        status: "error",
        message:
          "The same product cannot appear more than once in one sale. Update its quantity instead.",
      });
    }

    const cleanCustomerName = cleanText(customer_name);
    const cleanCustomerPhone = cleanText(customer_phone);
    const cleanCustomerLocation = cleanText(customer_location);
    const discountAmount = toNonNegativeNumber(discount_amount ?? 0);

    if (discountAmount === null) {
      return res.status(400).json({
        status: "error",
        message: "Discount must be a valid number and cannot be negative.",
      });
    }

    if (
      (["credit", "mixed", "installment"].includes(payment_type)) &&
      !cleanCustomerName &&
      !cleanCustomerPhone
    ) {
      return res.status(400).json({
        status: "error",
        message: "Customer name or phone is required for credit/mixed sales.",
      });
    }

    await connection.beginTransaction();

    const approvalResult = await verifyIndependentApprover(connection, {
      currentUserId: req.user.id,
      branchId,
      approverUsername: approver_username,
      approverPassword: approver_password,
    });

    if (approvalResult.error) {
      await connection.rollback();
      return res.status(403).json({ status: "error", message: approvalResult.error });
    }

    const approver = approvalResult.approver;

    const [sales] = await connection.query(
      `SELECT *
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

    if (sale.payment_type === "installment" || payment_type === "installment") {
      await connection.rollback();
      return res.status(409).json({
        status: "error",
        code: "INSTALLMENT_AGREEMENT_CONTROL_REQUIRED",
        message:
          "Installment sales cannot be converted or edited through the general sale editor. Use the Installment Sales workspace for payments, rescheduling, delivery, cancellation and corrections.",
      });
    }

    const beforeSnapshot = await loadCompleteSaleSnapshot(connection, id, branchId);

    const lockedPeriod = await findApprovedAuditLockForDate(
      connection,
      branchId,
      sale.created_at
    );

    if (lockedPeriod) {
      await connection.rollback();
      return sendAuditLockedResponse(res, lockedPeriod, "edit a sale");
    }

    if (
      Number(sale.is_voided) === 1 ||
      sale.sale_status === "cancelled" ||
      sale.sale_status === "voided"
    ) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message: "Voided or deleted sales cannot be edited.",
      });
    }

    const [returnRows] = await connection.query(
      `SELECT COUNT(*) AS return_count
       FROM returns
       WHERE sale_id = ?
       AND branch_id = ?`,
      [id, branchId]
    );

    if (Number(returnRows[0]?.return_count || 0) > 0) {
      await connection.rollback();

      return res.status(409).json({
        status: "error",
        message:
          "This sale already has returns. Edit is blocked to avoid unsafe stock and accounting reconciliation.",
      });
    }

    const [existingDebts] = await connection.query(
      `SELECT id
       FROM debts
       WHERE sale_id = ?
       AND branch_id = ?
       LIMIT 1
       FOR UPDATE`,
      [id, branchId]
    );

    if (existingDebts.length > 0) {
      const [recordedDebtPayments] = await connection.query(
        `SELECT id
         FROM debt_payments
         WHERE debt_id = ?
         AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [existingDebts[0].id, branchId]
      );

      if (recordedDebtPayments.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          status: "error",
          message:
            "This sale already has recorded debt payments. Editing is blocked to protect the payment history. Void it through the approved accounting process or contact the system administrator.",
        });
      }
    }

    const [originalItems] = await connection.query(
      `SELECT *
       FROM sale_items
       WHERE sale_id = ?
       ORDER BY id ASC
       FOR UPDATE`,
      [id]
    );

    for (const item of originalItems) {
      await connection.query(
        `UPDATE products
         SET quantity = quantity + ?
         WHERE id = ?
         AND branch_id = ?`,
        [Number(item.quantity || 0), item.product_id, branchId]
      );
    }

    const settings = await getSettings(connection, branchId);
    const taxRate = Number(settings.tax_rate || 0);
    const saleItems = [];
    let subtotal = 0;

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = toPositiveInt(Number(item.quantity));
      const requestedUnitPrice = toNonNegativeNumber(item.unit_price);

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

      const unitPrice =
        requestedUnitPrice !== null ? requestedUnitPrice : Number(product.selling_price);
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
    const payment = calculateSalePayment(
      payment_type,
      amount_tendered,
      amount_paid,
      total
    );

    if (payment.error) {
      await connection.rollback();

      return res.status(400).json({
        status: "error",
        message: payment.error,
      });
    }

    const allocationResult = normalizePaymentAllocations(
      payment_type,
      payment,
      payment_allocations
    );
    if (allocationResult.error) {
      await connection.rollback();
      return res.status(400).json({ status: "error", message: allocationResult.error });
    }

    const customer = await findOrCreateCustomer(
      connection,
      branchId,
      cleanCustomerName,
      cleanCustomerPhone,
      cleanCustomerLocation
    );
    const finalCustomerName =
      cleanCustomerName || customer?.name || sale.customer_name || "Walk-in Customer";
    const finalCustomerPhone =
      cleanCustomerPhone || customer?.phone || sale.customer_phone || null;

    await connection.query(`DELETE FROM sale_items WHERE sale_id = ?`, [id]);

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
          id,
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

    await connection.query(
      `UPDATE sales
       SET customer_id = ?,
           customer_name = ?,
           customer_phone = ?,
           subtotal = ?,
           discount_amount = ?,
           tax_amount = ?,
           total = ?,
           payment_type = ?,
           amount_tendered = ?,
           amount_paid = ?,
           change_due = ?,
           balance = ?,
           edited_by = ?,
           edited_at = NOW(),
           edit_reason = ?
       WHERE id = ?
       AND branch_id = ?`,
      [
        customer ? customer.id : sale.customer_id || null,
        finalCustomerName,
        finalCustomerPhone,
        subtotal,
        discountAmount,
        taxAmount,
        total,
        payment_type,
        payment.amount_tendered,
        payment.amount_paid,
        payment.change_due,
        payment.balance,
        req.user.id,
        cleanReason,
        id,
        branchId,
      ]
    );

    await replaceSalePaymentAllocations(connection, {
      branchId,
      saleId: Number(id),
      userId: req.user.id,
      allocations: allocationResult.allocations,
    });

    if (payment.balance > 0 || payment_type === "credit" || payment_type === "mixed") {
      const debtStatus = getDebtStatus(payment.balance, payment.amount_paid);
      const dueDate = calculateDueDate(settings.debt_reminder_days);

      if (existingDebts.length > 0) {
        await connection.query(
          `UPDATE debts
           SET customer_id = ?,
               customer_name = ?,
               customer_phone = ?,
               amount_owed = ?,
               amount_paid = ?,
               balance = ?,
               status = ?,
               due_date = ?
           WHERE id = ?
           AND branch_id = ?`,
          [
            customer ? customer.id : sale.customer_id || null,
            finalCustomerName,
            finalCustomerPhone,
            total,
            payment.amount_paid,
            payment.balance,
            debtStatus,
            dueDate,
            existingDebts[0].id,
            branchId,
          ]
        );
      } else {
        await connection.query(
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
            id,
            customer ? customer.id : sale.customer_id || null,
            finalCustomerName,
            finalCustomerPhone,
            total,
            payment.amount_paid,
            payment.balance,
            debtStatus,
            dueDate,
          ]
        );
      }
    } else {
      await connection.query(
        `UPDATE debts
         SET amount_owed = ?,
             amount_paid = ?,
             balance = 0,
             status = 'paid'
         WHERE sale_id = ?
         AND branch_id = ?`,
        [total, total, id, branchId]
      );
    }

    const afterSnapshot = await loadCompleteSaleSnapshot(connection, id, branchId);
    const affectedClosing = await markAffectedClosingStale(connection, {
      branchId,
      transactionDate: sale.created_at,
      reason: `Sale ${sale.receipt_number} changed after completion. ${cleanReason}`,
      sourceEntityType: "sale",
      sourceEntityId: id,
      changedBy: req.user.id,
      approvedBy: approver.id,
    });

    await connection.query(
      `INSERT INTO sale_change_history (
        branch_id, sale_id, change_type, reason, before_snapshot_json,
        after_snapshot_json, changed_by, approved_by, affected_closing_id
      ) VALUES (?, ?, 'edit', ?, ?, ?, ?, ?, ?)`,
      [
        branchId,
        id,
        cleanReason,
        JSON.stringify(beforeSnapshot),
        JSON.stringify(afterSnapshot),
        req.user.id,
        approver.id,
        affectedClosing?.id || null,
      ]
    );

    await writeAuditEvent({
      connection,
      req,
      branchId,
      action: "EDIT_SALE",
      details: `Edited sale ${sale.receipt_number} under dual approval. Reason: ${cleanReason}. Before total GHS ${sale.total}, after total GHS ${total}. Approved by ${approver.full_name || approver.username}.`,
      workspaceCode: "spare_parts",
      entityType: "sale",
      entityId: id,
      actionType: "EDIT_SALE",
      outcome: "success",
      severity: "critical",
      metadata: {
        receipt_number: sale.receipt_number,
        before_total: sale.total,
        after_total: total,
        payment_allocations: allocationResult.allocations,
        approved_by_user_id: approver.id,
        approved_by_username: approver.username,
        affected_closing_id: affectedClosing?.id || null,
      },
    });

    const [debts] = await connection.query(
      `SELECT *
       FROM debts
       WHERE sale_id = ?
       AND branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    await connection.commit();

    return res.json({
      status: "success",
      message: "Sale edited successfully.",
      receipt: buildReceiptPayload({
        sale: {
          ...sale,
          id: Number(id),
          customer_id: customer ? customer.id : sale.customer_id || null,
          customer_name: finalCustomerName,
          customer_phone: finalCustomerPhone,
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total,
          payment_type,
          amount_tendered: payment.amount_tendered,
          amount_paid: payment.amount_paid,
          change_due: payment.change_due,
          balance: payment.balance,
          edited_at: new Date().toISOString(),
          edit_reason: cleanReason,
        },
        items: saleItems,
        debt: debts.length > 0 ? debts[0] : null,
        settings,
        branchId,
        user: req.user,
        customer,
        paymentAllocations: allocationResult.allocations,
      }),
      affected_closing: affectedClosing,
    });
  } catch (error) {
    await connection.rollback();

    console.error("Edit sale error:", error);

    return res.status(500).json({
      status: "error",
      message:
        "Something went wrong while editing the sale. No changes were saved.",
    });
  } finally {
    connection.release();
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
      const { reason, approver_username, approver_password } = req.body;
      const cleanReason = cleanText(reason);

      if (!cleanReason) {
        return res.status(400).json({
          status: "error",
          message: "Void reason is required.",
        });
      }

      await connection.beginTransaction();

      const approvalResult = await verifyIndependentApprover(connection, {
        currentUserId: req.user.id,
        branchId,
        approverUsername: approver_username,
        approverPassword: approver_password,
      });
      if (approvalResult.error) {
        await connection.rollback();
        return res.status(403).json({ status: "error", message: approvalResult.error });
      }
      const approver = approvalResult.approver;

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
      const beforeSnapshot = await loadCompleteSaleSnapshot(connection, id, branchId);

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

      const [returnRows] = await connection.query(
        `SELECT COUNT(*) AS return_count
         FROM returns
         WHERE sale_id = ? AND branch_id = ?`,
        [id, branchId]
      );
      if (Number(returnRows[0]?.return_count || 0) > 0) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This sale already has a protected return or refund. Voiding is blocked to prevent double stock or cash adjustment.",
        });
      }

      const [debtPaymentRows] = await connection.query(
        `SELECT COUNT(*) AS payment_count
         FROM debt_payments dp
         INNER JOIN debts d ON dp.debt_id = d.id AND dp.branch_id = d.branch_id
         WHERE d.sale_id = ? AND d.branch_id = ?`,
        [id, branchId]
      );
      if (Number(debtPaymentRows[0]?.payment_count || 0) > 0) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This sale already has debt-payment history. Voiding is blocked to preserve the collection trail.",
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

      const afterSnapshot = await loadCompleteSaleSnapshot(connection, id, branchId);
      const affectedClosing = await markAffectedClosingStale(connection, {
        branchId,
        transactionDate: sale.created_at,
        reason: `Sale ${sale.receipt_number} was voided after completion. ${cleanReason}`,
        sourceEntityType: "sale",
        sourceEntityId: id,
        changedBy: req.user.id,
        approvedBy: approver.id,
      });

      await connection.query(
        `INSERT INTO sale_change_history (
          branch_id, sale_id, change_type, reason, before_snapshot_json,
          after_snapshot_json, changed_by, approved_by, affected_closing_id
        ) VALUES (?, ?, 'void', ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          id,
          cleanReason,
          JSON.stringify(beforeSnapshot),
          JSON.stringify(afterSnapshot),
          req.user.id,
          approver.id,
          affectedClosing?.id || null,
        ]
      );

      await writeAuditEvent({
        connection,
        req,
        branchId,
        action: "VOID_SALE",
        details: `Voided sale ${sale.receipt_number} under dual approval. Reason: ${cleanReason}. Approved by ${approver.full_name || approver.username}.`,
        workspaceCode: "spare_parts",
        entityType: "sale",
        entityId: id,
        actionType: "VOID_SALE",
        outcome: "success",
        severity: "critical",
        metadata: {
          receipt_number: sale.receipt_number,
          reason: cleanReason,
          approved_by_user_id: approver.id,
          approved_by_username: approver.username,
          affected_closing_id: affectedClosing?.id || null,
        },
      });

      await connection.commit();

      await sendSaleVoidedSecuritySmsAlert({
        sale,
        voidedByUser: req.user,
        branchId,
        reason: cleanReason,
      });

      return res.json({
        status: "success",
        message: "Sale voided successfully under independent approval. Stock has been restored.",
        affected_closing: affectedClosing,
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
