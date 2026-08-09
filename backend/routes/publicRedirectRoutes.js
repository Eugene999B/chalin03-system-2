"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  resolvePublicRedirect,
} = require("../services/contentStudioRedirectService");

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

router.get("/resolve", resolverLimiter, async (req, res, next) => {
  try {
    const redirect = await resolvePublicRedirect(req.query.path);
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
