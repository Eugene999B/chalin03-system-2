"use strict";

const express = require("express");

const {
  requirePermission,
} = require("../middleware/permissionMiddleware");
const {
  archiveForm,
  createFormDraft,
  createFormVersion,
  decideFormApproval,
  getFormDetails,
  listFormApprovals,
  listForms,
  publishFormVersion,
  restoreFormVersion,
  submitFormVersion,
  updateFormDraft,
} = require("../services/contentStudioFormService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedFormHandler(req, res, next) {
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
  "/approvals",
  requirePermission("public_content.review"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listFormApprovals({
        assignedTo:
          String(req.query.mine || "").toLowerCase() === "true"
            ? req.user?.id
            : req.query.assigned_to,
        limit: req.query.limit,
        offset: req.query.offset,
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
      await decideFormApproval({
        approvalId: req.params.approvalId,
        decision: req.body?.decision,
        note: req.body?.note,
        user: req.user,
        req,
      })
    )
  )
);

router.get(
  "/",
  requirePermission("public_forms.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listForms({
        status: req.query.status,
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    )
  )
);

router.post(
  "/",
  requirePermission("public_forms.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createFormDraft({ input: req.body, user: req.user, req }),
      201
    )
  )
);

router.get(
  "/:formId",
  requirePermission("public_forms.view"),
  asyncHandler(async (req, res) =>
    success(res, req, await getFormDetails(req.params.formId))
  )
);

router.post(
  "/:formId/versions",
  requirePermission("public_forms.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createFormVersion({
        formId: req.params.formId,
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.put(
  "/:formId/versions/:versionId",
  requirePermission("public_forms.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await updateFormDraft({
        formId: req.params.formId,
        versionId: req.params.versionId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:formId/versions/:versionId/submit",
  requirePermission("public_content.submit"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await submitFormVersion({
        formId: req.params.formId,
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
  "/:formId/versions/:versionId/publish",
  requirePermission("public_content.publish"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await publishFormVersion({
        formId: req.params.formId,
        versionId: req.params.versionId,
        publishAt: req.body?.publish_at,
        expiresAt: req.body?.expires_at,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:formId/versions/:versionId/restore",
  requirePermission("public_content.restore_version"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await restoreFormVersion({
        formId: req.params.formId,
        versionId: req.params.versionId,
        reason: req.body?.reason,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.post(
  "/:formId/archive",
  requirePermission("public_content.archive"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveForm({
        formId: req.params.formId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

module.exports = router;
