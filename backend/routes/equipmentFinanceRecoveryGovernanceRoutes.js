const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  decideFinanceGovernanceRequest,
  getFinanceGovernanceAccount,
  governancePolicy,
  listFinanceGovernance,
  recordFinanceRecoveryAction,
  requestFinanceDefaultReview,
  requestFinanceReschedule,
} = require("../services/equipmentFinanceRecoveryGovernanceService");

const router = express.Router();

const REQUEST_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
  "credit_officer",
]);
const RECOVERY_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
]);
const APPROVAL_ROLES = new Set(["finance_manager"]);

function userId(req) {
  const number = Number(req.user?.id || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assertRole(req, allowed, message, code) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!allowed.has(workspaceRoleFor(req.user))) {
    const error = new Error(message);
    error.statusCode = 403;
    error.code = code;
    throw error;
  }
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error?.statusCode) {
        return res.status(error.statusCode).json({
          status: "error",
          code: error.code || "FINANCE_GOVERNANCE_ERROR",
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          policy: governancePolicy(),
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "FINANCE_GOVERNANCE_STORAGE_UNAVAILABLE",
          message:
            "The protected Finance governance ledger is unavailable. Existing Finance records were not changed.",
          policy: governancePolicy(),
        });
      }
      return next(error);
    });
}

router.get(
  "/",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const result = await listFinanceGovernance({
      search: req.query?.search,
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
    const result = await getFinanceGovernanceAccount(req.params.agreementId);
    return res.json({ status: "success", ...result });
  })
);

router.post(
  "/agreements/:agreementId/reschedule-requests",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      REQUEST_ROLES,
      "Only Finance Manager, Finance Accountant, Collections Officer or Credit Officer can prepare a reschedule request.",
      "FINANCE_RESCHEDULE_REQUEST_PERMISSION_REQUIRED"
    );
    const result = await requestFinanceReschedule({
      agreementId: req.params.agreementId,
      input: req.body || {},
      userId: userId(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Reschedule request recorded. A different Finance Manager must review it before any schedule changes.",
      ...result,
    });
  })
);

router.post(
  "/agreements/:agreementId/default-requests",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      REQUEST_ROLES,
      "Only Finance Manager, Finance Accountant, Collections Officer or Credit Officer can prepare a default review.",
      "FINANCE_DEFAULT_REQUEST_PERMISSION_REQUIRED"
    );
    const result = await requestFinanceDefaultReview({
      agreementId: req.params.agreementId,
      input: req.body || {},
      userId: userId(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Default review request recorded. The agreement status remains unchanged until an independent Finance Manager decision.",
      ...result,
    });
  })
);

router.post(
  "/requests/:requestId/decisions",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      APPROVAL_ROLES,
      "Only the Finance Manager or protected System Administrator can decide governance requests.",
      "FINANCE_GOVERNANCE_DECISION_PERMISSION_REQUIRED"
    );
    const result = await decideFinanceGovernanceRequest({
      requestId: req.params.requestId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      userId: userId(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        String(req.body?.decision || "").toLowerCase() === "approve"
          ? "Governance request approved under independent control."
          : "Governance request rejected; the original request remains preserved.",
      ...result,
    });
  })
);

router.post(
  "/agreements/:agreementId/recovery-actions",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      RECOVERY_ROLES,
      "Only Finance Manager, Finance Accountant or Collections Officer can record recovery actions.",
      "FINANCE_RECOVERY_ACTION_PERMISSION_REQUIRED"
    );
    const result = await recordFinanceRecoveryAction({
      agreementId: req.params.agreementId,
      input: req.body || {},
      userId: userId(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Recovery action recorded as append-only Finance evidence. No Hire, fleet, payment or ownership record was changed.",
      ...result,
    });
  })
);

router.get("/policy", requirePermission("fleet.assets.view"), (_req, res) => {
  return res.json({ status: "success", policy: governancePolicy() });
});

module.exports = router;
module.exports.APPROVAL_ROLES = APPROVAL_ROLES;
module.exports.RECOVERY_ROLES = RECOVERY_ROLES;
module.exports.REQUEST_ROLES = REQUEST_ROLES;
