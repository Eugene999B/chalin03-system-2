"use strict";

const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const { requireFeature } = require("../services/featureFlagService");
const {
  answerContentStudioAi,
  ContentStudioAiError,
  getContentStudioAiStatus,
} = require("../services/contentStudioAiService");

const router = express.Router();

router.use(requireFeature("aiEnabled"), requireFeature("chalinCopilot"));

function asyncHandler(handler) {
  return function wrappedContentStudioAiHandler(req, res, next) {
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

router.get(
  "/status",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) =>
    success(res, req, await getContentStudioAiStatus({ user: req.user }))
  )
);

router.post(
  "/ask",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await answerContentStudioAi({
        user: req.user,
        question: req.body?.question,
      })
    )
  )
);

router.use((error, req, res, next) => {
  if (
    !(error instanceof ContentStudioAiError) &&
    !String(error?.code || "").startsWith("AI_") &&
    !String(error?.name || "").startsWith("Ai")
  ) {
    return next(error);
  }
  noStore(res);
  return res.status(Number(error.statusCode) || 400).json({
    status: "error",
    code: error.code || "CONTENT_STUDIO_AI_REQUEST_FAILED",
    message: error.message || "CHALIN Content Studio Intelligence could not complete the request safely.",
    details: error.details || [],
    request_id: req.requestId || null,
  });
});

module.exports = router;
