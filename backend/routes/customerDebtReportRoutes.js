const express = require("express");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

router.use(requireAuth, requireRole("admin", "manager", "cashier", "auditor"));

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
    branch_code: cleanText(req.user?.branch_code || "STORE", 40),
    name: cleanText(req.user?.branch_name || "Selected Store", 160),
    location: cleanText(req.user?.branch_location || "", 255),
  };
}

function parseDate(value) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getDateRange(req) {
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);

  if (from && to && from > to) {
    const error = new Error("The start date cannot be after the end date.");
    error.statusCode = 400;
    throw error;
  }

  return { from, to };
}

function buildDateFilter(alias, column, range, params) {
  let sql = "";

  if (range.from) {
    sql += ` AND DATE(${alias}.${column}) >= ?`;
    params.push(range.from);
  }

  if (range.to) {
    sql += ` AND DATE(${alias}.${column}) <= ?`;
    params.push(range.to);
  }

  return sql;
}

function getSelection(req) {
  const scope = cleanText(req.query.scope || "selected", 20).toLowerCase();
  const customerId = positiveId(req.query.customer_id);
  const name = cleanText(req.query.name, 180);
  const phone = cleanText(req.query.phone, 80);

  if (!["selected", "all"].includes(scope)) {
    const error = new Error("Customer scope must be selected or all.");
    error.statusCode = 400;
    throw error;
  }

  if (scope === "selected" && !customerId && !name && !phone) {
    const error = new Error(
      "Choose a customer before printing a selected-customer report."
    );
    error.statusCode = 400;
    throw error;
  }

  return { scope, customerId, name, phone };
}

function buildCustomerFilter(alias, selection, params) {
  if (selection.scope === "all") return "";

  if (selection.customerId) {
    params.push(selection.customerId);
    return ` AND ${alias}.customer_id = ?`;
  }

  const clauses = [];
  if (selection.phone) {
    clauses.push(`${alias}.customer_phone = ?`);
    params.push(selection.phone);
  }

  if (clauses.length === 0 && selection.name) {
    clauses.push(`${alias}.customer_name = ?`);
    params.push(selection.name);
  }

  return clauses.length > 0 ? ` AND (${clauses.join(" OR ")})` : "";
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
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
  return Number.isNaN(date.getTime())
    ? cleanText(value, 40)
    : date.toLocaleDateString("en-GB");
}

function dateTimeLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? cleanText(value, 60)
    : date.toLocaleString("en-GB");
}

function periodLabel(range) {
  if (range.from && range.to) return `${range.from} to ${range.to}`;
  if (range.from) return `From ${range.from}`;
  if (range.to) return `Up to ${range.to}`;
  return "All available dates";
}

function customerKey(record) {
  const customerId = positiveId(record?.customer_id);
  if (customerId) return `id:${customerId}`;

  const phone = cleanText(record?.customer_phone, 80).toLowerCase();
  if (phone) return `phone:${phone}`;

  return `name:${cleanText(
    record?.customer_name || "Customer",
    180
  ).toLowerCase()}`;
}

function customerLabel(customer) {
  const name = cleanText(
    customer?.name || customer?.customer_name || "Customer",
    180
  );
  const phone = cleanText(
    customer?.phone || customer?.customer_phone || "",
    80
  );
  return phone ? `${name} (${phone})` : name;
}

function groupCustomerData(sales, debts, payments, selection) {
  const groups = new Map();

  function ensure(record) {
    const key = customerKey(record);
    if (!groups.has(key)) {
      groups.set(key, {
        customer: {
          id: positiveId(record?.customer_id),
          name: cleanText(
            record?.customer_name || selection.name || "Customer",
            180
          ),
          phone: cleanText(
            record?.customer_phone || selection.phone || "",
            80
          ),
        },
        sales: [],
        debts: [],
        debt_payments: [],
      });
    }
    return groups.get(key);
  }

  sales.forEach((row) => ensure(row).sales.push(row));
  debts.forEach((row) => ensure(row).debts.push(row));
  payments.forEach((row) => ensure(row).debt_payments.push(row));

  if (groups.size === 0 && selection.scope === "selected") {
    ensure({
      customer_id: selection.customerId,
      customer_name: selection.name || "Customer",
      customer_phone: selection.phone,
    });
  }

  return Array.from(groups.values()).sort((left, right) =>
    customerLabel(left.customer).localeCompare(customerLabel(right.customer))
  );
}

async function loadReportData(req, { includeItems = true } = {}) {
  const branchId = getBranchId(req);
  if (!branchId) {
    const error = new Error("No store was selected for this session.");
    error.statusCode = 400;
    throw error;
  }

  const range = getDateRange(req);
  const selection = getSelection(req);

  const saleParams = [branchId];
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
  saleSql += buildCustomerFilter("s", selection, saleParams);
  saleSql += buildDateFilter("s", "created_at", range, saleParams);
  saleSql += " ORDER BY s.created_at DESC, s.id DESC";

  const [sales] = await pool.query(saleSql, saleParams);

  let items = [];
  if (includeItems && sales.length > 0) {
    const saleIds = sales.map((sale) => sale.id);
    const placeholders = saleIds.map(() => "?").join(",");
    const [itemRows] = await pool.query(
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
    items = itemRows;
  }

  const itemsBySale = new Map();
  items.forEach((item) => {
    if (!itemsBySale.has(Number(item.sale_id))) {
      itemsBySale.set(Number(item.sale_id), []);
    }
    itemsBySale.get(Number(item.sale_id)).push(item);
  });
  sales.forEach((sale) => {
    sale.items = itemsBySale.get(Number(sale.id)) || [];
  });

  const debtParams = [branchId];
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
  debtSql += buildCustomerFilter("d", selection, debtParams);
  debtSql += buildDateFilter("d", "created_at", range, debtParams);
  debtSql += " ORDER BY d.created_at DESC, d.id DESC";

  const [debts] = await pool.query(debtSql, debtParams);

  const paymentParams = [branchId];
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
  paymentSql += buildCustomerFilter("d", selection, paymentParams);
  paymentSql += buildDateFilter("dp", "paid_at", range, paymentParams);
  paymentSql += " ORDER BY dp.paid_at DESC, dp.id DESC";

  const [payments] = await pool.query(paymentSql, paymentParams);

  return {
    branch: branchInfo(req),
    range,
    selection,
    sales,
    debts,
    payments,
    groups: groupCustomerData(sales, debts, payments, selection),
  };
}

function validSale(sale) {
  const status = cleanText(sale?.sale_status, 30).toLowerCase();
  return (
    Number(sale?.is_voided || 0) !== 1 &&
    !["cancelled", "voided"].includes(status)
  );
}

function statementSummary(group) {
  const sales = group.sales.filter(validSale);
  const totalSales = sales.reduce((sum, sale) => sum + toNumber(sale.total), 0);
  const paidAtSale = sales.reduce(
    (sum, sale) => sum + toNumber(sale.amount_paid),
    0
  );
  const laterPayments = group.debt_payments.reduce(
    (sum, payment) => sum + toNumber(payment.amount),
    0
  );
  const outstanding = group.debts.reduce(
    (sum, debt) => sum + toNumber(debt.balance),
    0
  );

  return {
    sales_count: group.sales.length,
    valid_sales_count: sales.length,
    debts_count: group.debts.length,
    payments_count: group.debt_payments.length,
    total_sales: Number(totalSales.toFixed(2)),
    total_paid_on_sales: Number(paidAtSale.toFixed(2)),
    total_debt_payments: Number(laterPayments.toFixed(2)),
    total_received: Number((paidAtSale + laterPayments).toFixed(2)),
    total_outstanding: Number(outstanding.toFixed(2)),
  };
}

function sendError(res, error, fallback) {
  const statusCode = Number(error?.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    status: "error",
    message: error?.message || fallback,
  });
}

function configurePdfResponse(res, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

function addPageHeader(doc, branch, title, subtitle) {
  const width =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, 28, width, 50).fill("#071529");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14);
  doc.text("CHALIN 03 COMPANY LIMITED", doc.page.margins.left + 10, 39, {
    width: width - 20,
    align: "center",
  });
  doc.font("Helvetica").fontSize(8.5);
  doc.text(
    `${branch.branch_code} - ${branch.name}${
      branch.location ? ` | ${branch.location}` : ""
    }`,
    doc.page.margins.left + 10,
    59,
    { width: width - 20, align: "center" }
  );
  doc.y = 92;
  doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(15);
  doc.text(title, { align: "center" });
  doc.fillColor("#475569").font("Helvetica").fontSize(8.5);
  doc.text(subtitle, { align: "center" });
  doc.moveDown(0.7);
}

function ensureSpace(doc, height, branch, title, subtitle) {
  if (doc.y + height <= doc.page.height - doc.page.margins.bottom - 24) return;
  doc.addPage();
  addPageHeader(doc, branch, title, subtitle);
}

function drawMetricRow(doc, metrics) {
  const left = doc.page.margins.left;
  const width =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cellWidth = width / metrics.length;
  const startY = doc.y;

  metrics.forEach(([label, value], index) => {
    const x = left + index * cellWidth;
    doc
      .rect(x, startY, cellWidth, 42)
      .fillAndStroke(index % 2 === 0 ? "#f4f7fb" : "#ffffff", "#d8e1ea");
    doc.fillColor("#475569").font("Helvetica-Bold").fontSize(7);
    doc.text(label, x + 5, startY + 7, {
      width: cellWidth - 10,
      align: "center",
    });
    doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(9);
    doc.text(String(value), x + 5, startY + 22, {
      width: cellWidth - 10,
      align: "center",
    });
  });

  doc.y = startY + 50;
}

function drawSectionTitle(doc, text) {
  doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(11);
  doc.text(text);
  doc.moveDown(0.25);
}

function drawStatementCustomer(doc, data, branch, period, index) {
  if (index > 0) doc.addPage();
  const title = "Customer Statement";
  const subtitle = `${customerLabel(data.customer)} | Period: ${period}`;
  addPageHeader(doc, branch, title, subtitle);

  const summary = statementSummary(data);
  drawMetricRow(doc, [
    ["Total Sales", money(summary.total_sales)],
    ["Received", money(summary.total_received)],
    ["Outstanding", money(summary.total_outstanding)],
    ["Sales / Debts", `${summary.valid_sales_count} / ${summary.debts_count}`],
  ]);

  drawSectionTitle(doc, "Items Purchased and Sales");
  if (data.sales.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(9);
    doc.text("No sales were found for this customer and date range.");
    doc.moveDown();
  }

  data.sales.forEach((sale) => {
    ensureSpace(doc, 82, branch, title, subtitle);
    const voided = !validSale(sale);
    const boxY = doc.y;
    doc
      .rect(doc.page.margins.left, boxY, 507, 22)
      .fillAndStroke("#eef4fb", "#d8e1ea");
    doc.fillColor("#173b68").font("Helvetica-Bold").fontSize(8.5);
    doc.text(
      `${dateTimeLabel(sale.created_at)} | ${
        sale.receipt_number || "No receipt"
      } | ${voided ? "VOIDED/CANCELLED" : money(sale.total)}`,
      doc.page.margins.left + 6,
      boxY + 7,
      { width: 495 }
    );
    doc.y = boxY + 28;

    const items = sale.items || [];
    if (items.length === 0) {
      doc.fillColor("#64748b").font("Helvetica").fontSize(8);
      doc.text("No item lines were recorded for this sale.");
    } else {
      items.forEach((item) => {
        ensureSpace(doc, 16, branch, title, subtitle);
        doc.fillColor("#172033").font("Helvetica").fontSize(8);
        doc.text(
          `• ${item.product_name || "Item"} — Qty ${toNumber(
            item.quantity
          )} × ${money(item.unit_price)} = ${money(item.line_total)}`,
          { indent: 8 }
        );
      });
    }

    doc.fillColor("#475569").font("Helvetica").fontSize(7.8);
    doc.text(
      `Paid: ${money(sale.amount_paid)} | Balance: ${money(
        sale.balance
      )} | Payment: ${sale.payment_type || "-"} | Staff: ${
        sale.staff_name || "-"
      }`,
      { indent: 8 }
    );
    doc.moveDown(0.55);
  });

  ensureSpace(doc, 70, branch, title, subtitle);
  drawSectionTitle(doc, "Debt Records");
  if (data.debts.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(9);
    doc.text("No debt records were found for this customer and date range.");
  } else {
    data.debts.forEach((debt) => {
      ensureSpace(doc, 24, branch, title, subtitle);
      doc.fillColor("#172033").font("Helvetica").fontSize(8);
      doc.text(
        `${dateLabel(debt.created_at)} | ${
          debt.receipt_number || "-"
        } | Owed ${money(debt.amount_owed)} | Paid ${money(
          debt.amount_paid
        )} | Balance ${money(debt.balance)} | ${
          debt.status || "-"
        } | Due ${dateLabel(debt.due_date)}`
      );
    });
  }

  doc.moveDown(0.7);
  ensureSpace(doc, 60, branch, title, subtitle);
  drawSectionTitle(doc, "Debt Payments");
  if (data.debt_payments.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(9);
    doc.text("No debt payments were found for this customer and date range.");
  } else {
    data.debt_payments.forEach((payment) => {
      ensureSpace(doc, 22, branch, title, subtitle);
      doc.fillColor("#172033").font("Helvetica").fontSize(8);
      doc.text(
        `${dateTimeLabel(payment.paid_at)} | ${
          payment.receipt_number || "-"
        } | ${money(payment.amount)} | ${
          payment.payment_method || "-"
        } | Received by ${payment.received_by_name || "-"}`
      );
    });
  }
}

function drawDebtReport(doc, groups, branch, period) {
  const title = "Customer Debt Report";
  const subtitle = `Period: ${period}`;
  addPageHeader(doc, branch, title, subtitle);

  const allDebts = groups.flatMap((group) =>
    group.debts.map((debt) => ({ ...debt, customer: group.customer }))
  );
  const totalOwed = allDebts.reduce(
    (sum, debt) => sum + toNumber(debt.amount_owed),
    0
  );
  const balance = allDebts.reduce(
    (sum, debt) => sum + toNumber(debt.balance),
    0
  );

  drawMetricRow(doc, [
    ["Customers", groups.filter((group) => group.debts.length > 0).length],
    ["Debt Records", allDebts.length],
    ["Total Owed", money(totalOwed)],
    ["Outstanding", money(balance)],
  ]);

  if (allDebts.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(10);
    doc.text(
      "No debt records were found for the selected customer scope and date range.",
      { align: "center" }
    );
    return;
  }

  groups.forEach((group) => {
    if (group.debts.length === 0) return;
    ensureSpace(doc, 46, branch, title, subtitle);
    const headerY = doc.y;
    doc
      .rect(doc.page.margins.left, headerY, 507, 24)
      .fillAndStroke("#173b68", "#173b68");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
    doc.text(
      customerLabel(group.customer),
      doc.page.margins.left + 7,
      headerY + 8,
      { width: 493 }
    );
    doc.y = headerY + 30;

    group.debts.forEach((debt) => {
      ensureSpace(doc, 43, branch, title, subtitle);
      const y = doc.y;
      doc
        .rect(doc.page.margins.left, y, 507, 37)
        .fillAndStroke("#f8fafc", "#d8e1ea");
      doc.fillColor("#172033").font("Helvetica-Bold").fontSize(7.8);
      doc.text(
        `${dateLabel(debt.created_at)} | Receipt ${
          debt.receipt_number || "-"
        }`,
        doc.page.margins.left + 6,
        y + 6,
        { width: 495 }
      );
      doc.font("Helvetica").fontSize(7.5);
      doc.text(
        `Owed ${money(debt.amount_owed)} | Paid ${money(
          debt.amount_paid
        )} | Balance ${money(debt.balance)} | Status ${
          debt.status || "-"
        } | Due ${dateLabel(debt.due_date)}`,
        doc.page.margins.left + 6,
        y + 20,
        { width: 495 }
      );
      doc.y = y + 43;
    });
  });
}

function addPageFooters(doc, branch, title) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - 20;
    const original = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor("#64748b").font("Helvetica").fontSize(7);
    doc.text(
      `Chalin 03 | ${branch.branch_code} | ${title} | Page ${
        index + 1
      } of ${range.count}`,
      doc.page.margins.left,
      y,
      {
        width:
          doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
        lineBreak: false,
      }
    );
    doc.page.margins.bottom = original;
  }
}

router.get("/customers", async (req, res) => {
  try {
    const branchId = getBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        status: "error",
        message: "No store was selected for this session.",
      });
    }

    const range = getDateRange(req);
    const reportType = cleanText(
      req.query.report_type || "statement",
      20
    ).toLowerCase();
    const params = [branchId];

    let sql;
    if (reportType === "debt") {
      sql = `
        SELECT
          d.customer_id,
          MAX(d.customer_name) AS customer_name,
          MAX(d.customer_phone) AS customer_phone,
          COUNT(*) AS record_count,
          COALESCE(SUM(d.balance), 0) AS outstanding_balance
        FROM debts d
        WHERE d.branch_id = ?
      `;
      sql += buildDateFilter("d", "created_at", range, params);
      sql += `
        GROUP BY d.customer_id
        ORDER BY customer_name ASC, customer_phone ASC, d.customer_id ASC
        LIMIT 500
      `;
    } else {
      sql = `
        SELECT
          s.customer_id,
          MAX(s.customer_name) AS customer_name,
          MAX(s.customer_phone) AS customer_phone,
          COUNT(*) AS record_count,
          COALESCE(SUM(CASE
            WHEN COALESCE(s.is_voided, 0) = 0
             AND s.sale_status NOT IN ('cancelled', 'voided')
            THEN s.total ELSE 0 END), 0) AS total_sales
        FROM sales s
        WHERE s.branch_id = ?
      `;
      sql += buildDateFilter("s", "created_at", range, params);
      sql += `
        GROUP BY s.customer_id
        ORDER BY customer_name ASC, customer_phone ASC, s.customer_id ASC
        LIMIT 500
      `;
    }

    const [customers] = await pool.query(sql, params);

    return res.json({
      status: "success",
      branch: branchInfo(req),
      period: periodLabel(range),
      customers,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load printable-report customers.");
  }
});

router.get("/statement", async (req, res) => {
  try {
    req.query.scope = "selected";
    const data = await loadReportData(req);
    const group = data.groups[0] || {
      customer: {
        id: data.selection.customerId,
        name: data.selection.name || "Customer",
        phone: data.selection.phone || "",
      },
      sales: [],
      debts: [],
      debt_payments: [],
    };

    return res.json({
      status: "success",
      branch: data.branch,
      customer: group.customer,
      period: periodLabel(data.range),
      summary: statementSummary(group),
      sales: group.sales,
      debts: group.debts,
      debt_payments: group.debt_payments,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load customer statement details.");
  }
});

router.get("/pdf", async (req, res) => {
  try {
    const reportType = cleanText(
      req.query.report_type || "statement",
      20
    ).toLowerCase();
    if (!["statement", "debt"].includes(reportType)) {
      return res.status(400).json({
        status: "error",
        message: "Choose Customer Statement or Debt Report.",
      });
    }

    const data = await loadReportData(req, {
      includeItems: reportType === "statement",
    });
    const period = periodLabel(data.range);
    const reportTitle =
      reportType === "statement" ? "Customer Statement" : "Customer Debt Report";
    const reportSlug =
      reportType === "statement" ? "customer-statements" : "debt-report";
    const filename = `chalin03-${data.branch.branch_code.toLowerCase()}-${reportSlug}-${
      data.range.from || "all"
    }-${data.range.to || "all"}.pdf`;

    configurePdfResponse(res, filename);

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 28, right: 44, bottom: 34, left: 44 },
      bufferPages: true,
      info: {
        Title: reportTitle,
        Author: "Chalin 03 Company Limited",
        Subject: `${reportTitle} - ${data.branch.branch_code} - ${period}`,
      },
    });

    doc.pipe(res);

    if (reportType === "statement") {
      data.groups.forEach((group, index) =>
        drawStatementCustomer(doc, group, data.branch, period, index)
      );
      if (data.groups.length === 0) {
        addPageHeader(doc, data.branch, reportTitle, `Period: ${period}`);
        doc.text("No customer records were found for the selected filters.", {
          align: "center",
        });
      }
    } else {
      drawDebtReport(doc, data.groups, data.branch, period);
    }

    addPageFooters(doc, data.branch, reportTitle);

    doc.end();

    writeAuditEvent({
      req,
      branchId: data.branch.id,
      userId: req.user?.id || null,
      workspaceCode: "spare_parts",
      action: "CUSTOMER_FINANCIAL_REPORT_PRINTED",
      actionType: "CUSTOMER_FINANCIAL_REPORT_PRINTED",
      entityType:
        reportType === "statement" ? "customer_statement" : "debt_report",
      details: `${reportTitle} opened for printing: ${
        data.selection.scope
      } customer scope, ${period}.`,
      metadata: {
        report_type: reportType,
        scope: data.selection.scope,
        customer_id: data.selection.customerId,
        customer_name: data.selection.name,
        customer_phone: data.selection.phone,
        from: data.range.from,
        to: data.range.to,
        customer_count: data.groups.length,
      },
      outcome: "success",
      severity: "info",
    }).catch((auditError) => {
      console.error("Customer financial report audit error:", auditError);
    });
  } catch (error) {
    if (!res.headersSent) {
      return sendError(res, error, "Unable to generate the printable report.");
    }
    console.error("Customer/debt PDF stream error:", error);
    res.end();
  }
});

module.exports = router;
