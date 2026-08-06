"use strict";

const express = require("express");

const { ContentStudioError } = require("../services/contentStudioPageService");
const contentStudioCompanyInfoRoutes = require("./contentStudioCompanyInfoRoutes");
const contentStudioCoreRoutes = require("./contentStudioCoreRoutes");
const contentStudioFormRoutes = require("./contentStudioFormRoutes");
const contentStudioMediaRoutes = require("./contentStudioMediaRoutes");
const contentStudioNavigationRoutes = require("./contentStudioNavigationRoutes");
const contentStudioNewsroomRoutes = require("./contentStudioNewsroomRoutes");
const contentStudioPortfolioRoutes = require("./contentStudioPortfolioRoutes");
const contentStudioSettingsRoutes = require("./contentStudioSettingsRoutes");

const router = express.Router();

// Capability boundaries are enforced inside the mounted routers:
// public_content.view, public_content.create, public_content.edit,
// public_content.submit, public_content.review, public_content.approve,
// public_content.publish, public_content.restore_version, public_content.archive,
// public_media.view/manage and public_forms.view/manage.

router.use("/settings", contentStudioSettingsRoutes);
router.use("/navigation", contentStudioNavigationRoutes);
router.use("/media", contentStudioMediaRoutes);
router.use("/forms", contentStudioFormRoutes);
router.use("/newsroom", contentStudioNewsroomRoutes);
router.use("/company-info", contentStudioCompanyInfoRoutes);
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
