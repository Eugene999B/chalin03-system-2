const express = require("express");
const rateLimit = require("express-rate-limit");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  FinancePrivateDocumentError,
} = require("../services/equipmentFinancePrivateDocumentsService");
const {
  assertAuthorizationSchema,
  decideDeliveryAuthorization,
  getAuthorizationCaseFile,
  getAuthorizationPolicy,
  requestDeliveryAuthorization,
  revokeDeliveryAuthorization,
} = require("../services/equipmentFinanceDeliveryAuthorizationService");

const router = express.Router();

const authorizationReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
});
const authorizationRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_DELIVERY_AUTHORIZATION_REQUEST_RATE_LIMITED",
    message:
      "Too many delivery authorization requests were attempted. Wait briefly before trying again.",
  },
});
const authorizationDecisionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_DELIVERY_AUTHORIZATION_DECISION_RATE_LIMITED",
    message:
      "Too many delivery authorization decisions were attempted. Wait briefly before trying again.",
  },
});
const authorizationRevocationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_DELIVERY_AUTHORIZATION_REVOCATION_RATE_LIMITED",
    message:
      "Too many delivery authorization revocations were attempted. Wait briefly before trying again.",
  },
});

const AUTHORIZATION_VIEW_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "finance_accountant",
  "collections_officer",
  "finance_auditor",
  "equipment_business_manager",
  "equipment_business_accountant",
  "equipment_business_auditor",
]);
const AUTHORIZATION_REQUEST_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const AUTHORIZATION_DECISION_ROLES = new Set([
  "finance_manager",
  "equipment_business_manager",
]);

function actor(req) {
  const number = Number(req.user?.id || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assertRole(req, roles, message) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!roles.has(workspaceRoleFor(req.user))) {
    throw new FinancePrivateDocumentError(
      403,
      message,
      "EQUIPMENT_FINANCE_PHASE5C_ROLE_REQUIRED"
    );
  }
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof FinancePrivateDocumentError || error?.statusCode) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_PHASE5C_ERROR",
          message: error.message,
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5C_MIGRATION_REQUIRED",
          message:
            "Finance delivery authorization is awaiting the approved additive Phase 5C migration.",
        });
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          code: "FINANCE_DELIVERY_AUTHORIZATION_DUPLICATE",
          message:
            "That delivery authorization already exists. No duplicate was created.",
        });
      }
      return next(error);
    });
}

router.get(
  "/readiness",
  authorizationReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (_req, res) => {
    await assertAuthorizationSchema();
    return res.json({ status: "success", ready: true });
  })
);

router.get(
  "/capabilities",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const role = workspaceRoleFor(req.user);
    const administrator = isOriginalSystemAdministrator(req.user);
    return res.json({
      status: "success",
      capabilities: {
        role,
        delivery_authorization_view:
          administrator || AUTHORIZATION_VIEW_ROLES.has(role),
        delivery_authorization_request:
          administrator || AUTHORIZATION_REQUEST_ROLES.has(role),
        delivery_authorization_decision:
          administrator || AUTHORIZATION_DECISION_ROLES.has(role),
        delivery_authorization_revoke:
          administrator || AUTHORIZATION_DECISION_ROLES.has(role),
        requester_cannot_authorize: true,
        creates_delivery: false,
        confirms_handover: false,
      },
    });
  })
);

router.get(
  "/policy",
  authorizationReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      AUTHORIZATION_VIEW_ROLES,
      "This staff account cannot view Finance delivery authorization policy."
    );
    return res.json({
      status: "success",
      policy: await getAuthorizationPolicy(),
    });
  })
);

router.get(
  "/cases/:agreementId",
  authorizationReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      AUTHORIZATION_VIEW_ROLES,
      "This staff account cannot view Finance delivery authorization records."
    );
    return res.json({
      status: "success",
      ...(await getAuthorizationCaseFile(req.params.agreementId)),
    });
  })
);

router.post(
  "/cases/:agreementId/requests",
  authorizationRequestLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      AUTHORIZATION_REQUEST_ROLES,
      "Only authorised Finance staff can request equipment delivery authorization."
    );
    const result = await requestDeliveryAuthorization({
      agreementId: req.params.agreementId,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Delivery authorization requested. A different Finance Manager must decide it.",
      ...result,
    });
  })
);

router.post(
  "/authorizations/:authorizationId/decision",
  authorizationDecisionLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      AUTHORIZATION_DECISION_ROLES,
      "Only an independent Finance Manager can decide delivery authorization."
    );
    const result = await decideDeliveryAuthorization({
      authorizationId: req.params.authorizationId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        String(req.body?.decision || "").toLowerCase() === "authorize"
          ? "Delivery authorized for the recorded validity window. This phase does not create or confirm delivery."
          : "Delivery authorization rejected; the request remains in the activity trail.",
      ...result,
    });
  })
);

router.post(
  "/authorizations/:authorizationId/revoke",
  authorizationRevocationLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      AUTHORIZATION_DECISION_ROLES,
      "Only a Finance Manager can revoke a live delivery authorization."
    );
    const result = await revokeDeliveryAuthorization({
      authorizationId: req.params.authorizationId,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        "Delivery authorization revoked. No delivery or handover record was created.",
      ...result,
    });
  })
);

module.exports = router;
module.exports.AUTHORIZATION_DECISION_ROLES = AUTHORIZATION_DECISION_ROLES;
module.exports.AUTHORIZATION_REQUEST_ROLES = AUTHORIZATION_REQUEST_ROLES;
module.exports.AUTHORIZATION_VIEW_ROLES = AUTHORIZATION_VIEW_ROLES;
module.exports.authorizationDecisionLimiter = authorizationDecisionLimiter;
module.exports.authorizationReadLimiter = authorizationReadLimiter;
module.exports.authorizationRequestLimiter = authorizationRequestLimiter;
module.exports.authorizationRevocationLimiter = authorizationRevocationLimiter;
