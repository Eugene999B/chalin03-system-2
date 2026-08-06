"use strict";

const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  archiveNavigationItemSafely,
} = require("../services/contentStudioNavigationArchiveService");
const {
  createNavigationDraft,
  createNavigationVersion,
  decideNavigationApproval,
  listNavigationItems,
  publishNavigationVersion,
  submitNavigationVersion,
  updateNavigationDraft,
} = require("../services/contentStudioNavigationService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedNavigationHandler(req, res, next) {
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
  requirePermission("public_navigation.view"),
  asyncHandler(async (req, res) =>
    success(res, req, await listNavigationItems())
  )
);

router.post(
  "/",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createNavigationDraft({ input: req.body, user: req.user, req }),
      201
    )
  )
);

router.post(
  "/:itemId/versions",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createNavigationVersion({
        itemId: req.params.itemId,
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.put(
  "/:itemId/versions/:versionId",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await updateNavigationDraft({
        itemId: req.params.itemId,
        versionId: req.params.versionId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:itemId/versions/:versionId/submit",
  requirePermission("public_content.submit"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await submitNavigationVersion({
        itemId: req.params.itemId,
        versionId: req.params.versionId,
        assignedTo: req.body?.assigned_to,
        note: req.body?.note,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/approvals/:approvalId/decision",
  requirePermission("public_content.approve"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await decideNavigationApproval({
        approvalId: req.params.approvalId,
        decision: req.body?.decision,
        note: req.body?.note,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:itemId/versions/:versionId/publish",
  requirePermission("public_content.publish"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await publishNavigationVersion({
        itemId: req.params.itemId,
        versionId: req.params.versionId,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:itemId/archive",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveNavigationItemSafely({
        itemId: req.params.itemId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

module.exports = router;
