const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const { writeAuditEvent } = require("../services/auditTrailService");
const {
  loadDocumentSignature,
  normalizeSignatureDataUrl,
} = require("../services/documentSignatureService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

router.get(
  "/document-signature",
  requireAuth,
  requirePermission("workers.documents.view"),
  asyncHandler(async (req, res) => {
    const setting = await loadDocumentSignature();
    return res.json({
      status: "success",
      signature: setting
        ? {
            signatory_name: setting.signatory_name,
            signatory_title: setting.signatory_title,
            signature_data_url: setting.signature_data_url,
            updated_at: setting.updated_at,
          }
        : null,
    });
  })
);

router.put(
  "/document-signature",
  requireAuth,
  requirePermission("security.admin"),
  asyncHandler(async (req, res) => {
    const signatoryName = cleanText(req.body?.signatory_name, 150);
    const signatoryTitle = cleanText(req.body?.signatory_title, 150);
    const signatureDataUrl = normalizeSignatureDataUrl(req.body?.signature_data_url);

    if (!signatoryName || !signatoryTitle) {
      return res.status(400).json({
        status: "error",
        message: "The authorised signatory name and title are required.",
      });
    }

    await pool.query(
      `INSERT INTO document_signature_settings (
         id, signatory_name, signatory_title, signature_data_url, updated_by
       ) VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         signatory_name = VALUES(signatory_name),
         signatory_title = VALUES(signatory_title),
         signature_data_url = VALUES(signature_data_url),
         updated_by = VALUES(updated_by)`,
      [signatoryName, signatoryTitle, signatureDataUrl, req.user.id]
    );

    await writeAuditEvent({
      req,
      action: "DOCUMENT_SIGNATURE_UPDATED",
      details: `The authorised document signature for ${signatoryName} was saved or replaced.`,
      entityType: "document_signature_setting",
      entityId: 1,
      severity: "warning",
      metadata: {
        signatory_name: signatoryName,
        signatory_title: signatoryTitle,
      },
    });

    return res.json({
      status: "success",
      message:
        "Authorised signature saved. New approvals will snapshot this signature; previously issued documents remain unchanged.",
      signature: await loadDocumentSignature(),
    });
  })
);

router.delete(
  "/document-signature",
  requireAuth,
  requirePermission("security.admin"),
  asyncHandler(async (req, res) => {
    const current = await loadDocumentSignature();
    if (!current) {
      return res.status(404).json({
        status: "error",
        message: "No authorised document signature is saved.",
      });
    }

    await pool.query("DELETE FROM document_signature_settings WHERE id = 1");

    await writeAuditEvent({
      req,
      action: "DOCUMENT_SIGNATURE_REMOVED",
      details: `The authorised document signature for ${current.signatory_name} was removed.`,
      entityType: "document_signature_setting",
      entityId: 1,
      severity: "warning",
      metadata: {
        signatory_name: current.signatory_name,
        signatory_title: current.signatory_title,
      },
    });

    return res.json({
      status: "success",
      message:
        "Authorised signature removed. Existing issued documents keep their historical signature snapshot.",
    });
  })
);

module.exports = router;
