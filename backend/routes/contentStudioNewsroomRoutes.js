"use strict";

const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  archiveEntity,
  archiveNewsCategory,
  createEntityDraft,
  createEntityVersion,
  createNewsCategory,
  decideEntityApproval,
  getEntityDetails,
  listEntities,
  listNewsCategories,
  listNewsroomApprovals,
  publishEntityVersion,
  restoreEntityVersion,
  submitEntityVersion,
  updateEntityDraft,
  updateNewsCategory,
} = require("../services/contentStudioNewsroomService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedNewsroomHandler(req, res, next) {
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
  "/categories",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listNewsCategories({
        includeInactive:
          String(req.query.include_inactive || "").toLowerCase() === "true",
      })
    )
  )
);

router.post(
  "/categories",
  requirePermission("public_content.create"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createNewsCategory({ input: req.body, user: req.user, req }),
      201
    )
  )
);

router.patch(
  "/categories/:categoryId",
  requirePermission("public_content.edit"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await updateNewsCategory({
        categoryId: req.params.categoryId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/categories/:categoryId/archive",
  requirePermission("public_content.archive"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveNewsCategory({
        categoryId: req.params.categoryId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

router.get(
  "/approvals",
  requirePermission("public_content.review"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listNewsroomApprovals({
        kind: req.query.kind,
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
  "/:kind/approvals/:approvalId/decision",
  requirePermission("public_content.approve"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await decideEntityApproval({
        kind: req.params.kind,
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
  "/:kind",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listEntities(req.params.kind, {
        status: req.query.status,
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    )
  )
);

router.post(
  "/:kind",
  requirePermission("public_content.create"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createEntityDraft({
        kind: req.params.kind,
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.get(
  "/:kind/:entityId",
  requirePermission("public_content.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await getEntityDetails(req.params.kind, req.params.entityId)
    )
  )
);

router.post(
  "/:kind/:entityId/versions",
  requirePermission("public_content.edit"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createEntityVersion({
        kind: req.params.kind,
        entityId: req.params.entityId,
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.put(
  "/:kind/:entityId/versions/:versionId",
  requirePermission("public_content.edit"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await updateEntityDraft({
        kind: req.params.kind,
        entityId: req.params.entityId,
        versionId: req.params.versionId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:kind/:entityId/versions/:versionId/submit",
  requirePermission("public_content.submit"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await submitEntityVersion({
        kind: req.params.kind,
        entityId: req.params.entityId,
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
  "/:kind/:entityId/versions/:versionId/publish",
  requirePermission("public_content.publish"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await publishEntityVersion({
        kind: req.params.kind,
        entityId: req.params.entityId,
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
  "/:kind/:entityId/versions/:versionId/restore",
  requirePermission("public_content.restore_version"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await restoreEntityVersion({
        kind: req.params.kind,
        entityId: req.params.entityId,
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
  "/:kind/:entityId/archive",
  requirePermission("public_content.archive"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveEntity({
        kind: req.params.kind,
        entityId: req.params.entityId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

module.exports = router;
