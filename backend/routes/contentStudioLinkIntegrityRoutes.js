"use strict";

const express = require("express");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  getLinkIntegrityIntelligence,
} = require("../services/contentStudioLinkIntegrityService");

const router = express.Router();

router.get("/", requirePermission("public_content.view"), async (req, res, next) => {
  try {
    const data = await getLinkIntegrityIntelligence();
    res.set("Cache-Control", "no-store, private, max-age=0");
    res.set("Pragma", "no-cache");
    return res.json({
      status: "success",
      data,
      request_id: req.requestId || null,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
