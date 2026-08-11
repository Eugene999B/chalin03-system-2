"use strict";

const express = require("express");

const { requireAiPermission } = require("../middleware/aiPermissionMiddleware");
const {
  createAiDocumentArtifact,
  AiDocumentExportError,
} = require("../services/aiDocumentExportService");
const { writeAiAuditEvent } = require("../services/aiAuditService");

const router = express.Router();

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function safeHeaderFilename(value) {
  return String(value || "chalin-intelligence-report")
    .replace(/[\r\n"\\]/g, "-")
    .slice(0, 180);
}

router.post(
  "/generate",
  requireAiPermission("ai.documents.generate"),
  async (req, res, next) => {
    try {
      const artifact = await createAiDocumentArtifact({
        conversationKey: req.body?.conversation_key,
        messageKey: req.body?.message_key,
        user: req.user,
        format: req.body?.format,
        title: req.body?.title,
        requestId: req.requestId,
      });

      await writeAiAuditEvent({
        req,
        userId: req.user.id,
        conversationId: artifact.conversation_id,
        eventType: "AI_DOCUMENT_GENERATED",
        outcome: "success",
        severity: "info",
        persona: artifact.persona,
        scope: artifact.scope,
        metadata: {
          format: artifact.format,
          filename: artifact.filename,
          byte_length: artifact.byte_length,
          sha256: artifact.sha256,
          classification: artifact.classification,
          evidence_count: artifact.evidence_count,
          source_message_key: artifact.message_key,
        },
      }).catch(() => null);

      noStore(res);
      res.set("Content-Type", artifact.content_type);
      res.set(
        "Content-Disposition",
        `attachment; filename="${safeHeaderFilename(artifact.filename)}"`
      );
      res.set("X-CHALIN-Document-Format", artifact.format);
      res.set("X-CHALIN-Document-SHA256", artifact.sha256);
      res.set("X-CHALIN-Document-Classification", artifact.classification);
      res.set("X-CHALIN-Document-Evidence-Count", String(artifact.evidence_count));
      return res.status(200).send(artifact.buffer);
    } catch (error) {
      if (error instanceof AiDocumentExportError || String(error?.code || "").startsWith("AI_")) {
        return next(error);
      }
      return next(error);
    }
  }
);

module.exports = router;
