const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const {
  buildAccountingIntelligence,
} = require("../services/accountingIntelligenceService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAccountingAccess(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();

  if (role === "admin" || role === "manager") {
    return next();
  }

  return res.status(403).json({
    status: "error",
    message: "Only admins and managers can view advanced accounting intelligence.",
  });
}

router.get(
  "/overview",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    res.json({
      status: "success",
      message: "Advanced accounting and audit intelligence loaded.",
      intelligence,
    });
  })
);

router.get(
  "/ledger",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    res.json({
      status: "success",
      message: "Management ledger loaded.",
      scope: intelligence.scope,
      ledger: intelligence.management_ledger,
    });
  })
);

router.get(
  "/audit-flags",
  requireAuth,
  requireAccountingAccess,
  asyncHandler(async (req, res) => {
    const intelligence = await buildAccountingIntelligence(req);

    res.json({
      status: "success",
      message: "Audit intelligence flags loaded.",
      scope: intelligence.scope,
      audit: intelligence.audit,
      recommendations: intelligence.recommendations,
    });
  })
);

module.exports = router;
