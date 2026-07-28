const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("../services/excelJsCompat");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

router.use(requireAuth, requireRole("admin", "manager", "cashier", "auditor"));

const MAX_ROWS = 5000;

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function getBranchId(req) {
  return positiveId(req.user?.branch_id || req.user?.default_branch_id);
}

function branchInfo(req) {
  return {
    id: getBranchId(req),
    code: cleanText(req.user?.branch_code || "STORE", 40),
    name: cleanText(req.user?.branch_name || "Selected Store", 160),
    location: cleanText(req.user?.branch_location || "", 255),
  };
}

function parseDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parseFilters(req) {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const customer = cleanText(req.query.customer || req.query.query, 160);
  const customerId = positiveId(req.query.customer_id);
  const debtStatus = cleanText(req.query.debt_status, 30).toLowerCase();
  const reportType = cleanText(req.query.report_type || "statement", 20).toLowerCase();

  if (from && to && from > to) {
    const error = new Error("The start date cannot be after the end date.");
    error.statusCode = 400;
    throw error;
  }

  if (!["statement", "debt"].includes(reportType)) {
    const error = new Error("Choose Customer Statement or Debt Report.");
    error.statusCode = 400;
    throw error;
  }

  const allowedStatuses = ["", "unpaid", "partial", "paid", "overdue"];
  if (!allowedStatuses.includes(debtStatus)) {
    const error = new Error("Choose a valid debt status filter.");
    error.statusCode = 400;
    throw error;
  }

  return { from, to, customer, customerId, debtStatus, reportType };
}

function appendDateFilter(sql, params, alias, column, filters) {
  let nextSql = sql;
  if (filters.from) {
    nextSql += ` AND DATE(${alias}.${column}) >= ?`;
    params.push(filters.from);
  }
  if (filters.to) {
    nextSql += ` AND DATE(${alias}.${column}) <= ?`;
    params.push(filters.to);
  }
  return nextSql;
}

function appendCustomerIdFilter(sql, params, alias, filters) {
  if (!filters.customerId) return sql;
  params.push(filters.customerId);
  return `${sql} AND ${alias}.customer_id = ?`;
}

function appendCustomerFilter(sql, params, alias, filters) {
  if (filters.customerId || !filters.customer) return sql;
  const pattern = `%${filters.customer.toLowerCase()}%`;
  params.push(pattern, pattern);
  return `${sql} AND (
    LOWER(COALESCE(${alias}.customer_name, '')) LIKE ?
    OR LOWER(COALESCE(${alias}.customer_phone, '')) LIKE ?
  )`;
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function money(value) {
  return `GHS ${toNumber(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 40) || "-";
  return date.toLocaleDateString("en-GB");
}

function dateTimeLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 60) || "-";
  return date.toLocaleString("en-GB");
}

function periodLabel(filters) {
  if (filters.from && filters.to) return `${dateLabel(filters.from)} to ${dateLabel(filters.to)}`;
  if (filters.from) return `From ${dateLabel(filters.from)}`;
  if (filters.to) return `Up to ${dateLabel(filters.to)}`;
  return "All available dates";
}

function customerKey(record) {
  const id = positiveId(record?.customer_id);
  if (id) return `id:${id}`;
  const phone = cleanText(record?.customer_phone, 80).toLowerCase();
  if (phone) return `phone:${phone}`;
  return `name:${cleanText(record?.customer_name || "Customer", 180).toLowerCase()}`;
}

function isValidSale(sale) {
  const status = cleanText(sale?.sale_status, 30).toLowerCase();
  return Number(sale?.is_voided || 0) !== 1 && !["cancelled", "voided"].includes(status);
}

function safeFilename(value) {
  return cleanText(value, 180)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "report";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadFilteredData(req) {
  const branch = branchInfo(req);
  if (!branch.id) {
    const error = new Error("No store was selected for this session.");
    error.statusCode = 400;
    throw error;
  }

  const filters = parseFilters(req);

  const saleParams = [branch.id];
  let saleSql = `
    SELECT
      s.id,
      s.customer_id,
      s.customer_name,
      s.customer_phone,
      s.receipt_number,
      s.subtotal,
      s.discount_amount,
      s.tax_amount,
      s.total,
      s.payment_type,
      s.amount_paid,
      s.balance,
      s.sale_status,
      s.is_voided,
      s.created_at,
      u.full_name AS staff_name
    FROM sales s
    LEFT JOIN users u ON u.id = s.staff_id
    WHERE s.branch_id = ?
  `;
  saleSql = appendDateFilter(saleSql, saleParams, "s", "created_at", filters);
  saleSql = appendCustomerIdFilter(saleSql, saleParams, "s", filters);
  saleSql = appendCustomerFilter(saleSql, saleParams, "s", filters);
  saleSql += ` ORDER BY s.created_at DESC, s.id DESC LIMIT ${MAX_ROWS}`;

  const debtParams = [branch.id];
  let debtSql = `
    SELECT
      d.id,
      d.customer_id,
      d.customer_name,
      d.customer_phone,
      d.sale_id,
      d.amount_owed,
      d.amount_paid,
      d.balance,
      d.status,
      d.due_date,
      d.created_at,
      s.receipt_number
    FROM debts d
    LEFT JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
    WHERE d.branch_id = ?
  `;
  debtSql = appendDateFilter(debtSql, debtParams, "d", "created_at", filters);
  debtSql = appendCustomerIdFilter(debtSql, debtParams, "d", filters);
  debtSql = appendCustomerFilter(debtSql, debtParams, "d", filters);
  if (filters.debtStatus) {
    if (filters.debtStatus === "overdue") {
      debtSql += " AND d.balance > 0 AND d.due_date IS NOT NULL AND DATE(d.due_date) < CURRENT_DATE";
    } else {
      debtSql += " AND LOWER(COALESCE(d.status, '')) = ?";
      debtParams.push(filters.debtStatus);
    }
  }
  debtSql += ` ORDER BY d.created_at DESC, d.id DESC LIMIT ${MAX_ROWS}`;

  const paymentParams = [branch.id];
  let paymentSql = `
    SELECT
      dp.id,
      dp.debt_id,
      dp.amount,
      dp.payment_method,
      dp.paid_at,
      dp.notes,
      d.customer_id,
      d.customer_name,
      d.customer_phone,
      s.receipt_number,
      u.full_name AS received_by_name
    FROM debt_payments dp
    INNER JOIN debts d ON d.id = dp.debt_id AND d.branch_id = dp.branch_id
    LEFT JOIN sales s ON s.id = d.sale_id AND s.branch_id = d.branch_id
    LEFT JOIN users u ON u.id = dp.received_by
    WHERE dp.branch_id = ?
  `;
  paymentSql = appendDateFilter(paymentSql, paymentParams, "dp", "paid_at", filters);
  paymentSql = appendCustomerIdFilter(paymentSql, paymentParams, "d", filters);
  paymentSql = appendCustomerFilter(paymentSql, paymentParams, "d", filters);
  paymentSql += ` ORDER BY dp.paid_at DESC, dp.id DESC LIMIT ${MAX_ROWS}`;

  const [[sales], [debts], [debtPayments]] = await Promise.all([
    pool.query(saleSql, saleParams),
    pool.query(debtSql, debtParams),
    pool.query(paymentSql, paymentParams),
  ]);

  const saleIds = sales.map((sale) => Number(sale.id)).filter(Boolean);
  let saleItems = [];
  if (saleIds.length > 0) {
    const placeholders = saleIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT
         si.id,
         si.sale_id,
         si.product_id,
         si.product_name,
         si.quantity,
         si.unit_price,
         si.line_total
       FROM sale_items si
       WHERE si.sale_id IN (${placeholders})
       ORDER BY si.sale_id ASC, si.id ASC`,
      saleIds
    );
    saleItems = rows;
  }

  const itemsBySale = new Map();
  saleItems.forEach((item) => {
    const saleId = Number(item.sale_id);
    if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
    itemsBySale.get(saleId).push({
      id: Number(item.id),
      sale_id: saleId,
      product_id: positiveId(item.product_id),
      product_name: cleanText(item.product_name || "Item", 180),
      quantity: toNumber(item.quantity),
      unit_price: roundMoney(item.unit_price),
      line_total: roundMoney(item.line_total),
    });
  });

  sales.forEach((sale) => {
    sale.items = itemsBySale.get(Number(sale.id)) || [];
  });

  return buildReport({ branch, filters, sales, debts, debtPayments });
}

function buildReport({ branch, filters, sales, debts, debtPayments }) {
  const groups = new Map();

  function ensureGroup(record) {
    const key = customerKey(record);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        customer_id: positiveId(record?.customer_id),
        customer_name: cleanText(record?.customer_name || "Customer", 180),
        customer_phone: cleanText(record?.customer_phone || "", 80),
        sales: [],
        debts: [],
        debt_payments: [],
      });
    }
    return groups.get(key);
  }

  sales.forEach((sale) => ensureGroup(sale).sales.push(sale));
  debts.forEach((debt) => ensureGroup(debt).debts.push(debt));
  debtPayments.forEach((payment) => ensureGroup(payment).debt_payments.push(payment));

  const customerSummaries = [];
  const transactions = [];
  const itemRows = [];

  groups.forEach((group) => {
    const validSales = group.sales.filter(isValidSale);
    const totalSales = validSales.reduce((sum, sale) => sum + toNumber(sale.total), 0);
    const paidOnSales = validSales.reduce((sum, sale) => sum + toNumber(sale.amount_paid), 0);
    const debtPaymentsTotal = group.debt_payments.reduce(
      (sum, payment) => sum + toNumber(payment.amount),
      0
    );
    const outstanding = group.debts.reduce((sum, debt) => sum + toNumber(debt.balance), 0);
    const itemCount = validSales.reduce(
      (sum, sale) => sum + (sale.items || []).reduce((qty, item) => qty + toNumber(item.quantity), 0),
      0
    );
    const lastDates = [
      ...group.sales.map((row) => row.created_at),
      ...group.debts.map((row) => row.created_at),
      ...group.debt_payments.map((row) => row.paid_at),
    ].filter(Boolean);
    const lastActivity = lastDates.sort((a, b) => new Date(b) - new Date(a))[0] || null;

    customerSummaries.push({
      customer_key: group.key,
      customer_id: group.customer_id,
      customer_name: group.customer_name,
      customer_phone: group.customer_phone,
      sales_count: validSales.length,
      item_quantity: roundMoney(itemCount),
      total_sales: roundMoney(totalSales),
      total_received: roundMoney(paidOnSales + debtPaymentsTotal),
      outstanding_balance: roundMoney(outstanding),
      debt_count: group.debts.length,
      last_activity: lastActivity,
      account_status: outstanding <= 0 ? "clear" : outstanding >= totalSales * 0.5 ? "high_follow_up" : "watch",
    });

    group.sales.forEach((sale) => {
      const valid = isValidSale(sale);
      transactions.push({
        id: `sale-${sale.id}`,
        source_id: Number(sale.id),
        type: "sale",
        date: sale.created_at,
        customer_key: group.key,
        customer_name: group.customer_name,
        customer_phone: group.customer_phone,
        receipt_number: sale.receipt_number || "-",
        description: (sale.items || []).map((item) => `${item.product_name} × ${item.quantity}`).join(", ") || "Sale",
        items: sale.items || [],
        amount: valid ? roundMoney(sale.total) : 0,
        paid: valid ? roundMoney(sale.amount_paid) : 0,
        balance: valid ? roundMoney(sale.balance) : 0,
        payment_method: sale.payment_type || "-",
        staff_name: sale.staff_name || "-",
        status: valid ? sale.sale_status || "completed" : "voided",
      });

      (sale.items || []).forEach((item) => {
        itemRows.push({
          id: Number(item.id),
          sale_id: Number(sale.id),
          date: sale.created_at,
          customer_key: group.key,
          customer_name: group.customer_name,
          customer_phone: group.customer_phone,
          receipt_number: sale.receipt_number || "-",
          product_name: item.product_name,
          quantity: toNumber(item.quantity),
          unit_price: roundMoney(item.unit_price),
          line_total: valid ? roundMoney(item.line_total) : 0,
          status: valid ? "valid" : "voided",
        });
      });
    });

    group.debts.forEach((debt) => {
      transactions.push({
        id: `debt-${debt.id}`,
        source_id: Number(debt.id),
        type: "debt",
        date: debt.created_at,
        customer_key: group.key,
        customer_name: group.customer_name,
        customer_phone: group.customer_phone,
        receipt_number: debt.receipt_number || "-",
        description: `Debt record • Due ${dateLabel(debt.due_date)}`,
        items: [],
        amount: roundMoney(debt.amount_owed),
        paid: roundMoney(debt.amount_paid),
        balance: roundMoney(debt.balance),
        payment_method: "Credit",
        staff_name: "-",
        status: debt.status || "unpaid",
        due_date: debt.due_date,
      });
    });

    group.debt_payments.forEach((payment) => {
      transactions.push({
        id: `payment-${payment.id}`,
        source_id: Number(payment.id),
        type: "debt_payment",
        date: payment.paid_at,
        customer_key: group.key,
        customer_name: group.customer_name,
        customer_phone: group.customer_phone,
        receipt_number: payment.receipt_number || "-",
        description: payment.notes || "Debt payment",
        items: [],
        amount: roundMoney(payment.amount),
        paid: roundMoney(payment.amount),
        balance: 0,
        payment_method: payment.payment_method || "-",
        staff_name: payment.received_by_name || "-",
        status: "received",
      });
    });
  });

  customerSummaries.sort((a, b) => b.total_sales - a.total_sales || a.customer_name.localeCompare(b.customer_name));
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  itemRows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const validSales = sales.filter(isValidSale);
  const summary = {
    customer_count: customerSummaries.length,
    sales_count: validSales.length,
    transaction_count: transactions.length,
    item_line_count: itemRows.length,
    item_quantity: roundMoney(itemRows.reduce((sum, item) => sum + toNumber(item.quantity), 0)),
    total_sales: roundMoney(validSales.reduce((sum, sale) => sum + toNumber(sale.total), 0)),
    paid_on_sales: roundMoney(validSales.reduce((sum, sale) => sum + toNumber(sale.amount_paid), 0)),
    debt_payments: roundMoney(debtPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)),
    total_received: roundMoney(
      validSales.reduce((sum, sale) => sum + toNumber(sale.amount_paid), 0) +
        debtPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)
    ),
    outstanding_balance: roundMoney(debts.reduce((sum, debt) => sum + toNumber(debt.balance), 0)),
    debt_count: debts.length,
  };

  return {
    branch,
    filters,
    period: periodLabel(filters),
    summary,
    customers: customerSummaries,
    transactions,
    items: itemRows,
    debts,
    debt_payments: debtPayments,
    capped: sales.length >= MAX_ROWS || debts.length >= MAX_ROWS || debtPayments.length >= MAX_ROWS,
  };
}

function configureDownload(res, contentType, filename, disposition = "attachment") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

function pdfHeader(doc, report, title) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, 28, width, 58).fill("#07182c");
  doc.fillColor("#f5d84a").font("Helvetica-Bold").fontSize(9);
  doc.text("CHALIN 03 COMPANY LIMITED", doc.page.margins.left + 12, 39, { width: width - 24 });
  doc.fillColor("#ffffff").fontSize(16);
  doc.text(title, doc.page.margins.left + 12, 53, { width: width - 24 });
  doc.font("Helvetica").fontSize(8.5);
  doc.text(
    `${report.branch.code} — ${report.branch.name}${report.branch.location ? ` • ${report.branch.location}` : ""}`,
    doc.page.margins.left + 12,
    72,
    { width: width - 24 }
  );
  doc.y = 100;
}

function ensurePdfSpace(doc, report, title, required = 55) {
  if (doc.y + required < doc.page.height - doc.page.margins.bottom - 24) return;
  doc.addPage();
  pdfHeader(doc, report, title);
}

function pdfMeta(doc, report) {
  const customerLabel = report.filters.customer || "All matching customers";
  doc.fillColor("#334155").font("Helvetica").fontSize(9);
  doc.text(`Period: ${report.period}`);
  doc.text(`Customer filter: ${customerLabel}`);
  if (report.filters.debtStatus) doc.text(`Debt status: ${report.filters.debtStatus}`);
  doc.text(`Generated: ${dateTimeLabel(new Date())}`);
  doc.moveDown(0.7);
}

function pdfMetrics(doc, report) {
  const metrics = [
    ["Customers", report.summary.customer_count],
    ["Sales", report.summary.sales_count],
    ["Total Sales", money(report.summary.total_sales)],
    ["Received", money(report.summary.total_received)],
    ["Outstanding", money(report.summary.outstanding_balance)],
  ];
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cellWidth = width / metrics.length;
  const y = doc.y;
  metrics.forEach(([label, value], index) => {
    const x = doc.page.margins.left + index * cellWidth;
    doc.rect(x, y, cellWidth, 42).fillAndStroke(index % 2 ? "#ffffff" : "#f1f5f9", "#cbd5e1");
    doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(6.8);
    doc.text(label, x + 4, y + 7, { width: cellWidth - 8, align: "center" });
    doc.fillColor("#173b68").fontSize(8.3);
    doc.text(String(value), x + 4, y + 23, { width: cellWidth - 8, align: "center" });
  });
  doc.y = y + 52;
}

function drawStatementPdf(doc, report) {
  const title = "Filtered Customer Statement";
  pdfHeader(doc, report, title);
  pdfMeta(doc, report);
  pdfMetrics(doc, report);

  report.customers.forEach((customer, customerIndex) => {
    ensurePdfSpace(doc, report, title, 80);
    if (customerIndex > 0) doc.moveDown(0.25);
    const y = doc.y;
    doc.rect(doc.page.margins.left, y, 507, 30).fill("#173b68");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
    doc.text(
      `${customer.customer_name}${customer.customer_phone ? ` • ${customer.customer_phone}` : ""}`,
      doc.page.margins.left + 8,
      y + 7,
      { width: 330 }
    );
    doc.fontSize(8.2).text(
      `Sales ${money(customer.total_sales)} • Balance ${money(customer.outstanding_balance)}`,
      doc.page.margins.left + 342,
      y + 8,
      { width: 157, align: "right" }
    );
    doc.y = y + 38;

    const customerTransactions = report.transactions.filter((row) => row.customer_key === customer.customer_key);
    customerTransactions.forEach((row) => {
      ensurePdfSpace(doc, report, title, row.items?.length ? 62 + row.items.length * 11 : 44);
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8);
      doc.text(
        `${dateTimeLabel(row.date)} | ${row.type.replace(/_/g, " ").toUpperCase()} | ${row.receipt_number}`
      );
      doc.fillColor("#475569").font("Helvetica").fontSize(7.6);
      doc.text(
        `${row.description || "-"} | Amount ${money(row.amount)} | Paid ${money(row.paid)} | Balance ${money(row.balance)} | ${row.status}`
      );
      (row.items || []).forEach((item) => {
        doc.text(
          `• ${item.product_name} — Qty ${item.quantity} × ${money(item.unit_price)} = ${money(item.line_total)}`,
          { indent: 10 }
        );
      });
      doc.moveDown(0.35);
    });
  });

  if (report.customers.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(10);
    doc.text("No records matched the applied filters.", { align: "center" });
  }
}

function drawDebtPdf(doc, report) {
  const title = "Filtered Customer Debt Report";
  pdfHeader(doc, report, title);
  pdfMeta(doc, report);
  pdfMetrics(doc, report);

  report.debts.forEach((debt) => {
    ensurePdfSpace(doc, report, title, 52);
    const y = doc.y;
    doc.rect(doc.page.margins.left, y, 507, 44).fillAndStroke("#f8fafc", "#cbd5e1");
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8.4);
    doc.text(
      `${debt.customer_name || "Customer"}${debt.customer_phone ? ` • ${debt.customer_phone}` : ""}`,
      doc.page.margins.left + 7,
      y + 7,
      { width: 270 }
    );
    doc.fillColor("#173b68").text(
      `Balance ${money(debt.balance)}`,
      doc.page.margins.left + 350,
      y + 7,
      { width: 150, align: "right" }
    );
    doc.fillColor("#475569").font("Helvetica").fontSize(7.6);
    doc.text(
      `${dateLabel(debt.created_at)} | Receipt ${debt.receipt_number || "-"} | Owed ${money(debt.amount_owed)} | Paid ${money(debt.amount_paid)} | ${debt.status || "-"} | Due ${dateLabel(debt.due_date)}`,
      doc.page.margins.left + 7,
      y + 24,
      { width: 493 }
    );
    doc.y = y + 51;
  });

  if (report.debts.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(10);
    doc.text("No debt records matched the applied filters.", { align: "center" });
  }
}

function addPdfFooters(doc, report, title) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    const bottom = doc.page.height - 18;
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor("#64748b").font("Helvetica").fontSize(7);
    doc.text(
      `Chalin 03 • ${report.branch.code} • ${title} • Page ${index + 1} of ${range.count}`,
      doc.page.margins.left,
      bottom,
      {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
        lineBreak: false,
      }
    );
    doc.page.margins.bottom = originalBottom;
  }
}

async function sendPdf(res, report, inline = false) {
  const title = report.filters.reportType === "debt" ? "Customer Debt Report" : "Customer Statement";
  const slug = report.filters.reportType === "debt" ? "debt-report" : "customer-statement";
  const filename = `chalin03-${safeFilename(report.branch.code)}-${slug}-${safeFilename(report.filters.from || "all")}-${safeFilename(report.filters.to || "all")}.pdf`;
  configureDownload(res, "application/pdf", filename, inline ? "inline" : "attachment");

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 28, right: 44, bottom: 34, left: 44 },
    bufferPages: true,
    info: {
      Title: title,
      Author: "Chalin 03 Company Limited",
      Subject: `${title} — ${report.period}`,
    },
  });
  doc.pipe(res);
  if (report.filters.reportType === "debt") drawDebtPdf(doc, report);
  else drawStatementPdf(doc, report);
  addPdfFooters(doc, report, title);
  doc.end();
}

function htmlTable(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
        )
        .join("")}</tbody>
    </table>
  `;
}

function buildWordHtml(report) {
  const isDebt = report.filters.reportType === "debt";
  const title = isDebt ? "Filtered Customer Debt Report" : "Filtered Customer Statement";
  const summaryRows = [
    ["Customers", report.summary.customer_count],
    ["Sales", report.summary.sales_count],
    ["Items Purchased", report.summary.item_quantity],
    ["Total Sales", money(report.summary.total_sales)],
    ["Total Received", money(report.summary.total_received)],
    ["Outstanding", money(report.summary.outstanding_balance)],
  ];

  const bodyRows = isDebt
    ? report.debts.map((debt) => [
        dateLabel(debt.created_at),
        debt.customer_name || "Customer",
        debt.customer_phone || "-",
        debt.receipt_number || "-",
        money(debt.amount_owed),
        money(debt.amount_paid),
        money(debt.balance),
        debt.status || "-",
        dateLabel(debt.due_date),
      ])
    : report.transactions.map((row) => [
        dateTimeLabel(row.date),
        row.customer_name,
        row.customer_phone || "-",
        row.receipt_number,
        row.type.replace(/_/g, " "),
        row.description || "-",
        money(row.amount),
        money(row.paid),
        money(row.balance),
        row.status,
      ]);

  const headers = isDebt
    ? ["Date", "Customer", "Phone", "Receipt", "Owed", "Paid", "Balance", "Status", "Due Date"]
    : ["Date", "Customer", "Phone", "Receipt", "Type", "Items / Details", "Amount", "Paid", "Balance", "Status"];

  const itemSection = isDebt
    ? ""
    : `<h2>Items Purchased</h2>${htmlTable(
        ["Date", "Customer", "Receipt", "Product", "Quantity", "Unit Price", "Line Total"],
        report.items.map((item) => [
          dateTimeLabel(item.date),
          item.customer_name,
          item.receipt_number,
          item.product_name,
          item.quantity,
          money(item.unit_price),
          money(item.line_total),
        ])
      )}`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:Arial,sans-serif;color:#0f172a;margin:32px;font-size:10pt}.brand{background:#07182c;color:white;padding:18px 20px}.brand h1{margin:0;color:#f5d84a;font-size:18pt}.brand p{margin:5px 0 0}h2{color:#173b68;margin-top:24px;border-bottom:2px solid #dbe3ef;padding-bottom:6px}.meta{margin:14px 0;background:#f8fafc;padding:12px;border:1px solid #dbe3ef}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric{border:1px solid #dbe3ef;padding:10px}.metric strong{display:block;color:#173b68;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:8.5pt}th{background:#173b68;color:white;text-align:left;padding:6px}td{border:1px solid #cbd5e1;padding:5px;vertical-align:top}tr:nth-child(even){background:#f8fafc}.footer{margin-top:24px;color:#64748b;font-size:8pt}
</style></head><body>
<div class="brand"><h1>CHALIN 03 COMPANY LIMITED</h1><p>${escapeHtml(title)}</p><p>${escapeHtml(report.branch.code)} — ${escapeHtml(report.branch.name)}${report.branch.location ? ` • ${escapeHtml(report.branch.location)}` : ""}</p></div>
<div class="meta"><strong>Period:</strong> ${escapeHtml(report.period)}<br><strong>Customer filter:</strong> ${escapeHtml(report.filters.customer || "All matching customers")}<br><strong>Generated:</strong> ${escapeHtml(dateTimeLabel(new Date()))}</div>
<div class="summary">${summaryRows.map(([label, value]) => `<div class="metric">${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
<h2>${escapeHtml(isDebt ? "Debt Records" : "Transaction Ledger")}</h2>
${htmlTable(headers, bodyRows)}
${itemSection}
<div class="footer">Generated from the exact filters applied in Chalin 03. Store isolation remains enforced.</div>
</body></html>`;
}

async function sendWord(res, report) {
  const slug = report.filters.reportType === "debt" ? "debt-report" : "customer-statement";
  const filename = `chalin03-${safeFilename(report.branch.code)}-${slug}-${safeFilename(report.filters.from || "all")}-${safeFilename(report.filters.to || "all")}.doc`;
  configureDownload(res, "application/msword; charset=utf-8", filename);
  res.send(Buffer.from(`\ufeff${buildWordHtml(report)}`, "utf8"));
}

function styleWorksheet(sheet, currencyColumns = []) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B68" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 24;
  sheet.columns.forEach((column) => {
    let width = 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      width = Math.max(width, Math.min(42, String(cell.value ?? "").length + 2));
    });
    column.width = width;
  });
  currencyColumns.forEach((columnKey) => {
    sheet.getColumn(columnKey).numFmt = '"GHS" #,##0.00';
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    }
    row.alignment = { vertical: "top", wrapText: true };
  });
}

async function sendExcel(res, report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chalin 03 Company Limited";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field" },
    { header: "Value", key: "value" },
  ];
  [
    ["Store", `${report.branch.code} — ${report.branch.name}`],
    ["Location", report.branch.location || "-"],
    ["Period", report.period],
    ["Customer Filter", report.filters.customer || "All matching customers"],
    ["Debt Status", report.filters.debtStatus || "All"],
    ["Customers", report.summary.customer_count],
    ["Sales", report.summary.sales_count],
    ["Transactions", report.summary.transaction_count],
    ["Items Purchased", report.summary.item_quantity],
    ["Total Sales", report.summary.total_sales],
    ["Total Received", report.summary.total_received],
    ["Outstanding Balance", report.summary.outstanding_balance],
  ].forEach(([field, value]) => summary.addRow({ field, value }));
  styleWorksheet(summary);
  summary.getCell("B10").numFmt = '"GHS" #,##0.00';
  summary.getCell("B11").numFmt = '"GHS" #,##0.00';
  summary.getCell("B12").numFmt = '"GHS" #,##0.00';

  const customersSheet = workbook.addWorksheet("Customer Accounts");
  customersSheet.columns = [
    { header: "Customer", key: "customer_name" },
    { header: "Phone", key: "customer_phone" },
    { header: "Sales Count", key: "sales_count" },
    { header: "Item Quantity", key: "item_quantity" },
    { header: "Total Sales", key: "total_sales" },
    { header: "Total Received", key: "total_received" },
    { header: "Outstanding", key: "outstanding_balance" },
    { header: "Debt Records", key: "debt_count" },
    { header: "Last Activity", key: "last_activity" },
    { header: "Account Status", key: "account_status" },
  ];
  report.customers.forEach((row) => customersSheet.addRow(row));
  styleWorksheet(customersSheet, ["E", "F", "G"]);

  const transactionsSheet = workbook.addWorksheet("Transactions");
  transactionsSheet.columns = [
    { header: "Date", key: "date" },
    { header: "Customer", key: "customer_name" },
    { header: "Phone", key: "customer_phone" },
    { header: "Receipt", key: "receipt_number" },
    { header: "Type", key: "type" },
    { header: "Items / Details", key: "description" },
    { header: "Amount", key: "amount" },
    { header: "Paid", key: "paid" },
    { header: "Balance", key: "balance" },
    { header: "Payment Method", key: "payment_method" },
    { header: "Staff", key: "staff_name" },
    { header: "Status", key: "status" },
  ];
  report.transactions.forEach((row) => transactionsSheet.addRow(row));
  styleWorksheet(transactionsSheet, ["G", "H", "I"]);

  const itemsSheet = workbook.addWorksheet("Items Purchased");
  itemsSheet.columns = [
    { header: "Date", key: "date" },
    { header: "Customer", key: "customer_name" },
    { header: "Phone", key: "customer_phone" },
    { header: "Receipt", key: "receipt_number" },
    { header: "Product", key: "product_name" },
    { header: "Quantity", key: "quantity" },
    { header: "Unit Price", key: "unit_price" },
    { header: "Line Total", key: "line_total" },
    { header: "Status", key: "status" },
  ];
  report.items.forEach((row) => itemsSheet.addRow(row));
  styleWorksheet(itemsSheet, ["G", "H"]);

  const debtsSheet = workbook.addWorksheet("Debts");
  debtsSheet.columns = [
    { header: "Date", key: "created_at" },
    { header: "Customer", key: "customer_name" },
    { header: "Phone", key: "customer_phone" },
    { header: "Receipt", key: "receipt_number" },
    { header: "Amount Owed", key: "amount_owed" },
    { header: "Amount Paid", key: "amount_paid" },
    { header: "Balance", key: "balance" },
    { header: "Status", key: "status" },
    { header: "Due Date", key: "due_date" },
  ];
  report.debts.forEach((row) => debtsSheet.addRow(row));
  styleWorksheet(debtsSheet, ["E", "F", "G"]);

  const paymentsSheet = workbook.addWorksheet("Debt Payments");
  paymentsSheet.columns = [
    { header: "Paid At", key: "paid_at" },
    { header: "Customer", key: "customer_name" },
    { header: "Phone", key: "customer_phone" },
    { header: "Receipt", key: "receipt_number" },
    { header: "Amount", key: "amount" },
    { header: "Method", key: "payment_method" },
    { header: "Received By", key: "received_by_name" },
    { header: "Notes", key: "notes" },
  ];
  report.debt_payments.forEach((row) => paymentsSheet.addRow(row));
  styleWorksheet(paymentsSheet, ["E"]);

  const slug = report.filters.reportType === "debt" ? "debt-report" : "customer-statement";
  const filename = `chalin03-${safeFilename(report.branch.code)}-${slug}-${safeFilename(report.filters.from || "all")}-${safeFilename(report.filters.to || "all")}.xlsx`;
  configureDownload(
    res,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename
  );
  await workbook.xlsx.write(res);
  res.end();
}

function auditReport(req, report, format) {
  writeAuditEvent({
    req,
    branchId: report.branch.id,
    userId: req.user?.id || null,
    workspaceCode: "spare_parts",
    action: "FILTERED_CUSTOMER_REPORT_EXPORTED",
    actionType: "FILTERED_CUSTOMER_REPORT_EXPORTED",
    entityType: report.filters.reportType === "debt" ? "debt_report" : "customer_statement",
    details: `${report.filters.reportType} report exported as ${format} for ${report.period}.`,
    metadata: {
      report_type: report.filters.reportType,
      format,
      from: report.filters.from,
      to: report.filters.to,
      customer: report.filters.customer,
      debt_status: report.filters.debtStatus,
      customer_count: report.summary.customer_count,
      transaction_count: report.summary.transaction_count,
    },
    outcome: "success",
    severity: "info",
  }).catch((error) => console.error("Customer report audit error:", error));
}

router.get("/report", async (req, res) => {
  try {
    const report = await loadFilteredData(req);
    return res.json({ status: "success", ...report });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    if (statusCode >= 500) console.error("Customer statement workspace error:", error);
    return res.status(statusCode).json({
      status: "error",
      message: error?.message || "Unable to load the filtered customer report.",
    });
  }
});

router.get("/export/:format", async (req, res) => {
  try {
    const format = cleanText(req.params.format, 20).toLowerCase();
    if (!["pdf", "print", "word", "excel"].includes(format)) {
      return res.status(400).json({
        status: "error",
        message: "Choose PDF, Word, Excel or Print.",
      });
    }

    const report = await loadFilteredData(req);
    auditReport(req, report, format);

    if (format === "pdf") return sendPdf(res, report, false);
    if (format === "print") return sendPdf(res, report, true);
    if (format === "word") return sendWord(res, report);
    return sendExcel(res, report);
  } catch (error) {
    if (res.headersSent) {
      console.error("Customer report export stream error:", error);
      return res.end();
    }
    const statusCode = Number(error?.statusCode || 500);
    if (statusCode >= 500) console.error("Customer report export error:", error);
    return res.status(statusCode).json({
      status: "error",
      message: error?.message || "Unable to export the filtered customer report.",
    });
  }
});

module.exports = router;
