const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

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

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getFilters(req) {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const query = cleanText(req.query.query || req.query.name || req.query.phone, 180);
  const status = cleanText(req.query.status, 30).toLowerCase();
  const reportType = cleanText(req.query.report_type || "statement", 20).toLowerCase();

  if (from && to && from > to) {
    const error = new Error("The start date cannot be after the end date.");
    error.statusCode = 400;
    throw error;
  }

  if (!["statement", "debt"].includes(reportType)) {
    const error = new Error("Report type must be statement or debt.");
    error.statusCode = 400;
    throw error;
  }

  return { from, to, query, status, reportType };
}

function getBranch(req) {
  const id = positiveId(req.user?.branch_id || req.user?.default_branch_id);
  if (!id) {
    const error = new Error("No store was selected for this session.");
    error.statusCode = 400;
    throw error;
  }

  return {
    id,
    code: cleanText(req.user?.branch_code || "STORE", 40),
    name: cleanText(req.user?.branch_name || "Selected Store", 160),
    location: cleanText(req.user?.branch_location || "", 255),
  };
}

function addDateFilter(sql, params, alias, column, filters) {
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

function addCustomerFilter(sql, params, alias, filters) {
  if (!filters.query) return sql;
  const like = `%${filters.query}%`;
  params.push(like, like);
  return `${sql} AND (${alias}.customer_name LIKE ? OR ${alias}.customer_phone LIKE ?)`;
}

function validSale(sale) {
  const status = cleanText(sale?.sale_status, 30).toLowerCase();
  return Number(sale?.is_voided || 0) !== 1 && !["cancelled", "voided"].includes(status);
}

function customerKey(record) {
  const phone = cleanText(record?.customer_phone, 80).toLowerCase();
  if (phone) return `phone:${phone}`;
  const id = positiveId(record?.customer_id);
  if (id) return `id:${id}`;
  return `name:${cleanText(record?.customer_name || "Customer", 180).toLowerCase()}`;
}

function makeGroup(record) {
  return {
    customer: {
      id: positiveId(record?.customer_id),
      name: cleanText(record?.customer_name || "Customer", 180),
      phone: cleanText(record?.customer_phone || "", 80),
    },
    sales: [],
    debts: [],
    payments: [],
  };
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
  return Number.isNaN(date.getTime()) ? cleanText(value, 50) : date.toLocaleDateString("en-GB");
}

function dateTimeLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? cleanText(value, 60) : date.toLocaleString("en-GB");
}

function periodLabel(filters) {
  if (filters.from && filters.to) return `${filters.from} to ${filters.to}`;
  if (filters.from) return `From ${filters.from}`;
  if (filters.to) return `Up to ${filters.to}`;
  return "All available dates";
}

async function loadFinancialData(req) {
  const branch = getBranch(req);
  const filters = getFilters(req);

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
  saleSql = addCustomerFilter(saleSql, saleParams, "s", filters);
  saleSql = addDateFilter(saleSql, saleParams, "s", "created_at", filters);
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
  debtSql = addCustomerFilter(debtSql, debtParams, "d", filters);
  debtSql = addDateFilter(debtSql, debtParams, "d", "created_at", filters);
  if (filters.status && filters.status !== "all") {
    debtSql += " AND LOWER(d.status) = ?";
    debtParams.push(filters.status);
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
  paymentSql = addCustomerFilter(paymentSql, paymentParams, "d", filters);
  paymentSql = addDateFilter(paymentSql, paymentParams, "dp", "paid_at", filters);
  paymentSql += ` ORDER BY dp.paid_at DESC, dp.id DESC LIMIT ${MAX_ROWS}`;

  const [[sales], [debts], [payments]] = await Promise.all([
    pool.query(saleSql, saleParams),
    pool.query(debtSql, debtParams),
    pool.query(paymentSql, paymentParams),
  ]);

  let saleItems = [];
  if (sales.length > 0) {
    const saleIds = sales.map((sale) => sale.id);
    const placeholders = saleIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT id, sale_id, product_id, product_name, quantity, unit_price, line_total
       FROM sale_items
       WHERE sale_id IN (${placeholders})
       ORDER BY sale_id ASC, id ASC`,
      saleIds
    );
    saleItems = rows;
  }

  const itemsBySale = new Map();
  saleItems.forEach((item) => {
    const saleId = Number(item.sale_id);
    if (!itemsBySale.has(saleId)) itemsBySale.set(saleId, []);
    itemsBySale.get(saleId).push(item);
  });
  sales.forEach((sale) => {
    sale.items = itemsBySale.get(Number(sale.id)) || [];
  });

  const groups = new Map();
  function ensure(record) {
    const key = customerKey(record);
    if (!groups.has(key)) groups.set(key, makeGroup(record));
    return groups.get(key);
  }
  sales.forEach((sale) => ensure(sale).sales.push(sale));
  debts.forEach((debt) => ensure(debt).debts.push(debt));
  payments.forEach((payment) => ensure(payment).payments.push(payment));

  const customerSummaries = Array.from(groups.values()).map((group) => {
    const validSales = group.sales.filter(validSale);
    const salesTotal = validSales.reduce((sum, sale) => sum + toNumber(sale.total), 0);
    const paidAtSale = validSales.reduce((sum, sale) => sum + toNumber(sale.amount_paid), 0);
    const debtPayments = group.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const outstanding = group.debts.reduce((sum, debt) => sum + toNumber(debt.balance), 0);
    const itemCount = validSales.reduce(
      (sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + toNumber(item.quantity), 0),
      0
    );
    const latestDate = [
      ...group.sales.map((row) => row.created_at),
      ...group.debts.map((row) => row.created_at),
      ...group.payments.map((row) => row.paid_at),
    ]
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || null;

    return {
      customer: group.customer,
      sales_count: validSales.length,
      debt_count: group.debts.length,
      payment_count: group.payments.length,
      item_quantity: Number(itemCount.toFixed(2)),
      total_sales: Number(salesTotal.toFixed(2)),
      total_received: Number((paidAtSale + debtPayments).toFixed(2)),
      outstanding: Number(outstanding.toFixed(2)),
      latest_activity_at: latestDate,
      status: outstanding <= 0 ? "clear" : outstanding > salesTotal * 0.5 ? "high_follow_up" : "watch",
    };
  });

  customerSummaries.sort((a, b) => b.total_sales - a.total_sales || a.customer.name.localeCompare(b.customer.name));

  const transactions = [];
  sales.forEach((sale) => {
    transactions.push({
      id: `sale-${sale.id}`,
      record_id: sale.id,
      type: "sale",
      date: sale.created_at,
      customer_id: sale.customer_id,
      customer_name: sale.customer_name,
      customer_phone: sale.customer_phone,
      receipt_number: sale.receipt_number,
      amount: validSale(sale) ? toNumber(sale.total) : 0,
      amount_paid: validSale(sale) ? toNumber(sale.amount_paid) : 0,
      balance: validSale(sale) ? toNumber(sale.balance) : 0,
      payment_method: sale.payment_type,
      status: validSale(sale) ? sale.sale_status : "voided",
      staff_name: sale.staff_name,
      items: sale.items,
    });
  });
  debts.forEach((debt) => {
    transactions.push({
      id: `debt-${debt.id}`,
      record_id: debt.id,
      type: "debt",
      date: debt.created_at,
      customer_id: debt.customer_id,
      customer_name: debt.customer_name,
      customer_phone: debt.customer_phone,
      receipt_number: debt.receipt_number,
      amount: toNumber(debt.amount_owed),
      amount_paid: toNumber(debt.amount_paid),
      balance: toNumber(debt.balance),
      payment_method: "credit",
      status: debt.status,
      due_date: debt.due_date,
      items: [],
    });
  });
  payments.forEach((payment) => {
    transactions.push({
      id: `payment-${payment.id}`,
      record_id: payment.id,
      type: "debt_payment",
      date: payment.paid_at,
      customer_id: payment.customer_id,
      customer_name: payment.customer_name,
      customer_phone: payment.customer_phone,
      receipt_number: payment.receipt_number,
      amount: toNumber(payment.amount),
      amount_paid: toNumber(payment.amount),
      balance: 0,
      payment_method: payment.payment_method,
      status: "received",
      staff_name: payment.received_by_name,
      notes: payment.notes,
      items: [],
    });
  });
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  const items = [];
  sales.filter(validSale).forEach((sale) => {
    sale.items.forEach((item) => {
      items.push({
        id: item.id,
        sale_id: sale.id,
        date: sale.created_at,
        receipt_number: sale.receipt_number,
        customer_name: sale.customer_name,
        customer_phone: sale.customer_phone,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: toNumber(item.quantity),
        unit_price: toNumber(item.unit_price),
        line_total: toNumber(item.line_total),
      });
    });
  });
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  const validSales = sales.filter(validSale);
  const totalSales = validSales.reduce((sum, sale) => sum + toNumber(sale.total), 0);
  const paidAtSale = validSales.reduce((sum, sale) => sum + toNumber(sale.amount_paid), 0);
  const debtPaymentTotal = payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const outstanding = debts.reduce((sum, debt) => sum + toNumber(debt.balance), 0);
  const itemQuantity = items.reduce((sum, item) => sum + toNumber(item.quantity), 0);

  return {
    branch,
    filters,
    period: periodLabel(filters),
    summary: {
      customer_count: customerSummaries.length,
      sales_count: validSales.length,
      debt_count: debts.length,
      payment_count: payments.length,
      item_quantity: Number(itemQuantity.toFixed(2)),
      total_sales: Number(totalSales.toFixed(2)),
      total_received: Number((paidAtSale + debtPaymentTotal).toFixed(2)),
      total_outstanding: Number(outstanding.toFixed(2)),
    },
    customer_summaries: customerSummaries,
    transactions,
    items,
    debts,
    payments,
    truncated: sales.length >= MAX_ROWS || debts.length >= MAX_ROWS || payments.length >= MAX_ROWS,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportTitle(data) {
  return data.filters.reportType === "debt" ? "Customer Debt Report" : "Customer Statement & Account Analysis";
}

function filteredTransactions(data) {
  return data.filters.reportType === "debt"
    ? data.transactions.filter((row) => row.type === "debt" || row.type === "debt_payment")
    : data.transactions;
}

function filenameBase(data) {
  const queryPart = data.filters.query ? data.filters.query.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") : "all-customers";
  return `chalin03-${data.branch.code.toLowerCase()}-${data.filters.reportType}-${data.filters.from || "all"}-${data.filters.to || "all"}-${queryPart}`;
}

function generatePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 38, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const title = reportTitle(data);
    doc.rect(38, 30, 519, 64).fill("#07182c");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text("CHALIN 03 COMPANY LIMITED", 48, 44, { align: "center", width: 499 });
    doc.font("Helvetica").fontSize(9).text(`${data.branch.code} — ${data.branch.name}${data.branch.location ? ` | ${data.branch.location}` : ""}`, 48, 68, { align: "center", width: 499 });
    doc.y = 110;
    doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(17).text(title, { align: "center" });
    doc.fillColor("#475569").font("Helvetica").fontSize(9).text(`Period: ${data.period} | Customer filter: ${data.filters.query || "All customers"}`, { align: "center" });
    doc.moveDown();

    const metrics = [
      ["Customers", data.summary.customer_count],
      ["Sales", data.summary.sales_count],
      ["Sales Value", money(data.summary.total_sales)],
      ["Received", money(data.summary.total_received)],
      ["Outstanding", money(data.summary.total_outstanding)],
    ];
    metrics.forEach(([label, value]) => {
      doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(9).text(`${label}: ${value}`);
    });
    doc.moveDown(0.7);

    if (data.filters.reportType === "statement") {
      data.customer_summaries.forEach((customer, index) => {
        if (doc.y > 680) doc.addPage();
        doc.fillColor("#ffffff").rect(38, doc.y, 519, 24).fill("#173b68");
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(
          `${customer.customer.name}${customer.customer.phone ? ` (${customer.customer.phone})` : ""}`,
          45,
          doc.y - 17,
          { width: 505 }
        );
        doc.fillColor("#334155").font("Helvetica").fontSize(8.5).text(
          `Sales ${customer.sales_count} | Items ${customer.item_quantity} | Sales ${money(customer.total_sales)} | Received ${money(customer.total_received)} | Outstanding ${money(customer.outstanding)}`,
          { paragraphGap: 4 }
        );
        const customerRows = data.transactions.filter((row) => customerKey(row) === customerKey({ customer_id: customer.customer.id, customer_name: customer.customer.name, customer_phone: customer.customer.phone }));
        customerRows.slice(0, 200).forEach((row) => {
          if (doc.y > 730) doc.addPage();
          const itemText = row.items?.length ? row.items.map((item) => `${item.product_name} x${toNumber(item.quantity)}`).join(", ") : "-";
          doc.fillColor("#1f2937").font("Helvetica").fontSize(7.8).text(
            `${dateTimeLabel(row.date)} | ${row.type.replaceAll("_", " ")} | ${row.receipt_number || "-"} | ${itemText} | Amount ${money(row.amount)} | Paid ${money(row.amount_paid)} | Balance ${money(row.balance)} | ${row.status || "-"}`
          );
        });
        if (index < data.customer_summaries.length - 1) doc.moveDown(0.8);
      });
    } else {
      filteredTransactions(data).forEach((row) => {
        if (doc.y > 730) doc.addPage();
        doc.fillColor("#1f2937").font("Helvetica").fontSize(8).text(
          `${dateTimeLabel(row.date)} | ${row.customer_name || "Customer"}${row.customer_phone ? ` (${row.customer_phone})` : ""} | ${row.type.replaceAll("_", " ")} | ${row.receipt_number || "-"} | Amount ${money(row.amount)} | Paid ${money(row.amount_paid)} | Balance ${money(row.balance)} | ${row.status || "-"}`
        );
      });
    }

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(index);
      doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(
        `Chalin 03 | ${data.branch.code} | ${title} | Page ${index + 1} of ${pages.count}`,
        38,
        812,
        { width: 519, align: "center", lineBreak: false }
      );
    }
    doc.end();
  });
}

function generateWordHtml(data) {
  const rows = filteredTransactions(data)
    .map((row) => {
      const items = row.items?.length
        ? row.items.map((item) => `${escapeHtml(item.product_name)} x${toNumber(item.quantity)} @ ${money(item.unit_price)}`).join("<br>")
        : "-";
      return `<tr><td>${escapeHtml(dateTimeLabel(row.date))}</td><td>${escapeHtml(row.customer_name || "Customer")}</td><td>${escapeHtml(row.type.replaceAll("_", " "))}</td><td>${escapeHtml(row.receipt_number || "-")}</td><td>${items}</td><td>${escapeHtml(money(row.amount))}</td><td>${escapeHtml(money(row.amount_paid))}</td><td>${escapeHtml(money(row.balance))}</td><td>${escapeHtml(row.status || "-")}</td></tr>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(reportTitle(data))}</title><style>body{font-family:Arial,sans-serif;color:#172033}h1,h2{text-align:center;color:#173b68}.meta{text-align:center;margin-bottom:18px}.summary{display:table;width:100%;border-collapse:collapse;margin:16px 0}.summary td{border:1px solid #cbd5e1;padding:8px;font-weight:bold}table.report{width:100%;border-collapse:collapse;font-size:10px}table.report th,table.report td{border:1px solid #cbd5e1;padding:6px;vertical-align:top}table.report th{background:#173b68;color:white}</style></head><body><h1>CHALIN 03 COMPANY LIMITED</h1><h2>${escapeHtml(reportTitle(data))}</h2><div class="meta">${escapeHtml(data.branch.code)} — ${escapeHtml(data.branch.name)}<br>Period: ${escapeHtml(data.period)} | Customer: ${escapeHtml(data.filters.query || "All customers")}</div><table class="summary"><tr><td>Customers: ${data.summary.customer_count}</td><td>Sales: ${data.summary.sales_count}</td><td>Total Sales: ${escapeHtml(money(data.summary.total_sales))}</td><td>Received: ${escapeHtml(money(data.summary.total_received))}</td><td>Outstanding: ${escapeHtml(money(data.summary.total_outstanding))}</td></tr></table><table class="report"><thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Receipt</th><th>Items Bought</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No matching records.</td></tr>'}</tbody></table></body></html>`;
}

async function generateExcel(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chalin 03 Company Limited";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
  summary.addRow(["CHALIN 03 COMPANY LIMITED"]);
  summary.addRow([reportTitle(data)]);
  summary.addRow([`${data.branch.code} — ${data.branch.name}`, data.branch.location || ""]);
  summary.addRow(["Period", data.period, "Customer Filter", data.filters.query || "All customers"]);
  summary.addRow([]);
  summary.addRow(["Metric", "Value"]);
  [
    ["Matching Customers", data.summary.customer_count],
    ["Sales", data.summary.sales_count],
    ["Items Purchased", data.summary.item_quantity],
    ["Total Sales", data.summary.total_sales],
    ["Total Received", data.summary.total_received],
    ["Outstanding", data.summary.total_outstanding],
  ].forEach((row) => summary.addRow(row));
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 22;
  summary.getColumn(3).width = 22;
  summary.getColumn(4).width = 26;
  summary.getColumn(2).numFmt = '#,##0.00';

  const customers = workbook.addWorksheet("Customer Accounts", { views: [{ state: "frozen", ySplit: 1 }] });
  customers.columns = [
    { header: "Customer", key: "name", width: 28 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Sales", key: "sales_count", width: 12 },
    { header: "Items", key: "item_quantity", width: 12 },
    { header: "Total Sales", key: "total_sales", width: 18 },
    { header: "Received", key: "total_received", width: 18 },
    { header: "Outstanding", key: "outstanding", width: 18 },
    { header: "Last Activity", key: "latest_activity_at", width: 20 },
    { header: "Status", key: "status", width: 18 },
  ];
  data.customer_summaries.forEach((row) => customers.addRow({ ...row, name: row.customer.name, phone: row.customer.phone, latest_activity_at: dateTimeLabel(row.latest_activity_at) }));

  const transactions = workbook.addWorksheet("Transactions", { views: [{ state: "frozen", ySplit: 1 }] });
  transactions.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "customer_phone", width: 17 },
    { header: "Type", key: "type", width: 16 },
    { header: "Receipt", key: "receipt_number", width: 20 },
    { header: "Items Bought", key: "items_text", width: 48 },
    { header: "Amount", key: "amount", width: 16 },
    { header: "Paid", key: "amount_paid", width: 16 },
    { header: "Balance", key: "balance", width: 16 },
    { header: "Payment Method", key: "payment_method", width: 18 },
    { header: "Status", key: "status", width: 16 },
    { header: "Staff", key: "staff_name", width: 22 },
  ];
  filteredTransactions(data).forEach((row) => transactions.addRow({ ...row, date: dateTimeLabel(row.date), type: row.type.replaceAll("_", " "), items_text: row.items?.map((item) => `${item.product_name} x${toNumber(item.quantity)} @ ${money(item.unit_price)}`).join("; ") || "" }));

  const items = workbook.addWorksheet("Items Purchased", { views: [{ state: "frozen", ySplit: 1 }] });
  items.columns = [
    { header: "Date", key: "date", width: 20 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "customer_phone", width: 17 },
    { header: "Receipt", key: "receipt_number", width: 20 },
    { header: "Product", key: "product_name", width: 34 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Unit Price", key: "unit_price", width: 16 },
    { header: "Line Total", key: "line_total", width: 16 },
  ];
  data.items.forEach((row) => items.addRow({ ...row, date: dateTimeLabel(row.date) }));

  const debts = workbook.addWorksheet("Debts", { views: [{ state: "frozen", ySplit: 1 }] });
  debts.columns = [
    { header: "Date", key: "created_at", width: 20 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "customer_phone", width: 17 },
    { header: "Receipt", key: "receipt_number", width: 20 },
    { header: "Amount Owed", key: "amount_owed", width: 18 },
    { header: "Amount Paid", key: "amount_paid", width: 18 },
    { header: "Balance", key: "balance", width: 18 },
    { header: "Status", key: "status", width: 16 },
    { header: "Due Date", key: "due_date", width: 16 },
  ];
  data.debts.forEach((row) => debts.addRow({ ...row, created_at: dateTimeLabel(row.created_at), due_date: dateLabel(row.due_date) }));

  const payments = workbook.addWorksheet("Debt Payments", { views: [{ state: "frozen", ySplit: 1 }] });
  payments.columns = [
    { header: "Date", key: "paid_at", width: 20 },
    { header: "Customer", key: "customer_name", width: 26 },
    { header: "Phone", key: "customer_phone", width: 17 },
    { header: "Receipt", key: "receipt_number", width: 20 },
    { header: "Amount", key: "amount", width: 18 },
    { header: "Method", key: "payment_method", width: 18 },
    { header: "Received By", key: "received_by_name", width: 24 },
    { header: "Notes", key: "notes", width: 34 },
  ];
  data.payments.forEach((row) => payments.addRow({ ...row, paid_at: dateTimeLabel(row.paid_at) }));

  workbook.eachSheet((sheet) => {
    const header = sheet.getRow(1);
    if (sheet.name !== "Summary") {
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B68" } };
      header.alignment = { vertical: "middle", horizontal: "center" };
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    }
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  });

  [customers, transactions, items, debts, payments].forEach((sheet) => {
    ["total_sales", "total_received", "outstanding", "amount", "amount_paid", "balance", "unit_price", "line_total", "amount_owed"].forEach((key) => {
      const column = sheet.getColumn(key);
      if (column) column.numFmt = '#,##0.00';
    });
  });

  return workbook.xlsx.writeBuffer();
}

function auditExport(req, data, format) {
  return writeAuditEvent({
    req,
    branchId: data.branch.id,
    userId: req.user?.id || null,
    workspaceCode: "spare_parts",
    action: "CUSTOMER_FINANCIAL_WORKSPACE_EXPORTED",
    actionType: "CUSTOMER_FINANCIAL_WORKSPACE_EXPORTED",
    entityType: data.filters.reportType === "debt" ? "debt_report" : "customer_statement",
    details: `${reportTitle(data)} exported as ${format.toUpperCase()} for ${data.period}.`,
    metadata: {
      report_type: data.filters.reportType,
      format,
      from: data.filters.from,
      to: data.filters.to,
      query: data.filters.query,
      status: data.filters.status,
      customer_count: data.summary.customer_count,
      transaction_count: filteredTransactions(data).length,
    },
    outcome: "success",
    severity: "info",
  }).catch((error) => console.error("Customer financial export audit error:", error));
}

router.get("/data", async (req, res) => {
  try {
    const data = await loadFinancialData(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.page_size) || 25));
    const transactions = filteredTransactions(data);
    const start = (page - 1) * pageSize;

    return res.json({
      status: "success",
      ...data,
      transactions: transactions.slice(start, start + pageSize),
      pagination: {
        page,
        page_size: pageSize,
        total: transactions.length,
        pages: Math.max(1, Math.ceil(transactions.length / pageSize)),
      },
    });
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    if (statusCode >= 500) console.error("Customer financial workspace data error:", error);
    return res.status(statusCode).json({ status: "error", message: error.message || "Unable to load the filtered customer report." });
  }
});

router.get("/export/:format", async (req, res) => {
  try {
    const format = cleanText(req.params.format, 20).toLowerCase();
    if (!["pdf", "word", "excel"].includes(format)) {
      return res.status(400).json({ status: "error", message: "Export format must be PDF, Word or Excel." });
    }

    const data = await loadFinancialData(req);
    const base = filenameBase(data);

    if (format === "pdf") {
      const buffer = await generatePdf(data);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${base}.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.send(buffer);
    } else if (format === "word") {
      const html = generateWordHtml(data);
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.doc"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.send(Buffer.from(html, "utf8"));
    } else {
      const buffer = await generateExcel(data);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.send(Buffer.from(buffer));
    }

    auditExport(req, data, format);
  } catch (error) {
    if (!res.headersSent) {
      const statusCode = Number(error.statusCode || 500);
      if (statusCode >= 500) console.error("Customer financial export error:", error);
      return res.status(statusCode).json({ status: "error", message: error.message || "Unable to export the filtered customer report." });
    }
    console.error("Customer financial export stream error:", error);
    res.end();
  }
});

module.exports = router;
