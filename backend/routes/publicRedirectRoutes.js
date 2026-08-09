"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  resolvePublicRedirect,
} = require("../services/contentStudioRedirectService");
const {
  STATIC_PUBLIC_PATHS,
} = require("../services/contentStudioWebsiteControlService");
const {
  cleanPath,
  findPublishedRouteOwner,
} = require("../services/publicRouteOccupancyService");
const publicSeoRoutes = require("./publicSeoRoutes");

const router = express.Router();

const resolverLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Math.max(60, Number(process.env.PUBLIC_REDIRECT_READ_RATE_LIMIT_MAX) || 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PUBLIC_REDIRECT_RATE_LIMITED",
    message: "Too many public route lookups. Please wait briefly and try again.",
  },
});

// Edge-support SEO inventory is anonymous, read-only and inherits the same
// publicWebsite feature gate as this router's parent mount in systemRoutes.
router.use("/seo", publicSeoRoutes);

router.get("/resolve", resolverLimiter, async (req, res, next) => {
  try {
    const pathname = cleanPath(req.query.path);
    let redirect = null;
    if (pathname && !STATIC_PUBLIC_PATHS.has(pathname)) {
      const owner = await findPublishedRouteOwner(pathname);
      if (!owner) redirect = await resolvePublicRedirect(pathname);
    }
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    return res.json({
      status: "success",
      data: redirect,
      request_id: req.requestId || null,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
