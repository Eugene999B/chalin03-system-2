"use strict";

const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  deactivateSiteSetting,
  listSiteSettings,
  upsertSiteSetting,
} = require("../services/contentStudioSettingsService");

const router = express.Router();

function asyncHandler(handler) {
  return function wrappedSettingsHandler(req, res, next) {
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
  requirePermission("public_settings.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listSiteSettings({
        group: req.query.group,
        publicOnly:
          String(req.query.public_only || "").toLowerCase() === "true",
      })
    )
  )
);

router.post(
  "/",
  requirePermission("public_settings.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await upsertSiteSetting({
        input: req.body,
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.put(
  "/:settingId",
  requirePermission("public_settings.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await upsertSiteSetting({
        settingId: req.params.settingId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:settingId/deactivate",
  requirePermission("public_settings.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await deactivateSiteSetting({
        settingId: req.params.settingId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

module.exports = router;
