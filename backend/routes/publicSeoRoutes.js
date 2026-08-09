"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const {
  getPublicSeoInventory,
} = require("../services/publicSeoDeliveryService");

const router = express.Router();

const seoReadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Math.max(30, Number(process.env.PUBLIC_SEO_READ_RATE_LIMIT_MAX) || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    code: "PUBLIC_SEO_RATE_LIMITED",
    message: "Too many public SEO inventory requests. Please wait briefly and try again.",
  },
});

router.get("/inventory", seoReadLimiter, async (req, res, next) => {
  try {
    const inventory = await getPublicSeoInventory();
    res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return res.json({
      status: "success",
      data: inventory,
      request_id: req.requestId || null,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
