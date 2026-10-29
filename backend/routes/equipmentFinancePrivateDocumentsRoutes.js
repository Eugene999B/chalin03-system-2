const express = require("express");
const rateLimit = require("express-rate-limit");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  DOCUMENT_CATEGORIES,
  FinancePrivateDocumentError,
  getApplicationCaseFile,
  getCaseFile,
  getDocumentContent,
  getPolicy,
  listActivity,
  listApplicationCases,
  listCases,
  schemaStatus,
  uploadDocument,
} = require("../services/equipmentFinancePrivateDocumentsService");

const router = express.Router();

const privateDocumentReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_PRIVATE_DOCUMENT_READ_RATE_LIMITED",
    message:
      "Too many private document requests were made. Wait briefly before trying again.",
  },
});
const privateDocumentUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_PRIVATE_DOCUMENT_UPLOAD_RATE_LIMITED",
    message:
      "Too many private document uploads were attempted. Wait briefly before trying again.",
  },
});
const privateDocumentDownloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "FINANCE_PRIVATE_DOCUMENT_DOWNLOAD_RATE_LIMITED",
    message:
      "Too many private document downloads were attempted. Wait briefly before trying again.",
  },
});

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
      "EQUIPMENT_FINANCE_PHASE5A_ROLE_REQUIRED"
    );
  }
}

function capabilitiesFor(req) {
  const role = workspaceRoleFor(req.user);
  const administrator = isOriginalSystemAdministrator(req.user);
  const allowed = (roles) => administrator || roles.has(role);
  return {
    role,
    protected_system_administrator: administrator,
    private_documents_view: allowed(PRIVATE_DOCUMENT_VIEW_ROLES),
    private_documents_upload: allowed(DOCUMENT_UPLOAD_ROLES),
    private_documents_download: allowed(PRIVATE_DOCUMENT_VIEW_ROLES),
    activity_log_view: allowed(PRIVATE_DOCUMENT_VIEW_ROLES),
    encryption: "aes-256-gcm",
    public_document_urls: false,
  };
}

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof FinancePrivateDocumentError || error?.statusCode) {
        return res.status(Number(error.statusCode || 400)).json({
          status: "error",
          code: error.code || "EQUIPMENT_FINANCE_PHASE5A_ERROR",
          message: error.message,
          ...(error.readiness ? { readiness: error.readiness } : {}),
        });
      }
      if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
        return res.status(503).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5A_MIGRATION_REQUIRED",
          message:
            "Private Finance documents are awaiting the approved additive Phase 5A migration. Existing records were not changed.",
        });
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          status: "error",
          code: "EQUIPMENT_FINANCE_PHASE5A_DUPLICATE",
          message: "That private document or activity record was already stored.",
        });
      }
      return next(error);
    });
}

router.get(
  "/readiness",
  privateDocumentReadLimiter,
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
  privateDocumentReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot view the private Finance document policy."
    );
    return res.json({ status: "success", policy: await getPolicy() });
  })
);

router.get(
  "/applications",
  privateDocumentReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot view private Finance application files."
    );
    const cases = await listApplicationCases();
    return res.json({ status: "success", count: cases.length, cases });
  })
);

router.get(
  "/applications/:applicationId",
  privateDocumentReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot view private Finance application files."
    );
    return res.json({
      status: "success",
      ...(await getApplicationCaseFile(req.params.applicationId)),
    });
  })
);

router.post(
  "/applications/:applicationId/documents",
  privateDocumentUploadLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      DOCUMENT_UPLOAD_ROLES,
      "Only authorised Finance case staff can upload private documents."
    );
    const document = await uploadDocument({
      applicationId: req.params.applicationId,
      input: req.body || {},
      actor: actor(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message:
        "Application document encrypted and stored with an audit record.",
      document,
    });
  })
);

router.get(
  "/cases",
  privateDocumentReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot view private Finance case files."
    );
    const cases = await listCases();
    return res.json({ status: "success", count: cases.length, cases });
  })
);

router.get(
  "/cases/:agreementId",
  privateDocumentReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot view private Finance case files."
    );
    return res.json({
      status: "success",
      ...(await getCaseFile(req.params.agreementId)),
    });
  })
);

router.post(
  "/cases/:agreementId/documents",
  privateDocumentUploadLimiter,
  requirePermission("fleet.assets.manage"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      DOCUMENT_UPLOAD_ROLES,
      "Only authorised Finance case staff can upload private documents."
    );
    const document = await uploadDocument({
      agreementId: req.params.agreementId,
      input: req.body || {},
      actor: actor(req),
      req,
    });
    return res.status(201).json({
      status: "success",
      message: "Private document encrypted and stored with an audit record.",
      document,
    });
  })
);

router.get(
  "/documents/:documentId/content",
  privateDocumentDownloadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot access private Finance document content."
    );
    const content = await getDocumentContent({
      documentId: req.params.documentId,
      actor: actor(req),
      req,
    });
    res.setHeader("Content-Type", content.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(content.fileName)}`
    );
    res.setHeader("Content-Length", String(content.buffer.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Chalin03-Document-Number", content.documentNumber);
    res.setHeader("X-Chalin03-Content-SHA256", content.checksum);
    return res.send(content.buffer);
  })
);

router.get(
  "/activity",
  privateDocumentReadLimiter,
  requirePermission("fleet.assets.view"),
  asyncHandler(async (req, res) => {
    assertRole(
      req,
      PRIVATE_DOCUMENT_VIEW_ROLES,
      "This staff account cannot view the private Finance document activity log."
    );
    const activity = await listActivity({
      agreementId: req.query?.agreement_id || null,
      applicationId: req.query?.application_id || null,
      limit: req.query?.limit,
    });
    return res.json({ status: "success", count: activity.length, activity });
  })
);

module.exports = router;
module.exports.DOCUMENT_UPLOAD_ROLES = DOCUMENT_UPLOAD_ROLES;
module.exports.PRIVATE_DOCUMENT_VIEW_ROLES = PRIVATE_DOCUMENT_VIEW_ROLES;
module.exports.capabilitiesFor = capabilitiesFor;
module.exports.privateDocumentDownloadLimiter = privateDocumentDownloadLimiter;
module.exports.privateDocumentReadLimiter = privateDocumentReadLimiter;
module.exports.privateDocumentUploadLimiter = privateDocumentUploadLimiter;

