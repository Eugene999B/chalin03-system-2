"use strict";

const express = require("express");

const {
  requireAnyPermission,
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  ContentStudioError,
  archivePage,
  createPageDraft,
  createPageVersion,
  decidePageApproval,
  getContentStudioDashboard,
  getPageDetails,
  listPages,
  listPendingApprovals,
  publishPageVersion,
  restorePageVersion,
  submitPageVersion,
  updateDraftVersion,
} = require("../services/contentStudioPageService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedContentStudioHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
}

function success(res, req, data, options = {}) {
  noStore(res);
  return res.status(options.statusCode || 200).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

function sendContentStudioError(error, req, res, next) {
  if (!(error instanceof ContentStudioError)) {
    return next(error);
  }

  noStore(res);
  return res.status(error.statusCode || 400).json({
    status: "error",
    code: error.code,
    message: error.message,
    details: error.details || [],
    request_id: req.requestId || null,
  });
}

router.get(
  "/dashboard",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) => {
    return success(res, req, await getContentStudioDashboard());
  })
);

router.get(
  "/pages",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await listPages({
        status: req.query.status,
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    );
  })
);

router.post(
  "/pages",
  requirePermission("public_content.create"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await createPageDraft({
        input: req.body,
        user: req.user,
        req,
      }),
      { statusCode: 201 }
    );
  })
);

router.get(
  "/pages/:pageId",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) => {
    return success(res, req, await getPageDetails(req.params.pageId));
  })
);

router.post(
  "/pages/:pageId/versions",
  requireAnyPermission("public_content.create", "public_content.edit"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await createPageVersion({
        pageId: req.params.pageId,
        input: req.body,
        user: req.user,
        req,
      }),
      { statusCode: 201 }
    );
  })
);

router.put(
  "/pages/:pageId/versions/:versionId",
  requirePermission("public_content.edit"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await updateDraftVersion({
        pageId: req.params.pageId,
        versionId: req.params.versionId,
        input: req.body,
        user: req.user,
        req,
      })
    );
  })
);

router.post(
  "/pages/:pageId/versions/:versionId/submit",
  requirePermission("public_content.submit"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await submitPageVersion({
        pageId: req.params.pageId,
        versionId: req.params.versionId,
        assignedTo: req.body?.assigned_to,
        note: req.body?.note,
        user: req.user,
        req,
      })
    );
  })
);

router.get(
  "/approvals",
  requirePermission("public_content.review"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await listPendingApprovals({
        assignedTo:
          String(req.query.mine || "").toLowerCase() === "true"
            ? req.user?.id
            : req.query.assigned_to,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    );
  })
);

router.post(
  "/approvals/:approvalId/decision",
  requirePermission("public_content.approve"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await decidePageApproval({
        approvalId: req.params.approvalId,
        decision: req.body?.decision,
        note: req.body?.note,
        user: req.user,
        req,
      })
    );
  })
);

router.post(
  "/pages/:pageId/versions/:versionId/publish",
  requirePermission("public_content.publish"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await publishPageVersion({
        pageId: req.params.pageId,
        versionId: req.params.versionId,
        publishAt: req.body?.publish_at,
        expiresAt: req.body?.expires_at,
        user: req.user,
        req,
      })
    );
  })
);

router.post(
  "/pages/:pageId/versions/:versionId/restore",
  requirePermission("public_content.restore_version"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await restorePageVersion({
        pageId: req.params.pageId,
        versionId: req.params.versionId,
        reason: req.body?.reason,
        user: req.user,
        req,
      }),
      { statusCode: 201 }
    );
  })
);

router.post(
  "/pages/:pageId/archive",
  requirePermission("public_content.archive"),
  asyncHandler(async (req, res) => {
    return success(
      res,
      req,
      await archivePage({
        pageId: req.params.pageId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    );
  })
);

router.use((error, req, res, next) =>
  sendContentStudioError(error, req, res, next)
);

router.asyncHandler = asyncHandler;
router.sendContentStudioError = sendContentStudioError;

module.exports = router;
