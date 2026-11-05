const express = require("express");
const rateLimit = require("express-rate-limit");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  FinancePrivateDocumentError,
} = require("../services/equipmentFinancePrivateDocumentsService");
const {
  approveDocument,
  archiveDocument,
  assertReviewSchema,
  getApplicationReviewCaseFile,
  getReviewCaseFile,
  getReviewPolicy,
  reviewDocument,
} = require("../services/equipmentFinanceDocumentReviewService");

const router = express.Router();

const reviewReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
});
const reviewDecisionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_DOCUMENT_REVIEW_RATE_LIMITED",
    message:
      "Too many document review decisions were attempted. Wait briefly before trying again.",
  },
});
const approvalDecisionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_DOCUMENT_APPROVAL_RATE_LIMITED",
    message:
      "Too many document approval decisions were attempted. Wait briefly before trying again.",
  },
});

const DOCUMENT_REVIEW_ROLES = new Set([
  "finance_auditor",
  "equipment_business_auditor",
  "finance_manager",
  "equipment_business_manager",
]);
const DOCUMENT_APPROVAL_ROLES = new Set([
  "finance_manager",
  "equipment_business_manager",
]);
const REVIEW_VIEW_ROLES = new Set([
  ...DOCUMENT_REVIEW_ROLES,
  ...DOCUMENT_APPROVAL_ROLES,
  "finance_accountant",
  "credit_officer",
  "collections_officer",
  "equipment_business_accountant",
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
      "EQUIPMENT_FINANCE_PHASE5B_ROLE_REQUIRED"
    );
  }
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof FinancePrivateDocumentError || error?.statusCode) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_PHASE5B_ERROR",
          message: error.message,
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5B_MIGRATION_REQUIRED",
          message:
            "Independent Finance document review is awaiting the approved additive Phase 5B migration.",
        });
      }
      return next(error);
    });
}

router.get(
  "/review-readiness",
  reviewReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (_req, res) => {
    await assertReviewSchema();
    return res.json({ status: "success", ready: true });
  })
);

router.get(
  "/review-capabilities",
  reviewReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    const role = workspaceRoleFor(req.user);
    const administrator = isOriginalSystemAdministrator(req.user);
    return res.json({
      status: "success",
      capabilities: {
        role,
        independent_document_review:
          administrator || DOCUMENT_REVIEW_ROLES.has(role),
        document_approval:
          administrator || DOCUMENT_APPROVAL_ROLES.has(role),
        document_archive:
          administrator || DOCUMENT_APPROVAL_ROLES.has(role),
        uploader_cannot_review: true,
        uploader_or_reviewer_cannot_approve: true,
      },
      policy: await getReviewPolicy(),
    });
  })
);

router.get(
  "/application-review-cases/:applicationId",
  reviewReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      REVIEW_VIEW_ROLES,
      "This staff account cannot view independent Finance document decisions."
    );
    return res.json({
      status: "success",
      ...(await getApplicationReviewCaseFile(req.params.applicationId)),
    });
  })
);

router.get(
  "/review-cases/:agreementId",
  reviewReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      REVIEW_VIEW_ROLES,
      "This staff account cannot view independent Finance document decisions."
    );
    return res.json({
      status: "success",
      ...(await getReviewCaseFile(req.params.agreementId)),
    });
  })
);

router.post(
  "/documents/:documentId/review",
  reviewDecisionLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      DOCUMENT_REVIEW_ROLES,
      "Only an authorised independent Finance reviewer can decide document review."
    );
    const result = await reviewDocument({
      documentId: req.params.documentId,
      decision: req.body?.decision,
      notes: req.body?.notes,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        String(req.body?.decision || "").toLowerCase() === "verify"
          ? "Document independently verified and sent for separate approval."
          : "Document review rejected; the encrypted evidence remains preserved.",
      ...result,
    });
  })
);

router.post(
  "/documents/:documentId/approval",
  approvalDecisionLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      DOCUMENT_APPROVAL_ROLES,
      "Only an independent Finance Manager can approve reviewed documents."
    );
    const result = await approveDocument({
      documentId: req.params.documentId,
      decision: req.body?.decision,
      notes: req.body?.notes,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        String(req.body?.decision || "").toLowerCase() === "approve"
          ? "Document approved for the Finance case file."
          : "Document approval rejected; the encrypted evidence remains preserved.",
      ...result,
    });
  })
);

router.post(
  "/documents/:documentId/archive",
  approvalDecisionLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      DOCUMENT_APPROVAL_ROLES,
      "Only a Finance Manager can archive or replace a private document."
    );
    const result = await archiveDocument({
      documentId: req.params.documentId,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message:
        "Document archived for replacement. Its encrypted content and every decision remain preserved.",
      ...result,
    });
  })
);

module.exports = router;
module.exports.DOCUMENT_APPROVAL_ROLES = DOCUMENT_APPROVAL_ROLES;
module.exports.DOCUMENT_REVIEW_ROLES = DOCUMENT_REVIEW_ROLES;
module.exports.REVIEW_VIEW_ROLES = REVIEW_VIEW_ROLES;
module.exports.approvalDecisionLimiter = approvalDecisionLimiter;
module.exports.reviewDecisionLimiter = reviewDecisionLimiter;
module.exports.reviewReadLimiter = reviewReadLimiter;

