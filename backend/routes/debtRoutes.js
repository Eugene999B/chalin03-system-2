const crypto = require("node:crypto");
const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const { markClosingStale } = require("../services/dailyClosingSecurityService");
const { validateRequest } = require("../middleware/requestValidationMiddleware");
const { validateDebtPaymentRequest } = require("../validation/requestValidators");

const router = express.Router();

function appError(message, statusCode = 400, code = "DEBT_DESK_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getBranchId(req) {
  const branchId = Number(req.user?.branch_id || req.user?.default_branch_id || 0);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
}

function toPositiveMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Number(number.toFixed(2));
}

function cleanPaymentMethod(value) {
  const method = String(value || "cash").trim().toLowerCase();
  return ["cash", "momo", "bank"].includes(method) ? method : "cash";
}

function cleanText(value, maxLength = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function getDebtStatus(balance, amountPaid = 0) {
  if (Number(balance || 0) <= 0) return "paid";
  return Number(amountPaid || 0) > 0 ? "partial" : "unpaid";
}

function toDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function makePaymentReference(branchId) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `DEBT-${branchId}-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function cleanPaymentRequestKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(key)) {
    throw appError(
      "The payment request reference is invalid. Refresh the Debt Desk and try again.",
      400,
      "INVALID_DEBT_PAYMENT_REQUEST_KEY"
    );
  }
  return key;
}

async function findExistingCustomerPaymentRequest(connection, branchId, requestToken) {
  const [rows] = await connection.query(
    `SELECT id, debt_id, amount, paid_at
     FROM debt_payments
     WHERE branch_id = ?
       AND LEFT(notes, ?) = ?
     ORDER BY id ASC
     LIMIT 1
     FOR UPDATE`,
    [branchId, requestToken.length, requestToken]
  );
  return rows[0] || null;
}

function parseCustomerKey(value) {
  const key = String(value || "").trim().toLowerCase();
  const linked = /^customer-(\d+)$/.exec(key);
  if (linked) {
    return { type: "customer", id: Number(linked[1]), key };
  }

  const legacy = /^legacy-(\d+)$/.exec(key);
  if (legacy) {
    return { type: "legacy", id: Number(legacy[1]), key };
  }

  throw appError("The selected debt customer is invalid.", 400, "INVALID_DEBT_CUSTOMER");
}

async function logActivity(
  connection,
  { req, branchId, userId, action, details, entityType = "debt", entityId = null, metadata = null }
) {
  await writeAuditEvent({
    connection,
    req,
    branchId: branchId || null,
    userId: userId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType,
    entityId,
    actionType: action,
    outcome: "success",
    severity: "notice",
    metadata,
  });
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
           OR (period_start IS NOT NULL AND period_end IS NOT NULL AND ? BETWEEN period_start AND period_end)
           OR (period_start IS NOT NULL AND period_end IS NULL AND ? >= period_start)
           OR (period_start IS NULL AND period_end IS NOT NULL AND ? <= period_end)
         )
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
      [branchId, dateOnly, dateOnly, dateOnly]
    );

    return locks[0] || null;
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error?.code)) return null;
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

function currentIdentitySelect() {
  return `
    COALESCE(NULLIF(s.customer_name, ''), NULLIF(c.name, ''), NULLIF(d.customer_name, ''), 'Unnamed Customer') AS customer_name,
    COALESCE(NULLIF(s.customer_phone, ''), NULLIF(c.phone, ''), NULLIF(d.customer_phone, '')) AS customer_phone,
    c.location AS customer_location,
    d.customer_name AS debt_customer_name_snapshot,
    d.customer_phone AS debt_customer_phone_snapshot,
    s.customer_name AS sale_customer_name,
    s.customer_phone AS sale_customer_phone,
    COALESCE(s.customer_id, d.customer_id) AS effective_customer_id
  `;
}

async function loadDebtDeskAccounts(branchId, { includePaid = false } = {}) {
  const [linked] = await pool.query(
    `SELECT
       CONCAT('customer-', COALESCE(s.customer_id, d.customer_id)) AS customer_key,
       COALESCE(s.customer_id, d.customer_id) AS customer_id,
       COALESCE(
         MAX(CASE
           WHEN NULLIF(s.customer_name, '') IS NOT NULL
            AND TRIM(s.customer_name) <> TRIM(COALESCE(d.customer_name, ''))
           THEN s.customer_name
         END),
         MAX(NULLIF(c.name, '')),
         MAX(NULLIF(s.customer_name, '')),
         MAX(NULLIF(d.customer_name, '')),
         'Unnamed Customer'
       ) AS customer_name,
       COALESCE(
         MAX(CASE
           WHEN NULLIF(s.customer_phone, '') IS NOT NULL
            AND TRIM(s.customer_phone) <> TRIM(COALESCE(d.customer_phone, ''))
           THEN s.customer_phone
         END),
         MAX(NULLIF(c.phone, '')),
         MAX(NULLIF(s.customer_phone, '')),
         MAX(NULLIF(d.customer_phone, ''))
       ) AS customer_phone,
       MAX(c.location) AS customer_location,
       COUNT(d.id) AS debt_count,
       SUM(CASE WHEN d.balance > 0 THEN 1 ELSE 0 END) AS active_debt_count,
       SUM(CASE WHEN d.balance > 0 AND d.amount_paid > 0 THEN 1 ELSE 0 END) AS partial_debt_count,
       SUM(CASE WHEN d.balance > 0 AND d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE THEN 1 ELSE 0 END) AS overdue_count,
       COALESCE(SUM(d.amount_owed), 0) AS total_owed,
       COALESCE(SUM(d.amount_paid), 0) AS total_paid,
       COALESCE(SUM(d.balance), 0) AS outstanding_balance,
       MIN(d.created_at) AS first_debt_date,
       MAX(d.created_at) AS last_debt_date,
       MIN(CASE WHEN d.balance > 0 THEN d.due_date END) AS next_due_date,
       MAX(payment_summary.last_payment_at) AS last_payment_at,
       0 AS legacy_record
     FROM debts d
     LEFT JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     LEFT JOIN customers c
       ON c.id = COALESCE(s.customer_id, d.customer_id)
      AND c.branch_id = d.branch_id
     LEFT JOIN (
       SELECT branch_id, debt_id, MAX(paid_at) AS last_payment_at
       FROM debt_payments
       GROUP BY branch_id, debt_id
     ) payment_summary
       ON payment_summary.branch_id = d.branch_id
      AND payment_summary.debt_id = d.id
     WHERE d.branch_id = ?
       AND COALESCE(s.customer_id, d.customer_id) IS NOT NULL
     GROUP BY COALESCE(s.customer_id, d.customer_id)
     HAVING (? = 1 OR SUM(CASE WHEN d.balance > 0 THEN 1 ELSE 0 END) > 0)`,
    [branchId, includePaid ? 1 : 0]
  );

  const [legacy] = await pool.query(
    `SELECT
       CONCAT('legacy-', d.id) AS customer_key,
       NULL AS customer_id,
       COALESCE(NULLIF(s.customer_name, ''), NULLIF(d.customer_name, ''), 'Legacy Customer') AS customer_name,
       COALESCE(NULLIF(s.customer_phone, ''), NULLIF(d.customer_phone, '')) AS customer_phone,
       NULL AS customer_location,
       1 AS debt_count,
       CASE WHEN d.balance > 0 THEN 1 ELSE 0 END AS active_debt_count,
       CASE WHEN d.balance > 0 AND d.amount_paid > 0 THEN 1 ELSE 0 END AS partial_debt_count,
       CASE WHEN d.balance > 0 AND d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE THEN 1 ELSE 0 END AS overdue_count,
       d.amount_owed AS total_owed,
       d.amount_paid AS total_paid,
       d.balance AS outstanding_balance,
       d.created_at AS first_debt_date,
       d.created_at AS last_debt_date,
       CASE WHEN d.balance > 0 THEN d.due_date ELSE NULL END AS next_due_date,
       payment_summary.last_payment_at,
       1 AS legacy_record
     FROM debts d
     LEFT JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     LEFT JOIN (
       SELECT branch_id, debt_id, MAX(paid_at) AS last_payment_at
       FROM debt_payments
       GROUP BY branch_id, debt_id
     ) payment_summary
       ON payment_summary.branch_id = d.branch_id
      AND payment_summary.debt_id = d.id
     WHERE d.branch_id = ?
       AND COALESCE(s.customer_id, d.customer_id) IS NULL
       AND (? = 1 OR d.balance > 0)`,
    [branchId, includePaid ? 1 : 0]
  );

  const accounts = [...linked, ...legacy]
    .map((row) => ({
      ...row,
      customer_id: row.customer_id ? Number(row.customer_id) : null,
      debt_count: Number(row.debt_count || 0),
      active_debt_count: Number(row.active_debt_count || 0),
      partial_debt_count: Number(row.partial_debt_count || 0),
      overdue_count: Number(row.overdue_count || 0),
      total_owed: roundMoney(row.total_owed),
      total_paid: roundMoney(row.total_paid),
      outstanding_balance: roundMoney(row.outstanding_balance),
      legacy_record: Number(row.legacy_record || 0) === 1,
    }))
    .sort((left, right) => {
      const overdueDifference = Number(right.overdue_count || 0) - Number(left.overdue_count || 0);
      if (overdueDifference !== 0) return overdueDifference;
      return Number(right.outstanding_balance || 0) - Number(left.outstanding_balance || 0);
    });

  const [collectionRows] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN DATE(paid_at) = CURRENT_DATE THEN amount ELSE 0 END), 0) AS collected_today,
       COALESCE(SUM(CASE
         WHEN YEAR(paid_at) = YEAR(CURRENT_DATE)
          AND MONTH(paid_at) = MONTH(CURRENT_DATE)
         THEN amount ELSE 0 END), 0) AS collected_this_month
     FROM debt_payments
     WHERE branch_id = ?`,
    [branchId]
  );

  const summary = accounts.reduce(
    (result, account) => {
      result.customer_count += 1;
      if (account.outstanding_balance > 0) result.customers_owing += 1;
      if (account.overdue_count > 0) result.overdue_customers += 1;
      result.debt_record_count += account.debt_count;
      result.active_debt_count += account.active_debt_count;
      result.total_owed += account.total_owed;
      result.total_paid += account.total_paid;
      result.outstanding_balance += account.outstanding_balance;
      return result;
    },
    {
      customer_count: 0,
      customers_owing: 0,
      overdue_customers: 0,
      debt_record_count: 0,
      active_debt_count: 0,
      total_owed: 0,
      total_paid: 0,
      outstanding_balance: 0,
      collected_today: roundMoney(collectionRows[0]?.collected_today),
      collected_this_month: roundMoney(collectionRows[0]?.collected_this_month),
    }
  );

  summary.total_owed = roundMoney(summary.total_owed);
  summary.total_paid = roundMoney(summary.total_paid);
  summary.outstanding_balance = roundMoney(summary.outstanding_balance);

  return { accounts, summary };
}

async function loadDebtDeskAccount(branchId, parsedKey, connection = pool) {
  let customer = null;
  let debts = [];

  if (parsedKey.type === "customer") {
    const [customerRows] = await connection.query(
      `SELECT id, branch_id, name, phone, location, created_at, updated_at
       FROM customers
       WHERE id = ? AND branch_id = ?
       LIMIT 1`,
      [parsedKey.id, branchId]
    );
    customer = customerRows[0] || null;

    const [rows] = await connection.query(
      `SELECT
         d.id,
         d.branch_id,
         d.sale_id,
         d.customer_id,
         ${currentIdentitySelect()},
         d.amount_owed,
         d.amount_paid,
         d.balance,
         d.status,
         d.due_date,
         d.created_at,
         d.updated_at,
         s.receipt_number,
         s.total AS sale_total,
         s.payment_type,
         s.amount_tendered,
         s.amount_paid AS sale_amount_paid,
         s.balance AS sale_balance,
         s.created_at AS sale_date,
         u.full_name AS staff_name
       FROM debts d
       LEFT JOIN sales s
         ON s.id = d.sale_id
        AND s.branch_id = d.branch_id
       LEFT JOIN customers c
         ON c.id = COALESCE(s.customer_id, d.customer_id)
        AND c.branch_id = d.branch_id
       LEFT JOIN users u ON u.id = s.staff_id
       WHERE d.branch_id = ?
         AND COALESCE(s.customer_id, d.customer_id) = ?
       ORDER BY
         CASE WHEN d.balance > 0 THEN 0 ELSE 1 END,
         CASE WHEN d.due_date IS NULL THEN 1 ELSE 0 END,
         d.due_date ASC,
         d.created_at ASC,
         d.id ASC`,
      [branchId, parsedKey.id]
    );
    debts = rows;
  } else {
    const [rows] = await connection.query(
      `SELECT
         d.id,
         d.branch_id,
         d.sale_id,
         d.customer_id,
         ${currentIdentitySelect()},
         d.amount_owed,
         d.amount_paid,
         d.balance,
         d.status,
         d.due_date,
         d.created_at,
         d.updated_at,
         s.receipt_number,
         s.total AS sale_total,
         s.payment_type,
         s.amount_tendered,
         s.amount_paid AS sale_amount_paid,
         s.balance AS sale_balance,
         s.created_at AS sale_date,
         u.full_name AS staff_name
       FROM debts d
       LEFT JOIN sales s
         ON s.id = d.sale_id
        AND s.branch_id = d.branch_id
       LEFT JOIN customers c
         ON c.id = COALESCE(s.customer_id, d.customer_id)
        AND c.branch_id = d.branch_id
       LEFT JOIN users u ON u.id = s.staff_id
       WHERE d.branch_id = ?
         AND d.id = ?
         AND COALESCE(s.customer_id, d.customer_id) IS NULL
       LIMIT 1`,
      [branchId, parsedKey.id]
    );
    debts = rows;
  }

  if (debts.length === 0) {
    throw appError("This debt customer was not found in the selected store.", 404, "DEBT_CUSTOMER_NOT_FOUND");
  }

  const saleIds = [...new Set(debts.map((debt) => Number(debt.sale_id || 0)).filter(Boolean))];
  const debtIds = debts.map((debt) => Number(debt.id));
  let items = [];
  let payments = [];

  if (saleIds.length > 0) {
    const placeholders = saleIds.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT id, sale_id, product_id, product_name, quantity, unit_price, line_total
       FROM sale_items
       WHERE sale_id IN (${placeholders})
       ORDER BY sale_id ASC, id ASC`,
      saleIds
    );
    items = rows;
  }

  if (debtIds.length > 0) {
    const placeholders = debtIds.map(() => "?").join(",");
    const [rows] = await connection.query(
      `SELECT
         dp.id,
         dp.branch_id,
         dp.debt_id,
         dp.amount,
         dp.payment_method,
         dp.paid_at,
         dp.notes,
         u.full_name AS received_by_name
       FROM debt_payments dp
       LEFT JOIN users u ON u.id = dp.received_by
       WHERE dp.branch_id = ?
         AND dp.debt_id IN (${placeholders})
       ORDER BY dp.paid_at DESC, dp.id DESC`,
      [branchId, ...debtIds]
    );
    payments = rows;
  }

  const itemsBySale = new Map();
  for (const item of items) {
    const saleId = Number(item.sale_id);
    if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
    itemsBySale.get(saleId).push(item);
  }

  const paymentsByDebt = new Map();
  for (const payment of payments) {
    const debtId = Number(payment.debt_id);
    if (!paymentsByDebt.has(debtId)) paymentsByDebt.set(debtId, []);
    paymentsByDebt.get(debtId).push(payment);
  }

  const debtBreakdown = debts.map((debt) => ({
    ...debt,
    amount_owed: roundMoney(debt.amount_owed),
    amount_paid: roundMoney(debt.amount_paid),
    balance: roundMoney(debt.balance),
    identity_changed:
      String(debt.customer_name || "").trim() !== String(debt.debt_customer_name_snapshot || "").trim() ||
      String(debt.customer_phone || "").trim() !== String(debt.debt_customer_phone_snapshot || "").trim(),
    items: itemsBySale.get(Number(debt.sale_id)) || [],
    payments: paymentsByDebt.get(Number(debt.id)) || [],
  }));

  const summary = debtBreakdown.reduce(
    (result, debt) => {
      result.debt_count += 1;
      if (debt.balance > 0) result.active_debt_count += 1;
      if (debt.balance > 0 && debt.amount_paid > 0) result.partial_debt_count += 1;
      if (debt.balance > 0 && debt.due_date && new Date(`${String(debt.due_date).slice(0, 10)}T23:59:59Z`) < new Date()) {
        result.overdue_debt_count += 1;
      }
      result.total_owed += debt.amount_owed;
      result.total_paid += debt.amount_paid;
      result.outstanding_balance += debt.balance;
      return result;
    },
    {
      debt_count: 0,
      active_debt_count: 0,
      partial_debt_count: 0,
      overdue_debt_count: 0,
      total_owed: 0,
      total_paid: 0,
      outstanding_balance: 0,
    }
  );

  summary.total_owed = roundMoney(summary.total_owed);
  summary.total_paid = roundMoney(summary.total_paid);
  summary.outstanding_balance = roundMoney(summary.outstanding_balance);

  const firstDebt = debtBreakdown[0];
  const correctedIdentityDebt =
    debtBreakdown.find(
      (debt) =>
        cleanText(debt.sale_customer_name) &&
        cleanText(debt.sale_customer_name) !== cleanText(debt.debt_customer_name_snapshot)
    ) || firstDebt;

  return {
    customer: {
      customer_key: parsedKey.key,
      customer_id: customer?.id || correctedIdentityDebt.effective_customer_id || null,
      customer_name: correctedIdentityDebt.customer_name || customer?.name || "Unnamed Customer",
      customer_phone: correctedIdentityDebt.customer_phone || customer?.phone || null,
      customer_location: customer?.location || correctedIdentityDebt.customer_location || null,
      legacy_record: parsedKey.type === "legacy",
    },
    summary,
    debts: debtBreakdown,
    payments,
  };
}

async function loadOpenDebtsForPayment(connection, branchId, parsedKey) {
  const condition =
    parsedKey.type === "customer"
      ? "COALESCE(s.customer_id, d.customer_id) = ?"
      : "d.id = ? AND COALESCE(s.customer_id, d.customer_id) IS NULL";

  const [debts] = await connection.query(
    `SELECT
       d.*,
       s.receipt_number,
       s.customer_name AS sale_customer_name,
       s.created_at AS sale_date,
       COALESCE(NULLIF(s.customer_name, ''), NULLIF(c.name, ''), NULLIF(d.customer_name, ''), 'Unnamed Customer') AS current_customer_name,
       COALESCE(NULLIF(s.customer_phone, ''), NULLIF(c.phone, ''), NULLIF(d.customer_phone, '')) AS current_customer_phone,
       c.location AS current_customer_location,
       COALESCE(s.customer_id, d.customer_id) AS effective_customer_id
     FROM debts d
     LEFT JOIN sales s
       ON s.id = d.sale_id
      AND s.branch_id = d.branch_id
     LEFT JOIN customers c
       ON c.id = COALESCE(s.customer_id, d.customer_id)
      AND c.branch_id = d.branch_id
     WHERE d.branch_id = ?
       AND ${condition}
     ORDER BY
       CASE WHEN d.due_date IS NULL THEN 1 ELSE 0 END,
       d.due_date ASC,
       d.created_at ASC,
       d.id ASC
     FOR UPDATE`,
    [branchId, parsedKey.id]
  );

  return debts;
}

async function applyPaymentToDebt(
  connection,
  { branchId, debt, amount, paymentMethod, notes, receivedBy }
) {
  const oldBalance = roundMoney(debt.balance);
  const allocation = roundMoney(Math.min(amount, oldBalance));
  const newAmountPaid = roundMoney(Number(debt.amount_paid || 0) + allocation);
  const newBalance = roundMoney(Math.max(Number(debt.amount_owed || 0) - newAmountPaid, 0));
  const newStatus = getDebtStatus(newBalance, newAmountPaid);

  const [paymentResult] = await connection.query(
    `INSERT INTO debt_payments (
       branch_id,
       debt_id,
       amount,
       payment_method,
       received_by,
       notes
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [branchId, debt.id, allocation, paymentMethod, receivedBy, notes]
  );

  await connection.query(
    `UPDATE debts
     SET amount_paid = ?, balance = ?, status = ?
     WHERE id = ? AND branch_id = ?`,
    [newAmountPaid, newBalance, newStatus, debt.id, branchId]
  );

  if (debt.sale_id) {
    await connection.query(
      `UPDATE sales
       SET amount_paid = LEAST(total, amount_paid + ?),
           balance = GREATEST(balance - ?, 0)
       WHERE id = ? AND branch_id = ?`,
      [allocation, allocation, debt.sale_id, branchId]
    );
  }

  return {
    payment_id: Number(paymentResult.insertId),
    debt_id: Number(debt.id),
    sale_id: debt.sale_id ? Number(debt.sale_id) : null,
    receipt_number: debt.receipt_number || null,
    amount: allocation,
    previous_balance: oldBalance,
    new_balance: newBalance,
    status: newStatus,
    due_date: debt.due_date || null,
  };
}

// GET /api/debts
router.get("/", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const { status, search, overdue } = req.query;

    let sql = `SELECT
      d.id,
      d.branch_id,
      b.name AS branch_name,
      b.branch_code,
      d.sale_id,
      s.receipt_number,
      COALESCE(s.customer_id, d.customer_id) AS customer_id,
      ${currentIdentitySelect()},
      d.amount_owed,
      d.amount_paid,
      d.balance,
      d.status,
      d.due_date,
      d.created_at,
      d.updated_at,
      DATEDIFF(CURRENT_DATE, d.due_date) AS overdue_days
    FROM debts d
    LEFT JOIN sales s ON d.sale_id = s.id AND s.branch_id = d.branch_id
    LEFT JOIN customers c ON c.id = COALESCE(s.customer_id, d.customer_id) AND c.branch_id = d.branch_id
    LEFT JOIN branches b ON d.branch_id = b.id
    WHERE d.branch_id = ?`;

    const params = [branchId];

    if (status) {
      sql += " AND d.status = ?";
      params.push(status);
    }

    if (search) {
      const searchValue = `%${String(search).trim()}%`;
      sql += ` AND (
        COALESCE(c.name, s.customer_name, d.customer_name) LIKE ?
        OR COALESCE(c.phone, s.customer_phone, d.customer_phone) LIKE ?
        OR s.receipt_number LIKE ?
      )`;
      params.push(searchValue, searchValue, searchValue);
    }

    if (String(overdue).toLowerCase() === "true") {
      sql += " AND d.status <> 'paid' AND d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE";
    }

    sql += " ORDER BY CASE WHEN d.balance > 0 THEN 0 ELSE 1 END, d.due_date ASC, d.created_at DESC LIMIT 500";

    const [debts] = await pool.query(sql, params);
    return res.json({ status: "success", branch_id: branchId, count: debts.length, debts });
  } catch (error) {
    console.error("Get debts error:", error);
    return res.status(500).json({ status: "error", message: "Something went wrong while fetching debts." });
  }
});

// GET /api/debts/summary
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const [rows] = await pool.query(
      `SELECT
         COUNT(*) AS total_debt_records,
         COALESCE(SUM(CASE WHEN status <> 'paid' THEN balance ELSE 0 END), 0) AS outstanding_balance,
         COUNT(CASE WHEN status = 'unpaid' THEN 1 END) AS unpaid_count,
         COUNT(CASE WHEN status = 'partial' THEN 1 END) AS partial_count,
         COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count,
         COUNT(CASE WHEN status <> 'paid' AND due_date IS NOT NULL AND due_date < CURRENT_DATE THEN 1 END) AS overdue_count
       FROM debts
       WHERE branch_id = ?`,
      [branchId]
    );

    return res.json({ status: "success", branch_id: branchId, summary: rows[0] });
  } catch (error) {
    console.error("Debt summary error:", error);
    return res.status(500).json({ status: "error", message: "Something went wrong while fetching debt summary." });
  }
});

// GET /api/debts/customers
router.get("/customers", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const includePaid = String(req.query?.include_paid || "").toLowerCase() === "true";
    const result = await loadDebtDeskAccounts(branchId, { includePaid });
    return res.json({ status: "success", branch_id: branchId, ...result });
  } catch (error) {
    console.error("Debt desk accounts error:", error);
    return res.status(500).json({ status: "error", message: "Could not load the customer debt desk." });
  }
});

// GET /api/debts/customers/:customerKey
router.get("/customers/:customerKey", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const parsedKey = parseCustomerKey(req.params.customerKey);
    const result = await loadDebtDeskAccount(branchId, parsedKey);
    return res.json({ status: "success", branch_id: branchId, ...result });
  } catch (error) {
    console.error("Debt desk account detail error:", error);
    return res.status(error.statusCode || 500).json({
      status: "error",
      code: error.code || "DEBT_DESK_DETAIL_ERROR",
      message: error.statusCode ? error.message : "Could not load this customer's debt account.",
    });
  }
});

// POST /api/debts/customers/:customerKey/payments
router.post("/customers/:customerKey/payments", requireAuth, async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const branchId = getBranchId(req);
    const parsedKey = parseCustomerKey(req.params.customerKey);
    const paymentMethod = cleanPaymentMethod(req.body?.payment_method);
    const note = cleanText(req.body?.notes, 500);
    const payFullBalance = req.body?.pay_full_balance === true;
    const requestKey = cleanPaymentRequestKey(req.body?.request_key);
    const requestToken = `[DebtDesk:${requestKey}]`;

    await connection.beginTransaction();

    const lockedPeriod = await findApprovedAuditLockForDate(connection, branchId, new Date());
    if (lockedPeriod) {
      await connection.rollback();
      return sendAuditLockedResponse(res, lockedPeriod, "record a customer debt payment");
    }

    const targetDebts = await loadOpenDebtsForPayment(connection, branchId, parsedKey);
    const duplicateRequest = await findExistingCustomerPaymentRequest(
      connection,
      branchId,
      requestToken
    );
    if (duplicateRequest) {
      throw appError(
        "This payment request was already recorded. Refresh the customer account before trying again.",
        409,
        "DUPLICATE_DEBT_PAYMENT_REQUEST"
      );
    }

    const debts = targetDebts.filter(
      (debt) => Number(debt.balance || 0) > 0 && String(debt.status || "") !== "paid"
    );
    if (debts.length === 0) {
      throw appError("This customer has no outstanding debt to pay.", 400, "NO_OUTSTANDING_DEBT");
    }

    const previousOutstanding = roundMoney(
      debts.reduce((sum, debt) => sum + Number(debt.balance || 0), 0)
    );
    const requestedAmount = payFullBalance ? previousOutstanding : toPositiveMoney(req.body?.amount);

    if (!requestedAmount) {
      throw appError("Enter a payment amount greater than zero.", 400, "INVALID_PAYMENT_AMOUNT");
    }

    if (requestedAmount > previousOutstanding) {
      throw appError(
        `Payment cannot be more than the customer's outstanding balance of GHS ${previousOutstanding.toFixed(2)}.`,
        400,
        "PAYMENT_EXCEEDS_CUSTOMER_BALANCE"
      );
    }

    const reference = makePaymentReference(branchId);
    const paymentNote = [requestToken, reference, note].filter(Boolean).join(" — ");
    const allocations = [];
    let remaining = requestedAmount;

    for (const debt of debts) {
      if (remaining <= 0) break;
      const allocation = roundMoney(Math.min(remaining, Number(debt.balance || 0)));
      if (allocation <= 0) continue;

      const result = await applyPaymentToDebt(connection, {
        branchId,
        debt,
        amount: allocation,
        paymentMethod,
        notes: paymentNote,
        receivedBy: req.user.id,
      });
      allocations.push(result);
      remaining = roundMoney(remaining - allocation);
    }

    if (remaining > 0 || roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0)) !== requestedAmount) {
      throw appError(
        "The customer payment could not be allocated completely. No payment was saved.",
        409,
        "PAYMENT_ALLOCATION_MISMATCH"
      );
    }

    const identityDebt =
      debts.find(
        (debt) =>
          cleanText(debt.sale_customer_name) &&
          cleanText(debt.sale_customer_name) !== cleanText(debt.customer_name)
      ) || debts[0];
    const customerName =
      identityDebt.current_customer_name || identityDebt.customer_name || "Customer";
    const customerPhone =
      identityDebt.current_customer_phone || identityDebt.customer_phone || null;
    const newOutstanding = roundMoney(previousOutstanding - requestedAmount);

    await logActivity(connection, {
      req,
      branchId,
      userId: req.user.id,
      action: "CUSTOMER_DEBT_PAYMENT",
      details: `Received GHS ${requestedAmount.toFixed(2)} by ${paymentMethod} from ${customerName}. Payment ${reference} was allocated to ${allocations.length} debt record(s). New customer balance: GHS ${newOutstanding.toFixed(2)}.`,
      entityType: "customer_debt_account",
      entityId: parsedKey.type === "customer" ? parsedKey.id : allocations[0]?.debt_id,
      metadata: {
        reference,
        request_key: requestKey,
        customer_key: parsedKey.key,
        customer_name: customerName,
        payment_method: paymentMethod,
        amount: requestedAmount,
        previous_outstanding: previousOutstanding,
        new_outstanding: newOutstanding,
        allocation_method: "oldest_due_first",
        allocations,
      },
    });

    const affectedClosing = await markClosingStale(connection, {
      branchId,
      transactionDate: new Date(),
      reason: `Customer debt payment ${reference} of GHS ${requestedAmount.toFixed(2)} by ${paymentMethod} was recorded after the business day had already been closed.`,
      sourceEntityType: "customer_debt_payment",
      sourceEntityId: allocations[0]?.payment_id || null,
      changedBy: req.user.id,
    });

    await connection.commit();

    return res.status(201).json({
      status: "success",
      message:
        newOutstanding <= 0
          ? `${customerName}'s outstanding debt has been paid in full.`
          : `Customer payment recorded. Remaining balance: GHS ${newOutstanding.toFixed(2)}.`,
      branch_id: branchId,
      receipt: {
        reference,
        paid_at: new Date().toISOString(),
        payment_method: paymentMethod,
        notes: note,
        received_by_name: req.user?.full_name || req.user?.username || "Staff",
        customer: {
          customer_key: parsedKey.key,
          customer_id: parsedKey.type === "customer" ? parsedKey.id : null,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_location: debts[0].current_customer_location || null,
        },
        amount: requestedAmount,
        previous_outstanding: previousOutstanding,
        new_outstanding: newOutstanding,
        allocation_method: "oldest_due_first",
        request_key: requestKey,
        allocations,
      },
      affected_closing: affectedClosing,
    });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original payment error.
    }

    console.error("Customer debt payment error:", error);
    return res.status(error.statusCode || 500).json({
      status: "error",
      code: error.code || "CUSTOMER_DEBT_PAYMENT_ERROR",
      message: error.statusCode ? error.message : "Something went wrong while recording the customer debt payment.",
    });
  } finally {
    connection.release();
  }
});

// GET /api/debts/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const branchId = getBranchId(req);
    const { id } = req.params;

    const [debts] = await pool.query(
      `SELECT
         d.*,
         b.name AS branch_name,
         b.branch_code,
         s.receipt_number,
         s.total AS sale_total,
         s.payment_type,
         s.created_at AS sale_date,
         ${currentIdentitySelect()}
       FROM debts d
       LEFT JOIN branches b ON d.branch_id = b.id
       LEFT JOIN sales s ON d.sale_id = s.id AND s.branch_id = d.branch_id
       LEFT JOIN customers c ON c.id = COALESCE(s.customer_id, d.customer_id) AND c.branch_id = d.branch_id
       WHERE d.id = ? AND d.branch_id = ?
       LIMIT 1`,
      [id, branchId]
    );

    if (!debts[0]) {
      return res.status(404).json({ status: "error", message: "Debt not found in the selected store." });
    }

    const [payments] = await pool.query(
      `SELECT
         dp.id,
         dp.branch_id,
         dp.debt_id,
         dp.amount,
         dp.payment_method,
         dp.paid_at,
         dp.notes,
         u.full_name AS received_by_name
       FROM debt_payments dp
       LEFT JOIN users u ON dp.received_by = u.id
       WHERE dp.debt_id = ? AND dp.branch_id = ?
       ORDER BY dp.paid_at DESC, dp.id DESC`,
      [id, branchId]
    );

    return res.json({ status: "success", branch_id: branchId, debt: debts[0], payments });
  } catch (error) {
    console.error("Get single debt error:", error);
    return res.status(500).json({ status: "error", message: "Something went wrong while fetching the debt." });
  }
});

// POST /api/debts/:id/payments
router.post(
  "/:id/payments",
  requireAuth,
  validateRequest(validateDebtPaymentRequest),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);
      const { id } = req.validated.params;
      const {
        amount: paymentAmount,
        payment_method: paymentMethod,
        notes,
      } = req.validated.body;

      await connection.beginTransaction();

      const lockedPeriod = await findApprovedAuditLockForDate(connection, branchId, new Date());
      if (lockedPeriod) {
        await connection.rollback();
        return sendAuditLockedResponse(res, lockedPeriod, "record a debt payment");
      }

      const [debts] = await connection.query(
        `SELECT
           d.*,
           s.receipt_number,
           s.customer_name AS sale_customer_name,
           s.created_at AS sale_date,
           COALESCE(NULLIF(s.customer_name, ''), NULLIF(c.name, ''), NULLIF(d.customer_name, ''), 'Unnamed Customer') AS current_customer_name,
           COALESCE(NULLIF(s.customer_phone, ''), NULLIF(c.phone, ''), NULLIF(d.customer_phone, '')) AS current_customer_phone
         FROM debts d
         LEFT JOIN sales s ON d.sale_id = s.id AND s.branch_id = d.branch_id
         LEFT JOIN customers c ON c.id = COALESCE(s.customer_id, d.customer_id) AND c.branch_id = d.branch_id
         WHERE d.id = ? AND d.branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      if (!debts[0]) {
        throw appError("Debt not found in the selected store.", 404, "DEBT_NOT_FOUND");
      }

      const debt = debts[0];
      if (debt.status === "paid" || Number(debt.balance) <= 0) {
        throw appError("This debt has already been fully paid.", 400, "DEBT_ALREADY_PAID");
      }

      if (Number(paymentAmount) > Number(debt.balance)) {
        throw appError(
          `Payment cannot be more than the remaining balance of GHS ${Number(debt.balance).toFixed(2)}.`,
          400,
          "PAYMENT_EXCEEDS_DEBT_BALANCE"
        );
      }

      const allocation = await applyPaymentToDebt(connection, {
        branchId,
        debt,
        amount: Number(paymentAmount),
        paymentMethod,
        notes,
        receivedBy: req.user.id,
      });

      const customerName = debt.current_customer_name || debt.customer_name || "Customer";
      const customerPhone = debt.current_customer_phone || debt.customer_phone || null;

      await logActivity(connection, {
        req,
        branchId,
        userId: req.user.id,
        action: "DEBT_PAYMENT",
        details: `Received GHS ${Number(paymentAmount).toFixed(2)} by ${paymentMethod} from ${customerName}. New balance: GHS ${allocation.new_balance.toFixed(2)}.`,
        entityId: Number(id),
        metadata: { allocation },
      });

      const affectedClosing = await markClosingStale(connection, {
        branchId,
        transactionDate: new Date(),
        reason: `Debt payment of GHS ${Number(paymentAmount).toFixed(2)} by ${paymentMethod} was recorded after the business day had already been closed.`,
        sourceEntityType: "debt_payment",
        sourceEntityId: allocation.payment_id,
        changedBy: req.user.id,
      });

      await connection.commit();

      const [createdPayments] = await pool.query(
        `SELECT
           dp.id,
           dp.branch_id,
           dp.debt_id,
           dp.amount,
           dp.payment_method,
           dp.paid_at,
           dp.notes,
           u.full_name AS received_by_name
         FROM debt_payments dp
         LEFT JOIN users u ON dp.received_by = u.id
         WHERE dp.id = ? AND dp.branch_id = ?
         LIMIT 1`,
        [allocation.payment_id, branchId]
      );

      const createdPayment = createdPayments[0];
      return res.status(201).json({
        status: "success",
        message: "Debt payment recorded successfully.",
        branch_id: branchId,
        receipt: {
          payment: createdPayment,
          debt: {
            id: debt.id,
            branch_id: branchId,
            sale_id: debt.sale_id,
            receipt_number: debt.receipt_number,
            customer_name: customerName,
            customer_phone: customerPhone,
            amount_owed: roundMoney(debt.amount_owed),
            previous_amount_paid: roundMoney(debt.amount_paid),
            previous_balance: allocation.previous_balance,
            amount_paid: roundMoney(Number(debt.amount_paid || 0) + Number(paymentAmount)),
            balance: allocation.new_balance,
            status: allocation.status,
          },
        },
        affected_closing: affectedClosing,
        payment: createdPayment,
        debt: {
          id: debt.id,
          branch_id: branchId,
          customer_name: customerName,
          customer_phone: customerPhone,
          amount_owed: roundMoney(debt.amount_owed),
          amount_paid: roundMoney(Number(debt.amount_paid || 0) + Number(paymentAmount)),
          balance: allocation.new_balance,
          status: allocation.status,
        },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve original error.
      }

      console.error("Record debt payment error:", error);
      return res.status(error.statusCode || 500).json({
        status: "error",
        code: error.code || "DEBT_PAYMENT_ERROR",
        message: error.statusCode ? error.message : "Something went wrong while recording debt payment.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
