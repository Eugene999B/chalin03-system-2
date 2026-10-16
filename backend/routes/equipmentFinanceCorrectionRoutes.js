const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  FinanceCorrectionError,
  calculateReturnSettlement,
  decideFinanceCorrection,
  getCorrectionAccount,
  getCorrectionPolicy,
  listCorrectionAccounts,
  listCorrectionRequests,
  requestFinanceCorrection,
  schemaStatus,
  updateCorrectionPolicy,
} = require("../services/equipmentFinanceCorrectionService");

const router = express.Router();

const REQUEST_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
  "credit_officer",
]);
const APPROVAL_ROLES = new Set(["finance_manager"]);
const POLICY_ROLES = new Set(["finance_manager"]);

function actorId(req) {
  const number = Number(req.user?.id || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assertRole(req, allowed, message, code) {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!allowed.has(workspaceRoleFor(req.user))) {
    const error = new FinanceCorrectionError(403, message, code);
    throw error;
  }
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof FinanceCorrectionError || error?.statusCode) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_CORRECTION_ERROR",
          message: error.message,
          ...(error.readiness ? { readiness: error.readiness } : {}),
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE4_MIGRATION_REQUIRED",
          message:
            "Finance corrections and return settlements are awaiting the approved additive Phase 4 migration. Existing records were not changed.",
        });
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_CORRECTION_DUPLICATE",
          message: "That correction, ledger entry or return settlement was already recorded.",
        });
      }
      return next(error);
    });
}

router.get(
  "/readiness",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (_req, res) => {
    const readiness = await schemaStatus();
    return res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "success" : "warning",
      readiness,
      accounting_model: "append_only_correction_ledger",
    });
  })
);

router.get(
  "/policy",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (_req, res) => {
    const policy = await getCorrectionPolicy();
    return res.json({ status: "success", policy });
  })
);

router.put(
  "/policy",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      POLICY_ROLES,
      "Only an independent Finance Manager or protected System Administrator can change the return and correction policy.",
      "EQUIPMENT_FINANCE_CORRECTION_POLICY_PERMISSION_REQUIRED"
    );
    const policy = await updateCorrectionPolicy({
      input: req.body || {},
      actorId: actorId(req),
      req,
    });
    return res.json({
      status: "success",
      message: "Finance return and correction policy updated with a preserved policy-history record.",
      policy,
    });
  })
);

router.post(
  "/settlement-preview",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const policy = await getCorrectionPolicy();
    const settlement = calculateReturnSettlement({
      outstandingBalance: req.body?.outstanding_balance,
      approvedReturnCredit: req.body?.approved_return_credit,
      refundableAmount: req.body?.refundable_amount,
      penaltyAmount: req.body?.penalty_amount,
      damageAmount: req.body?.damage_amount,
      allowCustomerRefundDue: policy.allow_customer_refund_due,
    });
    return res.json({
      status: "success",
      settlement,
      policy_version: policy.policy_version,
      authoritative: false,
      message:
        "This preview uses the recorded policy formula. Approval rechecks the current official account balance before posting ledger entries.",
    });
  })
);

router.get(
  "/accounts",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const accounts = await listCorrectionAccounts({
      search: req.query?.search,
      status: req.query?.status,
    });
    return res.json({ status: "success", count: accounts.length, accounts });
  })
);

router.get(
  "/accounts/:agreementId",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const accountFile = await getCorrectionAccount(req.params.agreementId);
    return res.json({ status: "success", ...accountFile });
  })
);

router.get(
  "/requests",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const requests = await listCorrectionRequests({ status: req.query?.status || "pending" });
    return res.json({ status: "success", count: requests.length, requests });
  })
);

router.post(
  "/accounts/:agreementId/requests",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      REQUEST_ROLES,
      "Only authorised Finance staff can prepare cancellations, reversals, returns, repossessions or waivers.",
      "EQUIPMENT_FINANCE_CORRECTION_REQUEST_PERMISSION_REQUIRED"
    );
    const request = await requestFinanceCorrection({
      agreementId: req.params.agreementId,
      requestType: req.body?.request_type,
      input: req.body || {},
      actorId: actorId(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Correction request recorded. A different Finance Manager must approve it before any balance, payment, schedule or equipment status changes.",
      request,
    });
  })
);

router.post(
  "/requests/:requestId/decision",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      APPROVAL_ROLES,
      "Only a Finance Manager or protected System Administrator can decide correction requests.",
      "EQUIPMENT_FINANCE_CORRECTION_DECISION_PERMISSION_REQUIRED"
    );
    const result = await decideFinanceCorrection({
      requestId: req.params.requestId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      actorId: actorId(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        String(req.body?.decision || "").toLowerCase() === "approve"
          ? "Correction approved and posted through the protected Finance ledger."
          : "Correction rejected; the original request remains preserved.",
      ...result,
    });
  })
);

module.exports = router;
module.exports.APPROVAL_ROLES = APPROVAL_ROLES;
module.exports.POLICY_ROLES = POLICY_ROLES;
module.exports.REQUEST_ROLES = REQUEST_ROLES;
