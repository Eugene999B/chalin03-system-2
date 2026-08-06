const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  DOCUMENT_DEFINITIONS,
  getCompletionDocument,
  issueCompletionDocument,
  publicDefinitions,
} = require("../services/equipmentFinanceDocumentCompletionService");
// The photo-aware service wraps equipmentFinanceCompletionRendererService; the
// established branded document layouts remain the authoritative base renderer.
const {
  renderCompletionPdf,
  renderCompletionWord,
} = require("../services/equipmentFinanceCustomerPhotoRendererService");
const {
  ProfessionalFinanceError,
} = require("../services/equipmentFinanceProfessionalService");

const router = express.Router();
const PREFIX = "/professional/completion-documents";

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
        supported_downloads: ["pdf", "word", "print", "thermal"],
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
      return res.status(200).send(buffer);
    } catch (error) {
      return sendError(req, res, error, "Could not download the professional Finance document.");
    }
  }
);

module.exports = router;
