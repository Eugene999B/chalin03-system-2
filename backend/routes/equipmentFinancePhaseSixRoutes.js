const crypto = require("crypto");
const express = require("express");
const ExcelJS = require("exceljs");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  EquipmentFinancePhaseSixError,
  accountingCsv,
  getAccountingExport,
  getArrearsReport,
  getCashFlowReport,
  getCustomerStatement,
  getPortfolioDashboard,
  listPhaseSixMessageHistory,
  logAccountingExport,
  phaseSixSchemaStatus,
  renderCustomerStatementPdf,
  renderThermalReceiptPdf,
  safeFilename,
  sendCustomerPaymentReceipt,
  startEquipmentFinancePhaseSixSchedulers,
  syncCustomerPaymentReceipts,
} = require("../services/equipmentFinancePhaseSixService");
const {
  runProfessionalReminderSync,
} = require("../services/equipmentFinanceProfessionalReminderService");

const router = express.Router();
const REMINDER_CONFIRMATION = "RUN INSTALLMENT REMINDERS";

startEquipmentFinancePhaseSixSchedulers();

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  return res.status(statusCode).json({
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_PHASE6_ERROR",
    message: error.message || fallback,
    ...(error.readiness ? { readiness: error.readiness } : {}),
  });
}

async function auditExport(req, details, rowCount, checksum) {
  try {
    await writeAuditEvent({
      req,
      action: "EQUIPMENT_FINANCE_ACCOUNTING_EXPORT_GENERATED",
      actionType: "EQUIPMENT_FINANCE_ACCOUNTING_EXPORT_GENERATED",
      workspaceCode: "equipment_installment_finance",
      entityType: "equipment_finance_export",
      entityId: null,
      outcome: "success",
      severity: "notice",
      details,
      metadata: { row_count: rowCount, checksum },
    });
  } catch (error) {
    console.error("Could not append Finance accounting export audit event:", error);
  }
}

router.get(
  "/phase6/readiness",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const readiness = await phaseSixSchemaStatus();
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "warning",
        readiness,
        features: {
          customer_payment_sms: true,
          boss_payment_alerts: true,
          automatic_upcoming_reminders: true,
          automatic_overdue_reminders: true,
          customer_statement: true,
          portfolio_dashboard: true,
          arrears_report: true,
          cash_flow_report: true,
          accounting_export: ["csv", "xlsx"],
          thermal_receipt: "80mm_pdf",
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not check Equipment Finance Phase 6 readiness.");
    }
  }
);

router.get(
  "/phase6/portfolio",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const dashboard = await getPortfolioDashboard({
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
      });
      return res.json({ status: "success", ...dashboard });
    } catch (error) {
      return sendError(res, error, "Could not load the Finance portfolio dashboard.");
    }
  }
);

router.get(
  "/phase6/arrears",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const report = await getArrearsReport({ dateTo: req.query.as_of });
      return res.json({ status: "success", ...report });
    } catch (error) {
      return sendError(res, error, "Could not load the Finance arrears report.");
    }
  }
);

router.get(
  "/phase6/cash-flow",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const report = await getCashFlowReport({
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
      });
      return res.json({ status: "success", ...report });
    } catch (error) {
      return sendError(res, error, "Could not load the Finance cash-flow report.");
    }
  }
);

router.get(
  "/phase6/messages",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const history = await listPhaseSixMessageHistory(req.query.limit);
      return res.json({ status: "success", history });
    } catch (error) {
      return sendError(res, error, "Could not load Finance SMS history.");
    }
  }
);

router.post(
  "/phase6/messages/sync",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const receipts = await syncCustomerPaymentReceipts({
        sentBy: userId(req),
        limit: req.body?.limit || 100,
      });
      return res.json({
        status: receipts.failed ? "warning" : "success",
        message: `Payment SMS sync completed: ${receipts.sent} sent, ${receipts.failed} failed and ${receipts.skipped} skipped.`,
        receipts,
      });
    } catch (error) {
      return sendError(res, error, "Could not synchronize customer payment SMS alerts.");
    }
  }
);

router.post(
  "/phase6/payments/:paymentId/send-receipt",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const sms = await sendCustomerPaymentReceipt({
        paymentId: req.params.paymentId,
        sentBy: userId(req),
        retry: true,
      });
      return res.status(sms.ok ? 200 : 202).json({
        status: sms.ok ? "success" : "warning",
        message: sms.ok
          ? "Customer payment receipt SMS submitted."
          : sms.reason || "The customer payment receipt SMS was not confirmed.",
        sms,
      });
    } catch (error) {
      return sendError(res, error, "Could not send the customer payment receipt SMS.");
    }
  }
);

router.post(
  "/phase6/reminders/run",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const confirmation = String(req.body?.confirmation || "").trim().toUpperCase();
      if (confirmation !== REMINDER_CONFIRMATION) {
        throw new EquipmentFinancePhaseSixError(
          400,
          `Type "${REMINDER_CONFIRMATION}" to send eligible reminders.`,
          "INSTALLMENT_REMINDER_CONFIRMATION_REQUIRED"
        );
      }
      const reminders = await runProfessionalReminderSync({
        source: "phase6_run_now",
        sentBy: userId(req),
        bypassTime: true,
      });
      return res.json({
        status: reminders.failed ? "warning" : "success",
        message: `Reminder run completed: ${reminders.sent} sent, ${reminders.failed} failed and ${reminders.skipped} skipped.`,
        reminders,
      });
    } catch (error) {
      return sendError(res, error, "Could not run Finance reminders.");
    }
  }
);

router.get(
  "/phase6/accounts/:agreementId/statement",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const statement = await getCustomerStatement(req.params.agreementId);
      return res.json({ status: "success", statement });
    } catch (error) {
      return sendError(res, error, "Could not load the customer statement.");
    }
  }
);

router.get(
  "/phase6/accounts/:agreementId/statement.pdf",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const statement = await getCustomerStatement(req.params.agreementId);
      const buffer = await renderCustomerStatementPdf(statement);
      const filename = `${safeFilename(statement.agreement.agreement_number)}-statement.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, "Could not generate the customer statement PDF.");
    }
  }
);

router.get(
  "/phase6/payments/:paymentId/thermal-receipt.pdf",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const receipt = await renderThermalReceiptPdf(req.params.paymentId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${receipt.filename}-thermal.pdf"`
      );
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(receipt.buffer);
    } catch (error) {
      return sendError(res, error, "Could not generate the thermal installment receipt.");
    }
  }
);

router.get(
  "/phase6/accounting-export.csv",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const result = await getAccountingExport({
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
      });
      const content = accountingCsv(result.rows);
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
        `Generated Finance accounting CSV for ${result.period.date_from} to ${result.period.date_to}.`,
        result.rows.length,
        checksum
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="equipment-finance-accounting-${result.period.date_from}-${result.period.date_to}.csv"`
      );
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
      const result = await getAccountingExport({
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
      });
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Chalin 03 Equipment Finance";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("Finance Journal", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      sheet.columns = [
        { header: "Date", key: "transaction_date", width: 14 },
        { header: "Reference", key: "reference", width: 24 },
        { header: "Agreement", key: "agreement_number", width: 24 },
        { header: "Customer", key: "customer_name", width: 28 },
        { header: "Asset", key: "asset_code", width: 18 },
        { header: "Method", key: "payment_method", width: 14 },
        { header: "Account Code", key: "account_code", width: 14 },
        { header: "Account Name", key: "account_name", width: 24 },
        { header: "Debit", key: "debit", width: 16, style: { numFmt: '#,##0.00' } },
        { header: "Credit", key: "credit", width: 16, style: { numFmt: '#,##0.00' } },
        { header: "Description", key: "description", width: 48 },
      ];
      sheet.addRows(result.rows);
      sheet.autoFilter = { from: "A1", to: "K1" };
      sheet.getRow(1).font = { bold: true };
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
        `Generated Finance accounting workbook for ${result.period.date_from} to ${result.period.date_to}.`,
        result.rows.length,
        checksum
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="equipment-finance-accounting-${result.period.date_from}-${result.period.date_to}.xlsx"`
      );
      res.setHeader("X-Content-SHA256", checksum);
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(Buffer.from(buffer));
    } catch (error) {
      return sendError(res, error, "Could not generate the Finance accounting workbook.");
    }
  }
);

module.exports = router;
module.exports.REMINDER_CONFIRMATION = REMINDER_CONFIRMATION;
