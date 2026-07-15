const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const bcrypt = require("bcryptjs");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

const PAYMENT_GROUPS = [
  { key: "cash", label: "Cash Sales" },
  { key: "momo", label: "Mobile Money Sales" },
  { key: "bank", label: "Bank Sales" },
  { key: "mixed", label: "Mixed Sales" },
  { key: "credit", label: "Credit Sales" },
];

function getBranchId(req) {
  const branchId = Number(
    req.user?.branch_id || req.user?.default_branch_id || 1
  );

  if (!Number.isInteger(branchId) || branchId <= 0) {
    return 1;
  }

  return branchId;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toMoney(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Number(number.toFixed(2));
}

function toCountedMoney(value, fallbackValue) {
  if (value === undefined || value === null || value === "") {
    if (fallbackValue === undefined || fallbackValue === null || fallbackValue === "") {
      return null;
    }
    return Math.max(0, toMoney(fallbackValue));
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
}

function getCashControls(source = {}) {
  const fields = [
    "opening_cash_float",
    "cash_deposits",
    "cash_withdrawals",
    "other_cash_in",
    "other_cash_out",
  ];
  const result = {};
  for (const field of fields) {
    const value = toCountedMoney(source[field], 0);
    result[field] = value === null ? 0 : value;
  }
  return result;
}

function parseDenominations(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseSnapshotJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function revisionSnapshotValue(snapshot, key, fallback = 0) {
  const value = snapshot?.[key];
  return value === undefined || value === null || value === ""
    ? fallback
    : value;
}

function calculateDenominationTotal(denominations = {}) {
  const values = {
    note_200: 200, note_100: 100, note_50: 50, note_20: 20,
    note_10: 10, note_5: 5, note_2: 2, note_1: 1, coins: 1,
  };
  let total = 0;
  for (const [key, faceValue] of Object.entries(values)) {
    const quantity = Number(denominations[key] || 0);
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    total += key === "coins" ? quantity : Math.floor(quantity) * faceValue;
  }
  return toMoney(total);
}

function hasDenominationEvidence(denominations = {}) {
  const supportedKeys = [
    "note_200",
    "note_100",
    "note_50",
    "note_20",
    "note_10",
    "note_5",
    "note_2",
    "note_1",
    "coins",
  ];

  return supportedKeys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(denominations, key)) return false;
    const value = denominations[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function cleanText(value, maxLength = 5000) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeFilePart(value, fallback = "store") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return cleaned || fallback;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function moneyText(value) {
  return `GHS ${toMoney(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function truncateText(value, maxLength = 38) {
  const text = String(value || "");
  return text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 1))}…`
    : text;
}

async function logActivity(connection, userId, branchId, action, details) {
  await writeAuditEvent({
    connection,
    branchId: branchId || null,
    userId: userId || null,
    action,
    details,
    workspaceCode: "spare_parts",
    entityType: "daily_closing",
    actionType: action,
    outcome: "success",
    severity: "critical",
  });
}

async function getBranchDetails(branchId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, code, name, location
     FROM branches
     WHERE id = ?
     LIMIT 1`,
    [branchId]
  );

  return (
    rows[0] || {
      id: branchId,
      code: `STORE-${branchId}`,
      name: "Selected Store",
      location: "",
    }
  );
}

async function getExistingClosing(branchId, closingDate) {
  const [rows] = await pool.query(
    `SELECT
      dc.*,
      u.full_name AS closed_by_name,
      vu.full_name AS verified_by_name,
      b.code AS branch_code,
      b.name AS branch_name,
      b.location AS branch_location
     FROM daily_closings dc
     LEFT JOIN users u ON dc.closed_by = u.id
     LEFT JOIN users vu ON dc.verified_by = vu.id
     LEFT JOIN branches b ON dc.branch_id = b.id
     WHERE dc.branch_id = ?
     AND dc.closing_date = ?
     LIMIT 1`,
    [branchId, closingDate]
  );

  return rows[0] || null;
}


async function getClosingRevisions(existingClosing, branchId) {
  if (!existingClosing?.id) return [];

  const [rows] = await pool.query(
    `SELECT
      dcr.*,
      changer.full_name AS changed_by_name,
      approver.full_name AS approved_by_name
     FROM daily_closing_revisions dcr
     LEFT JOIN users changer ON dcr.changed_by = changer.id
     LEFT JOIN users approver ON dcr.approved_by = approver.id
     WHERE dcr.daily_closing_id = ? AND dcr.branch_id = ?
     ORDER BY dcr.revision_number ASC`,
    [existingClosing.id, branchId]
  );

  return rows.map((row) => ({
    ...row,
    expected_snapshot: parseSnapshotJson(row.expected_snapshot_json),
    counted_snapshot: parseSnapshotJson(row.counted_snapshot_json),
  }));
}

function createEmptyPaymentGroup(key, label) {
  return {
    key,
    label,
    transaction_count: 0,
    gross_before_discount: 0,
    discount_total: 0,
    tax_total: 0,
    net_sales: 0,
    amount_received: 0,
    outstanding_created: 0,
  };
}

function buildPaymentGroups(salesTransactions) {
  const groups = new Map(
    PAYMENT_GROUPS.map(({ key, label }) => [
      key,
      createEmptyPaymentGroup(key, label),
    ])
  );

  for (const sale of salesTransactions) {
    const paymentType = groups.has(sale.payment_type)
      ? sale.payment_type
      : "mixed";
    const group = groups.get(paymentType);

    const grossBeforeDiscount = toMoney(
      Number(sale.total || 0) + Number(sale.discount_amount || 0)
    );

    group.transaction_count += 1;
    group.gross_before_discount = toMoney(
      group.gross_before_discount + grossBeforeDiscount
    );
    group.discount_total = toMoney(
      group.discount_total + Number(sale.discount_amount || 0)
    );
    group.tax_total = toMoney(group.tax_total + Number(sale.tax_amount || 0));
    group.net_sales = toMoney(group.net_sales + Number(sale.total || 0));
    group.amount_received = toMoney(
      group.amount_received + Number(sale.amount_paid || 0)
    );
    group.outstanding_created = toMoney(
      group.outstanding_created + Number(sale.balance || 0)
    );
  }

  return PAYMENT_GROUPS.map(({ key }) => groups.get(key));
}

function findPaymentGroup(groups, key) {
  return groups.find((group) => group.key === key) || createEmptyPaymentGroup(key, key);
}

async function calculateClosingSummary(branchId, closingDate, cashControlSource = {}, connection = pool) {
  const branch = await getBranchDetails(branchId, connection);

  const [salesTransactions] = await connection.query(
    `SELECT
      s.id,
      s.receipt_number,
      COALESCE(NULLIF(s.customer_name, ''), 'CASH CUSTOMER') AS customer_name,
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
      COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'cash'), CASE WHEN s.payment_type = 'cash' THEN s.amount_paid ELSE 0 END) AS cash_received,
      COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'momo'), CASE WHEN s.payment_type = 'momo' THEN s.amount_paid ELSE 0 END) AS momo_received,
      COALESCE((SELECT SUM(spa.amount) FROM sale_payment_allocations spa WHERE spa.sale_id = s.id AND spa.payment_channel = 'bank'), CASE WHEN s.payment_type = 'bank' THEN s.amount_paid ELSE 0 END) AS bank_received,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM sale_payment_allocations spa_any
          WHERE spa_any.sale_id = s.id
        )
          THEN COALESCE((
            SELECT SUM(spa.amount)
            FROM sale_payment_allocations spa
            WHERE spa.sale_id = s.id
              AND spa.payment_channel = 'other'
          ), 0)
        ELSE CASE
          WHEN s.payment_type IN ('mixed','credit') THEN s.amount_paid
          ELSE 0
        END
      END AS other_received,
      s.created_at,
      COALESCE(u.full_name, 'System') AS staff_name
     FROM sales s
     LEFT JOIN users u ON s.staff_id = u.id
     WHERE s.branch_id = ?
     AND DATE(s.created_at) = ?
     AND s.sale_status = 'completed'
     AND COALESCE(s.is_voided, 0) = 0
     ORDER BY
       FIELD(s.payment_type, 'cash', 'momo', 'bank', 'mixed', 'credit'),
       s.created_at ASC,
       s.id ASC`,
    [branchId, closingDate]
  );

  const [debtPayments] = await connection.query(
    `SELECT
      dp.id,
      dp.amount,
      dp.payment_method,
      dp.paid_at,
      dp.notes,
      d.customer_name,
      d.customer_phone,
      s.receipt_number,
      COALESCE(u.full_name, 'System') AS received_by_name
     FROM debt_payments dp
     INNER JOIN debts d ON dp.debt_id = d.id
     INNER JOIN sales s ON d.sale_id = s.id
     LEFT JOIN users u ON dp.received_by = u.id
     WHERE dp.branch_id = ?
     AND d.branch_id = ?
     AND s.branch_id = ?
     AND DATE(dp.paid_at) = ?
     AND COALESCE(s.is_voided, 0) = 0
     AND s.sale_status != 'cancelled'
     ORDER BY dp.paid_at ASC, dp.id ASC`,
    [branchId, branchId, branchId, closingDate]
  );

  const [expenses] = await connection.query(
    `SELECT
      e.id,
      e.category,
      e.amount,
      e.payment_method,
      e.description,
      e.expense_date,
      e.created_at,
      COALESCE(u.full_name, 'System') AS recorded_by_name
     FROM expenses e
     LEFT JOIN users u ON e.recorded_by = u.id
     WHERE e.branch_id = ?
     AND e.expense_date = ?
     ORDER BY e.created_at ASC, e.id ASC`,
    [branchId, closingDate]
  );

  const [returns] = await connection.query(
    `SELECT
      r.id,
      r.sale_id,
      r.product_id,
      r.quantity,
      r.reason,
      r.return_type,
      r.refund_amount,
      r.refund_method,
      r.refund_reference,
      r.returned_at,
      s.receipt_number,
      COALESCE(NULLIF(s.customer_name, ''), 'CASH CUSTOMER') AS customer_name,
      p.name AS product_name,
      returned_user.full_name AS returned_by_name,
      approved_user.full_name AS approved_by_name
     FROM returns r
     INNER JOIN sales s ON r.sale_id = s.id AND r.branch_id = s.branch_id
     LEFT JOIN products p ON r.product_id = p.id AND r.branch_id = p.branch_id
     LEFT JOIN users returned_user ON r.returned_by = returned_user.id
     LEFT JOIN users approved_user ON r.approved_by = approved_user.id
     WHERE r.branch_id = ?
     AND DATE(r.returned_at) = ?
     ORDER BY r.returned_at ASC, r.id ASC`,
    [branchId, closingDate]
  );

  const [exceptions] = await connection.query(
    `SELECT
      s.id,
      s.receipt_number,
      COALESCE(NULLIF(s.customer_name, ''), 'CASH CUSTOMER') AS customer_name,
      s.total,
      s.amount_paid,
      s.balance,
      s.payment_type,
      s.sale_status,
      s.is_voided,
      s.void_reason,
      s.created_at,
      s.voided_at,
      COALESCE(u.full_name, 'System') AS staff_name
     FROM sales s
     LEFT JOIN users u ON s.staff_id = u.id
     WHERE s.branch_id = ?
     AND DATE(s.created_at) = ?
     AND (
       COALESCE(s.is_voided, 0) = 1
       OR s.sale_status IN ('returned', 'cancelled')
     )
     ORDER BY s.created_at ASC, s.id ASC`,
    [branchId, closingDate]
  );

  const [saleChanges] = await connection.query(
    `SELECT
      sch.id,
      sch.change_type,
      sch.reason,
      sch.created_at,
      sch.affected_closing_id,
      s.id AS sale_id,
      s.receipt_number,
      s.customer_name,
      s.total,
      s.created_at AS sale_created_at,
      changer.full_name AS changed_by_name,
      approver.full_name AS approved_by_name
     FROM sale_change_history sch
     INNER JOIN sales s ON sch.sale_id = s.id AND sch.branch_id = s.branch_id
     LEFT JOIN users changer ON sch.changed_by = changer.id
     LEFT JOIN users approver ON sch.approved_by = approver.id
     WHERE sch.branch_id = ?
     AND DATE(s.created_at) = ?
     ORDER BY sch.created_at ASC, sch.id ASC`,
    [branchId, closingDate]
  );


  const paymentGroups = buildPaymentGroups(salesTransactions);
  const cashGroup = findPaymentGroup(paymentGroups, "cash");
  const momoGroup = findPaymentGroup(paymentGroups, "momo");
  const bankGroup = findPaymentGroup(paymentGroups, "bank");
  const mixedGroup = findPaymentGroup(paymentGroups, "mixed");
  const creditGroup = findPaymentGroup(paymentGroups, "credit");

  const salesCount = salesTransactions.length;
  const salesSubtotal = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.subtotal || 0), 0)
  );
  const discountTotal = toMoney(
    salesTransactions.reduce(
      (sum, sale) => sum + Number(sale.discount_amount || 0),
      0
    )
  );
  const taxTotal = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.tax_amount || 0), 0)
  );
  const salesTotal = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  );
  const grossBeforeDiscount = toMoney(salesTotal + discountTotal);
  const salesReceived = toMoney(
    salesTransactions.reduce(
      (sum, sale) => sum + Number(sale.amount_paid || 0),
      0
    )
  );
  const creditCreated = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.balance || 0), 0)
  );

  const debtPaymentCount = debtPayments.length;
  const debtPaymentsTotal = toMoney(
    debtPayments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0
    )
  );
  const debtCash = toMoney(
    debtPayments
      .filter((payment) => payment.payment_method === "cash")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
  const debtMomo = toMoney(
    debtPayments
      .filter((payment) => payment.payment_method === "momo")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
  const debtBank = toMoney(
    debtPayments
      .filter((payment) => payment.payment_method === "bank")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
  const debtOther = toMoney(
    debtPayments
      .filter((payment) => !["cash", "momo", "bank"].includes(payment.payment_method))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );

  const expensesCount = expenses.length;
  const expensesTotal = toMoney(
    expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  );

  const returnCount = returns.length;
  const returnQuantity = returns.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const refundTotal = toMoney(
    returns.reduce((sum, item) => sum + Number(item.refund_amount || 0), 0)
  );
  const refundCash = toMoney(returns.filter((item) => item.refund_method === "cash").reduce((sum, item) => sum + Number(item.refund_amount || 0), 0));
  const refundMomo = toMoney(returns.filter((item) => item.refund_method === "momo").reduce((sum, item) => sum + Number(item.refund_amount || 0), 0));
  const refundBank = toMoney(returns.filter((item) => item.refund_method === "bank").reduce((sum, item) => sum + Number(item.refund_amount || 0), 0));
  const refundOther = toMoney(returns.filter((item) => item.refund_method === "other").reduce((sum, item) => sum + Number(item.refund_amount || 0), 0));

  const saleCashReceived = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.cash_received || 0), 0)
  );
  const saleMomoReceived = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.momo_received || 0), 0)
  );
  const saleBankReceived = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.bank_received || 0), 0)
  );
  const saleOtherReceived = toMoney(
    salesTransactions.reduce((sum, sale) => sum + Number(sale.other_received || 0), 0)
  );

  const expenseCash = toMoney(expenses.filter((item) => item.payment_method === "cash").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const expenseMomo = toMoney(expenses.filter((item) => item.payment_method === "momo").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const expenseBank = toMoney(expenses.filter((item) => item.payment_method === "bank").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const expenseOther = toMoney(expenses.filter((item) => !["cash", "momo", "bank"].includes(item.payment_method)).reduce((sum, item) => sum + Number(item.amount || 0), 0));

  const cashControls = getCashControls(cashControlSource);
  const expectedCash = toMoney(
    cashControls.opening_cash_float + saleCashReceived + debtCash + cashControls.other_cash_in
      - expenseCash - refundCash - cashControls.cash_deposits - cashControls.cash_withdrawals - cashControls.other_cash_out
  );
  const expectedMomo = toMoney(saleMomoReceived + debtMomo - expenseMomo - refundMomo);
  const expectedBank = toMoney(saleBankReceived + debtBank - expenseBank - refundBank);
  const expectedOther = toMoney(saleOtherReceived + debtOther - expenseOther - refundOther);
  const expectedTotal = toMoney(expectedCash + expectedMomo + expectedBank + expectedOther);

  const riskFlags = [];
  for (const sale of salesTransactions) {
    const subtotalValue = Number(sale.subtotal || 0);
    const discountValue = Number(sale.discount_amount || 0);
    const discountRate = subtotalValue > 0 ? discountValue / subtotalValue : 0;
    if (discountValue >= 100 || discountRate >= 0.1) {
      riskFlags.push({
        id: `discount-${sale.id}`,
        risk_type: "large_discount",
        severity: discountRate >= 0.2 || discountValue >= 500 ? "high" : "review",
        receipt_number: sale.receipt_number,
        customer_name: sale.customer_name,
        amount: discountValue,
        occurred_at: sale.created_at,
        details: `Discount GHS ${discountValue.toFixed(2)} (${(discountRate * 100).toFixed(1)}% of subtotal).`,
      });
    }

    const saleHour = new Date(sale.created_at).getHours();
    if (saleHour < 6 || saleHour >= 21) {
      riskFlags.push({
        id: `after-hours-${sale.id}`,
        risk_type: "after_hours_sale",
        severity: "review",
        receipt_number: sale.receipt_number,
        customer_name: sale.customer_name,
        amount: Number(sale.total || 0),
        occurred_at: sale.created_at,
        details: "Sale was recorded outside the normal 6:00 AM to 9:00 PM review window.",
      });
    }
  }

  for (const change of saleChanges) {
    riskFlags.push({
      id: `sale-change-${change.id}`,
      risk_type: `sale_${change.change_type || "change"}`,
      severity: "high",
      receipt_number: change.receipt_number,
      customer_name: change.customer_name,
      amount: Number(change.total || 0),
      occurred_at: change.created_at,
      details: `${String(change.change_type || "change").toUpperCase()} approved by ${change.approved_by_name || "unknown approver"}. Reason: ${change.reason || "No reason recorded"}`,
      changed_by_name: change.changed_by_name,
      approved_by_name: change.approved_by_name,
      affected_closing_id: change.affected_closing_id,
    });
  }

  for (const item of returns) {
    riskFlags.push({
      id: `return-${item.id}`,
      risk_type: Number(item.refund_amount || 0) > 0 ? "approved_refund" : `return_${item.return_type || "stock_only"}`,
      severity: Number(item.refund_amount || 0) > 0 ? "high" : "review",
      receipt_number: item.receipt_number,
      customer_name: item.customer_name,
      amount: Number(item.refund_amount || 0),
      occurred_at: item.returned_at,
      details: `${String(item.return_type || "stock_only").replaceAll("_", " ").toUpperCase()} return: ${item.quantity} x ${item.product_name || "item"}. Refund ${item.refund_method || "none"} GHS ${Number(item.refund_amount || 0).toFixed(2)}. Approved by ${item.approved_by_name || "not required"}.`,
    });
  }

  const expenseGroupsMap = new Map();
  for (const expense of expenses) {
    const category = cleanText(expense.category, 100) || "Other";
    const current = expenseGroupsMap.get(category) || {
      category,
      count: 0,
      total: 0,
    };
    current.count += 1;
    current.total = toMoney(current.total + Number(expense.amount || 0));
    expenseGroupsMap.set(category, current);
  }

  return {
    branch_id: branchId,
    branch: {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      location: branch.location,
    },
    closing_date: closingDate,

    sales_count: salesCount,
    sales_subtotal: salesSubtotal,
    gross_before_discount: grossBeforeDiscount,
    discount_total: discountTotal,
    tax_total: taxTotal,
    sales_total: salesTotal,
    sales_received: salesReceived,
    credit_created: creditCreated,

    cash_sales: cashGroup.amount_received,
    momo_sales: momoGroup.amount_received,
    bank_sales: bankGroup.amount_received,
    mixed_sales: mixedGroup.amount_received,
    credit_sales_total: creditGroup.net_sales,
    credit_sales_received: creditGroup.amount_received,
    sale_cash_received: saleCashReceived,
    sale_momo_received: saleMomoReceived,
    sale_bank_received: saleBankReceived,
    sale_other_received: saleOtherReceived,

    debt_payment_count: debtPaymentCount,
    debt_payments_total: debtPaymentsTotal,
    debt_cash: debtCash,
    debt_momo: debtMomo,
    debt_bank: debtBank,
    debt_other: debtOther,

    expenses_count: expensesCount,
    expenses_total: expensesTotal,
    expense_cash: expenseCash,
    expense_momo: expenseMomo,
    expense_bank: expenseBank,
    expense_other: expenseOther,

    return_count: returnCount,
    return_quantity: returnQuantity,
    refund_total: refundTotal,
    refund_cash: refundCash,
    refund_momo: refundMomo,
    refund_bank: refundBank,
    refund_other: refundOther,
    returns,

    ...cashControls,
    expected_cash: expectedCash,
    expected_momo: expectedMomo,
    expected_bank: expectedBank,
    expected_other: expectedOther,
    expected_total: expectedTotal,

    net_settlement: expectedTotal,
    payment_groups: paymentGroups,
    sales_transactions: salesTransactions.map((sale) => ({
      ...sale,
      gross_before_discount: toMoney(
        Number(sale.total || 0) + Number(sale.discount_amount || 0)
      ),
    })),
    debt_payments: debtPayments,
    expenses,
    expense_groups: Array.from(expenseGroupsMap.values()).sort((a, b) =>
      a.category.localeCompare(b.category)
    ),
    exceptions,
    exception_count: exceptions.length,
    risk_flags: riskFlags.sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at)),
    risk_flag_count: riskFlags.length,
    calculation_notes: [
      "Physical cash is calculated separately from MoMo, bank and other channels.",
      "Mixed and credit-sale payments use their recorded payment-channel allocation. Historical unallocated payments remain under Other / Unallocated.",
      "Expected physical cash is based on recorded Cash sales, Cash debt collections, Cash expenses and approved Cash refunds.",
      "Debt collections are separated from new sales so old debt payments are not confused with today's credit created.",
      "Approved return refunds are deducted from the payment channel used for the refund on the date the return was recorded.",
    ],
  };
}

function getCountedSnapshot(summary, existingClosing, source = {}) {
  const cash = toCountedMoney(
    source.cash_counted,
    existingClosing?.cash_counted ?? 0
  );
  const momo = toCountedMoney(
    source.momo_counted,
    existingClosing?.momo_counted ?? 0
  );
  const bank = toCountedMoney(
    source.bank_counted,
    existingClosing?.bank_counted ?? 0
  );
  const other = toCountedMoney(
    source.other_counted,
    existingClosing?.other_counted ?? 0
  );

  if ([cash, momo, bank, other].some((value) => value === null)) {
    return null;
  }

  const total = toMoney(cash + momo + bank + other);

  return {
    cash,
    momo,
    bank,
    other,
    total,
  };
}

function buildReconciliation(summary, counted) {
  const rows = [
    {
      key: "cash",
      label: "Physical Cash",
      expected: toMoney(summary.expected_cash),
      counted: toMoney(counted.cash),
    },
    {
      key: "momo",
      label: "Mobile Money",
      expected: toMoney(summary.expected_momo),
      counted: toMoney(counted.momo),
    },
    {
      key: "bank",
      label: "Bank",
      expected: toMoney(summary.expected_bank),
      counted: toMoney(counted.bank),
    },
    {
      key: "other",
      label: "Unallocated / Mixed",
      expected: toMoney(summary.expected_other),
      counted: toMoney(counted.other),
    },
  ].map((row) => ({
    ...row,
    difference: toMoney(row.counted - row.expected),
  }));

  return {
    rows,
    expected_total: toMoney(summary.expected_total),
    counted_total: toMoney(counted.total),
    difference_total: toMoney(counted.total - summary.expected_total),
  };
}

function getClosingStatus(existingClosing, differenceTotal) {
  const balanced = Math.abs(Number(differenceTotal || 0)) < 0.01;

  if (existingClosing) {
    if (Number(existingClosing.stale_after_close || 0) === 1) {
      return "Closed - Changed After Closing";
    }
    if (Number(existingClosing.counted_confirmed || 0) !== 1) {
      return "Closed - Legacy Count Unconfirmed";
    }
    if (existingClosing.verification_status === "verified") {
      return balanced ? "Closed - Independently Verified" : "Closed - Verified Variance";
    }
    return balanced ? "Closed - Awaiting Verification" : "Closed - Variance Review";
  }

  return balanced ? "Draft - Count Required" : "Draft - Variance";
}

async function buildClosingReportData(branchId, closingDate, countedSource = {}) {
  const summary = await calculateClosingSummary(branchId, closingDate, countedSource);
  const existingClosing = await getExistingClosing(branchId, closingDate);
  const revisions = await getClosingRevisions(existingClosing, branchId);
  const counted = getCountedSnapshot(summary, existingClosing, countedSource);

  if (!counted) {
    const error = new Error("Counted amounts must be valid non-negative numbers.");
    error.statusCode = 400;
    throw error;
  }

  const reconciliationSummary = existingClosing
    ? {
        ...summary,
        expected_cash: toMoney(existingClosing.expected_cash),
        expected_momo: toMoney(existingClosing.expected_momo),
        expected_bank: toMoney(existingClosing.expected_bank),
        expected_other: toMoney(existingClosing.expected_other),
        expected_total: toMoney(existingClosing.expected_total),
      }
    : summary;
  const reconciliation = buildReconciliation(reconciliationSummary, counted);
  const status = getClosingStatus(
    existingClosing,
    reconciliation.difference_total
  );
  const snapshotDifference = existingClosing
    ? toMoney(summary.expected_total - Number(existingClosing.expected_total || 0))
    : 0;

  return {
    summary,
    existing_closing: existingClosing,
    counted,
    reconciliation,
    status,
    notes: cleanText(
      existingClosing?.notes || countedSource.notes || "",
      5000
    ),
    cash_controls: getCashControls(existingClosing || countedSource),
    denominations: parseDenominations(existingClosing?.denomination_json || countedSource.denominations),
    denomination_total: toMoney(existingClosing?.denomination_total ?? calculateDenominationTotal(parseDenominations(countedSource.denominations)) ?? 0),
    snapshot_difference: snapshotDifference,
    revisions,
  };
}

function applyMoneyFormat(cell) {
  cell.numFmt = '"GHS" #,##0.00;[Red]-"GHS" #,##0.00';
}

function styleWorkbookTitle(sheet, range, text, fill = "0B1F35") {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]);
  cell.value = text;
  cell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(cell.row).height = 30;
}

function styleSectionRow(row, fill = "173F5F") {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
  row.alignment = { vertical: "middle" };
  row.height = 23;
}

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF235789" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 26;
  row.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });
}

function styleDataRange(sheet, fromRow, toRow, fromColumn, toColumn) {
  for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let columnNumber = fromColumn; columnNumber <= toColumn; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      cell.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
      }
    }
  }
}

function addKeyValueRows(sheet, rows, startRow = 1) {
  let rowNumber = startRow;
  for (const [label, value, isMoney = false] of rows) {
    const row = sheet.getRow(rowNumber);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: "FF334155" } };
    row.getCell(2).value = value;
    if (isMoney) applyMoneyFormat(row.getCell(2));
    rowNumber += 1;
  }
  return rowNumber;
}

function createDailyClosingWorkbook(reportData) {
  const {
    summary,
    existing_closing: existingClosing,
    reconciliation,
    status,
    notes,
    cash_controls: cashControls,
    denominations,
    denomination_total: denominationTotal,
    snapshot_difference: snapshotDifference,
    revisions,
  } = reportData;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chalin 03 Group Operations Platform";
  workbook.company = "Chalin 03 Company Limited";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Executive Summary", {
    views: [{ state: "frozen", ySplit: 6 }],
  });
  summarySheet.pageSetup = {
    orientation: "portrait",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  summarySheet.columns = [
    { width: 31 },
    { width: 23 },
    { width: 4 },
    { width: 31 },
    { width: 23 },
  ];

  styleWorkbookTitle(
    summarySheet,
    "A1:E1",
    "CHALIN 03 COMPANY LIMITED - DAILY CLOSING REPORT"
  );
  summarySheet.mergeCells("A2:E2");
  summarySheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name}`;
  summarySheet.getCell("A2").font = { bold: true, size: 13, color: { argb: "FF0B1F35" } };
  summarySheet.getCell("A2").alignment = { horizontal: "center" };
  summarySheet.mergeCells("A3:E3");
  summarySheet.getCell("A3").value = summary.branch.location || null;
  summarySheet.getCell("A3").alignment = { horizontal: "center" };
  summarySheet.mergeCells("A4:E4");
  summarySheet.getCell("A4").value = `Closing date: ${summary.closing_date}   |   Status: ${status}`;
  summarySheet.getCell("A4").font = { bold: true, color: { argb: "FF235789" } };
  summarySheet.getCell("A4").alignment = { horizontal: "center" };

  const leftRows = [
    ["Sales transactions", summary.sales_count],
    ["Gross before discount", summary.gross_before_discount, true],
    ["Discounts", summary.discount_total, true],
    ["Tax", summary.tax_total, true],
    ["Net sales", summary.sales_total, true],
    ["Received during sales", summary.sales_received, true],
  ];
  const rightRows = [
    ["Credit created today", summary.credit_created, true],
    ["Debt collections", summary.debt_payments_total, true],
    ["Expenses", summary.expenses_total, true],
    ["Return refunds", summary.refund_total, true],
    ["Expected net settlement", reconciliation.expected_total, true],
    ["Counted total", reconciliation.counted_total, true],
    ["Closing variance", reconciliation.difference_total, true],
  ];

  summarySheet.getRow(6).values = ["Sales and Collections", "Value", null, "Closing Control", "Value"];
  styleSectionRow(summarySheet.getRow(6));

  leftRows.forEach((entry, index) => {
    const row = 7 + index;
    summarySheet.getCell(row, 1).value = entry[0];
    summarySheet.getCell(row, 2).value = entry[1];
    summarySheet.getCell(row, 4).value = rightRows[index][0];
    summarySheet.getCell(row, 5).value = rightRows[index][1];
    summarySheet.getCell(row, 1).font = { bold: true };
    summarySheet.getCell(row, 4).font = { bold: true };
    if (entry[2]) applyMoneyFormat(summarySheet.getCell(row, 2));
    if (rightRows[index][2]) applyMoneyFormat(summarySheet.getCell(row, 5));
  });

  const reconciliationStart = 15;
  summarySheet.mergeCells(`A${reconciliationStart}:E${reconciliationStart}`);
  summarySheet.getCell(`A${reconciliationStart}`).value = "PAYMENT RECONCILIATION";
  styleSectionRow(summarySheet.getRow(reconciliationStart), "9B6A16");
  const reconciliationHeader = summarySheet.getRow(reconciliationStart + 1);
  reconciliationHeader.values = ["Payment channel", "System expected", null, "Counted / confirmed", "Difference"];
  styleHeaderRow(reconciliationHeader);

  reconciliation.rows.forEach((item, index) => {
    const row = summarySheet.getRow(reconciliationStart + 2 + index);
    row.values = [item.label, item.expected, null, item.counted, item.difference];
    applyMoneyFormat(row.getCell(2));
    applyMoneyFormat(row.getCell(4));
    applyMoneyFormat(row.getCell(5));
  });

  const totalRowNumber = reconciliationStart + 2 + reconciliation.rows.length;
  const totalRow = summarySheet.getRow(totalRowNumber);
  totalRow.values = [
    "TOTAL",
    reconciliation.expected_total,
    null,
    reconciliation.counted_total,
    reconciliation.difference_total,
  ];
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
  applyMoneyFormat(totalRow.getCell(2));
  applyMoneyFormat(totalRow.getCell(4));
  applyMoneyFormat(totalRow.getCell(5));

  let notesRow = totalRowNumber + 3;
  summarySheet.mergeCells(`A${notesRow}:E${notesRow}`);
  summarySheet.getCell(`A${notesRow}`).value = "CLOSING NOTES AND CONTROL INFORMATION";
  styleSectionRow(summarySheet.getRow(notesRow));
  notesRow += 1;
  const controlRows = [
    ["Prepared / closed by", existingClosing?.closed_by_name || "Draft - not closed"],
    ["Closed at", existingClosing?.closed_at ? formatDateTime(existingClosing.closed_at) : "Not yet closed"],
    ["Verification status", existingClosing?.verification_status || "submitted"],
    ["Verified by", existingClosing?.verified_by_name || "Pending"],
    ["Verified at", existingClosing?.verified_at ? formatDateTime(existingClosing.verified_at) : "-"],
    ["Optional denomination counter used", hasDenominationEvidence(denominations) ? "Yes" : "No"],
    ["Optional denomination total", hasDenominationEvidence(denominations) ? denominationTotal : 0, true],
    ["Count independently confirmed", existingClosing ? (Number(existingClosing.counted_confirmed || 0) === 1 ? "Yes" : "No") : "Draft"],
    ["Changed after closing", existingClosing ? (Number(existingClosing.stale_after_close || 0) === 1 ? "YES - MANAGEMENT REVIEW REQUIRED" : "No") : "Not closed"],
    ["Notes", notes || "No notes recorded"],
    ["Current data vs saved expected", snapshotDifference, true],
  ];
  for (const [label, value, isMoney] of controlRows) {
    summarySheet.getCell(notesRow, 1).value = label;
    summarySheet.getCell(notesRow, 1).font = { bold: true };
    summarySheet.mergeCells(notesRow, 2, notesRow, 5);
    summarySheet.getCell(notesRow, 2).value = value;
    summarySheet.getCell(notesRow, 2).alignment = { wrapText: true, vertical: "top" };
    if (isMoney) applyMoneyFormat(summarySheet.getCell(notesRow, 2));
    notesRow += 1;
  }

  notesRow += 1;
  summarySheet.mergeCells(`A${notesRow}:E${notesRow}`);
  summarySheet.getCell(`A${notesRow}`).value = "OPTIONAL CASH DENOMINATION COUNTER";
  styleSectionRow(summarySheet.getRow(notesRow), "166534");
  notesRow += 1;
  if (hasDenominationEvidence(denominations)) {
    const denominationLabels = { note_200: "GHS 200 notes", note_100: "GHS 100 notes", note_50: "GHS 50 notes", note_20: "GHS 20 notes", note_10: "GHS 10 notes", note_5: "GHS 5 notes", note_2: "GHS 2 notes", note_1: "GHS 1 notes", coins: "Coins total value" };
    for (const [key, label] of Object.entries(denominationLabels)) {
      summarySheet.getCell(notesRow, 1).value = label;
      summarySheet.getCell(notesRow, 1).font = { bold: true };
      summarySheet.getCell(notesRow, 2).value = Number(denominations?.[key] || 0);
      if (key === "coins") applyMoneyFormat(summarySheet.getCell(notesRow, 2));
      notesRow += 1;
    }
  } else {
    summarySheet.mergeCells(`A${notesRow}:E${notesRow}`);
    summarySheet.getCell(`A${notesRow}`).value =
      "Not used. Cash was entered directly as the physical counted amount.";
    summarySheet.getCell(`A${notesRow}`).alignment = { wrapText: true };
    notesRow += 1;
  }

  notesRow += 1;
  summarySheet.mergeCells(`A${notesRow}:E${notesRow}`);
  summarySheet.getCell(`A${notesRow}`).value = "Calculation notes";
  summarySheet.getCell(`A${notesRow}`).font = { bold: true };
  notesRow += 1;
  for (const note of summary.calculation_notes) {
    summarySheet.mergeCells(`A${notesRow}:E${notesRow}`);
    summarySheet.getCell(`A${notesRow}`).value = `- ${note}`;
    summarySheet.getCell(`A${notesRow}`).alignment = { wrapText: true, vertical: "top" };
    summarySheet.getRow(notesRow).height = 32;
    notesRow += 1;
  }

  styleDataRange(summarySheet, 7, 12, 1, 5);
  styleDataRange(summarySheet, reconciliationStart + 2, totalRowNumber - 1, 1, 5);

  const groupedSheet = workbook.addWorksheet("Grouped Sales", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  groupedSheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.2, right: 0.2, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  groupedSheet.columns = [
    { width: 12 },
    { width: 9 },
    { width: 25 },
    { width: 17 },
    { width: 17 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 16 },
    { width: 21 },
  ];
  styleWorkbookTitle(groupedSheet, "A1:K1", "GROUPED SALES TRANSACTIONS");
  groupedSheet.mergeCells("A2:K2");
  groupedSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  groupedSheet.getCell("A2").alignment = { horizontal: "center" };
  groupedSheet.getCell("A2").font = { bold: true };

  let groupedRow = 4;
  const groupTotals = {
    gross: 0,
    discount: 0,
    net: 0,
    received: 0,
    outstanding: 0,
  };

  for (const groupDefinition of PAYMENT_GROUPS) {
    const group = findPaymentGroup(summary.payment_groups, groupDefinition.key);
    const transactions = summary.sales_transactions.filter(
      (sale) => sale.payment_type === groupDefinition.key
    );

    groupedSheet.mergeCells(groupedRow, 1, groupedRow, 11);
    groupedSheet.getCell(groupedRow, 1).value = `${groupDefinition.label.toUpperCase()} (${transactions.length} transaction${transactions.length === 1 ? "" : "s"})`;
    styleSectionRow(groupedSheet.getRow(groupedRow), groupDefinition.key === "credit" ? "8B2E2E" : "173F5F");
    groupedRow += 1;

    const headerRow = groupedSheet.getRow(groupedRow);
    headerRow.values = [
      "Date",
      "Time",
      "Customer",
      "Receipt No.",
      "Gross",
      "Discount",
      "Tax",
      "Net",
      "Received",
      "Outstanding",
      "Staff",
    ];
    styleHeaderRow(headerRow);
    groupedRow += 1;

    const dataStart = groupedRow;
    if (transactions.length === 0) {
      groupedSheet.mergeCells(groupedRow, 1, groupedRow, 11);
      groupedSheet.getCell(groupedRow, 1).value = "No transactions in this group.";
      groupedSheet.getCell(groupedRow, 1).font = { italic: true, color: { argb: "FF64748B" } };
      groupedRow += 1;
    } else {
      for (const sale of transactions) {
        const row = groupedSheet.getRow(groupedRow);
        row.values = [
          formatDate(sale.created_at),
          formatTime(sale.created_at),
          sale.customer_name,
          sale.receipt_number,
          Number(sale.gross_before_discount || 0),
          Number(sale.discount_amount || 0),
          Number(sale.tax_amount || 0),
          Number(sale.total || 0),
          Number(sale.amount_paid || 0),
          Number(sale.balance || 0),
          sale.staff_name || "-",
        ];
        [5, 6, 7, 8, 9, 10].forEach((column) => applyMoneyFormat(row.getCell(column)));
        groupedRow += 1;
      }
      styleDataRange(groupedSheet, dataStart, groupedRow - 1, 1, 11);
    }

    const subtotalRow = groupedSheet.getRow(groupedRow);
    subtotalRow.values = [
      "SUBTOTAL",
      null,
      null,
      null,
      group.gross_before_discount,
      group.discount_total,
      group.tax_total,
      group.net_sales,
      group.amount_received,
      group.outstanding_created,
      null,
    ];
    subtotalRow.font = { bold: true };
    subtotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
    [5, 6, 7, 8, 9, 10].forEach((column) => applyMoneyFormat(subtotalRow.getCell(column)));
    groupedRow += 2;

    groupTotals.gross = toMoney(groupTotals.gross + group.gross_before_discount);
    groupTotals.discount = toMoney(groupTotals.discount + group.discount_total);
    groupTotals.net = toMoney(groupTotals.net + group.net_sales);
    groupTotals.received = toMoney(groupTotals.received + group.amount_received);
    groupTotals.outstanding = toMoney(groupTotals.outstanding + group.outstanding_created);
  }

  const grandTotalRow = groupedSheet.getRow(groupedRow);
  grandTotalRow.values = [
    "GRAND TOTAL",
    null,
    null,
    null,
    groupTotals.gross,
    groupTotals.discount,
    summary.tax_total,
    groupTotals.net,
    groupTotals.received,
    groupTotals.outstanding,
    null,
  ];
  grandTotalRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F35" } };
  [5, 6, 7, 8, 9, 10].forEach((column) => applyMoneyFormat(grandTotalRow.getCell(column)));

  const collectionsSheet = workbook.addWorksheet("Debt Collections");
  collectionsSheet.columns = [
    { width: 13 },
    { width: 10 },
    { width: 25 },
    { width: 18 },
    { width: 17 },
    { width: 16 },
    { width: 22 },
    { width: 35 },
  ];
  styleWorkbookTitle(collectionsSheet, "A1:H1", "DEBT COLLECTIONS RECEIVED");
  collectionsSheet.mergeCells("A2:H2");
  collectionsSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  collectionsSheet.getCell("A2").alignment = { horizontal: "center" };
  collectionsSheet.getCell("A2").font = { bold: true };
  const collectionsHeader = collectionsSheet.getRow(4);
  collectionsHeader.values = [
    "Date",
    "Time",
    "Customer",
    "Original Receipt",
    "Payment Method",
    "Amount",
    "Received By",
    "Notes",
  ];
  styleHeaderRow(collectionsHeader);
  let collectionRow = 5;
  for (const payment of summary.debt_payments) {
    const row = collectionsSheet.getRow(collectionRow);
    row.values = [
      formatDate(payment.paid_at),
      formatTime(payment.paid_at),
      payment.customer_name,
      payment.receipt_number,
      String(payment.payment_method || "other").toUpperCase(),
      Number(payment.amount || 0),
      payment.received_by_name,
      payment.notes || null,
    ];
    applyMoneyFormat(row.getCell(6));
    collectionRow += 1;
  }
  if (collectionRow === 5) {
    collectionsSheet.mergeCells("A5:H5");
    collectionsSheet.getCell("A5").value = "No debt collections were recorded for this date.";
    collectionRow = 6;
  } else {
    styleDataRange(collectionsSheet, 5, collectionRow - 1, 1, 8);
  }
  const collectionTotalRow = collectionsSheet.getRow(collectionRow);
  collectionTotalRow.values = ["TOTAL", null, null, null, null, summary.debt_payments_total, null, null];
  collectionTotalRow.font = { bold: true };
  collectionTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
  applyMoneyFormat(collectionTotalRow.getCell(6));

  const expensesSheet = workbook.addWorksheet("Expenses");
  expensesSheet.columns = [
    { width: 13 },
    { width: 24 },
    { width: 18 },
    { width: 17 },
    { width: 46 },
    { width: 23 },
  ];
  styleWorkbookTitle(expensesSheet, "A1:F1", "DAILY EXPENSES");
  expensesSheet.mergeCells("A2:F2");
  expensesSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  expensesSheet.getCell("A2").alignment = { horizontal: "center" };
  expensesSheet.getCell("A2").font = { bold: true };
  const expensesHeader = expensesSheet.getRow(4);
  expensesHeader.values = ["Date", "Category", "Amount", "Payment Method", "Description", "Recorded By"];
  styleHeaderRow(expensesHeader);
  let expenseRow = 5;
  for (const expense of summary.expenses) {
    const row = expensesSheet.getRow(expenseRow);
    row.values = [
      formatDate(expense.expense_date),
      expense.category,
      Number(expense.amount || 0),
      String(expense.payment_method || "cash").toUpperCase(),
      expense.description || null,
      expense.recorded_by_name,
    ];
    applyMoneyFormat(row.getCell(3));
    expenseRow += 1;
  }
  if (expenseRow === 5) {
    expensesSheet.mergeCells("A5:F5");
    expensesSheet.getCell("A5").value = "No expenses were recorded for this date.";
    expenseRow = 6;
  } else {
    styleDataRange(expensesSheet, 5, expenseRow - 1, 1, 6);
  }
  const expenseTotalRow = expensesSheet.getRow(expenseRow);
  expenseTotalRow.values = ["TOTAL", null, summary.expenses_total, null, null, null];
  expenseTotalRow.font = { bold: true };
  expenseTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
  applyMoneyFormat(expenseTotalRow.getCell(3));

  const returnsSheet = workbook.addWorksheet("Returns & Refunds");
  returnsSheet.columns = [
    { width: 15 },
    { width: 10 },
    { width: 18 },
    { width: 24 },
    { width: 28 },
    { width: 10 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
    { width: 24 },
    { width: 22 },
    { width: 22 },
  ];
  styleWorkbookTitle(returnsSheet, "A1:L1", "RETURNS AND APPROVED REFUNDS");
  returnsSheet.mergeCells("A2:L2");
  returnsSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  returnsSheet.getCell("A2").alignment = { horizontal: "center" };
  returnsSheet.getCell("A2").font = { bold: true };
  const returnHeader = returnsSheet.getRow(4);
  returnHeader.values = [
    "Date", "Time", "Receipt", "Customer", "Product", "Quantity",
    "Return Type", "Refund Method", "Refund Amount", "Reference",
    "Recorded By", "Approved By",
  ];
  styleHeaderRow(returnHeader);
  let returnRow = 5;
  for (const item of summary.returns || []) {
    const row = returnsSheet.getRow(returnRow);
    row.values = [
      formatDate(item.returned_at),
      formatTime(item.returned_at),
      item.receipt_number || null,
      item.customer_name || null,
      item.product_name || null,
      Number(item.quantity || 0),
      String(item.return_type || "stock_only").replaceAll("_", " ").toUpperCase(),
      String(item.refund_method || "none").toUpperCase(),
      Number(item.refund_amount || 0),
      item.refund_reference || null,
      item.returned_by_name || "System",
      item.approved_by_name || "-",
    ];
    applyMoneyFormat(row.getCell(9));
    returnRow += 1;
  }
  if (returnRow === 5) {
    returnsSheet.mergeCells("A5:L5");
    returnsSheet.getCell("A5").value = "No returns or refunds were recorded for this date.";
  } else {
    styleDataRange(returnsSheet, 5, returnRow - 1, 1, 12);
  }
  const returnTotalRow = returnsSheet.getRow(returnRow);
  returnTotalRow.values = ["TOTAL REFUNDS", null, null, null, null, summary.return_quantity || 0, null, null, summary.refund_total || 0, null, null, null];
  returnTotalRow.font = { bold: true };
  returnTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
  applyMoneyFormat(returnTotalRow.getCell(9));
  returnsSheet.pageSetup = {
    orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.2, right: 0.2, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  returnsSheet.views = [{ state: "frozen", ySplit: 4 }];
  returnsSheet.autoFilter = { from: "A4", to: "L4" };

  const exceptionsSheet = workbook.addWorksheet("Exceptions");
  exceptionsSheet.columns = [
    { width: 13 },
    { width: 10 },
    { width: 25 },
    { width: 18 },
    { width: 16 },
    { width: 15 },
    { width: 16 },
    { width: 42 },
    { width: 22 },
  ];
  styleWorkbookTitle(exceptionsSheet, "A1:I1", "VOIDED, RETURNED AND CANCELLED SALES");
  exceptionsSheet.mergeCells("A2:I2");
  exceptionsSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  exceptionsSheet.getCell("A2").alignment = { horizontal: "center" };
  exceptionsSheet.getCell("A2").font = { bold: true };
  const exceptionsHeader = exceptionsSheet.getRow(4);
  exceptionsHeader.values = [
    "Date",
    "Time",
    "Customer",
    "Receipt",
    "Payment Type",
    "Total",
    "Status",
    "Reason",
    "Staff",
  ];
  styleHeaderRow(exceptionsHeader);
  let exceptionRow = 5;
  for (const item of summary.exceptions) {
    const row = exceptionsSheet.getRow(exceptionRow);
    row.values = [
      formatDate(item.created_at),
      formatTime(item.created_at),
      item.customer_name,
      item.receipt_number,
      String(item.payment_type || "unknown").toUpperCase(),
      Number(item.total || 0),
      item.is_voided ? "VOIDED" : String(item.sale_status || "unknown").toUpperCase(),
      item.void_reason || null,
      item.staff_name,
    ];
    applyMoneyFormat(row.getCell(6));
    exceptionRow += 1;
  }
  if (exceptionRow === 5) {
    exceptionsSheet.mergeCells("A5:I5");
    exceptionsSheet.getCell("A5").value = "No voided, returned or cancelled sales were found for this date.";
  } else {
    styleDataRange(exceptionsSheet, 5, exceptionRow - 1, 1, 9);
  }

  const riskSheet = workbook.addWorksheet("Security Flags");
  riskSheet.columns = [
    { width: 15 },
    { width: 10 },
    { width: 24 },
    { width: 19 },
    { width: 24 },
    { width: 18 },
    { width: 70 },
  ];
  styleWorkbookTitle(riskSheet, "A1:G1", "CLEAN-HANDS SECURITY AND ERROR INDICATORS");
  riskSheet.mergeCells("A2:G2");
  riskSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  riskSheet.getCell("A2").alignment = { horizontal: "center" };
  riskSheet.getCell("A2").font = { bold: true };
  const riskHeader = riskSheet.getRow(4);
  riskHeader.values = ["Date", "Time", "Risk Type", "Severity", "Receipt", "Amount", "Details"];
  styleHeaderRow(riskHeader);
  let riskRow = 5;
  for (const item of summary.risk_flags || []) {
    const row = riskSheet.getRow(riskRow);
    row.values = [
      formatDate(item.occurred_at),
      formatTime(item.occurred_at),
      String(item.risk_type || "review").replaceAll("_", " "),
      String(item.severity || "review").toUpperCase(),
      item.receipt_number || null,
      Number(item.amount || 0),
      item.details || null,
    ];
    applyMoneyFormat(row.getCell(6));
    riskRow += 1;
  }
  if (riskRow === 5) {
    riskSheet.mergeCells("A5:G5");
    riskSheet.getCell("A5").value = "No configured security or error indicators were detected for this date.";
  } else {
    styleDataRange(riskSheet, 5, riskRow - 1, 1, 7);
  }

  const revisionSheet = workbook.addWorksheet("Closing Revisions");
  revisionSheet.columns = [
    { width: 10 },
    { width: 23 },
    { width: 24 },
    { width: 48 },
    { width: 19 },
    { width: 19 },
    { width: 19 },
    { width: 20 },
    { width: 20 },
    { width: 22 },
  ];
  styleWorkbookTitle(revisionSheet, "A1:J1", "IMMUTABLE DAILY CLOSING REVISION HISTORY");
  revisionSheet.mergeCells("A2:J2");
  revisionSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  revisionSheet.getCell("A2").alignment = { horizontal: "center" };
  revisionSheet.getCell("A2").font = { bold: true };
  const revisionHeader = revisionSheet.getRow(4);
  revisionHeader.values = [
    "Version",
    "Revision Type",
    "Created At",
    "Reason",
    "Expected Cash",
    "Expected Total",
    "Counted Total",
    "Difference",
    "Changed By",
    "Approved By",
  ];
  styleHeaderRow(revisionHeader);
  let revisionRow = 5;
  for (const item of revisions || []) {
    const expected = item.expected_snapshot || {};
    const countedSnapshot = item.counted_snapshot || {};
    const expectedTotal = toMoney(
      revisionSnapshotValue(expected, "expected_total", revisionSnapshotValue(expected, "total", 0))
    );
    const expectedCash = toMoney(
      revisionSnapshotValue(expected, "expected_cash", revisionSnapshotValue(expected, "cash", 0))
    );
    const countedTotal = toMoney(
      revisionSnapshotValue(countedSnapshot, "counted_total", revisionSnapshotValue(countedSnapshot, "total", 0))
    );
    const row = revisionSheet.getRow(revisionRow);
    row.values = [
      Number(item.revision_number || 0),
      String(item.revision_type || "review").replaceAll("_", " ").toUpperCase(),
      formatDateTime(item.created_at),
      item.reason || null,
      expectedCash,
      expectedTotal,
      countedTotal,
      Number(item.difference_total || countedTotal - expectedTotal || 0),
      item.changed_by_name || "System",
      item.approved_by_name || "-",
    ];
    [5, 6, 7, 8].forEach((column) => applyMoneyFormat(row.getCell(column)));
    revisionRow += 1;
  }
  if (revisionRow === 5) {
    revisionSheet.mergeCells("A5:J5");
    revisionSheet.getCell("A5").value = existingClosing
      ? "No revision history was found. Run the cash-control migration verification before relying on this report."
      : "Draft report - revision history begins when the closing is submitted.";
  } else {
    styleDataRange(revisionSheet, 5, revisionRow - 1, 1, 10);
  }
  revisionSheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  revisionSheet.views = [{ state: "frozen", ySplit: 4 }];
  revisionSheet.autoFilter = { from: "A4", to: "J4" };

  [summarySheet, groupedSheet, collectionsSheet, expensesSheet, returnsSheet, exceptionsSheet, riskSheet, revisionSheet].forEach((sheet) => {
    sheet.properties.defaultRowHeight = 18;
    sheet.headerFooter.oddFooter = "Chalin 03 Daily Closing | Page &P of &N";
  });

  return workbook;
}

function ensurePdfSpace(doc, requiredHeight = 45) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + requiredHeight > bottom) {
    doc.addPage();
  }
}

function drawPdfHeader(doc, reportData) {
  const { summary, status } = reportData;
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor("#0B1F35")
    .text("CHALIN 03 COMPANY LIMITED", { align: "center" });
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`${summary.branch.code} - ${summary.branch.name}`, { align: "center" });
  if (summary.branch.location) {
    doc.font("Helvetica").fontSize(9).text(summary.branch.location, { align: "center" });
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#235789")
    .text(`DAILY CLOSING REPORT | ${summary.closing_date} | ${status}`, {
      align: "center",
    });
  doc.moveDown(0.5);
  doc.strokeColor("#CBD5E1").moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fillColor("#111827");
}

function drawPdfSectionTitle(doc, title) {
  ensurePdfSpace(doc, 35);
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save();
  doc.rect(x, doc.y, width, 22).fill("#173F5F");
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(10).text(title, x + 8, doc.y + 6, {
    width: width - 16,
  });
  doc.restore();
  doc.y += 28;
  doc.fillColor("#111827");
}

function drawPdfKeyValueGrid(doc, entries, columns = 2) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 10;
  const cellWidth = (pageWidth - gap * (columns - 1)) / columns;
  const cellHeight = 43;
  let index = 0;

  while (index < entries.length) {
    ensurePdfSpace(doc, cellHeight + 8);
    const startY = doc.y;
    for (let column = 0; column < columns && index < entries.length; column += 1, index += 1) {
      const [label, value] = entries[index];
      const x = doc.page.margins.left + column * (cellWidth + gap);
      doc.save();
      doc.roundedRect(x, startY, cellWidth, cellHeight, 5).fillAndStroke("#F8FAFC", "#CBD5E1");
      doc.fillColor("#64748B").font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x + 8, startY + 7, {
        width: cellWidth - 16,
      });
      doc.fillColor("#0B1F35").font("Helvetica-Bold").fontSize(11).text(value, x + 8, startY + 21, {
        width: cellWidth - 16,
      });
      doc.restore();
    }
    doc.y = startY + cellHeight + 8;
  }
}

function drawPdfTable(doc, columns, rows, options = {}) {
  const xStart = doc.page.margins.left;
  const headerHeight = options.headerHeight || 22;
  const rowHeight = options.rowHeight || 20;
  const fontSize = options.fontSize || 7.5;
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  function drawHeader() {
    ensurePdfSpace(doc, headerHeight + rowHeight);
    let x = xStart;
    const y = doc.y;
    for (const column of columns) {
      doc.rect(x, y, column.width, headerHeight).fillAndStroke("#235789", "#CBD5E1");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7).text(column.label, x + 3, y + 6, {
        width: column.width - 6,
        align: column.align || "left",
      });
      x += column.width;
    }
    doc.y = y + headerHeight;
    doc.fillColor("#111827");
  }

  drawHeader();

  if (rows.length === 0) {
    doc.rect(xStart, doc.y, totalWidth, rowHeight).stroke("#CBD5E1");
    doc.font("Helvetica-Oblique").fontSize(fontSize).fillColor("#64748B").text(options.emptyText || "No records.", xStart + 5, doc.y + 6, {
      width: totalWidth - 10,
    });
    doc.y += rowHeight + 6;
    doc.fillColor("#111827");
    return;
  }

  rows.forEach((rowData, index) => {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (options.repeatTitle) {
        drawPdfSectionTitle(doc, options.repeatTitle);
      }
      drawHeader();
    }

    let x = xStart;
    const y = doc.y;
    const fill = index % 2 === 0 ? "#FFFFFF" : "#F8FAFC";

    columns.forEach((column) => {
      const raw = typeof column.value === "function" ? column.value(rowData) : rowData[column.key];
      const value = column.format ? column.format(raw, rowData) : raw;
      doc.rect(x, y, column.width, rowHeight).fillAndStroke(fill, "#E2E8F0");
      doc.fillColor("#111827").font("Helvetica").fontSize(fontSize).text(truncateText(value, column.maxLength || 32), x + 3, y + 5, {
        width: column.width - 6,
        align: column.align || "left",
        lineBreak: false,
      });
      x += column.width;
    });

    doc.y = y + rowHeight;
  });

  doc.y += 6;
}

function createDailyClosingPdf(reportData, res) {
  const {
    summary,
    existing_closing: existingClosing,
    reconciliation,
    status,
    notes,
    snapshot_difference: snapshotDifference,
    revisions,
  } = reportData;

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 30,
    bufferPages: true,
    info: {
      Title: `Chalin 03 Daily Closing - ${summary.branch.code} - ${summary.closing_date}`,
      Author: "Chalin 03 Group Operations Platform",
      Subject: "Daily closing, grouped sales and reconciliation report",
    },
  });

  doc.pipe(res);
  drawPdfHeader(doc, reportData);

  drawPdfSectionTitle(doc, "EXECUTIVE SUMMARY");
  drawPdfKeyValueGrid(doc, [
    ["Gross before discount", moneyText(summary.gross_before_discount)],
    ["Discounts", moneyText(summary.discount_total)],
    ["Net sales", moneyText(summary.sales_total)],
    ["Received during sales", moneyText(summary.sales_received)],
    ["Credit created today", moneyText(summary.credit_created)],
    ["Debt collections", moneyText(summary.debt_payments_total)],
    ["Expenses", moneyText(summary.expenses_total)],
    ["Return refunds", moneyText(summary.refund_total)],
    ["Expected net settlement", moneyText(reconciliation.expected_total)],
    ["Counted total", moneyText(reconciliation.counted_total)],
    ["Closing variance", moneyText(reconciliation.difference_total)],
  ], 5);

  drawPdfSectionTitle(doc, "PAYMENT RECONCILIATION");
  drawPdfTable(
    doc,
    [
      { key: "label", label: "Payment Channel", width: 170 },
      { key: "expected", label: "System Expected", width: 130, align: "right", format: moneyText },
      { key: "counted", label: "Counted / Confirmed", width: 140, align: "right", format: moneyText },
      { key: "difference", label: "Difference", width: 130, align: "right", format: moneyText },
    ],
    reconciliation.rows,
    { rowHeight: 22, fontSize: 8 }
  );
  doc.font("Helvetica-Bold").fontSize(9).text(
    `TOTAL: Expected ${moneyText(reconciliation.expected_total)} | Counted ${moneyText(reconciliation.counted_total)} | Difference ${moneyText(reconciliation.difference_total)}`,
    { align: "right" }
  );
  doc.moveDown(0.7);

  const salesColumns = [
    { key: "created_at", label: "Time", width: 45, format: formatTime, maxLength: 8 },
    { key: "customer_name", label: "Customer", width: 126, maxLength: 24 },
    { key: "receipt_number", label: "Receipt", width: 82, maxLength: 15 },
    { key: "gross_before_discount", label: "Gross", width: 75, align: "right", format: moneyText, maxLength: 18 },
    { key: "discount_amount", label: "Discount", width: 70, align: "right", format: moneyText, maxLength: 18 },
    { key: "total", label: "Net", width: 75, align: "right", format: moneyText, maxLength: 18 },
    { key: "amount_paid", label: "Received", width: 78, align: "right", format: moneyText, maxLength: 18 },
    { key: "balance", label: "Outstanding", width: 82, align: "right", format: moneyText, maxLength: 18 },
    { key: "staff_name", label: "Staff", width: 88, maxLength: 18 },
  ];

  for (const groupDefinition of PAYMENT_GROUPS) {
    const group = findPaymentGroup(summary.payment_groups, groupDefinition.key);
    const transactions = summary.sales_transactions.filter(
      (sale) => sale.payment_type === groupDefinition.key
    );
    drawPdfSectionTitle(doc, `${groupDefinition.label.toUpperCase()} - ${transactions.length} TRANSACTION(S)`);
    drawPdfTable(doc, salesColumns, transactions, {
      repeatTitle: groupDefinition.label.toUpperCase(),
      emptyText: "No transactions in this payment group.",
      rowHeight: 20,
      fontSize: 6.7,
    });
    doc.font("Helvetica-Bold").fontSize(8).text(
      `Subtotal: Gross ${moneyText(group.gross_before_discount)} | Discount ${moneyText(group.discount_total)} | Net ${moneyText(group.net_sales)} | Received ${moneyText(group.amount_received)} | Outstanding ${moneyText(group.outstanding_created)}`,
      doc.page.margins.left,
      doc.y,
      {
        width:
          doc.page.width -
          doc.page.margins.left -
          doc.page.margins.right,
        align: "right",
      }
    );
    doc.moveDown(0.6);
  }

  drawPdfSectionTitle(doc, "DEBT COLLECTIONS");
  drawPdfTable(
    doc,
    [
      { key: "paid_at", label: "Time", width: 50, format: formatTime, maxLength: 8 },
      { key: "customer_name", label: "Customer", width: 150, maxLength: 28 },
      { key: "receipt_number", label: "Original Receipt", width: 105, maxLength: 18 },
      { key: "payment_method", label: "Method", width: 75, format: (value) => String(value || "").toUpperCase() },
      { key: "amount", label: "Amount", width: 90, align: "right", format: moneyText, maxLength: 18 },
      { key: "received_by_name", label: "Received By", width: 120, maxLength: 22 },
      { key: "notes", label: "Notes", width: 130, maxLength: 28 },
    ],
    summary.debt_payments,
    { emptyText: "No debt collections recorded.", rowHeight: 20, fontSize: 7 }
  );
  doc.font("Helvetica-Bold").fontSize(8).text(
    `Debt collections total: ${moneyText(summary.debt_payments_total)}`,
    doc.page.margins.left,
    doc.y,
    {
      width:
        doc.page.width -
        doc.page.margins.left -
        doc.page.margins.right,
      align: "right",
    }
  );
  doc.moveDown(0.6);

  drawPdfSectionTitle(doc, "EXPENSES");
  drawPdfTable(
    doc,
    [
      { key: "category", label: "Category", width: 120, maxLength: 22 },
      { key: "description", label: "Description", width: 245, maxLength: 48 },
      { key: "payment_method", label: "Method", width: 80, format: (value) => String(value || "other").toUpperCase(), maxLength: 12 },
      { key: "amount", label: "Amount", width: 95, align: "right", format: moneyText, maxLength: 18 },
      { key: "recorded_by_name", label: "Recorded By", width: 120, maxLength: 22 },
    ],
    summary.expenses,
    { emptyText: "No expenses recorded.", rowHeight: 20, fontSize: 7 }
  );
  doc.font("Helvetica-Bold").fontSize(8).text(
    `Expenses total: ${moneyText(summary.expenses_total)}`,
    doc.page.margins.left,
    doc.y,
    {
      width:
        doc.page.width -
        doc.page.margins.left -
        doc.page.margins.right,
      align: "right",
    }
  );
  doc.moveDown(0.6);

  drawPdfSectionTitle(doc, "RETURNS AND APPROVED REFUNDS");
  drawPdfTable(
    doc,
    [
      { key: "returned_at", label: "Time", width: 48, format: formatTime, maxLength: 8 },
      { key: "receipt_number", label: "Receipt", width: 85, maxLength: 16 },
      { key: "customer_name", label: "Customer", width: 115, maxLength: 22 },
      { key: "product_name", label: "Product", width: 135, maxLength: 26 },
      { key: "quantity", label: "Qty", width: 42, align: "right", maxLength: 8 },
      { key: "return_type", label: "Type", width: 82, format: (value) => String(value || "stock_only").replaceAll("_", " ").toUpperCase(), maxLength: 16 },
      { key: "refund_method", label: "Refund Method", width: 78, format: (value) => String(value || "none").toUpperCase(), maxLength: 12 },
      { key: "refund_amount", label: "Refund", width: 78, align: "right", format: moneyText, maxLength: 18 },
      { key: "approved_by_name", label: "Approved By", width: 100, maxLength: 20 },
    ],
    summary.returns || [],
    { emptyText: "No returns or refunds were recorded for this date.", rowHeight: 20, fontSize: 6.5 }
  );
  doc.font("Helvetica-Bold").fontSize(8).text(
    `Return quantity: ${Number(summary.return_quantity || 0)} | Approved refunds: ${moneyText(summary.refund_total)}`,
    doc.page.margins.left,
    doc.y,
    {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "right",
    }
  );
  doc.moveDown(0.6);

  drawPdfSectionTitle(doc, "EXCEPTIONS AND CONTROL NOTES");
  drawPdfTable(
    doc,
    [
      { key: "created_at", label: "Time", width: 50, format: formatTime, maxLength: 8 },
      { key: "customer_name", label: "Customer", width: 135, maxLength: 25 },
      { key: "receipt_number", label: "Receipt", width: 95, maxLength: 18 },
      { key: "total", label: "Total", width: 90, align: "right", format: moneyText, maxLength: 18 },
      {
        key: "status",
        label: "Status",
        width: 90,
        value: (item) => (item.is_voided ? "VOIDED" : String(item.sale_status || "unknown").toUpperCase()),
      },
      { key: "void_reason", label: "Reason", width: 235, maxLength: 50 },
    ],
    summary.exceptions,
    { emptyText: "No voided, returned or cancelled sales.", rowHeight: 20, fontSize: 7 }
  );

  drawPdfSectionTitle(doc, "CLEAN-HANDS SECURITY AND ERROR INDICATORS");
  drawPdfTable(
    doc,
    [
      { key: "occurred_at", label: "Time", width: 60, format: formatTime, maxLength: 8 },
      { key: "risk_type", label: "Risk Type", width: 135, format: (value) => String(value || "review").replaceAll("_", " ").toUpperCase(), maxLength: 28 },
      { key: "severity", label: "Severity", width: 78, format: (value) => String(value || "review").toUpperCase(), maxLength: 12 },
      { key: "receipt_number", label: "Receipt", width: 90, maxLength: 16 },
      { key: "amount", label: "Amount", width: 90, align: "right", format: moneyText, maxLength: 18 },
      { key: "details", label: "Details", width: 268, maxLength: 58 },
    ],
    summary.risk_flags || [],
    { emptyText: "No configured security or error indicators were detected for this date.", rowHeight: 21, fontSize: 6.8 }
  );

  drawPdfSectionTitle(doc, "IMMUTABLE DAILY CLOSING REVISION HISTORY");
  const revisionRows = (revisions || []).map((item) => {
    const expected = item.expected_snapshot || {};
    const countedSnapshot = item.counted_snapshot || {};
    const expectedTotal = toMoney(revisionSnapshotValue(expected, "expected_total", revisionSnapshotValue(expected, "total", 0)));
    const countedTotal = toMoney(revisionSnapshotValue(countedSnapshot, "counted_total", revisionSnapshotValue(countedSnapshot, "total", 0)));
    return {
      ...item,
      revision_label: `V${Number(item.revision_number || 0)}`,
      revision_type_label: String(item.revision_type || "review").replaceAll("_", " ").toUpperCase(),
      expected_total_report: expectedTotal,
      counted_total_report: countedTotal,
      difference_total_report: toMoney(item.difference_total ?? countedTotal - expectedTotal),
    };
  });
  drawPdfTable(
    doc,
    [
      { key: "revision_label", label: "Version", width: 48, maxLength: 8 },
      { key: "revision_type_label", label: "Type", width: 115, maxLength: 24 },
      { key: "created_at", label: "Created", width: 105, format: formatDateTime, maxLength: 20 },
      { key: "reason", label: "Reason", width: 210, maxLength: 44 },
      { key: "expected_total_report", label: "Expected", width: 82, align: "right", format: moneyText, maxLength: 18 },
      { key: "counted_total_report", label: "Counted", width: 82, align: "right", format: moneyText, maxLength: 18 },
      { key: "difference_total_report", label: "Difference", width: 82, align: "right", format: moneyText, maxLength: 18 },
    ],
    revisionRows,
    { emptyText: existingClosing ? "No revision history found - migration verification is required." : "Draft report - no revisions yet.", rowHeight: 21, fontSize: 6.5 }
  );

  ensurePdfSpace(doc, 145);
  doc.font("Helvetica-Bold").fontSize(9).text("Closing notes:");
  doc.font("Helvetica").fontSize(8).text(notes || "No notes recorded.", { width: 720 });
  doc.moveDown(0.4);
  if (existingClosing) {
    doc.font("Helvetica").fontSize(8).text(
      `Closed by: ${existingClosing.closed_by_name || "-"} | Closed at: ${formatDateTime(existingClosing.closed_at)}`
    );
    doc.font("Helvetica").fontSize(8).text(
      `Verification: ${existingClosing.verification_status || "submitted"} | Verified by: ${existingClosing.verified_by_name || "Pending"} | Verified at: ${existingClosing.verified_at ? formatDateTime(existingClosing.verified_at) : "-"}`
    );
  } else {
    doc.font("Helvetica-Oblique").fontSize(8).text("Draft report - the day has not been closed yet.");
  }
  if (Math.abs(snapshotDifference) >= 0.01) {
    doc.fillColor("#B91C1C").font("Helvetica-Bold").text(
      `WARNING: Current calculated expected total differs from the saved closing snapshot by ${moneyText(snapshotDifference)}.`
    );
    doc.fillColor("#111827");
  }
  doc.moveDown(0.7);
  summary.calculation_notes.forEach((note) => {
    doc.font("Helvetica").fontSize(7.5).text(`- ${note}`, { width: 720 });
  });
  doc.moveDown(1.4);

  const signatureY = doc.y;
  const signatureWidth = 210;
  const signatureGap = 35;
  const signatureX = doc.page.margins.left;
  [
    ["Prepared / Closed By", existingClosing?.closed_by_name || ""],
    ["Reviewed By", existingClosing?.verified_by_name || ""],
    ["Management Approval", ""],
  ].forEach(([label, name], index) => {
    const x = signatureX + index * (signatureWidth + signatureGap);
    doc.moveTo(x, signatureY + 28).lineTo(x + signatureWidth, signatureY + 28).stroke("#64748B");
    doc.font("Helvetica-Bold").fontSize(7.5).text(label, x, signatureY + 33, { width: signatureWidth, align: "center" });
    if (name) {
      doc.font("Helvetica").fontSize(8).text(name, x, signatureY + 5, { width: signatureWidth, align: "center" });
    }
  });

  const pageRange = doc.bufferedPageRange();
  for (
    let index = pageRange.start;
    index < pageRange.start + pageRange.count;
    index += 1
  ) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor("#64748B").text(
      `Chalin 03 Daily Closing | ${summary.branch.code} | ${summary.closing_date} | Page ${index + 1} of ${pageRange.count}`,
      doc.page.margins.left,
      doc.page.height - 18,
      {
        width:
          doc.page.width -
          doc.page.margins.left -
          doc.page.margins.right,
        height: 10,
        align: "center",
        lineBreak: false,
      }
    );
    doc.page.margins.bottom = originalBottomMargin;
  }

  doc.end();
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function wordMoney(value) {
  return escapeHtml(moneyText(value));
}

function wordCell(value, className = "") {
  return `<td${className ? ` class="${className}"` : ""}>${escapeHtml(value)}</td>`;
}

function createDailyClosingWordHtml(reportData) {
  const {
    summary,
    existing_closing: existingClosing,
    reconciliation,
    status,
    notes,
    snapshot_difference: snapshotDifference,
    revisions,
  } = reportData;

  const paymentSections = PAYMENT_GROUPS.map((definition) => {
    const group = findPaymentGroup(summary.payment_groups, definition.key);
    const transactions = summary.sales_transactions.filter(
      (sale) => sale.payment_type === definition.key
    );

    const rows =
      transactions.length > 0
        ? transactions
            .map(
              (sale) => `
                <tr>
                  ${wordCell(formatTime(sale.created_at))}
                  ${wordCell(sale.customer_name || "CASH CUSTOMER")}
                  ${wordCell(sale.receipt_number || "-")}
                  <td class="money">${wordMoney(sale.gross_before_discount)}</td>
                  <td class="money">${wordMoney(sale.discount_amount)}</td>
                  <td class="money">${wordMoney(sale.total)}</td>
                  <td class="money">${wordMoney(sale.amount_paid)}</td>
                  <td class="money">${wordMoney(sale.balance)}</td>
                  ${wordCell(sale.staff_name || "System")}
                </tr>`
            )
            .join("")
        : `<tr><td colspan="9" class="empty">No transactions in this group.</td></tr>`;

    return `
      <h2>${escapeHtml(definition.label.toUpperCase())}</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Customer</th>
            <th>Receipt No.</th>
            <th>Gross</th>
            <th>Discount</th>
            <th>Net</th>
            <th>Received</th>
            <th>Outstanding</th>
            <th>Staff</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="subtotal">
            <td colspan="3">Subtotal (${group.transaction_count} transaction${group.transaction_count === 1 ? "" : "s"})</td>
            <td class="money">${wordMoney(group.gross_before_discount)}</td>
            <td class="money">${wordMoney(group.discount_total)}</td>
            <td class="money">${wordMoney(group.net_sales)}</td>
            <td class="money">${wordMoney(group.amount_received)}</td>
            <td class="money">${wordMoney(group.outstanding_created)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>`;
  }).join("");

  const debtRows =
    summary.debt_payments.length > 0
      ? summary.debt_payments
          .map(
            (payment) => `
              <tr>
                ${wordCell(formatTime(payment.paid_at))}
                ${wordCell(payment.customer_name || "-")}
                ${wordCell(payment.receipt_number || "-")}
                ${wordCell(String(payment.payment_method || "other").toUpperCase())}
                <td class="money">${wordMoney(payment.amount)}</td>
                ${wordCell(payment.received_by_name || "System")}
                ${wordCell(payment.notes || null)}
              </tr>`
          )
          .join("")
      : `<tr><td colspan="7" class="empty">No debt collections recorded.</td></tr>`;

  const expenseRows =
    summary.expenses.length > 0
      ? summary.expenses
          .map(
            (expense) => `
              <tr>
                ${wordCell(expense.category || "Other")}
                ${wordCell(expense.description || null)}
                ${wordCell(String(expense.payment_method || "other").toUpperCase())}
                <td class="money">${wordMoney(expense.amount)}</td>
                ${wordCell(expense.recorded_by_name || "System")}
              </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty">No expenses recorded.</td></tr>`;

  const returnRows =
    (summary.returns || []).length > 0
      ? summary.returns
          .map(
            (item) => `
              <tr>
                ${wordCell(formatTime(item.returned_at))}
                ${wordCell(item.receipt_number || "-")}
                ${wordCell(item.customer_name || "-")}
                ${wordCell(item.product_name || "-")}
                ${wordCell(item.quantity || 0)}
                ${wordCell(String(item.return_type || "stock_only").replaceAll("_", " ").toUpperCase())}
                ${wordCell(String(item.refund_method || "none").toUpperCase())}
                <td class="money">${wordMoney(item.refund_amount || 0)}</td>
                ${wordCell(item.refund_reference || null)}
                ${wordCell(item.returned_by_name || "System")}
                ${wordCell(item.approved_by_name || "-")}
              </tr>`
          )
          .join("")
      : `<tr><td colspan="11" class="empty">No returns or refunds were recorded for this date.</td></tr>`;

  const exceptionRows =
    summary.exceptions.length > 0
      ? summary.exceptions
          .map(
            (item) => `
              <tr>
                ${wordCell(formatTime(item.created_at))}
                ${wordCell(item.customer_name || "-")}
                ${wordCell(item.receipt_number || "-")}
                <td class="money">${wordMoney(item.total)}</td>
                ${wordCell(
                  item.is_voided
                    ? "VOIDED"
                    : String(item.sale_status || "unknown").toUpperCase()
                )}
                ${wordCell(item.void_reason || null)}
              </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="empty">No voided, returned or cancelled sales.</td></tr>`;

  const riskRows =
    (summary.risk_flags || []).length > 0
      ? summary.risk_flags
          .map(
            (item) => `
              <tr>
                ${wordCell(formatTime(item.occurred_at))}
                ${wordCell(String(item.risk_type || "review").replaceAll("_", " ").toUpperCase())}
                ${wordCell(String(item.severity || "review").toUpperCase())}
                ${wordCell(item.receipt_number || "-")}
                <td class="money">${wordMoney(item.amount || 0)}</td>
                ${wordCell(item.details || null)}
              </tr>`
          )
          .join("")
      : `<tr><td colspan="6" class="empty">No configured security or error indicators were detected for this date.</td></tr>`;

  const revisionRows =
    (revisions || []).length > 0
      ? revisions
          .map((item) => {
            const expected = item.expected_snapshot || {};
            const countedSnapshot = item.counted_snapshot || {};
            const expectedTotal = toMoney(revisionSnapshotValue(expected, "expected_total", revisionSnapshotValue(expected, "total", 0)));
            const countedTotal = toMoney(revisionSnapshotValue(countedSnapshot, "counted_total", revisionSnapshotValue(countedSnapshot, "total", 0)));
            return `
              <tr>
                ${wordCell(`V${Number(item.revision_number || 0)}`)}
                ${wordCell(String(item.revision_type || "review").replaceAll("_", " ").toUpperCase())}
                ${wordCell(formatDateTime(item.created_at))}
                ${wordCell(item.reason || null)}
                <td class="money">${wordMoney(expectedTotal)}</td>
                <td class="money">${wordMoney(countedTotal)}</td>
                <td class="money">${wordMoney(item.difference_total ?? countedTotal - expectedTotal)}</td>
                ${wordCell(item.changed_by_name || "System")}
                ${wordCell(item.approved_by_name || "-")}
              </tr>`;
          })
          .join("")
      : `<tr><td colspan="9" class="empty">${existingClosing ? "No revision history found - migration verification is required." : "Draft report - no revisions yet."}</td></tr>`;

  const reconciliationRows = reconciliation.rows
    .map(
      (item) => `
        <tr>
          ${wordCell(item.label)}
          <td class="money">${wordMoney(item.expected)}</td>
          <td class="money">${wordMoney(item.counted)}</td>
          <td class="money ${Math.abs(item.difference) >= 0.01 ? "variance" : ""}">${wordMoney(item.difference)}</td>
        </tr>`
    )
    .join("");

  const calculationNotes = summary.calculation_notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Chalin 03 Daily Closing ${escapeHtml(summary.closing_date)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>90</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page Section1 {
    size: 841.95pt 595.35pt;
    mso-page-orientation: landscape;
    margin: 28pt 28pt 32pt 28pt;
  }
  div.Section1 { page: Section1; }
  body { font-family: Arial, sans-serif; color: #142235; font-size: 9pt; }
  h1 { margin: 0; font-size: 18pt; color: #0b1f35; text-align: center; }
  h2 {
    margin: 14pt 0 4pt;
    padding: 5pt 7pt;
    color: #ffffff;
    background: #173f5f;
    font-size: 10pt;
  }
  h3 { margin: 12pt 0 4pt; color: #173f5f; font-size: 10pt; }
  .subtitle { text-align: center; margin: 3pt 0; }
  .status { font-weight: bold; color: #235789; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; }
  th {
    background: #235789;
    color: #ffffff;
    border: 1px solid #b9c8d8;
    padding: 4pt;
    font-size: 8pt;
  }
  td { border: 1px solid #d7e0e8; padding: 4pt; vertical-align: top; }
  .money { text-align: right; white-space: nowrap; }
  .subtotal td { background: #edf4fb; font-weight: bold; }
  .total td { background: #fff3cd; font-weight: bold; }
  .summary td.label { font-weight: bold; background: #f1f5f9; width: 24%; }
  .summary td.value { width: 26%; }
  .empty { text-align: center; font-style: italic; color: #64748b; }
  .variance { color: #b91c1c; font-weight: bold; }
  .notes { border: 1px solid #b9c8d8; background: #f8fafc; padding: 8pt; }
  .signature { margin-top: 26pt; border: 0; }
  .signature td { border: 0; width: 33%; text-align: center; padding: 0 14pt; }
  .line { border-top: 1px solid #64748b; padding-top: 4pt; }
  ul { margin-top: 4pt; }
</style>
</head>
<body>
<div class="Section1">
  <h1>CHALIN 03 COMPANY LIMITED</h1>
  <p class="subtitle"><b>ADVANCED DAILY CLOSING REPORT</b></p>
  <p class="subtitle">${escapeHtml(summary.branch.code)} — ${escapeHtml(summary.branch.name)}</p>
  <p class="subtitle">${escapeHtml(summary.branch.location || null)}</p>
  <p class="subtitle"><b>Closing date:</b> ${escapeHtml(summary.closing_date)} &nbsp; | &nbsp; <span class="status">${escapeHtml(status)}</span></p>

  <h2>EXECUTIVE SUMMARY</h2>
  <table class="summary">
    <tr>
      <td class="label">Sales transactions</td><td class="value">${escapeHtml(summary.sales_count)}</td>
      <td class="label">Gross before discount</td><td class="value money">${wordMoney(summary.gross_before_discount)}</td>
    </tr>
    <tr>
      <td class="label">Discounts</td><td class="value money">${wordMoney(summary.discount_total)}</td>
      <td class="label">Net sales</td><td class="value money">${wordMoney(summary.sales_total)}</td>
    </tr>
    <tr>
      <td class="label">Received during sales</td><td class="value money">${wordMoney(summary.sales_received)}</td>
      <td class="label">Credit created today</td><td class="value money">${wordMoney(summary.credit_created)}</td>
    </tr>
    <tr>
      <td class="label">Debt collections</td><td class="value money">${wordMoney(summary.debt_payments_total)}</td>
      <td class="label">Expenses</td><td class="value money">${wordMoney(summary.expenses_total)}</td>
    </tr>
    <tr>
      <td class="label">Return records</td><td class="value">${escapeHtml(summary.return_count || 0)}</td>
      <td class="label">Approved refunds</td><td class="value money">${wordMoney(summary.refund_total)}</td>
    </tr>
    <tr>
      <td class="label">Expected settlement</td><td class="value money">${wordMoney(reconciliation.expected_total)}</td>
      <td class="label">Counted / confirmed</td><td class="value money">${wordMoney(reconciliation.counted_total)}</td>
    </tr>
    <tr>
      <td class="label">Closing variance</td>
      <td class="value money ${Math.abs(reconciliation.difference_total) >= 0.01 ? "variance" : ""}">${wordMoney(reconciliation.difference_total)}</td>
      <td class="label">Exceptions</td><td class="value">${escapeHtml(summary.exception_count)}</td>
    </tr>
  </table>

  <h2>PAYMENT RECONCILIATION</h2>
  <table>
    <thead><tr><th>Payment channel</th><th>System expected</th><th>Counted / confirmed</th><th>Difference</th></tr></thead>
    <tbody>
      ${reconciliationRows}
      <tr class="total">
        <td>TOTAL</td>
        <td class="money">${wordMoney(reconciliation.expected_total)}</td>
        <td class="money">${wordMoney(reconciliation.counted_total)}</td>
        <td class="money ${Math.abs(reconciliation.difference_total) >= 0.01 ? "variance" : ""}">${wordMoney(reconciliation.difference_total)}</td>
      </tr>
    </tbody>
  </table>

  ${paymentSections}

  <h2>DEBT COLLECTIONS</h2>
  <table>
    <thead><tr><th>Time</th><th>Customer</th><th>Original Receipt</th><th>Method</th><th>Amount</th><th>Received By</th><th>Notes</th></tr></thead>
    <tbody>
      ${debtRows}
      <tr class="subtotal"><td colspan="4">Debt collections total</td><td class="money">${wordMoney(summary.debt_payments_total)}</td><td colspan="2"></td></tr>
    </tbody>
  </table>

  <h2>EXPENSES</h2>
  <table>
    <thead><tr><th>Category</th><th>Description</th><th>Method</th><th>Amount</th><th>Recorded By</th></tr></thead>
    <tbody>
      ${expenseRows}
      <tr class="subtotal"><td colspan="3">Expenses total</td><td class="money">${wordMoney(summary.expenses_total)}</td><td></td></tr>
    </tbody>
  </table>

  <h2>RETURNS AND APPROVED REFUNDS</h2>
  <table>
    <thead><tr><th>Time</th><th>Receipt</th><th>Customer</th><th>Product</th><th>Qty</th><th>Type</th><th>Refund Method</th><th>Refund</th><th>Reference</th><th>Recorded By</th><th>Approved By</th></tr></thead>
    <tbody>
      ${returnRows}
      <tr class="subtotal"><td colspan="5">Total returned quantity: ${escapeHtml(summary.return_quantity || 0)}</td><td colspan="2">Approved refunds</td><td class="money">${wordMoney(summary.refund_total)}</td><td colspan="3"></td></tr>
    </tbody>
  </table>

  <h2>EXCEPTIONS AND CONTROL NOTES</h2>
  <table>
    <thead><tr><th>Time</th><th>Customer</th><th>Receipt</th><th>Total</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>${exceptionRows}</tbody>
  </table>

  <h2>CLEAN-HANDS SECURITY AND ERROR INDICATORS</h2>
  <table>
    <thead><tr><th>Time</th><th>Risk Type</th><th>Severity</th><th>Receipt</th><th>Amount</th><th>Details</th></tr></thead>
    <tbody>${riskRows}</tbody>
  </table>

  <h2>IMMUTABLE DAILY CLOSING REVISION HISTORY</h2>
  <table>
    <thead><tr><th>Version</th><th>Type</th><th>Created</th><th>Reason</th><th>Expected</th><th>Counted</th><th>Difference</th><th>Changed By</th><th>Approved By</th></tr></thead>
    <tbody>${revisionRows}</tbody>
  </table>

  <div class="notes">
    <p><b>Closing notes:</b> ${escapeHtml(notes || "No notes recorded.")}</p>
    <p><b>Closed by:</b> ${escapeHtml(existingClosing?.closed_by_name || "Draft - not closed")}</p>
    <p><b>Closed at:</b> ${escapeHtml(existingClosing?.closed_at ? formatDateTime(existingClosing.closed_at) : "Not yet closed")}</p>
    <p><b>Verification status:</b> ${escapeHtml(existingClosing?.verification_status || "submitted")}</p>
    <p><b>Verified by:</b> ${escapeHtml(existingClosing?.verified_by_name || "Pending")}</p>
    <p><b>Verified at:</b> ${escapeHtml(existingClosing?.verified_at ? formatDateTime(existingClosing.verified_at) : "-")}</p>
    <p><b>Current data vs saved expected:</b> ${wordMoney(snapshotDifference)}</p>
    <p><b>Calculation notes:</b></p>
    <ul>${calculationNotes}</ul>
  </div>

  <table class="signature">
    <tr>
      <td><div class="line">Prepared / Closed By</div></td>
      <td><div class="line">Reviewed By</div></td>
      <td><div class="line">Management Approval</div></td>
    </tr>
  </table>
</div>
</body>
</html>`;
}

// GET /api/daily-closing/summary?date=YYYY-MM-DD
router.get(
  "/summary",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const closingDate = req.query.date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Date must be in YYYY-MM-DD format.",
        });
      }

      const existingClosing = await getExistingClosing(branchId, closingDate);
      const controlSource = existingClosing || req.query;
      const summary = await calculateClosingSummary(branchId, closingDate, controlSource);
      const currentVsSavedDifference = existingClosing
        ? toMoney(summary.expected_total - Number(existingClosing.expected_total || 0))
        : 0;

      return res.json({
        status: "success",
        branch_id: branchId,
        already_closed: Boolean(existingClosing),
        existing_closing: existingClosing,
        current_vs_saved_difference: currentVsSavedDifference,
        summary,
      });
    } catch (error) {
      console.error("Daily closing summary error:", error);

      return res.status(500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while calculating daily closing summary.",
      });
    }
  }
);

// GET /api/daily-closing/export.xlsx?date=YYYY-MM-DD
router.get(
  "/export.xlsx",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const closingDate = req.query.date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Date must be in YYYY-MM-DD format.",
        });
      }

      const reportData = await buildClosingReportData(
        branchId,
        closingDate,
        req.query
      );
      const workbook = createDailyClosingWorkbook(reportData);
      const branchCode = safeFilePart(reportData.summary.branch.code, "store");
      const filename = `Chalin03-Daily-Closing-${branchCode}-${closingDate}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      await workbook.xlsx.write(res);
      return res.end();
    } catch (error) {
      console.error("Daily closing Excel export error:", error);

      return res.status(error.statusCode || 500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while exporting the daily closing workbook.",
      });
    }
  }
);

// GET /api/daily-closing/report.pdf?date=YYYY-MM-DD
router.get(
  "/report.pdf",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const closingDate = req.query.date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Date must be in YYYY-MM-DD format.",
        });
      }

      const reportData = await buildClosingReportData(
        branchId,
        closingDate,
        req.query
      );
      const branchCode = safeFilePart(reportData.summary.branch.code, "store");
      const filename = `Chalin03-Daily-Closing-${branchCode}-${closingDate}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${filename}"`
      );

      createDailyClosingPdf(reportData, res);
      return undefined;
    } catch (error) {
      console.error("Daily closing PDF report error:", error);

      if (res.headersSent) {
        return res.end();
      }

      return res.status(error.statusCode || 500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while generating the daily closing PDF.",
      });
    }
  }
);


// GET /api/daily-closing/report.doc?date=YYYY-MM-DD
// This produces a Word-compatible document without adding a new backend package.
router.get(
  "/report.doc",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const closingDate = req.query.date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Date must be in YYYY-MM-DD format.",
        });
      }

      const reportData = await buildClosingReportData(
        branchId,
        closingDate,
        req.query
      );
      const branchCode = safeFilePart(reportData.summary.branch.code, "store");
      const filename = `Chalin03-Daily-Closing-${branchCode}-${closingDate}.doc`;
      const html = createDailyClosingWordHtml(reportData);

      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Cache-Control", "no-store");

      return res.send(Buffer.from(`\uFEFF${html}`, "utf8"));
    } catch (error) {
      console.error("Daily closing Word report error:", error);

      return res.status(error.statusCode || 500).json({
        status: "error",
        message:
          error.message ||
          "Something went wrong while generating the daily closing Word report.",
      });
    }
  }
);

// GET /api/daily-closing
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);

      const [closings] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name,
          vu.full_name AS verified_by_name,
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         LEFT JOIN users vu ON dc.verified_by = vu.id
         LEFT JOIN branches b ON dc.branch_id = b.id
         WHERE dc.branch_id = ?
         ORDER BY dc.closing_date DESC
         LIMIT 100`,
        [branchId]
      );

      const [controlRows] = await pool.query(
        `SELECT
          COUNT(*) AS closing_count,
          SUM(CASE WHEN difference_total < -0.009 THEN 1 ELSE 0 END) AS shortage_count,
          COALESCE(SUM(CASE WHEN difference_total < -0.009 THEN ABS(difference_total) ELSE 0 END), 0) AS shortage_total,
          SUM(CASE WHEN ABS(difference_total) >= 0.01 THEN 1 ELSE 0 END) AS variance_count,
          SUM(CASE WHEN stale_after_close = 1 THEN 1 ELSE 0 END) AS changed_after_close_count,
          SUM(CASE WHEN counted_confirmed = 0 THEN 1 ELSE 0 END) AS legacy_unconfirmed_count,
          SUM(CASE WHEN counted_confirmed = 1 AND verification_status <> 'verified' THEN 1 ELSE 0 END) AS awaiting_verification_count
         FROM daily_closings
         WHERE branch_id = ?
         AND closing_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
        [branchId]
      );

      const [changeRows] = await pool.query(
        `SELECT
          COUNT(*) AS protected_sale_change_count,
          SUM(CASE WHEN change_type = 'void' THEN 1 ELSE 0 END) AS protected_void_count
         FROM sale_change_history
         WHERE branch_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: closings.length,
        closings,
        control_summary: {
          period_days: 30,
          closing_count: Number(controlRows[0]?.closing_count || 0),
          shortage_count: Number(controlRows[0]?.shortage_count || 0),
          shortage_total: Number(controlRows[0]?.shortage_total || 0),
          variance_count: Number(controlRows[0]?.variance_count || 0),
          changed_after_close_count: Number(controlRows[0]?.changed_after_close_count || 0),
          legacy_unconfirmed_count: Number(controlRows[0]?.legacy_unconfirmed_count || 0),
          awaiting_verification_count: Number(controlRows[0]?.awaiting_verification_count || 0),
          protected_sale_change_count: Number(changeRows[0]?.protected_sale_change_count || 0),
          protected_void_count: Number(changeRows[0]?.protected_void_count || 0),
        },
      });
    } catch (error) {
      console.error("Get daily closings error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching daily closings.",
      });
    }
  }
);

// GET /api/daily-closing/:id/revisions
router.get(
  "/:id/revisions",
  requireAuth,
  requireRole("admin", "manager", "auditor"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: "error", message: "Daily closing ID must be a positive number." });
      }
      const [rows] = await pool.query(
        `SELECT
          dcr.*,
          changer.full_name AS changed_by_name,
          approver.full_name AS approved_by_name
         FROM daily_closing_revisions dcr
         LEFT JOIN users changer ON dcr.changed_by = changer.id
         LEFT JOIN users approver ON dcr.approved_by = approver.id
         WHERE dcr.daily_closing_id = ? AND dcr.branch_id = ?
         ORDER BY dcr.revision_number ASC`,
        [id, branchId]
      );
      return res.json({ status: "success", revisions: rows });
    } catch (error) {
      console.error("Get daily closing revisions error:", error);
      return res.status(500).json({ status: "error", message: "Failed to load closing revision history." });
    }
  }
);

// POST /api/daily-closing/:id/reconcile
// Rebuilds the expected snapshot after an approved post-closing change while
// preserving the original count and every earlier revision. It never erases
// the original closing or silently certifies the revised result.
router.post(
  "/:id/reconcile",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);
      const id = Number(req.params.id);
      const password = String(req.body.password || "");
      const revisionNotes = cleanText(req.body.revision_notes, 5000);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Daily closing ID must be a positive number.",
        });
      }

      if (!revisionNotes) {
        return res.status(400).json({
          status: "error",
          message: "Management revision notes are required. State which approved transaction changed and what was reviewed.",
        });
      }

      if (!password) {
        return res.status(400).json({
          status: "error",
          message: "Your password is required to reconcile the revised closing.",
        });
      }

      await connection.beginTransaction();

      const [closings] = await connection.query(
        `SELECT *
         FROM daily_closings
         WHERE id = ? AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );
      const closing = closings[0];

      if (!closing) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Daily closing record was not found in the selected store.",
        });
      }

      if (Number(closing.stale_after_close || 0) !== 1) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This closing is not marked as changed after closing, so no reconciliation revision is required.",
        });
      }

      if (Number(closing.closed_by) === Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({
          status: "error",
          message: "The person who submitted the closing cannot reconcile its post-closing revision. A different manager or administrator must review it.",
        });
      }

      const [users] = await connection.query(
        `SELECT id, password_hash, is_active
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [req.user.id]
      );
      const reviewer = users[0];
      if (!reviewer || Number(reviewer.is_active) !== 1) {
        await connection.rollback();
        return res.status(403).json({
          status: "error",
          message: "Reviewer account is inactive or unavailable.",
        });
      }

      const passwordMatches = await bcrypt.compare(password, reviewer.password_hash);
      if (!passwordMatches) {
        await connection.rollback();
        return res.status(401).json({
          status: "error",
          message: "Reviewer password is incorrect.",
        });
      }

      const summary = await calculateClosingSummary(
        branchId,
        formatDate(closing.closing_date),
        closing,
        connection
      );
      const revisedDifference = toMoney(
        Number(closing.total_counted || 0) - Number(summary.expected_total || 0)
      );
      const nextRevision = Number(closing.latest_revision_number || 1) + 1;

      await connection.query(
        `INSERT INTO daily_closing_revisions (
          daily_closing_id, branch_id, closing_date, revision_number,
          revision_type, reason, expected_snapshot_json, counted_snapshot_json,
          difference_total, source_entity_type, source_entity_id,
          changed_by, approved_by
        ) VALUES (?, ?, ?, ?, 'manager_revision', ?, ?, ?, ?, 'daily_closing_reconciliation', ?, ?, ?)`,
        [
          closing.id,
          branchId,
          closing.closing_date,
          nextRevision,
          revisionNotes,
          JSON.stringify({
            cash: Number(summary.expected_cash || 0),
            momo: Number(summary.expected_momo || 0),
            bank: Number(summary.expected_bank || 0),
            other: Number(summary.expected_other || 0),
            total: Number(summary.expected_total || 0),
          }),
          JSON.stringify({
            cash: Number(closing.cash_counted || 0),
            momo: Number(closing.momo_counted || 0),
            bank: Number(closing.bank_counted || 0),
            other: Number(closing.other_counted || 0),
            total: Number(closing.total_counted || 0),
            denominations: parseDenominations(closing.denomination_json),
          }),
          revisedDifference,
          String(closing.id),
          req.user.id,
          req.user.id,
        ]
      );

      await connection.query(
        `UPDATE daily_closings
         SET sales_count = ?,
             sales_total = ?,
             sales_received = ?,
             cash_sales = ?,
             momo_sales = ?,
             bank_sales = ?,
             mixed_sales = ?,
             credit_sales_total = ?,
             credit_sales_received = ?,
             debt_payment_count = ?,
             debt_payments_total = ?,
             debt_cash = ?,
             debt_momo = ?,
             debt_bank = ?,
             expenses_count = ?,
             expenses_total = ?,
             expected_cash = ?,
             expected_momo = ?,
             expected_bank = ?,
             expected_other = ?,
             expected_total = ?,
             difference_total = ?,
             stale_after_close = 0,
             stale_detected_at = NULL,
             latest_revision_number = ?,
             verification_status = 'revised',
             verified_by = NULL,
             verified_at = NULL
         WHERE id = ? AND branch_id = ?`,
        [
          summary.sales_count,
          summary.sales_total,
          summary.sales_received,
          summary.cash_sales,
          summary.momo_sales,
          summary.bank_sales,
          summary.mixed_sales,
          summary.credit_sales_total,
          summary.credit_sales_received,
          summary.debt_payment_count,
          summary.debt_payments_total,
          summary.debt_cash,
          summary.debt_momo,
          summary.debt_bank,
          summary.expenses_count,
          summary.expenses_total,
          summary.expected_cash,
          summary.expected_momo,
          summary.expected_bank,
          summary.expected_other,
          summary.expected_total,
          revisedDifference,
          nextRevision,
          id,
          branchId,
        ]
      );

      await logActivity(
        connection,
        req.user.id,
        branchId,
        "DAILY_CLOSING_RECONCILED",
        `Reconciled changed Daily Closing ${formatDate(closing.closing_date)}. Revised expected: GHS ${Number(summary.expected_total || 0).toFixed(2)}. Original counted: GHS ${Number(closing.total_counted || 0).toFixed(2)}. Revised variance: GHS ${revisedDifference.toFixed(2)}. Reason: ${revisionNotes}`
      );

      await connection.commit();

      const [updatedRows] = await pool.query(
        `SELECT dc.*, closer.full_name AS closed_by_name, verifier.full_name AS verified_by_name
         FROM daily_closings dc
         LEFT JOIN users closer ON dc.closed_by = closer.id
         LEFT JOIN users verifier ON dc.verified_by = verifier.id
         WHERE dc.id = ? AND dc.branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      return res.json({
        status: "success",
        message: "Post-closing changes reconciled. The original count remains preserved and independent verification is required again.",
        closing: updatedRows[0],
        revised_expected_total: Number(summary.expected_total || 0),
        revised_difference_total: revisedDifference,
      });
    } catch (error) {
      await connection.rollback();
      console.error("Reconcile daily closing error:", error);
      return res.status(500).json({
        status: "error",
        message: error.message || "Failed to reconcile the revised Daily Closing.",
      });
    } finally {
      connection.release();
    }
  }
);

// POST /api/daily-closing/:id/verify
router.post(
  "/:id/verify",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);
      const id = Number(req.params.id);
      const password = String(req.body.password || "");
      const verificationNotes = cleanText(req.body.verification_notes, 5000);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Daily closing ID must be a positive number.",
        });
      }

      if (!password) {
        return res.status(400).json({
          status: "error",
          message: "Your password is required to verify the closing.",
        });
      }

      await connection.beginTransaction();

      const [closings] = await connection.query(
        `SELECT *
         FROM daily_closings
         WHERE id = ? AND branch_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, branchId]
      );

      const closing = closings[0];
      if (!closing) {
        await connection.rollback();
        return res.status(404).json({
          status: "error",
          message: "Daily closing record was not found in the selected store.",
        });
      }

      if (closing.verification_status === "verified") {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This Daily Closing has already been independently verified.",
        });
      }

      if (Number(closing.counted_confirmed || 0) !== 1) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This is a legacy or unconfirmed closing. It cannot be certified as independently counted; keep it for history and use the new manual count process for future closings.",
        });
      }

      if (Number(closing.closed_by) === Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({
          status: "error",
          message: "The person who submitted the closing cannot verify the same closing. A different manager or administrator must verify it.",
        });
      }

      if (Number(closing.stale_after_close || 0) === 1) {
        await connection.rollback();
        return res.status(409).json({
          status: "error",
          message: "This closing changed after submission and cannot be verified until the variance and revision history are reviewed.",
        });
      }

      if (Math.abs(Number(closing.difference_total || 0)) >= 0.01 && !verificationNotes) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message: "Manager verification notes are required when the closing contains a variance.",
        });
      }

      const [users] = await connection.query(
        `SELECT id, password_hash, is_active
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [req.user.id]
      );
      const verifier = users[0];
      if (!verifier || Number(verifier.is_active) !== 1) {
        await connection.rollback();
        return res.status(403).json({
          status: "error",
          message: "Verifier account is inactive or unavailable.",
        });
      }

      const passwordMatches = await bcrypt.compare(password, verifier.password_hash);
      if (!passwordMatches) {
        await connection.rollback();
        return res.status(401).json({
          status: "error",
          message: "Verifier password is incorrect.",
        });
      }

      const nextRevision = Number(closing.latest_revision_number || 1) + 1;
      await connection.query(
        `INSERT INTO daily_closing_revisions (
          daily_closing_id, branch_id, closing_date, revision_number,
          revision_type, reason, expected_snapshot_json, counted_snapshot_json,
          difference_total, changed_by, approved_by
        ) VALUES (?, ?, ?, ?, 'manager_revision', ?, ?, ?, ?, ?, ?)`,
        [
          closing.id,
          branchId,
          closing.closing_date,
          nextRevision,
          verificationNotes || "Independently recounted and verified by management.",
          JSON.stringify({
            cash: Number(closing.expected_cash || 0),
            momo: Number(closing.expected_momo || 0),
            bank: Number(closing.expected_bank || 0),
            other: Number(closing.expected_other || 0),
            total: Number(closing.expected_total || 0),
          }),
          JSON.stringify({
            cash: Number(closing.cash_counted || 0),
            momo: Number(closing.momo_counted || 0),
            bank: Number(closing.bank_counted || 0),
            other: Number(closing.other_counted || 0),
            total: Number(closing.total_counted || 0),
            denominations: parseDenominations(closing.denomination_json),
          }),
          Number(closing.difference_total || 0),
          req.user.id,
          req.user.id,
        ]
      );

      await connection.query(
        `UPDATE daily_closings
         SET verified_by = ?,
             verified_at = NOW(),
             verification_status = 'verified',
             latest_revision_number = ?
         WHERE id = ? AND branch_id = ?`,
        [req.user.id, nextRevision, id, branchId]
      );

      await logActivity(
        connection,
        req.user.id,
        branchId,
        "DAILY_CLOSING_VERIFIED",
        `Independently verified daily closing ${closing.closing_date}. Difference: GHS ${Number(closing.difference_total || 0).toFixed(2)}`
      );

      await connection.commit();

      const [updatedRows] = await pool.query(
        `SELECT dc.*, closer.full_name AS closed_by_name, verifier.full_name AS verified_by_name
         FROM daily_closings dc
         LEFT JOIN users closer ON dc.closed_by = closer.id
         LEFT JOIN users verifier ON dc.verified_by = verifier.id
         WHERE dc.id = ? AND dc.branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      return res.json({
        status: "success",
        message: "Daily closing independently verified and locked for management review.",
        closing: updatedRows[0],
      });
    } catch (error) {
      await connection.rollback();
      console.error("Verify daily closing error:", error);
      return res.status(500).json({
        status: "error",
        message: "Something went wrong while verifying the daily closing.",
      });
    } finally {
      connection.release();
    }
  }
);

// GET /api/daily-closing/:id
router.get(
  "/:id",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const branchId = getBranchId(req);
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          status: "error",
          message: "Daily closing ID must be a positive number.",
        });
      }

      const [closings] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name,
          vu.full_name AS verified_by_name,
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         LEFT JOIN users vu ON dc.verified_by = vu.id
         LEFT JOIN branches b ON dc.branch_id = b.id
         WHERE dc.id = ?
         AND dc.branch_id = ?
         LIMIT 1`,
        [id, branchId]
      );

      if (closings.length === 0) {
        return res.status(404).json({
          status: "error",
          message: "Daily closing record not found in the selected store.",
        });
      }

      return res.json({
        status: "success",
        branch_id: branchId,
        closing: closings[0],
      });
    } catch (error) {
      console.error("Get single daily closing error:", error);

      return res.status(500).json({
        status: "error",
        message: "Something went wrong while fetching daily closing record.",
      });
    }
  }
);

// POST /api/daily-closing
router.post(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const branchId = getBranchId(req);
      const {
        closing_date,
        cash_counted,
        momo_counted,
        bank_counted,
        other_counted,
        denominations,
        counted_confirmed,
        notes,
      } = req.body;

      const closingDate = closing_date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Closing date must be in YYYY-MM-DD format.",
        });
      }

      // Cash Drawer Control was removed from the current business workflow by
      // management. Keep the existing database columns for historical records,
      // but every new closing stores neutral zero values.
      const cashControls = getCashControls({});
      const countedCash = toCountedMoney(cash_counted);
      const countedMomo = toCountedMoney(momo_counted);
      const countedBank = toCountedMoney(bank_counted);
      const countedOther = toCountedMoney(other_counted);

      if (
        countedCash === null ||
        countedMomo === null ||
        countedBank === null ||
        countedOther === null
      ) {
        return res.status(400).json({
          status: "error",
          message: "Every counted/confirmed channel must be entered manually as a valid non-negative number.",
        });
      }

      if (!(counted_confirmed === true || Number(counted_confirmed) === 1)) {
        return res.status(400).json({
          status: "error",
          message: "Confirm that the cash was physically counted and MoMo/bank balances were independently checked.",
        });
      }

      const parsedDenominations = parseDenominations(denominations);
      const denominationEvidenceUsed = hasDenominationEvidence(parsedDenominations);
      const calculatedDenominationTotal = calculateDenominationTotal(parsedDenominations);
      if (calculatedDenominationTotal === null) {
        return res.status(400).json({
          status: "error",
          message: "Cash denomination quantities are invalid.",
        });
      }
      if (
        denominationEvidenceUsed &&
        Math.abs(calculatedDenominationTotal - countedCash) >= 0.01
      ) {
        return res.status(400).json({
          status: "error",
          message: `Optional cash denomination total GHS ${calculatedDenominationTotal.toFixed(2)} must equal cash counted GHS ${countedCash.toFixed(2)}.`,
        });
      }
      const denominationTotal = denominationEvidenceUsed
        ? calculatedDenominationTotal
        : 0;
      const storedDenominations = denominationEvidenceUsed
        ? parsedDenominations
        : {};

      const totalCounted = toMoney(
        countedCash + countedMomo + countedBank + countedOther
      );
      const cleanedNotes = cleanText(notes, 5000);

      await connection.beginTransaction();

      // Lock the selected store row so a new sale and a Daily Closing cannot
      // be committed at the same time for the same store/day.
      await connection.query(
        `SELECT id FROM branches WHERE id = ? LIMIT 1 FOR UPDATE`,
        [branchId]
      );

      const [existingRows] = await connection.query(
        `SELECT id
         FROM daily_closings
         WHERE branch_id = ?
         AND closing_date = ?
         LIMIT 1
         FOR UPDATE`,
        [branchId, closingDate]
      );

      if (existingRows.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          status: "error",
          message: "This day has already been closed for the selected store.",
        });
      }

      const summary = await calculateClosingSummary(
        branchId,
        closingDate,
        cashControls,
        connection
      );
      const differenceTotal = toMoney(totalCounted - summary.expected_total);

      if (Math.abs(differenceTotal) >= 0.01 && !cleanedNotes) {
        await connection.rollback();
        return res.status(400).json({
          status: "error",
          message:
            "A closing note is required when counted money does not match the expected total.",
        });
      }

      const [result] = await connection.query(
        `INSERT INTO daily_closings (
          branch_id,
          closing_date,
          opening_cash_float,
          cash_deposits,
          cash_withdrawals,
          other_cash_in,
          other_cash_out,
          sales_count,
          sales_total,
          sales_received,
          cash_sales,
          momo_sales,
          bank_sales,
          mixed_sales,
          credit_sales_total,
          credit_sales_received,
          debt_payment_count,
          debt_payments_total,
          debt_cash,
          debt_momo,
          debt_bank,
          expenses_count,
          expenses_total,
          expected_cash,
          expected_momo,
          expected_bank,
          expected_other,
          expected_total,
          cash_counted,
          momo_counted,
          bank_counted,
          other_counted,
          total_counted,
          denomination_total,
          denomination_json,
          counted_confirmed,
          difference_total,
          notes,
          closed_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          closingDate,
          cashControls.opening_cash_float,
          cashControls.cash_deposits,
          cashControls.cash_withdrawals,
          cashControls.other_cash_in,
          cashControls.other_cash_out,
          summary.sales_count,
          summary.sales_total,
          summary.sales_received,
          summary.cash_sales,
          summary.momo_sales,
          summary.bank_sales,
          summary.mixed_sales,
          summary.credit_sales_total,
          summary.credit_sales_received,
          summary.debt_payment_count,
          summary.debt_payments_total,
          summary.debt_cash,
          summary.debt_momo,
          summary.debt_bank,
          summary.expenses_count,
          summary.expenses_total,
          summary.expected_cash,
          summary.expected_momo,
          summary.expected_bank,
          summary.expected_other,
          summary.expected_total,
          countedCash,
          countedMomo,
          countedBank,
          countedOther,
          totalCounted,
          denominationTotal,
          JSON.stringify(storedDenominations),
          1,
          differenceTotal,
          cleanedNotes || null,
          req.user.id,
        ]
      );

      await connection.query(
        `INSERT INTO daily_closing_revisions (
          daily_closing_id, branch_id, closing_date, revision_number, revision_type, reason,
          expected_snapshot_json, counted_snapshot_json, difference_total, changed_by, approved_by
        ) VALUES (?, ?, ?, 1, 'original', ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          branchId,
          closingDate,
          cleanedNotes || "Original submitted closing",
          JSON.stringify({ cash: summary.expected_cash, momo: summary.expected_momo, bank: summary.expected_bank, other: summary.expected_other, total: summary.expected_total }),
          JSON.stringify({ cash: countedCash, momo: countedMomo, bank: countedBank, other: countedOther, total: totalCounted, denominations: storedDenominations }),
          differenceTotal,
          req.user.id,
          req.user.id,
        ]
      );

      await logActivity(
        connection,
        req.user.id,
        branchId,
        "DAILY_CLOSING",
        `Closed business day ${closingDate}. Expected total: GHS ${summary.expected_total.toFixed(
          2
        )}, Counted total: GHS ${totalCounted.toFixed(
          2
        )}, Difference: GHS ${differenceTotal.toFixed(2)}`
      );

      await connection.commit();

      const [createdRows] = await pool.query(
        `SELECT
          dc.*,
          u.full_name AS closed_by_name,
          vu.full_name AS verified_by_name,
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         LEFT JOIN users vu ON dc.verified_by = vu.id
         LEFT JOIN branches b ON dc.branch_id = b.id
         WHERE dc.id = ?
         AND dc.branch_id = ?
         LIMIT 1`,
        [result.insertId, branchId]
      );

      return res.status(201).json({
        status: "success",
        message:
          Math.abs(differenceTotal) < 0.01
            ? "Daily closing saved and balanced successfully."
            : "Daily closing saved with a recorded variance.",
        closing: createdRows[0],
      });
    } catch (error) {
      await connection.rollback();

      console.error("Save daily closing error:", error);

      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          message: "This day has already been closed for the selected store.",
        });
      }

      return res.status(500).json({
        status: "error",
        message:
          error.message || "Something went wrong while saving daily closing.",
      });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
module.exports._test = {
  calculateClosingSummary,
  createDailyClosingWorkbook,
  createDailyClosingPdf,
  createDailyClosingWordHtml,
};
