const express = require("express");

const { requireAuth } = require("../middleware/authMiddleware");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/permissionMiddleware");
const {
  writeAuditEvent,
} = require("../services/auditTrailService");
const {
  listConfiguration,
  listConfigurationHistory,
  updateSetting,
  listSequences,
  updateSequence,
} = require("../services/groupConfigurationService");
const {
  buildExecutiveIntelligence,
  dispatchExecutiveIntelligence,
  listRecipients,
} = require("../services/executiveIntelligenceService");

const release2FinalRoutes = require("./release2FinalRoutes");

const {
  requireProtectedAction,
  appendLedger,
} = release2FinalRoutes;

if (
  typeof requireProtectedAction !== "function" ||
  typeof appendLedger !== "function"
) {
  throw new Error(
    "Release 3 Group Configuration requires the protected-action and privileged-ledger helpers."
  );
}

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanDate(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

router.get(
  "/",
  requireAuth,
  requireAnyPermission(
    "security.view",
    "security.admin",
    "audit.view",
    "executive.operations.view"
  ),
  asyncHandler(async (req, res) => {
    const settings = await listConfiguration();

    const groups = settings.reduce((result, setting) => {
      if (!result[setting.setting_group]) {
        result[setting.setting_group] = [];
      }

      result[setting.setting_group].push(setting);
      return result;
    }, {});

    return res.json({
      status: "success",
      message: "Group Configuration loaded.",
      settings,
      groups,
      policy: {
        secrets_displayed: false,
        secrets_editable: false,
        protected_action_required_for_changes: true,
        change_reason_required: true,
      },
    });
  })
);

router.get(
  "/history",
  requireAuth,
  requireAnyPermission(
    "security.view",
    "security.admin",
    "audit.view"
  ),
  asyncHandler(async (req, res) => {
    return res.json({
      status: "success",
      history: await listConfigurationHistory(req.query.limit),
    });
  })
);

router.get(
  "/sequences",
  requireAuth,
  requireAnyPermission(
    "security.view",
    "security.admin",
    "audit.view",
    "executive.operations.view"
  ),
  asyncHandler(async (req, res) => {
    return res.json({
      status: "success",
      sequences: await listSequences(),
    });
  })
);

router.get(
  "/executive-intelligence/recipients",
  requireAuth,
  requirePermission("notifications.manage"),
  asyncHandler(async (_req, res) => {
    return res.json({
      status: "success",
      recipients: await listRecipients(),
    });
  })
);

router.get(
  "/executive-intelligence/preview",
  requireAuth,
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const intelligence = await buildExecutiveIntelligence({
      from: cleanDate(req.query.from),
      to: cleanDate(req.query.to),
    });

    return res.json({ status: "success", intelligence });
  })
);

router.post(
  "/executive-intelligence/dispatch",
  requireAuth,
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const result = await dispatchExecutiveIntelligence({
      from: cleanDate(req.body?.from),
      to: cleanDate(req.body?.to),
      audience: cleanText(req.body?.audience, 30).toLowerCase() || "executive",
      userIds: Array.isArray(req.body?.user_ids) ? req.body.user_ids : [],
      roles: Array.isArray(req.body?.roles) ? req.body.roles : [],
      sendSms: Boolean(req.body?.send_sms),
      createdBy: req.user.id,
    });

    await writeAuditEvent({
      req,
      userId: req.user.id,
      branchId: req.user.branch_id || null,
      action: "DISPATCH_EXECUTIVE_INTELLIGENCE",
      actionType: "executive_intelligence.dispatch",
      severity: result.intelligence.actions.some((item) => item.severity === "critical")
        ? "high"
        : "medium",
      outcome: "success",
      workspaceCode: "group",
      entityType: "executive_intelligence",
      details: `Executive intelligence dispatched to ${result.recipient_count} recipient(s).`,
      metadata: {
        audience: result.audience,
        scope: result.intelligence.scope,
        range: result.intelligence.range,
        recipient_count: result.recipient_count,
      },
    });

    return res.status(201).json({
      status: "success",
      message: `Executive intelligence dispatched to ${result.recipient_count} recipient(s).`,
      ...result,
    });
  })
);

router.put(
  "/settings/:settingKey",
  requireAuth,
  requirePermission("security.admin"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const reason = cleanText(req.body?.reason, 500);

    const result = await updateSetting({
      settingKey: req.params.settingKey,
      value: req.body?.value,
      reason,
      userId: req.user.id,
      req,
    });

    if (result.changed) {
      await appendLedger({
        req,
        actorUserId: req.user.id,
        actionCode: "GROUP_CONFIGURATION_CHANGED",
        severity: "critical",
        entityType: "group_configuration",
        entityId: result.setting.setting_key,
        payload: {
          setting_key: result.setting.setting_key,
          reason,
          old_value: result.old_value,
          new_value: result.setting.value,
          secret_recorded: false,
        },
      });

      await writeAuditEvent({
        req,
        userId: req.user.id,
        action: "GROUP_CONFIGURATION_CHANGED",
        actionType: "configuration.group.updated",
        severity: "critical",
        outcome: "success",
        entityType: "group_configuration",
        entityId: result.setting.setting_key,
        details: `Group configuration setting ${result.setting.setting_key} was changed.`,
        metadata: {
          reason,
          secret_recorded: false,
        },
      });
    }

    return res.json({
      status: "success",
      message: result.changed
        ? "Group configuration updated successfully."
        : "The submitted value already matches the saved configuration.",
      changed: result.changed,
      setting: result.setting,
    });
  })
);

router.put(
  "/sequences/:sequenceCode",
  requireAuth,
  requirePermission("security.admin"),
  requireProtectedAction,
  asyncHandler(async (req, res) => {
    const reason = cleanText(req.body?.reason, 500);

    const result = await updateSequence({
      sequenceCode: req.params.sequenceCode,
      changes: req.body || {},
      reason,
      userId: req.user.id,
      req,
    });

    await appendLedger({
      req,
      actorUserId: req.user.id,
      actionCode: "DOCUMENT_SEQUENCE_CHANGED",
      severity: "critical",
      entityType: "document_sequence",
      entityId: result.sequence.sequence_code,
      payload: {
        sequence_code: result.sequence.sequence_code,
        workspace_code: result.sequence.workspace_code,
        prefix: result.sequence.prefix,
        next_number: result.sequence.next_number,
        reset_policy: result.sequence.reset_policy,
        reason,
      },
    });

    await writeAuditEvent({
      req,
      userId: req.user.id,
      action: "DOCUMENT_SEQUENCE_CHANGED",
      actionType: "configuration.sequence.updated",
      severity: "critical",
      outcome: "success",
      entityType: "document_sequence",
      entityId: result.sequence.sequence_code,
      details: `Document sequence ${result.sequence.sequence_code} was changed.`,
      metadata: {
        reason,
        next_number: result.sequence.next_number,
      },
    });

    return res.json({
      status: "success",
      message: "Document sequence updated successfully.",
      sequence: result.sequence,
    });
  })
);

module.exports = router;
