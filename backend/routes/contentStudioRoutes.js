"use strict";

const express = require("express");

const { ContentStudioError } = require("../services/contentStudioPageService");
const {
  requireContentStudioRouteScope,
} = require("../middleware/contentStudioAccessMiddleware");
const contentStudioAccessRoutes = require("./contentStudioAccessRoutes");
const contentStudioCompanyInfoRoutes = require("./contentStudioCompanyInfoRoutes");
const contentStudioCoreRoutes = require("./contentStudioCoreRoutes");
const contentStudioFormRoutes = require("./contentStudioFormRoutes");
const contentStudioLinkIntegrityRoutes = require("./contentStudioLinkIntegrityRoutes");
const contentStudioMediaRoutes = require("./contentStudioMediaRoutes");
const contentStudioNavigationRoutes = require("./contentStudioNavigationRoutes");
const contentStudioRedirectRoutes = require("./contentStudioRedirectRoutes");
const contentStudioNewsroomRoutes = require("./contentStudioNewsroomRoutes");
const contentStudioPortfolioRoutes = require("./contentStudioPortfolioRoutes");
const contentStudioSettingsRoutes = require("./contentStudioSettingsRoutes");

const router = express.Router();

// Phase 2A adds a second boundary in front of capability permissions. The
// authenticated Content Studio role must be allowed into the requested Studio
// section before the existing public_content/public_media/etc permissions are
// evaluated. This prevents a News Editor or Media Manager from wandering into
// unrelated Studio managers even though all Studio users share one workspace.
router.use(requireContentStudioRouteScope);

router.use("/access", contentStudioAccessRoutes);
router.use("/settings", contentStudioSettingsRoutes);
// Redirects live inside the existing Navigation scope but have their own
// manager and lifecycle. Mount this before /navigation so the dedicated router
// cannot be shadowed by navigation item IDs.
router.use("/navigation/redirects", contentStudioRedirectRoutes);
router.use("/navigation", contentStudioNavigationRoutes);
router.use("/media", contentStudioMediaRoutes);
router.use("/forms", contentStudioFormRoutes);
router.use("/newsroom", contentStudioNewsroomRoutes);
router.use("/company-info", contentStudioCompanyInfoRoutes);
router.use("/portfolio", contentStudioPortfolioRoutes);
// Link integrity belongs to the existing Pages scope and is deliberately
// mounted before the generic /pages/:pageId routes in contentStudioCoreRoutes.
router.use("/pages/link-integrity", contentStudioLinkIntegrityRoutes);
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
