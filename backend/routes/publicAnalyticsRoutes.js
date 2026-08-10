"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  recordPublicPageView,
} = require("../services/publicAnalyticsService");

const router = express.Router();

const PUBLIC_ANALYTICS_RATE_LIMIT_MAX = Math.max(
  30,
  Number(process.env.PUBLIC_ANALYTICS_RATE_LIMIT_MAX) || 240
);

const publicAnalyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PUBLIC_ANALYTICS_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "success",
    data: { accepted: true, recorded: false },
  },
});

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
}

router.post("/page-view", publicAnalyticsLimiter, async (req, res) => {
  noStore(res);

  try {
    const result = await recordPublicPageView(req.body?.path);
    return res.status(202).json({
      status: "success",
      data: {
        accepted: true,
        recorded: result.recorded,
      },
      request_id: req.requestId || null,
    });
  } catch (error) {
    // Public browsing must never fail because optional aggregate analytics is unavailable.
    console.error("Public analytics write skipped:", {
      requestId: req.requestId || null,
      code: error?.code || null,
      message: error?.message || "Unknown analytics error",
    });
    return res.status(202).json({
      status: "success",
      data: { accepted: true, recorded: false },
      request_id: req.requestId || null,
    });
  }
});

router.get("/disclosure", (_req, res) => {
  noStore(res);
  return res.json({
    status: "success",
    data: {
      analytics: {
        purpose: "Understand aggregate use of published CHALIN ONE pages.",
        storage: ["UTC date", "normalized public route", "aggregate page-view count"],
        excluded: [
          "raw IP addresses",
          "user-agent strings",
          "cookies",
          "persistent visitor identifiers",
          "public form contents",
          "Staff and Content Studio activity",
        ],
      },
      forms: {
        purpose: "Process public enquiries and applications that a visitor chooses to submit.",
        note: "Public form information is stored separately from aggregate page-view analytics and is never copied into the analytics table.",
      },
    },
  });
});

router.PUBLIC_ANALYTICS_RATE_LIMIT_MAX = PUBLIC_ANALYTICS_RATE_LIMIT_MAX;
router.publicAnalyticsLimiter = publicAnalyticsLimiter;

module.exports = router;
