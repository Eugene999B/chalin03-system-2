"use strict";

const express = require("express");

const { pool } = require("../config/db");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  activateRedirectRule,
  archiveRedirectRule,
  createRedirectDraft,
  deactivateRedirectRule,
  listRedirectRules,
  updateRedirectDraft,
} = require("../services/contentStudioRedirectService");
const {
  assertRedirectSourceUnoccupied,
} = require("../services/publicRouteOccupancyService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedRedirectHandler(req, res, next) {
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

async function assertStoredRuleSourceUnoccupied(ruleId) {
  const [rows] = await pool.query(
    "SELECT source_path FROM public_redirect_rules WHERE id = ? LIMIT 1",
    [ruleId]
  );
  if (rows[0]?.source_path) {
    await assertRedirectSourceUnoccupied(rows[0].source_path);
  }
}

router.get(
  "/",
  requirePermission("public_navigation.view"),
  asyncHandler(async (req, res) => success(res, req, await listRedirectRules()))
);

router.post(
  "/",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) => {
    await assertRedirectSourceUnoccupied(req.body?.source_path || req.body?.source);
    return success(
      res,
      req,
      await createRedirectDraft({ input: req.body, user: req.user, req }),
      201
    );
  })
);

router.put(
  "/:ruleId",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) => {
    await assertRedirectSourceUnoccupied(req.body?.source_path || req.body?.source);
    return success(
      res,
      req,
      await updateRedirectDraft({
        ruleId: req.params.ruleId,
        input: req.body,
        user: req.user,
        req,
      })
    );
  })
);

router.post(
  "/:ruleId/activate",
  requirePermission("public_content.publish"),
  asyncHandler(async (req, res) => {
    await assertStoredRuleSourceUnoccupied(req.params.ruleId);
    return success(
      res,
      req,
      await activateRedirectRule({ ruleId: req.params.ruleId, user: req.user, req })
    );
  })
);

router.post(
  "/:ruleId/deactivate",
  requirePermission("public_content.publish"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await deactivateRedirectRule({ ruleId: req.params.ruleId, user: req.user, req })
    )
  )
);

router.post(
  "/:ruleId/archive",
  requirePermission("public_navigation.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveRedirectRule({
        ruleId: req.params.ruleId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

module.exports = router;
