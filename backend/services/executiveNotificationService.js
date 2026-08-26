const { pool } = require("../config/db");
const {
  sendOwnerSmsAlert,
  sendSmsAlertToPhone,
} = require("./smsAlertService");

const MANAGEMENT_RULE = "group.executive.management_attention";
const AUDIT_RULE = "group.executive.auditor_attention";
const AUDIT_DAYS = 7;

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function ensureExecutiveRules() {
  if (!(await tableExists("notification_rules"))) return null;

  await pool.query(
    `INSERT INTO notification_rules
      (rule_code, rule_name, workspace_code, category, default_severity,
       target_role, target_permission, escalation_minutes, sms_allowed, is_enabled, description)
     VALUES
      (?, 'Executive management attention', 'group', 'executive', 'high', 'admin', 'notifications.view', 60, TRUE, TRUE,
       'Daily management risk summary for administrators and the registered owner contact.'),
      (?, 'Auditor review attention', 'group', 'audit', 'high', 'auditor', 'accounting.audit', 1440, TRUE, TRUE,
       'Reminder when no recent audit sign-off has been recorded.')
     ON DUPLICATE KEY UPDATE
       rule_name = VALUES(rule_name),
       category = VALUES(category),
       description = VALUES(description)`,
    [MANAGEMENT_RULE, AUDIT_RULE]
  );

  const [rules] = await pool.query(
    `SELECT * FROM notification_rules
     WHERE rule_code IN (?, ?)
     ORDER BY FIELD(rule_code, ?, ?)`,
    [MANAGEMENT_RULE, AUDIT_RULE, MANAGEMENT_RULE, AUDIT_RULE]
  );

  return {
    management: rules.find((rule) => rule.rule_code === MANAGEMENT_RULE),
    audit: rules.find((rule) => rule.rule_code === AUDIT_RULE),
  };
}

async function upsertExecutiveNotification(rule, payload) {
  if (!rule || !(await tableExists("notifications"))) return null;

  const [result] = await pool.query(
    `INSERT INTO notifications (
      notification_key, rule_id, rule_code, workspace_code,
      target_role, target_permission, category, notification_type,
      severity, title, message, action_path, source_type, source_reference,
      status, auto_generated, occurred_at, metadata_json
    ) VALUES (?, ?, ?, 'group', ?, ?, ?, 'analysis', ?, ?, ?, ?, ?, ?,
              'active', TRUE, NOW(), ?)
    ON DUPLICATE KEY UPDATE
      rule_id = VALUES(rule_id),
      target_role = VALUES(target_role),
      target_permission = VALUES(target_permission),
      severity = VALUES(severity),
      title = VALUES(title),
      message = VALUES(message),
      action_path = VALUES(action_path),
      source_reference = VALUES(source_reference),
      status = 'active',
      metadata_json = VALUES(metadata_json),
      last_detected_at = NOW(),
      updated_at = NOW()`,
    [
      payload.notificationKey,
      rule.id,
      rule.rule_code,
      rule.target_role || null,
      rule.target_permission || null,
      payload.category,
      payload.severity || rule.default_severity || "high",
      payload.title,
      payload.message,
      payload.actionPath || "/notifications",
      payload.sourceType || "executive_analysis",
      payload.sourceReference || null,
      JSON.stringify(payload.metadata || {}),
    ]
  );

  if (!result.affectedRows && result.insertId === 0) return null;

  const [rows] = await pool.query(
    `SELECT * FROM notifications WHERE notification_key = ? LIMIT 1`,
    [payload.notificationKey]
  );
  return rows[0] || null;
}

async function shouldSendSms(notificationId) {
  if (!notificationId || !(await tableExists("notification_escalations"))) return true;
  const [rows] = await pool.query(
    `SELECT id FROM notification_escalations
     WHERE notification_id = ?
       AND escalation_channel = 'sms'
       AND attempted_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     LIMIT 1`,
    [notificationId]
  );
  return rows.length === 0;
}

async function recordSmsEscalation(notificationId, result, attemptedBy = null) {
  if (!notificationId || !(await tableExists("notification_escalations"))) return;
  await pool.query(
    `INSERT INTO notification_escalations
      (notification_id, escalation_channel, status, destination_masked,
       provider_reference, response_message, attempted_by)
     VALUES (?, 'sms', ?, ?, ?, ?, ?)`,
    [
      notificationId,
      result?.status || (result?.ok ? "submitted" : "failed"),
      result?.phone ? `${String(result.phone).slice(0, 7)}***` : null,
      result?.provider_message_id || null,
      result?.message || result?.error || null,
      attemptedBy,
    ]
  );
}

function daysSince(value) {
  if (!value) return Infinity;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Infinity;
  return Math.floor((Date.now() - time) / 86400000);
}

async function buildManagementSummary() {
  const [rows] = await pool.query(
    `SELECT severity, COUNT(*) AS total
     FROM notifications
     WHERE status = 'active'
       AND severity IN ('critical', 'high')
       AND last_detected_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     GROUP BY severity`
  );

  const counts = Object.fromEntries(rows.map((row) => [
    String(row.severity || "").toLowerCase(),
    Number(row.total || 0),
  ]));

  const [topRows] = await pool.query(
    `SELECT title, severity, message
     FROM notifications
     WHERE status = 'active'
       AND severity IN ('critical', 'high')
     ORDER BY FIELD(severity, 'critical', 'high'), last_detected_at DESC
     LIMIT 5`
  );

  return {
    critical: counts.critical || 0,
    high: counts.high || 0,
    topRows,
  };
}

async function buildAuditAttention() {
  if (!(await tableExists("audit_signoffs"))) {
    return { overdue: false, lastAudit: null, days: null };
  }

  let lastAudit = null;
  try {
    const [rows] = await pool.query(
      `SELECT MAX(review_date) AS last_audit FROM audit_signoffs`
    );
    lastAudit = rows[0]?.last_audit || null;
  } catch {
    try {
      const [rows] = await pool.query(
        `SELECT MAX(updated_at) AS last_audit FROM audit_signoffs`
      );
      lastAudit = rows[0]?.last_audit || null;
    } catch {
      lastAudit = null;
    }
  }

  const days = daysSince(lastAudit);
  return { overdue: days >= AUDIT_DAYS, lastAudit, days };
}

async function sendManagementSms(notification, rule) {
  if (!notification?.id || !rule?.sms_allowed) return;
  if (!(await shouldSendSms(notification.id))) return;

  const message = `Chalin 03 management summary: ${notification.message}`;
  const results = [];

  const ownerResult = await sendOwnerSmsAlert({
    branchId: 1,
    message,
    smsType: "management_intelligence",
    sourceReference: notification.notification_key,
  });
  results.push(ownerResult);

  if (await tableExists("users")) {
    const [admins] = await pool.query(
      `SELECT id, phone FROM users
       WHERE is_active = 1 AND role = 'admin' AND phone IS NOT NULL AND phone <> ''
       ORDER BY id ASC`
    );

    const ownerPhone = ownerResult?.phone || "";
    for (const admin of admins) {
      if (admin.phone === ownerPhone) continue;
      const result = await sendSmsAlertToPhone({
        branchId: 1,
        phone: admin.phone,
        message,
        smsType: "management_intelligence",
        sourceReference: notification.notification_key,
      });
      results.push(result);
    }
  }

  for (const result of results) {
    await recordSmsEscalation(notification.id, result);
  }
}

async function sendAuditSms(notification, rule) {
  if (!notification?.id || !rule?.sms_allowed) return;
  if (!(await shouldSendSms(notification.id))) return;
  if (!(await tableExists("users"))) return;

  const [auditors] = await pool.query(
    `SELECT id, phone FROM users
     WHERE is_active = 1 AND role = 'auditor' AND phone IS NOT NULL AND phone <> ''`
  );

  for (const auditor of auditors) {
    const result = await sendSmsAlertToPhone({
      branchId: 1,
      phone: auditor.phone,
      message: `Chalin 03 audit attention: ${notification.message}`,
      smsType: "audit_attention",
      sourceReference: notification.notification_key,
      sentBy: auditor.id,
    });
    await recordSmsEscalation(notification.id, result, auditor.id);
  }
}

async function runExecutiveNotificationSync({ logger = console } = {}) {
  try {
    const rules = await ensureExecutiveRules();
    if (!rules?.management || !rules?.audit) return { skipped: true, reason: "rules_unavailable" };

    const summary = await buildManagementSummary();
    const managementKey = `group.executive.management.${new Date().toISOString().slice(0, 10)}`;
    const managementMessage =
      `Last 24 hours: ${summary.critical} critical and ${summary.high} high-priority issues remain active.` +
      (summary.topRows.length
        ? ` Priority items: ${summary.topRows.slice(0, 3).map((row) => row.title).join("; ")}.`
        : " No critical/high exceptions are currently active.");

    const managementNotification = await upsertExecutiveNotification(rules.management, {
      notificationKey: managementKey,
      category: "executive",
      severity: summary.critical > 0 ? "critical" : summary.high > 0 ? "high" : "medium",
      title: "Daily management intelligence",
      message: managementMessage,
      actionPath: "/group-executive-control",
      metadata: {
        critical: summary.critical,
        high: summary.high,
        generated_at: new Date().toISOString(),
      },
    });

    if (managementNotification && (summary.critical > 0 || summary.high > 0)) {
      await sendManagementSms(managementNotification, rules.management);
    }

    const audit = await buildAuditAttention();
    if (audit.overdue) {
      const auditKey = `group.executive.audit.${new Date().toISOString().slice(0, 10)}`;
      const auditNotification = await upsertExecutiveNotification(rules.audit, {
        notificationKey: auditKey,
        category: "audit",
        severity: audit.days >= 14 ? "critical" : "high",
        title: "Audit review overdue",
        message: `No audit sign-off has been recorded for ${audit.days} days. The audit queue should be reviewed and a sign-off completed.`,
        actionPath: "/audit-accounting",
        metadata: { last_audit: audit.lastAudit, days_since_audit: audit.days },
      });
      await sendAuditSms(auditNotification, rules.audit);
    }

    return {
      skipped: false,
      management: { critical: summary.critical, high: summary.high },
      audit,
    };
  } catch (error) {
    logger.warn("Executive notification intelligence skipped:", error.message);
    return { skipped: true, reason: error.message };
  }
}

module.exports = {
  AUDIT_DAYS,
  runExecutiveNotificationSync,
};
