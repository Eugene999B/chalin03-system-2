"use strict";

const express = require("express");

const { requireAiPermission } = require("../middleware/aiPermissionMiddleware");
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
        workspaceCode: req.query.workspace_code,
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
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.get(
  "/:sourceId",
  requireAiPermission("ai.knowledge.view"),
  asyncHandler(async (req, res) =>
    success(res, req, await getKnowledgeSourceDetails(req.params.sourceId))
  )
);

router.post(
  "/:sourceId/versions",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createKnowledgeVersion({
        sourceId: req.params.sourceId,
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.put(
  "/:sourceId/versions/:versionId",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) => {
    await updateKnowledgeDraft({
      sourceId: req.params.sourceId,
      versionId: req.params.versionId,
      input: req.body,
      user: req.user,
      req,
    });
    return success(res, req, { updated: true });
  })
);

router.post(
  "/:sourceId/versions/:versionId/submit",
  requireAiPermission("ai.knowledge.manage"),
  asyncHandler(async (req, res) =>
    success(
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
    )
  )
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
