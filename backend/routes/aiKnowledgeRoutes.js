"use strict";

const express = require("express");

const { requireAiPermission } = require("../middleware/aiPermissionMiddleware");
const { hasAiPermission } = require("../security/aiPermissionCatalog");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  createKnowledgeSourceDraft,
  createKnowledgeVersion,
  decideKnowledgeApproval,
  getKnowledgeSourceDetails,
  listKnowledgeSources,
  publishKnowledgeVersion,
  submitKnowledgeVersion,
  updateKnowledgeDraft,
} = require("../services/aiKnowledgeService");
const {
  getKnowledgeHealthSnapshot,
} = require("../services/aiKnowledgeHealthService");
const {
  getKnowledgeChunk,
  ingestKnowledgeDocument,
  listKnowledgeDocuments,
} = require("../services/aiDocumentIntelligenceService");
const {
  ingestDocxKnowledgeDocument,
} = require("../services/aiBinaryDocumentIngestionService");
const { DOCX_MIME_TYPE } = require("../services/aiDocxParserService");
const {
  listDocumentChunks,
} = require("../services/aiDocumentReviewService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedAiKnowledgeHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function success(res, req, data, statusCode = 200) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  return res.status(statusCode).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

function hasCrossWorkspaceKnowledgeAccess(user) {
  return (
    isOriginalSystemAdministrator(user) ||
    hasAiPermission(user, "ai.executive.use")
  );
}

function activeKnowledgeWorkspace(req) {
  if (hasCrossWorkspaceKnowledgeAccess(req.user)) {
    return String(req.query.workspace_code || "").trim() || null;
  }
  return String(req.user?.workspace_code || "").trim() || null;
}

function scopedKnowledgeInput(req) {
  const input = { ...(req.body || {}) };
  if (!hasCrossWorkspaceKnowledgeAccess(req.user)) {
    input.owner_workspace_code = req.user?.workspace_code || null;
  }
  return input;
}

function requestMimeType(req) {
  return String(req.body?.mime_type || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

async function scopedKnowledgeDetails(req, sourceId) {
  const details = await getKnowledgeSourceDetails(sourceId);
  const source = details.source || {};
  if (
    hasCrossWorkspaceKnowledgeAccess(req.user) ||
    source.visibility === "public" ||
    (source.owner_workspace_code &&
      source.owner_workspace_code === req.user?.workspace_code)
  ) {
    return details;
  }

  const error = new Error("Knowledge source not found.");
  error.name = "AiKnowledgeError";
  error.code = "AI_KNOWLEDGE_SOURCE_NOT_FOUND";
  error.statusCode = 404;
  throw error;
}

async function resolveScopedKnowledgeDetails(req, sourceReference) {
  const reference = String(sourceReference || "").trim();
  if (/^\d+$/.test(reference)) {
    return scopedKnowledgeDetails(req, reference);
  }

  const candidates = await listKnowledgeSources({
    search: reference,
    workspaceCode: activeKnowledgeWorkspace(req),
    limit: 100,
    offset: 0,
  });
  const match = candidates.find((item) => item.source_key === reference);
  if (!match) {
    const error = new Error("Knowledge source not found.");
    error.name = "AiKnowledgeError";
    error.code = "AI_KNOWLEDGE_SOURCE_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  return scopedKnowledgeDetails(req, match.id);
}

router.get(
  "/",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listKnowledgeSources({
        status: req.query.status,
        visibility: req.query.visibility,
        workspaceCode: activeKnowledgeWorkspace(req),
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    )
  )
);

router.post(
  "/",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createKnowledgeSourceDraft({
        input: scopedKnowledgeInput(req),
        user: req.user,
        req,
      }),
      201
    )
  )
);

// Keep fixed knowledge-health diagnostics above the dynamic /:sourceId route.
// Non-enterprise users are always scoped to their authenticated workspace;
// the original System Administrator / executive authority can request an
// enterprise snapshot or explicitly select a workspace.
router.get(
  "/health",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await getKnowledgeHealthSnapshot({
        workspaceCode: activeKnowledgeWorkspace(req),
        windowDays: req.query.window_days,
      })
    )
  )
);

router.get(
  "/:sourceId",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await scopedKnowledgeDetails(req, req.params.sourceId)
    )
  )
);

router.post(
  "/:sourceId/versions",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) => {
    await scopedKnowledgeDetails(req, req.params.sourceId);
    return success(
      res,
      req,
      await createKnowledgeVersion({
        sourceId: req.params.sourceId,
        input: scopedKnowledgeInput(req),
        user: req.user,
        req,
      }),
      201
    );
  })
);

router.put(
  "/:sourceId/versions/:versionId",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) => {
    await scopedKnowledgeDetails(req, req.params.sourceId);
    await updateKnowledgeDraft({
      sourceId: req.params.sourceId,
      versionId: req.params.versionId,
      input: scopedKnowledgeInput(req),
      user: req.user,
      req,
    });
    return success(res, req, { updated: true });
  })
);

router.post(
  "/:sourceId/versions/:versionId/documents",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) => {
    await scopedKnowledgeDetails(req, req.params.sourceId);
    const ingestion =
      requestMimeType(req) === DOCX_MIME_TYPE
        ? ingestDocxKnowledgeDocument
        : ingestKnowledgeDocument;
    return success(
      res,
      req,
      await ingestion({
        sourceId: req.params.sourceId,
        versionId: req.params.versionId,
        input: req.body || {},
        user: req.user,
        req,
      }),
      201
    );
  })
);

router.get(
  "/:sourceId/documents",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) => {
    const details = await scopedKnowledgeDetails(req, req.params.sourceId);
    return success(
      res,
      req,
      await listKnowledgeDocuments({
        sourceId: details.source.id,
        versionId: req.query.version_id || null,
      })
    );
  })
);

router.get(
  "/:sourceReference/documents/:documentId/chunks",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) => {
    const details = await resolveScopedKnowledgeDetails(
      req,
      req.params.sourceReference
    );
    return success(
      res,
      req,
      await listDocumentChunks({
        sourceId: details.source.id,
        documentId: req.params.documentId,
      })
    );
  })
);

router.get(
  "/:sourceReference/documents/:documentId/chunks/:chunkId",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) => {
    const details = await resolveScopedKnowledgeDetails(
      req,
      req.params.sourceReference
    );
    return success(
      res,
      req,
      await getKnowledgeChunk({
        sourceId: details.source.id,
        documentId: req.params.documentId,
        chunkId: req.params.chunkId,
      })
    );
  })
);

router.post(
  "/:sourceId/versions/:versionId/submit",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) => {
    await scopedKnowledgeDetails(req, req.params.sourceId);
    return success(
      res,
      req,
      await submitKnowledgeVersion({
        sourceId: req.params.sourceId,
        versionId: req.params.versionId,
        assignedTo: req.body.assigned_to,
        note: req.body.note,
        user: req.user,
        req,
      })
    );
  })
);

router.post(
  "/approvals/:approvalId/decision",
  requireAiPermission("ai.knowledge.review"),
  asyncHandler(async (req, res) => {
    await decideKnowledgeApproval({
      approvalId: req.params.approvalId,
      decision: req.body.decision,
      note: req.body.note,
      user: req.user,
      req,
    });
    return success(res, req, { decided: true });
  })
);

router.post(
  "/:sourceId/versions/:versionId/publish",
  requireAiPermission("ai.knowledge.publish"),
  asyncHandler(async (req, res) => {
    await scopedKnowledgeDetails(req, req.params.sourceId);
    await publishKnowledgeVersion({
      sourceId: req.params.sourceId,
      versionId: req.params.versionId,
      user: req.user,
      req,
    });
    return success(res, req, { published: true });
  })
);

module.exports = router;
