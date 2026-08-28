const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  buildExecutiveIntelligence,
  dispatchExecutiveIntelligence,
  listRecipients,
} = require("../services/executiveIntelligenceService");
const { writeAuditEvent } = require("../services/auditTrailService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

router.use(requireAuth, requirePermission("notifications.manage"));

router.get(
  "/recipients",
  asyncHandler(async (_req, res) => {
    const recipients = await listRecipients();
    res.json({ status: "success", recipients });
  })
);

router.get(
  "/preview",
  asyncHandler(async (req, res) => {
    const intelligence = await buildExecutiveIntelligence({
      from: cleanDate(req.query.from),
      to: cleanDate(req.query.to),
    });
    res.json({ status: "success", intelligence });
  })
);

router.post(
  "/dispatch",
  asyncHandler(async (req, res) => {
    const result = await dispatchExecutiveIntelligence({
      from: cleanDate(req.body?.from),
      to: cleanDate(req.body?.to),
      audience: String(req.body?.audience || "executive").toLowerCase(),
      userIds: Array.isArray(req.body?.user_ids) ? req.body.user_ids : [],
      roles: Array.isArray(req.body?.roles) ? req.body.roles : [],
      sendSms: req.body?.send_sms !== false,
      createdBy: req.user.id,
    });

    try {
      await writeAuditEvent({
        req,
        userId: req.user.id,
        branchId: req.user.branch_id || null,
        action: "DISPATCH_EXECUTIVE_INTELLIGENCE",
        details: `Executive intelligence dispatched to ${result.recipient_count} recipient(s).`,
        workspaceCode: "group",
        entityType: "executive_intelligence",
        actionType: "executive_intelligence_dispatch",
        outcome: "success",
        severity: result.intelligence.actions.some((item) => item.severity === "critical") ? "high" : "medium",
        metadata: {
          audience: result.audience,
          range: result.intelligence.range,
          recipient_count: result.recipient_count,
        },
      });
    } catch (error) {
      console.warn("Executive intelligence audit event skipped:", error.message);
    }

    res.status(201).json({
      status: "success",
      message: `Executive intelligence dispatched to ${result.recipient_count} recipient(s).`,
      ...result,
    });
  })
);

module.exports = router;
