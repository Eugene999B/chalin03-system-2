const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getAgreementReminderPreview,
  getInstallmentReminderSettings,
  listInstallmentReminderHistory,
  previewInstallmentReminders,
  runEquipmentSalesReminderSync,
  saveInstallmentReminderSettings,
  sendManualInstallmentReminder,
} = require("../services/equipmentInstallmentCommandService");
const {
  FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_TYPES,
  QUEUES,
  correctFinanceCollectionFollowUp,
  getFinanceArrearsAccount,
  listFinanceArrears,
  recordFinanceCollectionFollowUp,
} = require("../services/equipmentFinanceArrearsService");
const {
  getInstallmentPortfolio,
} = require("../services/equipmentInstallmentReadModelService");
const equipmentFinanceRecoveryGovernanceRoutes = require("./equipmentFinanceRecoveryGovernanceRoutes");

const router = express.Router();
const RUN_CONFIRMATION = "RUN INSTALLMENT REMINDERS";

router.use("/governance", equipmentFinanceRecoveryGovernanceRoutes);

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

function locationIdFromScope(req, { required = false } = {}) {
  const locationId = Number(req.hireLocationScope?.locationId || 0);
  if (Number.isInteger(locationId) && locationId > 0) return locationId;
  if (required) {
    const error = new Error(
      "Choose a specific equipment location before changing installment records or settings."
    );
    error.statusCode = 400;
    error.code = "INSTALLMENT_LOCATION_REQUIRED";
    throw error;
  }
  return null;
}

function userId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code || "EQUIPMENT_INSTALLMENT_ERROR",
          message: error.message,
        });
      }
      return next(error);
    });
}

router.get(
  "/portfolio",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const portfolio = await getInstallmentPortfolio({
      locationId: locationIdFromScope(req),
    });
    return res.json({ status: "success", ...portfolio });
  })
);

router.get(
  "/collections",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const result = await listFinanceArrears({
      search: req.query?.search,
      status: req.query?.status,
      risk: req.query?.risk,
      aging: req.query?.aging,
      queue: req.query?.queue,
      limit: req.query?.limit,
    });
    return res.json({ status: "success", ...result });
  })
);

router.get(
  "/agreements/:agreementId",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const agreementId = positiveId(req.params.agreementId, "Agreement ID");
    const result = await getFinanceArrearsAccount(agreementId);
    return res.json({ status: "success", ...result });
  })
);

router.post(
  "/agreements/:agreementId/follow-ups",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const agreementId = positiveId(req.params.agreementId, "Agreement ID");
    const result = await recordFinanceCollectionFollowUp({
      agreementId,
      userId: userId(req),
      input: req.body || {},
      req,
    });
    return res.status(201).json({
      status: "success",
      message: "Finance collection follow-up recorded successfully.",
      ...result,
    });
  })
);

router.post(
  "/agreements/:agreementId/follow-ups/:followUpId/corrections",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const agreementId = positiveId(req.params.agreementId, "Agreement ID");
    const followUpId = positiveId(req.params.followUpId, "Follow-up ID");
    const result = await correctFinanceCollectionFollowUp({
      agreementId,
      followUpId,
      userId: userId(req),
      input: req.body || {},
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Finance collection follow-up correction recorded. The original evidence was preserved.",
      ...result,
    });
  })
);

router.get(
  "/settings",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const locationId = locationIdFromScope(req, { required: true });
    const result = await getInstallmentReminderSettings(locationId);
    return res.json({
      status: "success",
      hire_location_id: locationId,
      ...result,
      policy: {
        settings_permission: "fleet.assets.manage",
        sending_permission: "fleet.assets.manage",
        automatic_whatsapp_available: false,
        automatic_whatsapp_notice:
          "WhatsApp opens a prepared customer chat. Fully automatic WhatsApp delivery requires an approved Meta WhatsApp Business API connection.",
      },
    });
  })
);

router.put(
  "/settings",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const locationId = locationIdFromScope(req, { required: true });
    const result = await saveInstallmentReminderSettings({
      locationId,
      input: req.body?.settings || req.body || {},
      reason: req.body?.reason,
      userId: userId(req),
      req,
    });
    return res.json({
      status: "success",
      hire_location_id: locationId,
      message: result.changed
        ? "Installment reminder settings saved successfully."
        : "The submitted installment settings already match the saved controls.",
      ...result,
    });
  })
);

router.get(
  "/reminders/preview",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const locationId = locationIdFromScope(req, { required: true });
    const result = await previewInstallmentReminders(locationId);
    return res.json({ status: "success", ...result });
  })
);

router.post(
  "/reminders/run",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const confirmation = String(req.body?.confirmation || "")
      .trim()
      .toUpperCase();
    if (confirmation !== RUN_CONFIRMATION) {
      return res.status(400).json({
        status: "error",
        code: "INSTALLMENT_REMINDER_CONFIRMATION_REQUIRED",
        message: `Type "${RUN_CONFIRMATION}" to send the eligible installment reminders now.`,
      });
    }
    const locationId = locationIdFromScope(req, { required: true });
    const result = await runEquipmentSalesReminderSync({
      locationId,
      source: "run_now",
      sentBy: userId(req),
      bypassTime: true,
    });
    return res.json({
      status: result.failed > 0 ? "warning" : "success",
      message: `Installment reminder run completed: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`,
      result,
    });
  })
);

router.get(
  "/reminders/history",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const locationId = locationIdFromScope(req, { required: true });
    const history = await listInstallmentReminderHistory(locationId, req.query?.limit);
    return res.json({ status: "success", count: history.length, history });
  })
);

router.get(
  "/agreements/:agreementId/reminder-message",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const agreementId = positiveId(req.params.agreementId, "Agreement ID");
    const locationId = locationIdFromScope(req, { required: true });
    const preview = await getAgreementReminderPreview({ agreementId, locationId });
    return res.json({
      status: "success",
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
  "/agreements/:agreementId/sms",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    const agreementId = positiveId(req.params.agreementId, "Agreement ID");
    const locationId = locationIdFromScope(req, { required: true });
    const result = await sendManualInstallmentReminder({
      agreementId,
      locationId,
      sentBy: userId(req),
    });
    return res.status(result.success ? 200 : 502).json({
      status: result.success ? "success" : "error",
      message: result.success
        ? "Equipment installment reminder SMS submitted successfully."
        : result.error || "Equipment installment reminder SMS failed.",
      result,
    });
  })
);

router.get("/options", requirePermission("fleet.assets.view"), (_req, res) => {
  return res.json({
    status: "success",
    follow_up_types: [...FOLLOW_UP_TYPES],
    follow_up_outcomes: [...FOLLOW_UP_OUTCOMES],
    queues: [...QUEUES],
    run_confirmation: RUN_CONFIRMATION,
  });
});

module.exports = router;
module.exports.RUN_CONFIRMATION = RUN_CONFIRMATION;