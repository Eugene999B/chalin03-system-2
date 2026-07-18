const express = require("express");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/permissionMiddleware");
const { rowsToCsv } = require("../utils/csvSafety");
const { writeSharedControlEvidence } = require("../services/sharedControlService");

const router = express.Router();

async function logAuditExport(req, format, rowCount, category) {
  await writeSharedControlEvidence({
    req,
    controlArea: "audit",
    actionType: "export",
    documentType: "audit_activity_report",
    documentNumber: category || "all",
    exportFormat: format,
    description: `Exported ${rowCount} audit activity record(s) in ${String(format).toUpperCase()} format.`,
    metadata: {
      category: category || "all",
      from: req.query.from || null,
      to: req.query.to || null,
    },
  });
}

function cleanText(value, maxLength = 255) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function positiveInt(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function getActivityColumns() {
  try {
    const [columns] = await pool.query("SHOW COLUMNS FROM activity_log");
    return new Set(columns.map((column) => column.Field));
  } catch {
    return new Set();
  }
}

function selectColumn(columns, columnName, fallbackSql = `NULL AS ${columnName}`) {
  return columns.has(columnName) ? `al.${columnName}` : fallbackSql;
}

function addFilter({ where, params }, condition, value) {
  const cleanValue = cleanText(value);
  if (!cleanValue) return;
  where.push(condition);
  params.push(cleanValue);
}


const ACTIVITY_CATEGORIES = [
  ["authentication", "Logins & Account Security"],
  ["sales", "Sales & Receipts"],
  ["products_inventory", "Products, Stock & Transfers"],
  ["daily_closing", "Daily Closing & Cash Control"],
  ["debts_payments", "Debts & Payments"],
  ["expenses_purchases", "Expenses & Purchases"],
  ["returns", "Returns & Refunds"],
  ["users_access", "Users, Roles & Access"],
  ["audit_security", "Audit, Approvals & Security"],
  ["backup_export", "Backups, Restores & Exports"],
  ["mining", "Mining Operations"],
  ["equipment_hire", "Equipment Hire"],
  ["system_other", "Other System Activity"],
];

function activityCategorySql(columns = new Set()) {
  const workspaceSql = columns.has("workspace_code")
    ? "LOWER(COALESCE(al.workspace_code, ''))"
    : "''";
  const entitySql = columns.has("entity_type")
    ? "LOWER(COALESCE(al.entity_type, ''))"
    : "''";

  return `CASE
    WHEN UPPER(COALESCE(al.action, '')) REGEXP 'LOGIN|LOGOUT|PASSWORD|TOKEN|AUTH' THEN 'authentication'
    WHEN ${workspaceSql} = 'mining' THEN 'mining'
    WHEN ${workspaceSql} = 'equipment_hire' THEN 'equipment_hire'
    WHEN ${entitySql} IN ('daily_closing','cash_control')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'DAILY_CLOSING|CLOSING|CASH_COUNT' THEN 'daily_closing'
    WHEN ${entitySql} IN ('audit','audit_signoff','audit_unlock_request','security')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'AUDIT|APPROV|SECURITY|VOID|EDIT_SALE|CORRECTION|UNLOCK' THEN 'audit_security'
    WHEN ${entitySql} IN ('return','refund')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'RETURN|REFUND' THEN 'returns'
    WHEN ${entitySql} IN ('sale','receipt')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'SALE|RECEIPT' THEN 'sales'
    WHEN ${entitySql} IN ('product','stock','stock_transfer','stock_adjustment')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'PRODUCT|STOCK|TRANSFER|ADJUSTMENT' THEN 'products_inventory'
    WHEN ${entitySql} IN ('debt','debt_payment','customer_statement')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'DEBT|PAYMENT|STATEMENT' THEN 'debts_payments'
    WHEN ${entitySql} IN ('expense','purchase','supplier')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'EXPENSE|PURCHASE|SUPPLIER' THEN 'expenses_purchases'
    WHEN ${entitySql} IN ('user','role','permission','workspace_access')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'USER|ROLE|PERMISSION|ACCESS' THEN 'users_access'
    WHEN ${entitySql} IN ('backup','restore','export')
      OR UPPER(COALESCE(al.action, '')) REGEXP 'BACKUP|RESTORE|EXPORT' THEN 'backup_export'
    ELSE 'system_other'
  END`;
}

function categoryLabel(value) {
  return ACTIVITY_CATEGORIES.find(([key]) => key === value)?.[1] || "Other System Activity";
}

function safeSheetName(value) {
  return String(value || "Activity").replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "Activity";
}

function safeFilePart(value) {
  return String(value || "all").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "all";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAuditDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("en-GB", { hour12: false });
}

async function loadUserScope(req, columns) {
  const role = String(req.user?.role || "").toLowerCase();
  const workspaceCode = String(req.user?.workspace_code || "spare_parts")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (role === "admin") {
    return { where: ["1 = 1"], params: [] };
  }

  if (workspaceCode === "spare_parts") {
    if (Boolean(req.user?.can_access_all_branches)) {
      return {
        where: columns.has("workspace_code")
          ? ["(al.workspace_code IS NULL OR al.workspace_code = 'spare_parts')"]
          : ["1 = 1"],
        params: [],
      };
    }

    const [rows] = await pool.query(
      `SELECT branch_id
       FROM user_branch_access
       WHERE user_id = ? AND can_access = 1`,
      [req.user.id]
    );
    const branchIds = [
      ...new Set(
        rows
          .map((row) => positiveInt(row.branch_id))
          .concat(positiveInt(req.user.branch_id), positiveInt(req.user.default_branch_id))
          .filter(Boolean)
      ),
    ];

    if (branchIds.length === 0 || !columns.has("branch_id")) {
      return { where: ["1 = 0"], params: [] };
    }

    return {
      where: [
        columns.has("workspace_code")
          ? "(al.workspace_code IS NULL OR al.workspace_code = 'spare_parts')"
          : "1 = 1",
        `al.branch_id IN (${branchIds.map(() => "?").join(", ")})`,
      ],
      params: branchIds,
    };
  }

  if (workspaceCode === "mining") {
    if (!columns.has("workspace_code") || !columns.has("mining_site_id")) {
      return { where: ["1 = 0"], params: [] };
    }

    const [rows] = await pool.query(
      `SELECT site_id
       FROM user_mining_site_access
       WHERE user_id = ? AND can_access = 1`,
      [req.user.id]
    );
    const siteIds = [...new Set(rows.map((row) => positiveInt(row.site_id)).filter(Boolean))];

    if (siteIds.length === 0) {
      return { where: ["1 = 0"], params: [] };
    }

    return {
      where: [
        "al.workspace_code = 'mining'",
        `al.mining_site_id IN (${siteIds.map(() => "?").join(", ")})`,
      ],
      params: siteIds,
    };
  }

  if (workspaceCode === "equipment_hire") {
    if (!columns.has("workspace_code") || !columns.has("hire_location_id")) {
      return { where: ["1 = 0"], params: [] };
    }

    const [rows] = await pool.query(
      `SELECT location_id
       FROM user_hire_location_access
       WHERE user_id = ? AND can_access = 1`,
      [req.user.id]
    );
    const locationIds = [
      ...new Set(rows.map((row) => positiveInt(row.location_id)).filter(Boolean)),
    ];

    if (locationIds.length === 0) {
      return { where: ["1 = 0"], params: [] };
    }

    return {
      where: [
        "al.workspace_code = 'equipment_hire'",
        `al.hire_location_id IN (${locationIds.map(() => "?").join(", ")})`,
      ],
      params: locationIds,
    };
  }

  return {
    where: ["al.user_id = ?"],
    params: [req.user.id],
  };
}

function buildAuditFilters(req, columns, scope) {
  const where = [...scope.where];
  const params = [...scope.params];

  addFilter({ where, params }, "DATE(al.created_at) >= ?", req.query.from);
  addFilter({ where, params }, "DATE(al.created_at) <= ?", req.query.to);
  addFilter({ where, params }, "al.action = ?", req.query.action);
  const category = cleanText(req.query.category);
  if (category) {
    where.push(`(${activityCategorySql(columns)}) = ?`);
    params.push(category);
  }
  addFilter({ where, params }, "u.role = ?", req.query.role);
  addFilter({ where, params }, "al.user_id = ?", positiveInt(req.query.user_id));

  if (columns.has("workspace_code")) {
    addFilter({ where, params }, "al.workspace_code = ?", req.query.workspace);
  }

  if (columns.has("business_unit_id")) {
    addFilter(
      { where, params },
      "al.business_unit_id = ?",
      positiveInt(req.query.business_unit_id)
    );
  }

  if (columns.has("mining_site_id")) {
    addFilter(
      { where, params },
      "al.mining_site_id = ?",
      positiveInt(req.query.mining_site_id || req.query.site_id)
    );
  }

  if (columns.has("hire_location_id")) {
    addFilter(
      { where, params },
      "al.hire_location_id = ?",
      positiveInt(req.query.hire_location_id || req.query.location_id)
    );
  }

  if (columns.has("entity_type")) {
    addFilter({ where, params }, "al.entity_type = ?", req.query.entity_type);
  }

  if (columns.has("entity_id")) {
    addFilter({ where, params }, "al.entity_id = ?", req.query.entity_id);
  }

  if (columns.has("action_type")) {
    addFilter({ where, params }, "al.action_type = ?", req.query.action_type);
  }

  if (columns.has("outcome")) {
    addFilter({ where, params }, "al.outcome = ?", req.query.outcome);
  }

  if (columns.has("severity")) {
    addFilter({ where, params }, "al.severity = ?", req.query.severity);
  }

  if (columns.has("request_id")) {
    addFilter({ where, params }, "al.request_id = ?", req.query.request_id);
  }

  const branchId = positiveInt(req.query.branch_id);
  if (branchId && columns.has("branch_id")) {
    where.push("al.branch_id = ?");
    params.push(branchId);
  }

  const search = cleanText(req.query.search, 120);
  if (search) {
    const searchParts = [
      "al.action LIKE ?",
      "al.details LIKE ?",
      "u.full_name LIKE ?",
      "u.username LIKE ?",
      "u.role LIKE ?",
      "b.name LIKE ?",
      "b.location LIKE ?",
    ];

    if (columns.has("entity_type")) searchParts.push("al.entity_type LIKE ?");
    if (columns.has("entity_id")) searchParts.push("al.entity_id LIKE ?");
    if (columns.has("request_id")) searchParts.push("al.request_id LIKE ?");
    if (columns.has("metadata_json")) searchParts.push("al.metadata_json LIKE ?");

    where.push(`(${searchParts.join(" OR ")})`);
    const value = `%${search}%`;
    params.push(...searchParts.map(() => value));
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
  };
}

function buildAuditSelect(columns) {
  return `SELECT
    al.id,
    ${selectColumn(columns, "branch_id")},
    ${selectColumn(columns, "user_id")},
    al.action,
    al.details,
    ${activityCategorySql(columns)} AS activity_category,
    ${selectColumn(columns, "ip_address")},
    al.created_at,
    ${selectColumn(columns, "workspace_code")},
    ${selectColumn(columns, "business_unit_id")},
    ${selectColumn(columns, "mining_site_id")},
    ${selectColumn(columns, "hire_location_id")},
    ${selectColumn(columns, "entity_type")},
    ${selectColumn(columns, "entity_id")},
    ${selectColumn(columns, "action_type")},
    ${selectColumn(columns, "outcome", "'success' AS outcome")},
    ${selectColumn(columns, "severity", "'info' AS severity")},
    ${selectColumn(columns, "request_id")},
    ${selectColumn(columns, "user_agent")},
    ${selectColumn(columns, "metadata_json")},
    u.full_name,
    u.username,
    u.role,
    b.code AS branch_code,
    b.name AS branch_name,
    b.location AS branch_location`;
}

async function loadAuditRows(req, { exportMode = false } = {}) {
  const columns = await getActivityColumns();
  const scope = await loadUserScope(req, columns);
  const { whereSql, params } = buildAuditFilters(req, columns, scope);
  const limit = exportMode ? 5000 : Math.min(positiveInt(req.query.limit, 50), 200);
  const page = Math.max(positiveInt(req.query.page, 1), 1);
  const offset = exportMode ? 0 : (page - 1) * limit;

  const [logs] = await pool.query(
    `${buildAuditSelect(columns)}
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [[summary]] = await pool.query(
    `SELECT
       COUNT(*) AS total_logs,
       COUNT(DISTINCT al.user_id) AS active_users
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}`,
    params
  );

  const [actions] = await pool.query(
    `SELECT al.action, COUNT(*) AS count
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}
     GROUP BY al.action
     ORDER BY al.action ASC
     LIMIT 300`,
    params
  );

  const [categoryRows] = await pool.query(
    `SELECT ${activityCategorySql(columns)} AS category, COUNT(*) AS count
     FROM activity_log al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN branches b ON al.branch_id = b.id
     ${whereSql}
     GROUP BY category
     ORDER BY category ASC`,
    params
  );

  return {
    logs,
    actions,
    categories: ACTIVITY_CATEGORIES.map(([key, label]) => ({
      key, label, count: Number(categoryRows.find((row) => row.category === key)?.count || 0),
    })),
    summary: {
      total_logs: Number(summary?.total_logs || 0),
      active_users: Number(summary?.active_users || 0),
    },
    pagination: {
      page,
      limit,
      total: Number(summary?.total_logs || 0),
      total_pages: Math.max(
        1,
        Math.ceil(Number(summary?.total_logs || 0) / Math.max(limit, 1))
      ),
    },
  };
}

router.use(requireAuth);


function styleAuditWorksheet(worksheet, title, periodText, generatedBy) {
  worksheet.mergeCells("A1:M1");
  worksheet.getCell("A1").value = "CHALIN 03 COMPANY LIMITED";
  worksheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  worksheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F36" } };
  worksheet.getCell("A1").alignment = { horizontal: "center" };
  worksheet.mergeCells("A2:M2");
  worksheet.getCell("A2").value = title;
  worksheet.getCell("A2").font = { bold: true, size: 14, color: { argb: "FF92400E" } };
  worksheet.getCell("A2").alignment = { horizontal: "center" };
  worksheet.mergeCells("A3:M3");
  worksheet.getCell("A3").value = `${periodText} | Generated by ${generatedBy}`;
  worksheet.getCell("A3").alignment = { horizontal: "center" };
  worksheet.getRow(5).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  worksheet.views = [{ state: "frozen", ySplit: 5 }];
  worksheet.autoFilter = { from: "A5", to: "M5" };
  worksheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  worksheet.headerFooter.oddFooter = "Chalin 03 Audit Evidence | Page &P of &N";
}

function addAuditRowsToWorksheet(worksheet, rows, startRow = 5) {
  const columns = [
    ["Date & Time", "created_at", 22], ["Category", "activity_category", 22],
    ["User", "full_name", 22], ["Username", "username", 18], ["Role", "role", 14],
    ["Action", "action", 24], ["Outcome", "outcome", 12], ["Severity", "severity", 12],
    ["Entity", "entity_type", 16], ["Entity ID", "entity_id", 14], ["Branch", "branch_code", 12],
    ["Request ID", "request_id", 18], ["Details", "details", 60],
  ];
  const header = worksheet.getRow(startRow);
  columns.forEach(([label, , width], index) => {
    worksheet.getColumn(index + 1).width = width;
    header.getCell(index + 1).value = label;
  });
  rows.forEach((row, rowIndex) => {
    const target = worksheet.getRow(startRow + 1 + rowIndex);
    columns.forEach(([, key], index) => {
      target.getCell(index + 1).value = key === "created_at" ? formatAuditDate(row[key]) : key === "activity_category" ? categoryLabel(row[key]) : row[key] ?? null;
    });
    target.alignment = { vertical: "top", wrapText: true };
    if (rowIndex % 2 === 1) target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  });
}

function createAuditWorkbook(logs, req) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chalin 03 Company Limited";
  workbook.created = new Date();
  const generatedBy = req.user?.full_name || req.user?.username || "Authorized user";
  const periodText = `${req.query.from || "All dates"} to ${req.query.to || "Current"}`;

  const summary = workbook.addWorksheet("Executive Summary");
  summary.mergeCells("A1:F1");
  summary.getCell("A1").value = "CHALIN 03 COMPANY LIMITED - AUDIT ACTIVITY CONTROL REPORT";
  summary.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F36" } };
  summary.getCell("A1").alignment = { horizontal: "center" };
  summary.addRow([]);
  summary.addRow(["Period", periodText]);
  summary.addRow(["Generated by", generatedBy]);
  summary.addRow(["Total records", logs.length]);
  summary.addRow([]);
  summary.addRow(["Category", "Records"]);
  ACTIVITY_CATEGORIES.forEach(([key, label]) => summary.addRow([label, logs.filter((row) => row.activity_category === key).length]));
  summary.columns = [{ width: 40 }, { width: 18 }];
  summary.getRow(7).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  summary.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

  const all = workbook.addWorksheet("All Activity");
  styleAuditWorksheet(all, "All Audit Activity", periodText, generatedBy);
  addAuditRowsToWorksheet(all, logs);

  for (const [key, label] of ACTIVITY_CATEGORIES) {
    const rows = logs.filter((row) => row.activity_category === key);
    if (!rows.length) continue;
    const sheet = workbook.addWorksheet(safeSheetName(label));
    styleAuditWorksheet(sheet, label, periodText, generatedBy);
    addAuditRowsToWorksheet(sheet, rows);
  }
  return workbook;
}

function createAuditPdf(logs, req, stream) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true });
  doc.pipe(stream);
  const generatedBy = req.user?.full_name || req.user?.username || "Authorized user";
  const periodText = `${req.query.from || "All dates"} to ${req.query.to || "Current"}`;

  function pageHeader(title) {
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0B1F36").text("CHALIN 03 COMPANY LIMITED", { align: "center" });
    doc.fontSize(12).fillColor("#92400E").text(title, { align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#475569").text(`${periodText} | Generated by ${generatedBy}`, { align: "center" });
    doc.moveDown(0.5);
  }

  pageHeader("AUDIT ACTIVITY CONTROL REPORT");
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A").text(`Total records: ${logs.length}`);
  doc.moveDown(0.4);
  for (const [key, label] of ACTIVITY_CATEGORIES) {
    const rows = logs.filter((row) => row.activity_category === key);
    if (!rows.length) continue;
    if (doc.y > 500) { doc.addPage(); pageHeader("AUDIT ACTIVITY CONTROL REPORT"); }
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1D4ED8").text(`${label} (${rows.length})`);
    for (const row of rows) {
      if (doc.y > 525) { doc.addPage(); pageHeader(label); }
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#0F172A").text(`${formatAuditDate(row.created_at)} | ${row.full_name || row.username || "System"} | ${row.action || "Activity"}`);
      doc.font("Helvetica").fontSize(7.5).fillColor("#334155").text(`${row.details || "No details"} | Outcome: ${row.outcome || "success"} | Severity: ${row.severity || "info"}`, { width: 770 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.4);
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 20;
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor("#64748B").text(
      `Page ${i + 1} of ${pages.count}`,
      32,
      footerY,
      { width: doc.page.width - 64, align: "right", lineBreak: false }
    );
    doc.page.margins.bottom = originalBottomMargin;
  }
  doc.end();
}

function createAuditWordHtml(logs, req) {
  const generatedBy = req.user?.full_name || req.user?.username || "Authorized user";
  const periodText = `${req.query.from || "All dates"} to ${req.query.to || "Current"}`;
  const sections = ACTIVITY_CATEGORIES.map(([key, label]) => {
    const rows = logs.filter((row) => row.activity_category === key);
    if (!rows.length) return "";
    const body = rows.map((row) => `<tr><td>${htmlEscape(formatAuditDate(row.created_at))}</td><td>${htmlEscape(row.full_name || row.username || "System")}</td><td>${htmlEscape(row.action)}</td><td>${htmlEscape(row.details)}</td><td>${htmlEscape(row.outcome || "success")}</td></tr>`).join("");
    return `<h2>${htmlEscape(label)} (${rows.length})</h2><table><thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Details</th><th>Outcome</th></tr></thead><tbody>${body}</tbody></table>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#0f172a}h1{text-align:center;color:#0b1f36}h2{color:#1d4ed8;border-bottom:2px solid #dbeafe;padding-bottom:4px}p.meta{text-align:center;color:#475569}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:9pt}th{background:#0b1f36;color:white}th,td{border:1px solid #cbd5e1;padding:5px;vertical-align:top}tr:nth-child(even){background:#f8fafc}</style></head><body><h1>CHALIN 03 COMPANY LIMITED<br>AUDIT ACTIVITY CONTROL REPORT</h1><p class="meta">${htmlEscape(periodText)} | Generated by ${htmlEscape(generatedBy)} | ${logs.length} record(s)</p>${sections || "<p>No matching activity records.</p>"}</body></html>`;
}

router.get(
  "/export.xlsx",
  requirePermission("audit.export"),
  async (req, res, next) => {
    try {
      const { logs } = await loadAuditRows(req, { exportMode: true });
      const workbook = createAuditWorkbook(logs, req);
      const category = safeFilePart(req.query.category || "all");
      const filename = `chalin03-audit-${category}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      await logAuditExport(req, "xlsx", logs.length, category);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await workbook.xlsx.write(res);
      return res.end();
    } catch (error) { return next(error); }
  }
);

router.get(
  "/export.pdf",
  requirePermission("audit.export"),
  async (req, res, next) => {
    try {
      const { logs } = await loadAuditRows(req, { exportMode: true });
      const category = safeFilePart(req.query.category || "all");
      await logAuditExport(req, "pdf", logs.length, category);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="chalin03-audit-${category}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      createAuditPdf(logs, req, res);
      return undefined;
    } catch (error) { return next(error); }
  }
);

router.get(
  "/export.doc",
  requirePermission("audit.export"),
  async (req, res, next) => {
    try {
      const { logs } = await loadAuditRows(req, { exportMode: true });
      const category = safeFilePart(req.query.category || "all");
      const html = createAuditWordHtml(logs, req);
      await logAuditExport(req, "doc", logs.length, category);
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="chalin03-audit-${category}-${new Date().toISOString().slice(0, 10)}.doc"`);
      return res.send(Buffer.from(`\uFEFF${html}`, "utf8"));
    } catch (error) { return next(error); }
  }
);

router.get(
  "/export.csv",
  requirePermission("audit.export"),
  async (req, res, next) => {
    try {
      const { logs } = await loadAuditRows(req, { exportMode: true });
      const csv = rowsToCsv(
        [
          { key: "created_at", label: "Created At" },
          { key: "activity_category", label: "Category" },
          { key: "workspace_code", label: "Workspace" },
          { key: "branch_code", label: "Branch" },
          { key: "username", label: "Username" },
          { key: "role", label: "Role" },
          { key: "action", label: "Action" },
          { key: "action_type", label: "Action Type" },
          { key: "entity_type", label: "Entity Type" },
          { key: "entity_id", label: "Entity ID" },
          { key: "outcome", label: "Outcome" },
          { key: "severity", label: "Severity" },
          { key: "request_id", label: "Request ID" },
          { key: "details", label: "Details" },
        ],
        logs
      );

      await logAuditExport(req, "csv", logs.length, safeFilePart(req.query.category || "all"));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="chalin03-audit-trail-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(csv);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/",
  requireAnyPermission("audit.view", "spare_parts.audit"),
  async (req, res, next) => {
    try {
      const result = await loadAuditRows(req);

      return res.json({
        status: "success",
        ...result,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.__private = {
  buildAuditFilters,
  loadUserScope,
  createAuditWorkbook,
  createAuditPdf,
  createAuditWordHtml,
  categoryLabel,
};

module.exports = router;
