"use strict";

const express = require("express");

const { requireAiPermission } = require("../middleware/aiPermissionMiddleware");
const { requireFeature, isFeatureEnabled } = require("../services/featureFlagService");
const { aiActionRegistry } = require("../services/aiActionRegistry");
const { registerBuiltInAiActions } = require("../ai-actions/registerAiActions");
const {
  cancelActionProposal,
  createActionProposal,
  decideActionProposal,
  executeActionProposal,
  getActionProposal,
  listActionProposals,
} = require("../services/aiActionProposalService");

registerBuiltInAiActions();

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedAiActionHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function success(res, req, data, statusCode = 200) {
  noStore(res);
  return res.status(statusCode).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

router.use(requireFeature("aiActions"));

router.get(
  "/definitions",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      aiActionRegistry.list({
        workspace: req.user?.workspace_code,
      })
    )
  )
);

router.get(
  "/proposals",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listActionProposals({
        user: req.user,
        workspaceCode: req.query.workspace_code,
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    )
  )
);

router.post(
  "/proposals",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createActionProposal({
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.get(
  "/proposals/:proposalKey",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await getActionProposal({
        proposalKey: req.params.proposalKey,
        user: req.user,
      })
    )
  )
);

router.post(
  "/proposals/:proposalKey/decision",
  requireAiPermission("ai.actions.review"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await decideActionProposal({
        proposalKey: req.params.proposalKey,
        decision: req.body.decision,
        note: req.body.note,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/proposals/:proposalKey/execute",
  requireAiPermission("ai.actions.execute"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await executeActionProposal({
        proposalKey: req.params.proposalKey,
        confirmation: req.body.confirmation,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/proposals/:proposalKey/cancel",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await cancelActionProposal({
        proposalKey: req.params.proposalKey,
        note: req.body.note,
        user: req.user,
        req,
      })
    )
  )
);

router.use((error, req, res, next) => {
  const code = String(error?.code || "");
  if (
    !code.startsWith("AI_ACTION_") &&
    !String(error?.name || "").startsWith("AiAction")
  ) {
    return next(error);
  }
  noStore(res);
  return res.status(Number(error.statusCode) || 400).json({
    status: "error",
    code: code || "AI_ACTION_REQUEST_FAILED",
    message:
      error.message ||
      "The AI action request failed safely.",
    details: error.details || [],
    execution_available: isFeatureEnabled("aiActions"),
    request_id: req.requestId || null,
  });
});

module.exports = router;
