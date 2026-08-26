const express = require("express");

const { pool } = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  buildOwnerAlertContext,
  formatSecurityDateTime,
  sendOwnerSmsAlert,
} = require("../services/smsAlertService");
const { writeAuditEvent } = require("../services/auditTrailService");
const { ensureReportRules } = require("../services/executiveBusinessReportService");
const {
  WORKSPACES,
  SEVERITIES,
  cleanText,
  positiveId,
  workspaceCode,
  selectedContextId,
  branchId,
  isAdmin,
  runNotificationSync,
  visibleNotifications,
  notificationSummary,
} = require("../services/notificationService");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function appError(message, statusCode = 400, code = "NOTIFICATION_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function normalizeWorkspace(value, fallback = "group") {
  const code = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return WORKSPACES.has(code) ? code : fallback;
}

function normalizeSeverity(value, fallback = "medium") {
  const severity = cleanText(value, 20).toLowerCase();
  return SEVERITIES.has(severity) ? severity : fallback;
}

async function notificationById(req, id, { forUpdate = false, connection = pool } = {}) {
  const visibleRows = await visibleNotifications(req, {
    id,
    status: "all",
    archived: null,
    limit: 1,
  });
  const visible = visibleRows[0] || null;

  if (!visible) {
    throw appError(
      "Notification not found or not available to this account.",
      404,
      "NOTIFICATION_NOT_FOUND"
    );
  }

  if (!forUpdate) return visible;

  const [lockedRows] = await connection.query(
    `SELECT * FROM notifications WHERE id = ? LIMIT 1 FOR UPDATE`,
    [id]
  );
  if (!lockedRows.length) {
    throw appError("Notification no longer exists.", 404, "NOTIFICATION_NOT_FOUND");
  }
  return lockedRows[0];
}

async function writeNotificationAudit(req, actionCode, notification, metadata = {}) {
  try {
    await writeAuditEvent({
      req,
      userId: req.user?.id || null,
      branchId: branchId(req),
      action: actionCode,
      details: `${actionCode}: ${notification?.title || notification?.notification_key || "notification"}`,
      workspaceCode: workspaceCode(req),
      miningSiteId: workspaceCode(req) === "mining" ? selectedContextId(req) : null,
      hireLocationId:
        workspaceCode(req) === "equipment_hire" ? selectedContextId(req) : null,
      entityType: "notification",
      entityId: notification?.id || null,
      actionType: actionCode,
      outcome: "success",
      severity: ["critical", "high"].includes(notification?.severity) ? "high" : "medium",
      metadata,
    });
  } catch (error) {
    console.warn("Notification audit event skipped:", error.message);
  }
}

router.use(requireAuth);

// GET /api/notifications
router.get(
  "/",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const notifications = await visibleNotifications(req, {
      archived: boolValue(req.query.archived, false),
      status: cleanText(req.query.status, 30).toLowerCase() || "active",
      severity: cleanText(req.query.severity, 20).toLowerCase(),
      category: cleanText(req.query.category, 60).toLowerCase(),
      search: cleanText(req.query.search, 150),
      limit: req.query.limit,
      offset: req.query.offset,
    });

    res.json({
      status: "success",
      count: notifications.length,
      workspace_code: workspaceCode(req),
      context_id: selectedContextId(req),
      notifications,
    });
  })
);

// GET /api/notifications/summary
router.get(
  "/summary",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const summary = await notificationSummary(req);
    res.json({ status: "success", generated_at: new Date().toISOString(), ...summary });
  })
);

// GET /api/notifications/rules
router.get(
  "/rules",
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    if (isAdmin(req) || workspaceCode(req) === "spare_parts") {
      await ensureReportRules();
    }

    const params = [];
    let where = "";
    if (!isAdmin(req)) {
      where = "WHERE workspace_code = ?";
      params.push(workspaceCode(req));
    }

    const [rules] = await pool.query(
      `SELECT * FROM notification_rules
       ${where}
       ORDER BY workspace_code, category, rule_name`,
      params
    );
    res.json({ status: "success", count: rules.length, rules });
  })
);

// GET /api/notifications/sync-runs
router.get(
  "/sync-runs",
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const params = [];
    let where = "";
    if (!isAdmin(req)) {
      where = "WHERE nsr.workspace_code = ?";
      params.push(workspaceCode(req));
    }

    const [runs] = await pool.query(
      `SELECT nsr.*, u.full_name AS started_by_name, u.username AS started_by_username
       FROM notification_sync_runs nsr
       LEFT JOIN users u ON u.id = nsr.started_by
       ${where}
       ORDER BY nsr.started_at DESC
       LIMIT 100`,
      params
    );
    res.json({ status: "success", count: runs.length, sync_runs: runs });
  })
);

// POST /api/notifications/sync
router.post(
  "/sync",
  requirePermission("notifications.sync"),
  asyncHandler(async (req, res) => {
    let requestedWorkspace = normalizeWorkspace(
      req.body?.workspace_code || workspaceCode(req),
      workspaceCode(req)
    );

    if (requestedWorkspace === "group" && !isAdmin(req)) {
      requestedWorkspace = workspaceCode(req);
    }

    if (!isAdmin(req) && requestedWorkspace !== workspaceCode(req)) {
      throw appError(
        "You may synchronize notifications only for your active workspace.",
        403,
        "NOTIFICATION_SYNC_SCOPE_DENIED"
      );
    }

    const result = await runNotificationSync({
      workspace: requestedWorkspace,
      userId: req.user.id,
    });

    await writeNotificationAudit(req, "SYNC_NOTIFICATIONS", {
      id: result.sync_id,
      title: `${requestedWorkspace} notification synchronization`,
      severity: "medium",
    }, result);

    res.json({
      status: "success",
      message: "Notification conditions synchronized successfully.",
      ...result,
    });
  })
);

// POST /api/notifications/manual
router.post(
  "/manual",
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const title = cleanText(req.body?.title, 220);
    const message = cleanText(req.body?.message, 1200);
    const workspace = normalizeWorkspace(req.body?.workspace_code || workspaceCode(req));

    if (!title || !message) {
      throw appError("Notification title and message are required.");
    }

    if (!isAdmin(req) && workspace !== workspaceCode(req)) {
      throw appError("You may create notifications only inside your active workspace.", 403);
    }

    const targetUserId = positiveId(req.body?.target_user_id);
    const targetRole = cleanText(req.body?.target_role, 60) || null;
    const targetPermission = cleanText(req.body?.target_permission, 120) || null;
    const currentContext = selectedContextId(req);
    const miningSiteId =
      workspace === "mining"
        ? isAdmin(req)
          ? positiveId(req.body?.mining_site_id) || currentContext
          : currentContext
        : null;
    const hireLocationId =
      workspace === "equipment_hire"
        ? isAdmin(req)
          ? positiveId(req.body?.hire_location_id) || currentContext
          : currentContext
        : null;

    if (workspace === "mining" && !miningSiteId) {
      throw appError("Select an authorized Mining site before creating this notification.");
    }
    if (workspace === "equipment_hire" && !hireLocationId) {
      throw appError("Select an authorized Hire location before creating this notification.");
    }

    const notificationKey = `manual.${req.user.id}.${Date.now()}.${Math.random().toString(16).slice(2, 10)}`;

    const [result] = await pool.query(
      `INSERT INTO notifications (
         notification_key, workspace_code, branch_id, mining_site_id, hire_location_id,
         target_user_id, target_role, target_permission, category, notification_type,
         severity, title, message, action_path, source_type, source_reference,
         status, auto_generated, occurred_at, metadata_json, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, 'manual', ?, 'active', FALSE, NOW(), ?, ?)`,
      [
        notificationKey,
        workspace,
        workspace === "spare_parts" ? branchId(req) : positiveId(req.body?.branch_id),
        miningSiteId,
        hireLocationId,
        targetUserId,
        targetRole,
        targetPermission,
        cleanText(req.body?.category, 60) || "management",
        normalizeSeverity(req.body?.severity),
        title,
        message,
        cleanText(req.body?.action_path, 500) || null,
        cleanText(req.body?.source_reference, 180) || null,
        JSON.stringify({ created_from: "notification_centre" }),
        req.user.id,
      ]
    );

    const notification = { id: result.insertId, title, severity: normalizeSeverity(req.body?.severity) };
    await writeNotificationAudit(req, "CREATE_MANUAL_NOTIFICATION", notification, { workspace_code: workspace });

    res.status(201).json({
      status: "success",
      message: "Notification created successfully.",
      notification_id: result.insertId,
    });
  })
);

// PATCH /api/notifications/rules/:id
router.patch(
  "/rules/:id",
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) throw appError("A valid notification rule is required.");

    const [rows] = await pool.query(`SELECT * FROM notification_rules WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) throw appError("Notification rule not found.", 404);

    const current = rows[0];
    if (!isAdmin(req) && current.workspace_code !== workspaceCode(req)) {
      throw appError(
        "You may update notification rules only for your active workspace.",
        403,
        "NOTIFICATION_RULE_SCOPE_DENIED"
      );
    }

    const requestedSmsAllowed = boolValue(
      req.body?.sms_allowed,
      Boolean(Number(current.sms_allowed))
    );
    if (
      !isAdmin(req) &&
      req.body?.sms_allowed !== undefined &&
      requestedSmsAllowed !== Boolean(Number(current.sms_allowed))
    ) {
      throw appError(
        "Only the System Administrator may change SMS escalation eligibility.",
        403,
        "NOTIFICATION_SMS_RULE_ADMIN_REQUIRED"
      );
    }

    const next = {
      is_enabled: boolValue(req.body?.is_enabled, Boolean(Number(current.is_enabled))),
      default_severity: normalizeSeverity(req.body?.default_severity, current.default_severity),
      target_role: req.body?.target_role === undefined ? current.target_role : cleanText(req.body.target_role, 60) || null,
      target_permission: req.body?.target_permission === undefined ? current.target_permission : cleanText(req.body.target_permission, 120) || null,
      escalation_minutes: req.body?.escalation_minutes === undefined
        ? Number(current.escalation_minutes || 0)
        : Math.min(43200, Math.max(0, Number(req.body.escalation_minutes || 0))),
      sms_allowed: requestedSmsAllowed,
    };

    await pool.query(
      `UPDATE notification_rules
       SET is_enabled = ?, default_severity = ?, target_role = ?, target_permission = ?,
           escalation_minutes = ?, sms_allowed = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        next.is_enabled,
        next.default_severity,
        next.target_role,
        next.target_permission,
        next.escalation_minutes,
        next.sms_allowed,
        id,
      ]
    );

    await writeNotificationAudit(req, "UPDATE_NOTIFICATION_RULE", { id, title: current.rule_name, severity: "medium" }, next);
    res.json({ status: "success", message: "Notification rule updated successfully." });
  })
);

// PATCH /api/notifications/:id/state
router.patch(
  "/:id/state",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) throw appError("A valid notification is required.");

    const notification = await notificationById(req, id);
    const setRead = req.body?.is_read === undefined ? null : boolValue(req.body.is_read);
    const setArchived = req.body?.is_archived === undefined ? null : boolValue(req.body.is_archived);

    const [stateRows] = await pool.query(
      `SELECT * FROM notification_user_states
       WHERE notification_id = ? AND user_id = ?
       LIMIT 1`,
      [id, req.user.id]
    );
    const currentState = stateRows[0] || {};
    const nextRead = setRead === null
      ? Boolean(Number(currentState.is_read ?? notification.is_read))
      : setRead;
    const nextArchived = setArchived === null
      ? Boolean(Number(currentState.is_archived ?? notification.is_archived))
      : setArchived;

    await pool.query(
      `INSERT INTO notification_user_states (
         notification_id, user_id, is_read, read_at, is_archived, archived_at, last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         is_read = VALUES(is_read),
         read_at = VALUES(read_at),
         is_archived = VALUES(is_archived),
         archived_at = VALUES(archived_at),
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [
        id,
        req.user.id,
        nextRead,
        nextRead ? currentState.read_at || new Date() : null,
        nextArchived,
        nextArchived ? currentState.archived_at || new Date() : null,
      ]
    );

    res.json({ status: "success", message: "Notification state updated." });
  })
);

// POST /api/notifications/read-all
router.post(
  "/read-all",
  requirePermission("notifications.view"),
  asyncHandler(async (req, res) => {
    const rows = await visibleNotifications(req, { status: "active", archived: false, limit: 250 });
    for (const row of rows) {
      await pool.query(
        `INSERT INTO notification_user_states (notification_id, user_id, is_read, read_at, last_seen_at)
         VALUES (?, ?, TRUE, NOW(), NOW())
         ON DUPLICATE KEY UPDATE is_read = TRUE, read_at = NOW(), last_seen_at = NOW(), updated_at = NOW()`,
        [row.id, req.user.id]
      );
    }
    res.json({ status: "success", message: `${rows.length} notification(s) marked as read.` });
  })
);

// PATCH /api/notifications/:id/resolve
router.patch(
  "/:id/resolve",
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) throw appError("A valid notification is required.");

    const notification = await notificationById(req, id);
    const note = cleanText(req.body?.resolution_note, 500);
    if (!note) throw appError("A resolution note is required.");

    await pool.query(
      `UPDATE notifications
       SET status = 'resolved', resolved_at = NOW(), resolved_by = ?, resolution_note = ?
       WHERE id = ?`,
      [req.user.id, note, id]
    );

    await writeNotificationAudit(req, "RESOLVE_NOTIFICATION", notification, { resolution_note: note });
    res.json({ status: "success", message: "Notification resolved successfully." });
  })
);

// PATCH /api/notifications/:id/reopen
router.patch(
  "/:id/reopen",
  requirePermission("notifications.manage"),
  asyncHandler(async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) throw appError("A valid notification is required.");

    const notification = await notificationById(req, id);
    await pool.query(
      `UPDATE notifications
       SET status = 'active', resolved_at = NULL, resolved_by = NULL, resolution_note = NULL
       WHERE id = ?`,
      [id]
    );
    await writeNotificationAudit(req, "REOPEN_NOTIFICATION", notification);
    res.json({ status: "success", message: "Notification reopened." });
  })
);

// POST /api/notifications/:id/escalate-owner-sms
router.post(
  "/:id/escalate-owner-sms",
  requirePermission("notifications.escalate"),
  asyncHandler(async (req, res) => {
    if (String(process.env.NOTIFICATION_SMS_ENABLED || "").toLowerCase() !== "true") {
      throw appError(
        "Notification SMS escalation is disabled. Set NOTIFICATION_SMS_ENABLED=true only during an approved escalation window.",
        409,
        "NOTIFICATION_SMS_DISABLED"
      );
    }

    if (cleanText(req.body?.confirmation, 80) !== "SEND CRITICAL NOTIFICATION SMS") {
      throw appError("Type SEND CRITICAL NOTIFICATION SMS to confirm the escalation.");
    }

    const id = positiveId(req.params.id);
    if (!id) throw appError("A valid notification is required.");
    const notification = await notificationById(req, id);

    if (!Boolean(Number(notification.sms_allowed))) {
      throw appError("This notification rule is not approved for SMS escalation.", 403);
    }
    if (!["critical", "high"].includes(notification.severity)) {
      throw appError("Only high or critical notifications may be escalated by SMS.", 409);
    }

    const { businessName } = await buildOwnerAlertContext(branchId(req) || 1);
    const message = `${businessName}: ${notification.severity.toUpperCase()} operations alert. ${notification.title}. ${notification.message} Time: ${formatSecurityDateTime()}. Review the Chalin 03 Notification Centre.`;

    let status = "failed";
    let providerReference = null;
    let responseMessage = null;

    try {
      const result = await sendOwnerSmsAlert({
        branchId: branchId(req) || 1,
        message,
        smsType: "security_alert",
        sentBy: req.user.id,
        sourceReference: `notification:${notification.id}`,
      });
      status = result?.accepted ? "accepted" : result?.status || "submitted";
      providerReference = result?.provider_message_id || result?.message_id || null;
      responseMessage = result?.message || null;
    } catch (error) {
      responseMessage = cleanText(error.message, 500);
      throw error;
    } finally {
      await pool.query(
        `INSERT INTO notification_escalations (
           notification_id, escalation_channel, status, provider_reference,
           response_message, attempted_by
         ) VALUES (?, 'sms', ?, ?, ?, ?)`,
        [notification.id, status, providerReference, responseMessage, req.user.id]
      );
    }

    await writeNotificationAudit(req, "ESCALATE_NOTIFICATION_SMS", notification, { status, provider_reference: providerReference });
    res.json({
      status: "success",
      message: "Notification SMS escalation submitted through the approved provider workflow.",
      submission_status: status,
      provider_reference: providerReference,
    });
  })
);

module.exports = router;
