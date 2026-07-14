const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

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
    return Math.max(0, toMoney(fallbackValue));
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Number(number.toFixed(2));
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

async function getBranchDetails(branchId) {
  const [rows] = await pool.query(
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
      b.code AS branch_code,
      b.name AS branch_name,
      b.location AS branch_location
     FROM daily_closings dc
     LEFT JOIN users u ON dc.closed_by = u.id
     LEFT JOIN branches b ON dc.branch_id = b.id
     WHERE dc.branch_id = ?
     AND dc.closing_date = ?
     LIMIT 1`,
    [branchId, closingDate]
  );

  return rows[0] || null;
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

async function calculateClosingSummary(branchId, closingDate) {
  const branch = await getBranchDetails(branchId);

  const [salesTransactions] = await pool.query(
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

  const [debtPayments] = await pool.query(
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

  const [expenses] = await pool.query(
    `SELECT
      e.id,
      e.category,
      e.amount,
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

  const [exceptions] = await pool.query(
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

  const expensesCount = expenses.length;
  const expensesTotal = toMoney(
    expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
  );

  // The current schema does not record a payment method for expenses, so the
  // closing treats expenses as cash deductions. Mixed-sale and initial credit
  // receipts also have no channel split, so they remain in Unallocated / Mixed.
  const expectedCash = toMoney(cashGroup.amount_received + debtCash - expensesTotal);
  const expectedMomo = toMoney(momoGroup.amount_received + debtMomo);
  const expectedBank = toMoney(bankGroup.amount_received + debtBank);
  const expectedOther = toMoney(
    mixedGroup.amount_received + creditGroup.amount_received
  );
  const expectedTotal = toMoney(
    salesReceived + debtPaymentsTotal - expensesTotal
  );

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

    debt_payment_count: debtPaymentCount,
    debt_payments_total: debtPaymentsTotal,
    debt_cash: debtCash,
    debt_momo: debtMomo,
    debt_bank: debtBank,

    expenses_count: expensesCount,
    expenses_total: expensesTotal,

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
    calculation_notes: [
      "Expenses are deducted from expected cash because expense records currently do not store a payment method.",
      "Mixed-sale receipts and money received at the time of a credit sale are shown under Unallocated / Mixed because the current sales table does not store a channel split.",
      "Debt collections are separated from new sales so old debt payments are not confused with today's credit created.",
    ],
  };
}

function getCountedSnapshot(summary, existingClosing, source = {}) {
  const cash = toCountedMoney(
    source.cash_counted,
    existingClosing?.cash_counted ?? summary.expected_cash
  );
  const momo = toCountedMoney(
    source.momo_counted,
    existingClosing?.momo_counted ?? summary.expected_momo
  );
  const bank = toCountedMoney(
    source.bank_counted,
    existingClosing?.bank_counted ?? summary.expected_bank
  );
  const other = toCountedMoney(
    source.other_counted,
    existingClosing?.other_counted ?? summary.expected_other
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
      label: "Cash",
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
    return balanced ? "Closed - Balanced" : "Closed - Variance";
  }

  return balanced ? "Ready to Close" : "Draft - Variance";
}

async function buildClosingReportData(branchId, closingDate, countedSource = {}) {
  const summary = await calculateClosingSummary(branchId, closingDate);
  const existingClosing = await getExistingClosing(branchId, closingDate);
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
    snapshot_difference: snapshotDifference,
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
    snapshot_difference: snapshotDifference,
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
  summarySheet.getCell("A3").value = summary.branch.location || "";
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
      String(payment.payment_method || "").toUpperCase(),
      Number(payment.amount || 0),
      payment.received_by_name,
      payment.notes || "",
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
    { width: 46 },
    { width: 23 },
  ];
  styleWorkbookTitle(expensesSheet, "A1:E1", "DAILY EXPENSES");
  expensesSheet.mergeCells("A2:E2");
  expensesSheet.getCell("A2").value = `${summary.branch.code} - ${summary.branch.name} | ${summary.closing_date}`;
  expensesSheet.getCell("A2").alignment = { horizontal: "center" };
  expensesSheet.getCell("A2").font = { bold: true };
  const expensesHeader = expensesSheet.getRow(4);
  expensesHeader.values = ["Date", "Category", "Amount", "Description", "Recorded By"];
  styleHeaderRow(expensesHeader);
  let expenseRow = 5;
  for (const expense of summary.expenses) {
    const row = expensesSheet.getRow(expenseRow);
    row.values = [
      formatDate(expense.expense_date),
      expense.category,
      Number(expense.amount || 0),
      expense.description || "",
      expense.recorded_by_name,
    ];
    applyMoneyFormat(row.getCell(3));
    expenseRow += 1;
  }
  if (expenseRow === 5) {
    expensesSheet.mergeCells("A5:E5");
    expensesSheet.getCell("A5").value = "No expenses were recorded for this date.";
    expenseRow = 6;
  } else {
    styleDataRange(expensesSheet, 5, expenseRow - 1, 1, 5);
  }
  const expenseTotalRow = expensesSheet.getRow(expenseRow);
  expenseTotalRow.values = ["TOTAL", null, summary.expenses_total, null, null];
  expenseTotalRow.font = { bold: true };
  expenseTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF5" } };
  applyMoneyFormat(expenseTotalRow.getCell(3));

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
      String(item.payment_type || "").toUpperCase(),
      Number(item.total || 0),
      item.is_voided ? "VOIDED" : String(item.sale_status || "").toUpperCase(),
      item.void_reason || "",
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

  [summarySheet, groupedSheet, collectionsSheet, expensesSheet, exceptionsSheet].forEach((sheet) => {
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
      { key: "category", label: "Category", width: 140, maxLength: 25 },
      { key: "description", label: "Description", width: 280, maxLength: 56 },
      { key: "amount", label: "Amount", width: 100, align: "right", format: moneyText, maxLength: 18 },
      { key: "recorded_by_name", label: "Recorded By", width: 140, maxLength: 25 },
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
        value: (item) => (item.is_voided ? "VOIDED" : String(item.sale_status || "").toUpperCase()),
      },
      { key: "void_reason", label: "Reason", width: 235, maxLength: 50 },
    ],
    summary.exceptions,
    { emptyText: "No voided, returned or cancelled sales.", rowHeight: 20, fontSize: 7 }
  );

  ensurePdfSpace(doc, 145);
  doc.font("Helvetica-Bold").fontSize(9).text("Closing notes:");
  doc.font("Helvetica").fontSize(8).text(notes || "No notes recorded.", { width: 720 });
  doc.moveDown(0.4);
  if (existingClosing) {
    doc.font("Helvetica").fontSize(8).text(
      `Closed by: ${existingClosing.closed_by_name || "-"} | Closed at: ${formatDateTime(existingClosing.closed_at)}`
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
    ["Reviewed By", ""],
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

      const summary = await calculateClosingSummary(branchId, closingDate);
      const existingClosing = await getExistingClosing(branchId, closingDate);
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
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
         LEFT JOIN branches b ON dc.branch_id = b.id
         WHERE dc.branch_id = ?
         ORDER BY dc.closing_date DESC
         LIMIT 100`,
        [branchId]
      );

      return res.json({
        status: "success",
        branch_id: branchId,
        count: closings.length,
        closings,
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
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
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
        notes,
      } = req.body;

      const closingDate = closing_date || todayDateString();

      if (!isValidDateString(closingDate)) {
        return res.status(400).json({
          status: "error",
          message: "Closing date must be in YYYY-MM-DD format.",
        });
      }

      const summary = await calculateClosingSummary(branchId, closingDate);
      const countedCash = toCountedMoney(cash_counted, summary.expected_cash);
      const countedMomo = toCountedMoney(momo_counted, summary.expected_momo);
      const countedBank = toCountedMoney(bank_counted, summary.expected_bank);
      const countedOther = toCountedMoney(other_counted, summary.expected_other);

      if (
        countedCash === null ||
        countedMomo === null ||
        countedBank === null ||
        countedOther === null
      ) {
        return res.status(400).json({
          status: "error",
          message: "Counted amounts must be valid numbers and cannot be negative.",
        });
      }

      const totalCounted = toMoney(
        countedCash + countedMomo + countedBank + countedOther
      );
      const differenceTotal = toMoney(totalCounted - summary.expected_total);
      const cleanedNotes = cleanText(notes, 5000);

      if (Math.abs(differenceTotal) >= 0.01 && !cleanedNotes) {
        return res.status(400).json({
          status: "error",
          message:
            "A closing note is required when counted money does not match the expected total.",
        });
      }

      await connection.beginTransaction();

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

      const [result] = await connection.query(
        `INSERT INTO daily_closings (
          branch_id,
          closing_date,
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
          difference_total,
          notes,
          closed_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          closingDate,
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
          differenceTotal,
          cleanedNotes || null,
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
          b.code AS branch_code,
          b.name AS branch_name,
          b.location AS branch_location
         FROM daily_closings dc
         LEFT JOIN users u ON dc.closed_by = u.id
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
