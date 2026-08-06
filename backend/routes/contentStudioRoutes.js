"use strict";

const express = require("express");

const { ContentStudioError } = require("../services/contentStudioPageService");
const contentStudioCoreRoutes = require("./contentStudioCoreRoutes");
const contentStudioNavigationRoutes = require("./contentStudioNavigationRoutes");
const contentStudioPortfolioRoutes = require("./contentStudioPortfolioRoutes");
const contentStudioSettingsRoutes = require("./contentStudioSettingsRoutes");

const router = express.Router();

// Capability boundaries are enforced inside the mounted routers:
// public_content.view, public_content.create, public_content.edit,
// public_content.submit, public_content.review, public_content.approve,
// public_content.publish, public_content.restore_version, public_content.archive.

router.use("/settings", contentStudioSettingsRoutes);
router.use("/navigation", contentStudioNavigationRoutes);
router.use("/portfolio", contentStudioPortfolioRoutes);
router.use("/", contentStudioCoreRoutes);

router.use((error, req, res, next) => {
  if (!(error instanceof ContentStudioError)) return next(error);

  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  return res.status(error.statusCode || 400).json({
    status: "error",
    code: error.code,
    message: error.message,
    details: error.details || [],
    request_id: req.requestId || null,
  });
});

module.exports = router;
