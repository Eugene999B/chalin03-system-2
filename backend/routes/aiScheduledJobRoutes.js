"use strict";

const express = require("express");

const { requireAiPermission } = require("../middleware/aiPermissionMiddleware");
const { requireFeature } = require("../services/featureFlagService");
const { aiScheduledJobRegistry } = require("../services/aiScheduledJobRegistry");
const {
  archiveScheduledDefinition,
  createScheduledDefinition,
  decideScheduledDefinition,
  getScheduledDefinition,
  listScheduledDefinitions,
} = require("../services/aiScheduledJobGovernanceService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedScheduledHandler(req, res, next) {
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

router.use(requireFeature("aiScheduledJobs"));

router.get(
  "/definitions",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      aiScheduledJobRegistry.list({
        workspace: req.user?.workspace_code,
      })
    )
  )
);

router.get(
  "/schedules",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listScheduledDefinitions({
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
  "/schedules",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createScheduledDefinition({
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.get(
  "/schedules/:scheduleKey",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await getScheduledDefinition({
        scheduleKey: req.params.scheduleKey,
        user: req.user,
      })
    )
  )
);

router.post(
  "/schedules/:scheduleKey/decision",
  requireAiPermission("ai.actions.review"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await decideScheduledDefinition({
        scheduleKey: req.params.scheduleKey,
        decision: req.body.decision,
        note: req.body.note,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/schedules/:scheduleKey/archive",
  requireAiPermission("ai.actions.propose"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveScheduledDefinition({
        scheduleKey: req.params.scheduleKey,
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
    !code.startsWith("AI_SCHEDULED_") &&
    !String(error?.name || "").startsWith("AiScheduled")
  ) {
    return next(error);
  }
  noStore(res);
  return res.status(Number(error.statusCode) || 400).json({
    status: "error",
    code: code || "AI_SCHEDULED_REQUEST_FAILED",
    message:
      error.message ||
      "The scheduled intelligence request failed safely.",
    runner_available: false,
    delivery_available: false,
    request_id: req.requestId || null,
  });
});

module.exports = router;
