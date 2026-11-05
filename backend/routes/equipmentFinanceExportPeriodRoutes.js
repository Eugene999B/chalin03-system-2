const crypto = require("crypto");
const express = require("express");
const ExcelJS = require("exceljs");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  accountingCsv,
  getAccountingExport,
  logAccountingExport,
} = require("../services/equipmentFinancePhaseSixService");

const router = express.Router();

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizedDateInput(value, fallback) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function dateRange(req) {
  const now = new Date();
  const dateFrom = normalizedDateInput(
    req.query.date_from,
    `${now.getUTCFullYear()}-01-01`
  );
  const dateTo = normalizedDateInput(
    req.query.date_to,
    now.toISOString().slice(0, 10)
  );
  if (dateFrom > dateTo) {
    const error = new Error("The report start date cannot be after the end date.");
    error.statusCode = 400;
    error.code = "INVALID_REPORT_DATE_RANGE";
    throw error;
  }
  return { date_from: dateFrom, date_to: dateTo };
}

function displayDate(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}-${month}-${year}` : String(value || "");
}

function generatedAtLabel() {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Africa/Accra",
    timeZoneName: "short",
  });
}

function periodLabel(period) {
  return `${displayDate(period.date_from)} to ${displayDate(period.date_to)}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvReportHeader(title, period) {
  return [
    ["Report", title],
    ["Selected Period", periodLabel(period)],
    ["Date From", displayDate(period.date_from)],
    ["Date To", displayDate(period.date_to)],
    ["Generated At", generatedAtLabel()],
    [],
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}



function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function auditExport(req, action, details, metadata) {
  try {
    await writeAuditEvent({
      req,
      action,
      actionType: action,
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_export",
      entityId: null,
      outcome: "success",
      severity: "notice",
      details,
      metadata,
    });
  } catch (error) {
    console.error("Could not append Finance period export audit event:", error);
  }
}

function sendError(res, error, fallback) {
  return res.status(Number(error.statusCode || 500)).json({
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_EXPORT_ERROR",
    message: error.message || fallback,
  });
}

router.get(
  "/reports/export.csv",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const period = dateRange(req);
      const [rows] = await pool.query(
        `SELECT
           esa.agreement_number,
           esa.sale_type,
           esa.agreement_status,
           esa.customer_name_snapshot AS customer_name,
           esa.customer_phone_snapshot AS customer_phone,
           esa.asset_code_snapshot AS asset_code,
           esa.asset_name_snapshot AS asset_name,
           esa.total_amount,
           esa.deposit_received,
           esa.amount_paid,
           esa.outstanding_balance,
           esa.overdue_amount,
           esa.next_due_date,
           esa.delivery_status,
           esa.ownership_status,
           bl.name AS hire_location,
           u.full_name AS created_by,
           esa.created_at
         FROM equipment_sale_agreements esa
         LEFT JOIN business_locations bl ON bl.id = esa.hire_location_id
         LEFT JOIN users u ON u.id = esa.created_by
         WHERE esa.sale_type = 'installment'
           AND esa.activation_source = 'approved_credit_application'
           AND DATE(esa.created_at) BETWEEN ? AND ?
         ORDER BY esa.created_at DESC`,
        [period.date_from, period.date_to]
      );

      const columns = [
        "agreement_number",
        "sale_type",
        "agreement_status",
        "customer_name",
        "customer_phone",
        "asset_code",
        "asset_name",
        "total_amount",
        "deposit_received",
        "amount_paid",
        "outstanding_balance",
        "overdue_amount",
        "next_due_date",
        "delivery_status",
        "ownership_status",
        "hire_location",
        "created_by",
        "created_at",
      ];
      const data = [
        columns.map(csvCell).join(","),
        ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
      ].join("\r\n");
      const content = `${csvReportHeader(
        "Equipment Finance Management Export",
        period
      )}${data}`;
      const checksum = crypto.createHash("sha256").update(content).digest("hex");

      await auditExport(
        req,
        "EQUIPMENT_FINANCE_MANAGEMENT_EXPORT_GENERATED",
        `Generated Equipment Finance management CSV for ${period.date_from} to ${period.date_to}.`,
        { ...period, row_count: rows.length, checksum }
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="equipment-finance-management-${displayDate(
          period.date_from
        )}-to-${displayDate(period.date_to)}.csv"`
      );
      res.setHeader("X-Report-Date-From", period.date_from);
      res.setHeader("X-Report-Date-To", period.date_to);
      res.setHeader("X-Content-SHA256", checksum);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(`\uFEFF${content}`);
    } catch (error) {
      return sendError(
        res,
        error,
        "Could not export Equipment Finance management records."
      );
    }
  }
);

router.get(
  "/phase6/accounting-export.csv",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const requestedPeriod = dateRange(req);
      const result = await getAccountingExport({
        dateFrom: requestedPeriod.date_from,
        dateTo: requestedPeriod.date_to,
      });
      const content = `${csvReportHeader(
        "Equipment Finance Accounting Journal",
        result.period
      )}${accountingCsv(result.rows)}`;
      const checksum = crypto.createHash("sha256").update(content).digest("hex");
      await logAccountingExport({
        exportType: "csv",
        period: result.period,
        rows: result.rows,
        userId: userId(req),
        checksum,
      });
      await auditExport(
        req,
        "EQUIPMENT_FINANCE_ACCOUNTING_EXPORT_GENERATED",
        `Generated Finance accounting CSV for ${result.period.date_from} to ${result.period.date_to}.`,
        { ...result.period, row_count: result.rows.length, checksum }
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="equipment-finance-accounting-${displayDate(
          result.period.date_from
        )}-to-${displayDate(result.period.date_to)}.csv"`
      );
      res.setHeader("X-Report-Date-From", result.period.date_from);
      res.setHeader("X-Report-Date-To", result.period.date_to);
      res.setHeader("X-Content-SHA256", checksum);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(`\uFEFF${content}`);
    } catch (error) {
      return sendError(res, error, "Could not generate the Finance accounting CSV.");
    }
  }
);

router.get(
  "/phase6/accounting-export.xlsx",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const requestedPeriod = dateRange(req);
      const result = await getAccountingExport({
        dateFrom: requestedPeriod.date_from,
        dateTo: requestedPeriod.date_to,
      });
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 Equipment Finance";
      workbook.created = new Date();
      workbook.subject = `Selected period: ${periodLabel(result.period)}`;
      workbook.description = `Equipment Finance accounting journal from ${displayDate(
        result.period.date_from
      )} to ${displayDate(result.period.date_to)}.`;
      const sheet = workbook.addWorksheet("Finance Journal", {
        views: [{ state: "frozen", ySplit: 6 }],
      });
      sheet.mergeCells("A1:K1");
      sheet.getCell("A1").value =
        "CHALIN 03 EQUIPMENT FINANCE ACCOUNTING JOURNAL";
      sheet.getCell("A1").font = { bold: true, size: 14 };
      sheet.mergeCells("A2:K2");
      sheet.getCell("A2").value = `SELECTED PERIOD: ${periodLabel(
        result.period
      )}`;
      sheet.getCell("A2").font = { bold: true, size: 12 };
      sheet.mergeCells("A3:K3");
      sheet.getCell("A3").value = `Date From: ${displayDate(
        result.period.date_from
      )}    Date To: ${displayDate(result.period.date_to)}`;
      sheet.mergeCells("A4:K4");
      sheet.getCell("A4").value = `Generated At: ${generatedAtLabel()}`;
      sheet.addRow([]);
      sheet.addRow([
        "Date",
        "Reference",
        "Agreement",
        "Customer",
        "Asset",
        "Method",
        "Account Code",
        "Account Name",
        "Debit",
        "Credit",
        "Description",
      ]);
      sheet.columns = [
        { key: "transaction_date", width: 14 },
        { key: "reference", width: 24 },
        { key: "agreement_number", width: 24 },
        { key: "customer_name", width: 28 },
        { key: "asset_code", width: 18 },
        { key: "payment_method", width: 14 },
        { key: "account_code", width: 14 },
        { key: "account_name", width: 24 },
        { key: "debit", width: 16, style: { numFmt: "#,##0.00" } },
        { key: "credit", width: 16, style: { numFmt: "#,##0.00" } },
        { key: "description", width: 48 },
      ];
      sheet.addRows(result.rows);
      sheet.autoFilter = { from: "A6", to: "K6" };
      sheet.getRow(6).font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      await logAccountingExport({
        exportType: "xlsx",
        period: result.period,
        rows: result.rows,
        userId: userId(req),
        checksum,
      });
      await auditExport(
        req,
        "EQUIPMENT_FINANCE_ACCOUNTING_EXPORT_GENERATED",
        `Generated Finance accounting workbook for ${result.period.date_from} to ${result.period.date_to}.`,
        { ...result.period, row_count: result.rows.length, checksum }
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="equipment-finance-accounting-${displayDate(
          result.period.date_from
        )}-to-${displayDate(result.period.date_to)}.xlsx"`
      );
      res.setHeader("X-Report-Date-From", result.period.date_from);
      res.setHeader("X-Report-Date-To", result.period.date_to);
      res.setHeader("X-Content-SHA256", checksum);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(Buffer.from(buffer));
    } catch (error) {
      return sendError(
        res,
        error,
        "Could not generate the Finance accounting workbook."
      );
    }
  }
);

module.exports = {
  dateRange,
  displayDate,
  periodLabel,
  router,
};
