const express = require("express");
const rateLimit = require("express-rate-limit");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  FinancePrivateDocumentError,
} = require("../services/equipmentFinancePrivateDocumentsService");
const {
  assertConfirmationSchema,
  confirmAuthorizedDelivery,
} = require("../services/equipmentFinanceDeliveryConfirmationService");

const router = express.Router();

const deliveryConfirmationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_DELIVERY_CONFIRMATION_RATE_LIMITED",
    message:
      "Too many delivery confirmations were attempted. Wait briefly before trying again.",
  },
});

const DELIVERY_CONFIRMATION_ROLES = new Set([
  "finance_accountant",
  "credit_officer",
  "collections_officer",
  "finance_manager",
  "equipment_business_accountant",
  "equipment_business_manager",
]);

function actor(req) {
  const number = Number(req.user?.id || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function roleAllowed(req) {
  return (
    isOriginalSystemAdministrator(req.user) ||
    DELIVERY_CONFIRMATION_ROLES.has(workspaceRoleFor(req.user))
  );
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof FinancePrivateDocumentError || error?.statusCode) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_PHASE5D_ERROR",
          message: error.message,
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5D_MIGRATION_REQUIRED",
          message:
            "Finance delivery confirmation is awaiting the approved additive Phase 5D migration.",
        });
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          code: "FINANCE_DELIVERY_CONFIRMATION_DUPLICATE",
          message:
            "Delivery or handover confirmation was already recorded. No duplicate was created.",
        });
      }
      return next(error);
    });
}

router.get(
  "/delivery-confirmation-readiness",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (_req, res) => {
    await assertConfirmationSchema();
    return res.json({ status: "success", ready: true });
  })
);

router.post(
  "/accounts/:agreementId/delivery",
  deliveryConfirmationLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    if (!roleAllowed(req)) {
      throw new FinancePrivateDocumentError(
        403,
        "Controlled delivery confirmation is restricted to authorised Finance staff.",
        "EQUIPMENT_FINANCE_DELIVERY_CONFIRMATION_ROLE_REQUIRED"
      );
    }
    const result = await confirmAuthorizedDelivery({
      agreementId: req.params.agreementId,
      input: req.body || {},
      actor: actor(req),
      req,
    });
    return res.status(result.replayed ? 200 : 201).json({
      status: "success",
      message: result.replayed
        ? "The existing authorized Finance delivery was returned without creating a duplicate."
        : "Authorized Finance delivery and independent physical handover confirmation recorded.",
      ...result,
      automatic_sms_sent: false,
      sms: { sent: false, automatic: false },
    });
  })
);

module.exports = router;
module.exports.DELIVERY_CONFIRMATION_ROLES = DELIVERY_CONFIRMATION_ROLES;
module.exports.deliveryConfirmationLimiter = deliveryConfirmationLimiter;
module.exports.roleAllowed = roleAllowed;
