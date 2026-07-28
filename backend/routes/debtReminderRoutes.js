const express = require("express");

const { requireRole } = require("../middleware/roleMiddleware");
const {
  getCustomerReminderPreview,
  getDebtReminderSettings,
  listDebtReminderHistory,
  previewDebtReminders,
  runDebtReminderSync,
  saveDebtReminderSettings,
  sendCustomerDebtReminderSms,
} = require("../services/debtReminderService");

const router = express.Router();
const SEND_CONFIRMATION = "SEND DEBT REMINDERS";

function getBranchId(req) {
  const candidate =
    req.body?.branch_id ||
    req.query?.branch_id ||
    req.headers["x-branch-id"] ||
    req.user?.branch_id ||
    req.user?.default_branch_id ||
    req.user?.selected_branch_id ||
    1;
  const branchId = Number(candidate);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : 1;
}

function getUserId(req) {
  const userId = Number(req.user?.id || req.user?.user_id || 0);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`${label} must be a positive whole number.`);
    error.statusCode = 400;
    error.code = "INVALID_IDENTIFIER";
    throw error;
  }
  return id;
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code || "DEBT_REMINDER_ERROR",
          message: error.message,
        });
      }
      return next(error);
    });
}

router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const result = await getDebtReminderSettings(branchId);

    return res.json({
      status: "success",
      branch_id: branchId,
      ...result,
      policy: {
        settings_change_roles: ["admin", "manager"],
        sending_roles: ["admin", "manager"],
        automatic_whatsapp_available: false,
        automatic_whatsapp_notice:
          "WhatsApp reminders open a prepared customer chat. Fully automatic WhatsApp delivery requires an approved Meta WhatsApp Business API connection.",
      },
    });
  })
);

router.put(
  "/settings",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const result = await saveDebtReminderSettings({
      branchId,
      input: req.body?.settings || req.body || {},
      reason: req.body?.reason,
      userId: getUserId(req),
      req,
    });

    return res.json({
      status: "success",
      branch_id: branchId,
      message: result.changed
        ? "Debt Reminder Settings saved successfully."
        : "The submitted Debt Reminder Settings already match the saved rules.",
      ...result,
    });
  })
);

router.get(
  "/preview",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const result = await previewDebtReminders(branchId);

    return res.json({
      status: "success",
      branch_id: branchId,
      ...result,
    });
  })
);

router.post(
  "/run",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const confirmation = String(req.body?.confirmation || "")
      .trim()
      .toUpperCase();

    if (confirmation !== SEND_CONFIRMATION) {
      return res.status(400).json({
        status: "error",
        code: "DEBT_REMINDER_CONFIRMATION_REQUIRED",
        message: `Type "${SEND_CONFIRMATION}" to send today's eligible reminders now.`,
      });
    }

    const branchId = getBranchId(req);
    const result = await runDebtReminderSync({
      branchId,
      source: "run_now",
      sentBy: getUserId(req),
      bypassTime: true,
    });

    return res.json({
      status: result.failed > 0 ? "warning" : "success",
      branch_id: branchId,
      message: `Debt reminder run completed: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`,
      result,
    });
  })
);

router.get(
  "/history",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const history = await listDebtReminderHistory(branchId, req.query?.limit);

    return res.json({
      status: "success",
      branch_id: branchId,
      count: history.length,
      history,
    });
  })
);

router.get(
  "/customer/:customerId/message",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const customerId = positiveId(req.params.customerId, "Customer ID");
    const preview = await getCustomerReminderPreview({ branchId, customerId });

    return res.json({
      status: "success",
      branch_id: branchId,
      ...preview,
      channels: {
        sms_enabled: preview.settings.manual_sms_enabled,
        whatsapp_enabled: preview.settings.manual_whatsapp_enabled,
        whatsapp_mode: "prepared_manual_chat",
      },
    });
  })
);

router.post(
  "/customer/:customerId/sms",
  requireRole("admin", "manager"),
  asyncHandler(async (req, res) => {
    const branchId = getBranchId(req);
    const customerId = positiveId(req.params.customerId, "Customer ID");
    const result = await sendCustomerDebtReminderSms({
      branchId,
      customerId,
      sentBy: getUserId(req),
    });

    const statusCode = result.success ? 200 : 502;
    return res.status(statusCode).json({
      status: result.success ? "success" : "error",
      branch_id: branchId,
      message: result.success
        ? "Customer debt reminder SMS submitted successfully."
        : result.error || "Customer debt reminder SMS failed.",
      result,
    });
  })
);

module.exports = router;
module.exports.SEND_CONFIRMATION = SEND_CONFIRMATION;
