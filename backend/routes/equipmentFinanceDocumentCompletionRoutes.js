const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { workspaceRoleFor } = require("../security/equipmentDivisionAccess");
const {
  DOCUMENT_DEFINITIONS,
  getCompletionDocument,
  issueCompletionDocument,
  publicDefinitions,
} = require("../services/equipmentFinanceDocumentCompletionService");
// Keep the targeted PDFKit footer guard loaded as a final defensive layer.
// The logo-led V3 renderer also creates A4 pages manually, reserves protected
// body space and writes every footer through an absolute no-break path.
require("../services/equipmentFinancePdfBlankPageGuardService");
const {
  renderCompletionPdf,
  renderCompletionWord,
} = require("../services/equipmentFinanceDocumentRendererV2Service");
const {
  ProfessionalFinanceError,
} = require("../services/equipmentFinanceProfessionalService");

const router = express.Router();
const PREFIX = "/professional/completion-documents";

const EXECUTIVE_DOCUMENTS = new Set(["boss_approval_pack"]);
const LEGAL_CONTROL_DOCUMENTS = new Set([
  "installment_agreement",
  "customer_agreement_copy",
  "company_agreement_copy",
  "guarantor_undertaking",
  "amendment_agreement",
  "settlement_confirmation",
  "ownership_transfer",
]);
const EXECUTIVE_ISSUE_ROLES = new Set([
  "finance_manager",
  "equipment_business_manager",
]);
const LEGAL_ISSUE_ROLES = new Set([
  ...EXECUTIVE_ISSUE_ROLES,
  "finance_accountant",
  "equipment_business_accountant",
]);
const OPERATING_ISSUE_ROLES = new Set([
  ...LEGAL_ISSUE_ROLES,
  "collections_officer",
  "credit_officer",
]);

function actor(req) {
  const value = Number(req.user?.id || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function safeFileName(value) {
  return String(value || "finance-document")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "finance-document";
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function roleCandidates(req) {
  const values = [
    workspaceRoleFor(req.user),
    req.user?.workspace_role,
    req.user?.access_role,
    req.user?.role,
    req.user?.base_role,
    ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
  ];
  return new Set(
    values
      .map((value) =>
        value && typeof value === "object"
          ? value.code || value.role_code || value.name || value.role
          : value
      )
      .map(normalizeRole)
      .filter(Boolean)
  );
}

function allowedIssueRoles(documentType) {
  if (EXECUTIVE_DOCUMENTS.has(documentType)) return EXECUTIVE_ISSUE_ROLES;
  if (LEGAL_CONTROL_DOCUMENTS.has(documentType)) return LEGAL_ISSUE_ROLES;
  return OPERATING_ISSUE_ROLES;
}

function assertDocumentIssueRole(req, documentType) {
  if (isOriginalSystemAdministrator(req.user)) return;
  const candidates = roleCandidates(req);
  const allowed = allowedIssueRoles(documentType);
  if ([...candidates].some((role) => allowed.has(role))) return;

  const definition = DOCUMENT_DEFINITIONS[documentType];
  throw new ProfessionalFinanceError(
    403,
    `${definition?.short_title || "This Finance document"} can only be issued by an authorised Installment Finance officer for this document class.`,
    "EQUIPMENT_FINANCE_DOCUMENT_ISSUE_ROLE_REQUIRED"
  );
}

function sendError(req, res, error, fallback) {
  const statusCode = Number(error?.statusCode || 500);
  if (!(error instanceof ProfessionalFinanceError) && statusCode >= 500) {
    console.error(fallback, {
      request_id: req.requestId || null,
      code: error?.code || null,
      message: error?.message || null,
    });
  }
  return res.status(statusCode).json({
    status: "error",
    code: error?.code || "EQUIPMENT_FINANCE_COMPLETION_DOCUMENT_ERROR",
    message: error?.message || fallback,
    request_id: req.requestId || null,
  });
}

router.get(
  `${PREFIX}/options`,
  requirePermission("fleet.assets.view"),
  (_req, res) => {
    return res.json({
      status: "success",
      documents: publicDefinitions(),
      policy: {
        immutable_snapshot: true,
        reconciliation_required: true,
        legal_approval_required_for_legal_documents: true,
        exact_payment_required_for_receipts: true,
        thermal_receipt_available: true,
        customer_passport_photo_page: true,
        customer_photo_encrypted_at_rest: true,
        professional_distinct_templates: true,
        official_public_logo_asset: "frontend/public/chalin03-logo.png",
        official_logo_cached_in_backend: "backend/assets/chalin03-logo.png",
        logo_led_visual_architecture: true,
        integrated_logo_and_document_watermark: true,
        qr_verification_identity: true,
        qr_public_online_verification: true,
        public_verification_privacy_masking: true,
        tamper_evident_footer: true,
        manual_page_flow_no_blank_pages: true,
        design_version: "professional-logo-led-v3",
        supported_downloads: ["pdf", "word", "print", "thermal"],
        issue_control: {
          executive_documents: [...EXECUTIVE_DOCUMENTS],
          legal_control_documents: [...LEGAL_CONTROL_DOCUMENTS],
          operating_documents_use_finance_roles: true,
        },
      },
    });
  }
);

router.post(
  `${PREFIX}/issue`,
  requirePermission("fleet.assets.manage"),
  async (req, res) => {
    try {
      const documentType = String(req.body?.document_type || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
      const definition = DOCUMENT_DEFINITIONS[documentType];
      if (!definition) {
        throw new ProfessionalFinanceError(
          400,
          "Choose a supported professional Finance document."
        );
      }
      assertDocumentIssueRole(req, documentType);
      const requestedFormat = String(req.body?.format || "pdf")
        .trim()
        .toLowerCase();
      if (!definition.formats.includes(requestedFormat)) {
        throw new ProfessionalFinanceError(
          400,
          `${definition.short_title} is not available in ${requestedFormat || "that"} format.`
        );
      }
      const document = await issueCompletionDocument({
        agreementId: req.body?.agreement_id,
        documentType,
        format: requestedFormat,
        paymentId: req.body?.payment_id,
        amendmentId: req.body?.amendment_id,
        userId: actor(req),
      });
      return res.status(201).json({
        status: "success",
        message: `${definition.short_title} issued from an immutable, reconciled Finance snapshot.`,
        document: {
          id: document.id,
          document_number: document.document_number,
          document_type: document.document_type,
          document_format: document.document_format,
          snapshot_checksum: document.snapshot_checksum,
          download_path: `${PREFIX}/${document.id}/download`,
        },
      });
    } catch (error) {
      return sendError(req, res, error, "Could not issue the professional Finance document.");
    }
  }
);

router.get(
  `${PREFIX}/:documentId/download`,
  requirePermission("fleet.assets.view"),
  async (req, res) => {
    try {
      const document = await getCompletionDocument(req.params.documentId);
      const definition = DOCUMENT_DEFINITIONS[document.document_type];
      const requested = String(req.query.format || document.document_format || "pdf")
        .trim()
        .toLowerCase();
      if (!definition.formats.includes(requested)) {
        throw new ProfessionalFinanceError(
          400,
          `${definition.short_title} is not available in ${requested || "that"} format.`
        );
      }
      const fileBase = safeFileName(
        `${document.document_number}-${definition.short_title}`
      );
      if (requested === "word") {
        const buffer = await renderCompletionWord(document);
        res.setHeader("Content-Type", "application/msword; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${fileBase}.doc"`
        );
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Chalin03-Document-Design", "professional-logo-led-v3");
        return res.status(200).send(buffer);
      }

      const thermal = requested === "thermal";
      const buffer = await renderCompletionPdf(document, {
        layout: thermal ? "thermal" : "a4",
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${requested === "print" ? "inline" : "attachment"}; filename="${fileBase}${
          thermal ? "-thermal" : ""
        }.pdf"`
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Chalin03-Document-Type", document.document_type);
      res.setHeader("X-Chalin03-Snapshot-Checksum", document.snapshot_checksum);
      res.setHeader("X-Chalin03-Document-Design", "professional-logo-led-v3");
      return res.status(200).send(buffer);
    } catch (error) {
      return sendError(req, res, error, "Could not download the professional Finance document.");
    }
  }
);

module.exports = router;
module.exports.EXECUTIVE_DOCUMENTS = EXECUTIVE_DOCUMENTS;
module.exports.LEGAL_CONTROL_DOCUMENTS = LEGAL_CONTROL_DOCUMENTS;
module.exports.allowedIssueRoles = allowedIssueRoles;
