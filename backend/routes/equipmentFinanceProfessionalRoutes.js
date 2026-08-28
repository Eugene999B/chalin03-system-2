const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  ProfessionalFinanceError,
  getIssuedDocument,
  getProfessionalSettings,
  issueDocument,
  listIssuedDocuments,
  listProfessionalMachines,
  loadAgreementSnapshot,
  professionalSchemaStatus,
  renderAgreementPdf,
  renderAgreementWord,
  saveSignature,
  sendBossPaymentAlert,
  updateProfessionalSettings,
} = require("../services/equipmentFinanceProfessionalService");
const {
  listProfessionalReminderHistory,
  previewProfessionalReminders,
  runProfessionalReminderSync,
} = require("../services/equipmentFinanceProfessionalReminderService");

const router = express.Router();
const RUN_CONFIRMATION = "RUN INSTALLMENT REMINDERS";

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendError(res, error, fallback) {
  const statusCode = Number(error.statusCode || 500);
  const payload = {
    status: "error",
    code: error.code || "EQUIPMENT_FINANCE_PROFESSIONAL_ERROR",
    message: error.message || fallback,
  };
  if (error.readiness) payload.readiness = error.readiness;
  return res.status(statusCode).json(payload);
}

function normalizeLegalReviewDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return value;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  return match ? match[1] : value;
}

router.get(
  "/professional/readiness",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const readiness = await professionalSchemaStatus();
      return res.status(readiness.ready ? 200 : 503).json({
        status: readiness.ready ? "success" : "warning",
        readiness,
      });
    } catch (error) {
      return sendError(res, error, "Could not check Professional Finance readiness.");
    }
  }
);

router.get(
  "/professional/settings",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const settings = await getProfessionalSettings();
      return res.json({
        status: "success",
        scope: "company_wide_finance",
        settings,
        safeguards: {
          settings_history_preserved: true,
          secret_storage_forbidden: true,
          legal_terms_versioned: true,
          boss_alert_after_commit: true,
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not load Professional Finance settings.");
    }
  }
);

router.put(
  "/professional/settings",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const submittedSettings = req.body?.settings || req.body || {};
      const settings = { ...submittedSettings };
      if (Object.prototype.hasOwnProperty.call(settings, "legal_review_date")) {
        settings.legal_review_date = normalizeLegalReviewDate(settings.legal_review_date);
      }
      const result = await updateProfessionalSettings({
        body: settings,
        reason: req.body?.reason,
        userId: userId(req),
        req,
      });
      return res.json({
        status: "success",
        message: result.changed
          ? "Professional Finance settings saved with a complete history record."
          : "The submitted settings already match the saved Finance policy.",
        ...result,
      });
    } catch (error) {
      return sendError(res, error, "Could not save Professional Finance settings.");
    }
  }
);

router.get(
  "/professional/machines",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const machines = await listProfessionalMachines({
        search: req.query.search,
        status: req.query.status,
        limit: req.query.limit,
      });
      return res.json({
        status: "success",
        count: machines.length,
        machines,
        photo_policy: {
          display: "contain",
          crop: false,
          required_primary_photo: true,
          recommended_evidence: [
            "main",
            "front",
            "rear",
            "left_side",
            "right_side",
            "cabin",
            "engine",
            "serial_plate",
            "chassis_plate",
            "attachment",
            "inspection",
            "damage",
            "registration",
            "ownership",
          ],
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not load the Professional Finance machine register.");
    }
  }
);

router.get(
  "/professional/agreements/:agreementId/preview",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const snapshot = await loadAgreementSnapshot(req.params.agreementId);
      return res.json({ status: "success", snapshot });
    } catch (error) {
      return sendError(res, error, "Could not prepare the Finance agreement preview.");
    }
  }
);

router.post(
  "/professional/agreements/:agreementId/signatures",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const signature = await saveSignature({
        agreementId: req.params.agreementId,
        role: req.body?.signer_role,
        name: req.body?.signer_name,
        phone: req.body?.signer_phone,
        signatureDataUrl: req.body?.signature_data_url,
        notes: req.body?.notes,
        userId: userId(req),
      });
      return res.status(201).json({
        status: "success",
        message: "Finance document signature saved as controlled agreement evidence.",
        signature,
      });
    } catch (error) {
      return sendError(res, error, "Could not save the Finance document signature.");
    }
  }
);

router.get(
  "/professional/documents",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const documents = await listIssuedDocuments({
        agreementId: req.query.agreement_id,
        limit: req.query.limit,
      });
      return res.json({ status: "success", count: documents.length, documents });
    } catch (error) {
      return sendError(res, error, "Could not load issued Finance documents.");
    }
  }
);

router.post(
  "/professional/documents/issue",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const document = await issueDocument({
        agreementId: req.body?.agreement_id,
        documentType: req.body?.document_type || "installment_agreement",
        format: req.body?.format || "pdf",
        userId: userId(req),
      });
      return res.status(201).json({
        status: "success",
        message: "Finance document issued from an immutable data snapshot.",
        document: {
          id: document.id,
          document_number: document.document_number,
          document_type: document.document_type,
          document_format: document.document_format,
          snapshot_checksum: document.snapshot_checksum,
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not issue the Finance document.");
    }
  }
);

router.get(
  "/professional/documents/:documentId/download",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const document = await getIssuedDocument(req.params.documentId);
      const requested = String(req.query.format || document.document_format || "pdf")
        .trim()
        .toLowerCase();
      if (requested === "json") {
        return res.json({
          status: "success",
          document: {
            id: document.id,
            document_number: document.document_number,
            document_type: document.document_type,
            template_version: document.template_version,
            snapshot_checksum: document.snapshot_checksum,
            issued_at: document.issued_at,
            issued_by_name: document.issued_by_name,
          },
          snapshot: document.snapshot,
        });
      }
      if (requested === "word" || requested === "doc") {
        const buffer = renderAgreementWord(document.snapshot, document.document_number);
        res.setHeader("Content-Type", "application/msword; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${document.document_number}.doc"`
        );
        return res.send(buffer);
      }
      if (requested !== "pdf" && requested !== "print") {
        throw new ProfessionalFinanceError(400, "Choose PDF, Word, print or JSON.");
      }
      const buffer = await renderAgreementPdf(document.snapshot, document.document_number);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${requested === "print" ? "inline" : "attachment"}; filename="${
          document.document_number
        }.pdf"`
      );
      return res.send(buffer);
    } catch (error) {
      return sendError(res, error, "Could not download the issued Finance document.");
    }
  }
);

router.get(
  "/installment-command/settings",
  requirePermission("fleet.assets.view"),
  async (_req, res) => {
    try {
      const settings = await getProfessionalSettings();
      return res.json({
        status: "success",
        hire_location_id: null,
        scope: "company_wide_finance",
        settings: {
          automatic_sms_enabled: settings.automatic_reminders_enabled,
          manual_sms_enabled: true,
          manual_whatsapp_enabled: true,
          reminder_time: String(settings.reminder_time || "09:00").slice(0, 5),
          timezone: "Africa/Accra",
          due_soon_enabled: true,
          due_soon_days: String(settings.due_soon_days || "7,3,1")
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value > 0),
          due_today_enabled: true,
          overdue_enabled: true,
          overdue_start_days: 1,
          overdue_repeat_days: settings.overdue_repeat_days,
          max_sms_7_days: settings.max_sms_7_days,
          max_sms_30_days: settings.max_sms_30_days,
          minimum_hours_between_sms: settings.minimum_hours_between_sms,
          minimum_balance: 1,
          max_messages_per_run: 100,
          skip_weekends: settings.skip_weekends,
          include_payment_phone: true,
          message_template: settings.reminder_template,
        },
        sms: {
          automatic_available: true,
          automatic_sms_enabled: settings.automatic_reminders_enabled,
          reason: settings.automatic_reminders_enabled
            ? "Automatic Finance reminders are enabled under the saved company-wide policy."
            : "Automatic reminders are currently disabled in Finance Settings.",
        },
        policy: {
          scope: "company_wide_finance",
          settings_permission: "fleet.assets.manage",
          sending_permission: "fleet.assets.manage",
          quiet_hours_start: settings.quiet_hours_start,
          quiet_hours_end: settings.quiet_hours_end,
        },
      });
    } catch (error) {
      return sendError(res, error, "Could not load installment reminder settings.");
    }
  }
);

router.put(
  "/installment-command/settings",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const input = req.body?.settings || req.body || {};
      const result = await updateProfessionalSettings({
        body: {
          automatic_reminders_enabled: input.automatic_sms_enabled,
          reminder_time: input.reminder_time,
          due_soon_days: Array.isArray(input.due_soon_days)
            ? input.due_soon_days.join(",")
            : input.due_soon_days,
          overdue_repeat_days: input.overdue_repeat_days,
          max_sms_7_days: input.max_sms_7_days,
          max_sms_30_days: input.max_sms_30_days,
          minimum_hours_between_sms: input.minimum_hours_between_sms,
          skip_weekends: input.skip_weekends,
          reminder_template: input.message_template,
        },
        reason: req.body?.reason || "Updated installment reminder controls",
        userId: userId(req),
        req,
      });
      return res.json({
        status: "success",
        message: "Company-wide installment reminder settings saved.",
        changed: result.changed,
      });
    } catch (error) {
      return sendError(res, error, "Could not save installment reminder settings.");
    }
  }
);

router.get(
  "/installment-command/reminders/preview",
  requirePermission("fleet.assets.manage"),
  async (_req, res) => {
    try {
      const preview = await previewProfessionalReminders();
      return res.json({ status: "success", ...preview });
    } catch (error) {
      return sendError(res, error, "Could not preview installment reminders.");
    }
  }
);

router.post(
  "/installment-command/reminders/run",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const confirmation = String(req.body?.confirmation || "")
        .trim()
        .toUpperCase();
      if (confirmation !== RUN_CONFIRMATION) {
        return res.status(400).json({
          status: "error",
          code: "INSTALLMENT_REMINDER_CONFIRMATION_REQUIRED",
          message: `Type "${RUN_CONFIRMATION}" to send eligible reminders now.`,
        });
      }
      const result = await runProfessionalReminderSync({
        source: "run_now",
        sentBy: userId(req),
        bypassTime: true,
      });
      return res.json({
        status: result.failed ? "warning" : "success",
        message: `Reminder run completed: ${result.sent} sent, ${result.failed} failed and ${result.skipped} skipped.`,
        result,
      });
    } catch (error) {
      return sendError(res, error, "Could not run installment reminders.");
    }
  }
);

router.get(
  "/installment-command/reminders/history",
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const history = await listProfessionalReminderHistory(req.query.limit);
      return res.json({ status: "success", count: history.length, history });
    } catch (error) {
      return sendError(res, error, "Could not load installment reminder history.");
    }
  }
);

router.post(
  "/professional/payment-alerts/:paymentId/retry",
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const paymentId = Number(req.params.paymentId);
      const [rows] = await pool.query(
        "SELECT agreement_id FROM equipment_sale_payments WHERE id = ? LIMIT 1",
        [paymentId]
      );
      if (!rows.length) {
        throw new ProfessionalFinanceError(404, "Finance payment was not found.");
      }
      const alert = await sendBossPaymentAlert({
        paymentId,
        agreementId: rows[0].agreement_id,
        userId: userId(req),
      });
      return res.status(alert.ok ? 200 : 202).json({
        status: alert.ok ? "success" : "warning",
        message: alert.ok
          ? "Boss payment alert submitted."
          : alert.reason || "Boss payment alert could not be confirmed.",
        alert,
      });
    } catch (error) {
      return sendError(res, error, "Could not retry the boss payment alert.");
    }
  }
);

module.exports = router;
module.exports.RUN_CONFIRMATION = RUN_CONFIRMATION;
