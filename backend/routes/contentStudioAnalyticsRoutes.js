"use strict";

const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getPublicAnalyticsSummary,
} = require("../services/publicAnalyticsService");

const router = express.Router();

function noStore(res) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
}

router.get(
  "/summary",
  requirePermission("public_content.view"),
  async (req, res, next) => {
    noStore(res);
    try {
      return res.json({
        status: "success",
        data: await getPublicAnalyticsSummary({ days: req.query.days }),
        request_id: req.requestId || null,
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
