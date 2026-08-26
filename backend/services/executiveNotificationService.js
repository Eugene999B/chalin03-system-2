const { pool } = require("../config/db");

const MANAGEMENT_RULE = "group.executive.management_attention";
const AUDIT_RULE = "group.executive.auditor_attention";
const SPARE_STOCK_RULE = "spare_parts.low_stock";
const SPARE_DEBT_RULE = "spare_parts.overdue_debt";
const INSTALLMENT_DUE_RULE = "spare_parts.installment_due";
const INSTALLMENT_OVERDUE_RULE = "spare_parts.installment_overdue";
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
      (?, 'Management attention', 'spare_parts', 'management', 'high', 'admin', 'notifications.view', 0, FALSE, TRUE,
       'Silent management monitoring for important Spare Parts and Installment exceptions. No SMS is sent from background checks.'),
      (?, 'Auditor attention', 'spare_parts', 'audit', 'high', 'auditor', 'accounting.audit', 0, FALSE, TRUE,
       'Silent audit monitoring for important Spare Parts and Installment control exceptions. Weekly and monthly reports are the SMS channel.'),
      (?, 'Spare Parts low stock', 'spare_parts', 'stock', 'high', 'manager', 'notifications.view', 0, FALSE, TRUE,
       'Monitors critical stock levels without sending SMS during background checks.'),
      (?, 'Spare Parts overdue debt', 'spare_parts', 'debt', 'high', 'manager', 'notifications.view', 0, FALSE, TRUE,
       'Monitors overdue customer debt without sending SMS during background checks.'),
      (?, 'Installment payment due', 'spare_parts', 'installment', 'medium', 'manager', 'notifications.view', 0, FALSE, TRUE,
       'Monitors installment payments approaching or reaching their due date without background SMS.'),
      (?, 'Installment payment overdue', 'spare_parts', 'installment', 'high', 'admin', 'notifications.view', 0, FALSE, TRUE,
       'Monitors overdue installment schedules and arrears without background SMS.')
     ON DUPLICATE KEY UPDATE
       rule_name = VALUES(rule_name),
       workspace_code = VALUES(workspace_code),
       category = VALUES(category),
       target_role = VALUES(target_role),
       target_permission = VALUES(target_permission),
       description = VALUES(description),
       sms_allowed = FALSE`,
    [
      MANAGEMENT_RULE,
      AUDIT_RULE,
      SPARE_STOCK_RULE,
      SPARE_DEBT_RULE,
      INSTALLMENT_DUE_RULE,
      INSTALLMENT_OVERDUE_RULE,
    ]
  );

  const [rules] = await pool.query(
    `SELECT * FROM notification_rules
     WHERE rule_code IN (?, ?, ?, ?, ?, ?)
     ORDER BY id ASC`,
    [
      MANAGEMENT_RULE,
      AUDIT_RULE,
      SPARE_STOCK_RULE,
      SPARE_DEBT_RULE,
      INSTALLMENT_DUE_RULE,
      INSTALLMENT_OVERDUE_RULE,
    ]
  );

  return {
    management: rules.find((rule) => rule.rule_code === MANAGEMENT_RULE),
    audit: rules.find((rule) => rule.rule_code === AUDIT_RULE),
    stock: rules.find((rule) => rule.rule_code === SPARE_STOCK_RULE),
    debt: rules.find((rule) => rule.rule_code === SPARE_DEBT_RULE),
    installmentDue: rules.find((rule) => rule.rule_code === INSTALLMENT_DUE_RULE),
    installmentOverdue: rules.find((rule) => rule.rule_code === INSTALLMENT_OVERDUE_RULE),
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'analysis', ?, ?, ?, ?, ?, ?,
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
      rule.workspaceCode || rule.workspace_code || "spare_parts",
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
       AND workspace_code = 'spare_parts'
       AND severity IN ('critical', 'high')
       AND last_detected_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
     GROUP BY severity`
  );

  const counts = Object.fromEntries(
    rows.map((row) => [
      String(row.severity || "").toLowerCase(),
      Number(row.total || 0),
    ])
  );

  const [topRows] = await pool.query(
    `SELECT title, severity, message
     FROM notifications
     WHERE status = 'active'
       AND workspace_code = 'spare_parts'
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
    const [rows] = await pool.query(`SELECT MAX(review_date) AS last_audit FROM audit_signoffs`);
    lastAudit = rows[0]?.last_audit || null;
  } catch {
    try {
      const [rows] = await pool.query(`SELECT MAX(updated_at) AS last_audit FROM audit_signoffs`);
      lastAudit = rows[0]?.last_audit || null;
    } catch {
      lastAudit = null;
    }
  }

  const days = daysSince(lastAudit);
  return { overdue: days >= AUDIT_DAYS, lastAudit, days };
}

async function buildSparePartsAndInstallmentExceptions() {
  const results = [];
  const today = new Date().toISOString().slice(0, 10);

  if (await tableExists("products")) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(quantity * cost_price), 0) AS stock_cost_value
       FROM products
       WHERE is_active = TRUE
         AND quantity <= low_stock_threshold`
    );
    const total = Number(rows[0]?.total || 0);
    if (total > 0) {
      results.push({
        ruleCode: SPARE_STOCK_RULE,
        notificationKey: `spare_parts.low_stock.${today}`,
        title: "Spare Parts low stock",
        message: `${total} Spare Parts product(s) are at or below their configured replenishment level. Review the highest-risk items and replenish before stock-outs affect sales.`,
        severity: total >= 10 ? "high" : "medium",
        metadata: { low_stock_products: total, stock_cost_value: Number(rows[0]?.stock_cost_value || 0) },
      });
    }
  }

  if (await tableExists("debts")) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS overdue_accounts,
              COALESCE(SUM(balance), 0) AS overdue_balance
       FROM debts
       WHERE balance > 0
         AND due_date IS NOT NULL
         AND due_date < CURDATE()
         AND status <> 'paid'`
    );
    const total = Number(rows[0]?.overdue_accounts || 0);
    const balance = Number(rows[0]?.overdue_balance || 0);
    if (total > 0) {
      results.push({
        ruleCode: SPARE_DEBT_RULE,
        notificationKey: `spare_parts.overdue_debt.${today}`,
        title: "Overdue customer debt",
        message: `${total} customer debt account(s) are overdue with GHS ${balance.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} outstanding. Prioritise the oldest and highest-value balances for collection review.`,
        severity: balance >= 10000 || total >= 10 ? "high" : "medium",
        metadata: { overdue_accounts: total, overdue_balance: balance },
      });
    }
  }

  if (await tableExists("installment_schedule")) {
    const [dueRows] = await pool.query(
      `SELECT COUNT(*) AS due_count,
              COALESCE(SUM(GREATEST(scheduled_amount - amount_paid, 0)), 0) AS due_amount
       FROM installment_schedule
       WHERE due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
         AND schedule_status IN ('upcoming','due','partial')`
    );
    const dueCount = Number(dueRows[0]?.due_count || 0);
    if (dueCount > 0) {
      results.push({
        ruleCode: INSTALLMENT_DUE_RULE,
        notificationKey: `spare_parts.installment_due.${today}`,
        title: "Installment payments approaching",
        message: `${dueCount} installment payment(s) are due within the next 3 days, representing GHS ${Number(dueRows[0]?.due_amount || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Review collection readiness and customer contact details.`,
        severity: dueCount >= 10 ? "high" : "medium",
        metadata: { due_count: dueCount, due_amount: Number(dueRows[0]?.due_amount || 0) },
      });
    }

    const [overdueRows] = await pool.query(
      `SELECT COUNT(*) AS overdue_count,
              COALESCE(SUM(GREATEST(scheduled_amount + late_charge_amount - waived_charge_amount - amount_paid, 0)), 0) AS overdue_amount
       FROM installment_schedule
       WHERE due_date < CURDATE()
         AND schedule_status IN ('overdue','partial','due')`
    );
    const overdueCount = Number(overdueRows[0]?.overdue_count || 0);
    if (overdueCount > 0) {
      results.push({
        ruleCode: INSTALLMENT_OVERDUE_RULE,
        notificationKey: `spare_parts.installment_overdue.${today}`,
        title: "Installment arrears",
        message: `${overdueCount} installment schedule item(s) are overdue, with approximately GHS ${Number(overdueRows[0]?.overdue_amount || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} still due. Review arrears, promise-to-pay activity and escalation actions.`,
        severity: overdueCount >= 5 ? "high" : "medium",
        metadata: { overdue_count: overdueCount, overdue_amount: Number(overdueRows[0]?.overdue_amount || 0) },
      });
    }
  }

  return results;
}

async function runExecutiveNotificationSync({ logger = console } = {}) {
  try {
    const rules = await ensureExecutiveRules();
    if (!rules) return { skipped: true, reason: "rules_unavailable" };

    const created = [];
    const summary = await buildManagementSummary();
    const managementNotification = await upsertExecutiveNotification(rules.management, {
      notificationKey: `group.executive.management.${new Date().toISOString().slice(0, 10)}`,
      category: "management",
      severity: summary.critical > 0 ? "critical" : summary.high > 0 ? "high" : "medium",
      title: "Management attention",
      message:
        summary.topRows.length > 0
          ? `${summary.critical} critical and ${summary.high} high-priority Spare Parts/Installment exceptions are active. Priority: ${summary.topRows.slice(0, 3).map((row) => row.title).join("; ")}.`
          : "No critical or high-priority Spare Parts/Installment exception is currently active.",
      actionPath: "/notifications",
      metadata: { critical: summary.critical, high: summary.high },
    });
    if (managementNotification) created.push(managementNotification);

    const audit = await buildAuditAttention();
    if (audit.overdue) {
      const auditNotification = await upsertExecutiveNotification(rules.audit, {
        notificationKey: `group.executive.audit.${new Date().toISOString().slice(0, 10)}`,
        category: "audit",
        severity: audit.days >= 14 ? "critical" : "high",
        title: "Audit review overdue",
        message: `No audit sign-off has been recorded for ${audit.days} days. Review Spare Parts and Installment control evidence and complete the required sign-off.`,
        actionPath: "/audit-accounting",
        metadata: { last_audit: audit.lastAudit, days_since_audit: audit.days },
      });
      if (auditNotification) created.push(auditNotification);
    }

    const exceptions = await buildSparePartsAndInstallmentExceptions();
    for (const exception of exceptions) {
      const rule = rules[
        exception.ruleCode === SPARE_STOCK_RULE
          ? "stock"
          : exception.ruleCode === SPARE_DEBT_RULE
            ? "debt"
            : exception.ruleCode === INSTALLMENT_DUE_RULE
              ? "installmentDue"
              : "installmentOverdue"
      ];
      const notification = await upsertExecutiveNotification(rule, {
        notificationKey: exception.notificationKey,
        category: rule?.category || "operations",
        severity: exception.severity,
        title: exception.title,
        message: exception.message,
        actionPath: rule?.rule_code?.includes("installment") ? "/installments/active" : "/reports",
        metadata: exception.metadata,
      });
      if (notification) created.push(notification);
    }

    return {
      skipped: false,
      sms_sent: false,
      monitoring_mode: "silent",
      management: { critical: summary.critical, high: summary.high },
      audit,
      exception_count: exceptions.length,
      notifications: created.length,
    };
  } catch (error) {
    logger.warn("Executive notification intelligence skipped:", error.message);
    return { skipped: true, reason: error.message, sms_sent: false, monitoring_mode: "silent" };
  }
}

module.exports = {
  AUDIT_DAYS,
  runExecutiveNotificationSync,
};
