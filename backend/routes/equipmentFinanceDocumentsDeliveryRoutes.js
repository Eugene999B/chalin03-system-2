const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  DOCUMENT_CATEGORIES,
  FinanceDocumentsDeliveryError,
  approveDocument,
  archiveDocument,
  decideDeliveryAuthorization,
  getCaseFile,
  getDocumentContent,
  getPolicy,
  listActivity,
  listCases,
  requestDeliveryAuthorization,
  reviewDocument,
  schemaStatus,
  updatePolicy,
  uploadDocument,
} = require("../services/equipmentFinanceDocumentsDeliveryService");

const router = express.Router();

const DOCUMENT_UPLOAD_ROLES = new Set([
  "finance_manager",
  "credit_officer",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const PRIVATE_DOCUMENT_VIEW_ROLES = new Set([
  ...DOCUMENT_UPLOAD_ROLES,
  "collections_officer",
  "finance_auditor",
  "equipment_business_auditor",
]);
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
const DELIVERY_REQUEST_ROLES = new Set([
  "finance_accountant",
  "credit_officer",
  "finance_manager",
  "equipment_business_accountant",
  "equipment_business_manager",
]);
const DELIVERY_AUTHORIZATION_ROLES = new Set([
  "finance_manager",
  "equipment_business_manager",
]);
const DELIVERY_CONFIRMATION_ROLES = new Set([
  "finance_accountant",
  "credit_officer",
  "collections_officer",
  "finance_manager",
  "equipment_business_accountant",
  "equipment_business_manager",
]);
const POLICY_ROLES = new Set(["finance_manager", "equipment_business_manager"]);

function actor(req) {
  const number = Number(req.user?.id || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assertRole(req, roles, message, code = "EQUIPMENT_FINANCE_PHASE5_ROLE_REQUIRED") {
  if (isOriginalSystemAdministrator(req.user)) return;
  if (!roles.has(workspaceRoleFor(req.user))) {
    throw new FinanceDocumentsDeliveryError(403, message, code);
  }
}

function capabilitiesFor(req) {
  const role = workspaceRoleFor(req.user);
  const admin = isOriginalSystemAdministrator(req.user);
  const allowed = (set) => admin || set.has(role);
  return {
    role,
    protected_system_administrator: admin,
    private_documents_view: allowed(PRIVATE_DOCUMENT_VIEW_ROLES),
    private_documents_upload: allowed(DOCUMENT_UPLOAD_ROLES),
    independent_document_review: allowed(DOCUMENT_REVIEW_ROLES),
    document_approval: allowed(DOCUMENT_APPROVAL_ROLES),
    delivery_authorization_request: allowed(DELIVERY_REQUEST_ROLES),
    delivery_authorization_decision: allowed(DELIVERY_AUTHORIZATION_ROLES),
    delivery_confirmation: allowed(DELIVERY_CONFIRMATION_ROLES),
    policy_manage: allowed(POLICY_ROLES),
    activity_log_view: allowed(PRIVATE_DOCUMENT_VIEW_ROLES),
    independent_controls: {
      uploader_cannot_review: true,
      uploader_or_reviewer_cannot_approve: true,
      requester_cannot_authorize_delivery: true,
      authorizer_cannot_confirm_delivery: true,
    },
  };
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof FinanceDocumentsDeliveryError || error?.statusCode) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_PHASE5_ERROR",
          message: error.message,
          ...(error.readiness ? { readiness: error.readiness } : {}),
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5_MIGRATION_REQUIRED",
          message:
            "Private Finance documents and controlled delivery are awaiting the approved additive Phase 5 migration. Existing records were not changed.",
        });
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5_DUPLICATE",
          message: "That protected document, authorization, confirmation or activity was already recorded.",
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
    });
  })
);

router.get(
  "/capabilities",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    return res.json({
      status: "success",
      capabilities: capabilitiesFor(req),
      document_categories: [...DOCUMENT_CATEGORIES],
    });
  })
);

router.get(
  "/policy",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (_req, res) => {
    return res.json({ status: "success", policy: await getPolicy() });
  })
);

router.put(
  "/policy",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      POLICY_ROLES,
      "Only a Finance Manager, Equipment Business Manager or protected System Administrator can change the document and delivery policy."
    );
    const policy = await updatePolicy({ input: req.body || {}, actor: actor(req), req });
    return res.json({
      status: "success",
      message: "Document and delivery policy updated with a preserved history record.",
      policy,
    });
  })
);

router.get(
  "/cases",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(req, PRIVATE_DOCUMENT_VIEW_ROLES, "This staff account cannot view private Finance case files.");
    const result = await listCases();
    return res.json({ status: "success", count: result.cases.length, ...result });
  })
);

router.get(
  "/cases/:agreementId",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(req, PRIVATE_DOCUMENT_VIEW_ROLES, "This staff account cannot view private Finance case files.");
    return res.json({ status: "success", ...(await getCaseFile(req.params.agreementId)) });
  })
);

router.post(
  "/cases/:agreementId/documents",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(req, DOCUMENT_UPLOAD_ROLES, "Only authorised Finance case staff can upload private documents.");
    const document = await uploadDocument({
      agreementId: req.params.agreementId,
      input: req.body || {},
      actor: actor(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message: "Private document encrypted and stored. It is pending independent review.",
      document,
    });
  })
);

router.get(
  "/documents/:documentId/content",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(req, PRIVATE_DOCUMENT_VIEW_ROLES, "This staff account cannot access private Finance document content.");
    const content = await getDocumentContent({
      documentId: req.params.documentId,
      actor: actor(req),
      req,
    });
    res.setHeader("Content-Type", content.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`);
    res.setHeader("Content-Length", String(content.buffer.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Chalin03-Document-Number", content.documentNumber);
    res.setHeader("X-Chalin03-Content-SHA256", content.checksum);
    return res.send(content.buffer);
  })
);

router.post(
  "/documents/:documentId/review",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(req, DOCUMENT_REVIEW_ROLES, "Only an authorised independent Finance reviewer can decide document review.");
    const caseFile = await reviewDocument({
      documentId: req.params.documentId,
      decision: req.body?.decision,
      notes: req.body?.notes,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message: String(req.body?.decision || "").toLowerCase() === "verify"
        ? "Document independently verified and sent for approval."
        : "Document review rejected; the encrypted evidence remains preserved.",
      ...caseFile,
    });
  })
);

router.post(
  "/documents/:documentId/approval",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(req, DOCUMENT_APPROVAL_ROLES, "Only an independent Finance Manager can approve reviewed documents.");
    const caseFile = await approveDocument({
      documentId: req.params.documentId,
      decision: req.body?.decision,
      notes: req.body?.notes,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message: String(req.body?.decision || "").toLowerCase() === "approve"
        ? "Document approved for the Finance case file."
        : "Document approval rejected; the encrypted evidence remains preserved.",
      ...caseFile,
    });
  })
);

router.post(
  "/documents/:documentId/archive",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(req, DOCUMENT_APPROVAL_ROLES, "Only a Finance Manager can archive a private document.");
    const caseFile = await archiveDocument({
      documentId: req.params.documentId,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message: "Document archived. Its encrypted content, decisions and activity evidence remain preserved.",
      ...caseFile,
    });
  })
);

router.post(
  "/cases/:agreementId/delivery-authorizations",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(req, DELIVERY_REQUEST_ROLES, "Only authorised Finance staff can request delivery authorization.");
    const caseFile = await requestDeliveryAuthorization({
      agreementId: req.params.agreementId,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message: "Delivery authorization requested. A different Finance Manager must decide it.",
      ...caseFile,
    });
  })
);

router.post(
  "/delivery-authorizations/:authorizationId/decision",
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(req, DELIVERY_AUTHORIZATION_ROLES, "Only an independent Finance Manager can authorize delivery.");
    const caseFile = await decideDeliveryAuthorization({
      authorizationId: req.params.authorizationId,
      decision: req.body?.decision,
      reason: req.body?.reason,
      actor: actor(req),
      req,
    });
    return res.json({
      status: "success",
      message: String(req.body?.decision || "").toLowerCase() === "authorize"
        ? "Delivery authorized for the recorded validity window. A different staff member must confirm handover."
        : "Delivery authorization rejected; the request remains in the activity trail.",
      ...caseFile,
    });
  })
);

router.get(
  "/activity",
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(req, PRIVATE_DOCUMENT_VIEW_ROLES, "This staff account cannot view the Finance case activity log.");
    const activity = await listActivity({
      agreementId: req.query?.agreement_id || null,
      limit: req.query?.limit,
    });
    return res.json({ status: "success", count: activity.length, activity });
  })
);

module.exports = router;
module.exports.DELIVERY_AUTHORIZATION_ROLES = DELIVERY_AUTHORIZATION_ROLES;
module.exports.DELIVERY_CONFIRMATION_ROLES = DELIVERY_CONFIRMATION_ROLES;
module.exports.DELIVERY_REQUEST_ROLES = DELIVERY_REQUEST_ROLES;
module.exports.DOCUMENT_APPROVAL_ROLES = DOCUMENT_APPROVAL_ROLES;
module.exports.DOCUMENT_REVIEW_ROLES = DOCUMENT_REVIEW_ROLES;
module.exports.DOCUMENT_UPLOAD_ROLES = DOCUMENT_UPLOAD_ROLES;
module.exports.PRIVATE_DOCUMENT_VIEW_ROLES = PRIVATE_DOCUMENT_VIEW_ROLES;
module.exports.capabilitiesFor = capabilitiesFor;
