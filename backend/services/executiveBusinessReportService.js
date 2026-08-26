const { pool } = require("../config/db");
const { sendOwnerSmsAlert, sendSmsAlertToPhone } = require("./smsAlertService");

const WEEKLY_RULE = "group.executive.weekly_business_intelligence";
const MONTHLY_RULE = "group.executive.monthly_business_intelligence";
const DEFAULT_CLOSE_HOUR = 20;

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `GHS ${numeric(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentPeriod(type, date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (type === "weekly") {
    const copy = new Date(date);
    const daysSinceMonday = (copy.getDay() + 6) % 7;
    copy.setDate(copy.getDate() - daysSinceMonday);
    const start = copy.toISOString().slice(0, 10);
    const end = new Date(copy);
    end.setDate(end.getDate() + 6);
    return { start, end: end.toISOString().slice(0, 10), key: `${start}_${end.toISOString().slice(0, 10)}` };
  }

  const start = `${year}-${month}-01`;
  const endDate = new Date(year, date.getMonth() + 1, 0);
  const end = `${year}-${month}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end, key: `${year}-${month}` };
}

function configuredCloseHour(env = process.env) {
  const value = Number(env.EXECUTIVE_BUSINESS_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR);
  return Number.isFinite(value) ? Math.min(23, Math.max(0, Math.floor(value))) : DEFAULT_CLOSE_HOUR;
}

function isWeeklySendWindow(date = new Date(), env = process.env) {
  return date.getDay() === 6 && date.getHours() >= configuredCloseHour(env);
}

function isMonthEndSendWindow(date = new Date(), env = process.env) {
  const tomorrow = new Date(date);
  tomorrow.setDate(date.getDate() + 1);
  return tomorrow.getMonth() !== date.getMonth() && date.getHours() >= configuredCloseHour(env);
}

async function ensureRules() {
  await pool.query(
    `INSERT INTO notification_rules
      (rule_code, rule_name, workspace_code, category, default_severity, target_role, target_permission, escalation_minutes, sms_allowed, is_enabled, description)
     VALUES
      (?, 'Weekly business intelligence', 'group', 'executive', 'high', 'admin', 'notifications.view', 60, TRUE, TRUE, 'Weekly business performance, cash, debt, operations and risk intelligence sent after Saturday closing.'),
      (?, 'Monthly business intelligence', 'group', 'executive', 'high', 'admin', 'notifications.view', 60, TRUE, TRUE, 'Month-end business performance and management intelligence sent after the final daily closing of the month.')
     ON DUPLICATE KEY UPDATE rule_name = VALUES(rule_name), description = VALUES(description)`,
    [WEEKLY_RULE, MONTHLY_RULE]
  );

  const [rows] = await pool.query(
    `SELECT * FROM notification_rules WHERE rule_code IN (?, ?)`,
    [WEEKLY_RULE, MONTHLY_RULE]
  );
  return {
    weekly: rows.find((row) => row.rule_code === WEEKLY_RULE),
    monthly: rows.find((row) => row.rule_code === MONTHLY_RULE),
  };
}

async function buildBusinessMetrics(start, end) {
  const [[sales], [expenses], [debt], [dailyClosing], [lowStock], [incidents]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS sales_count,
              COALESCE(SUM(total),0) AS sales_total,
              COALESCE(SUM(amount_paid),0) AS payments_received,
              COALESCE(SUM(balance),0) AS new_sales_balance
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND is_voided = 0
         AND sale_status = 'completed'`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount),0) AS expenses_total
       FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS debt_accounts, COALESCE(SUM(balance),0) AS outstanding_debt
       FROM debts WHERE balance > 0 AND status <> 'paid'`
    ),
    pool.query(
      `SELECT COUNT(*) AS closings,
              COALESCE(SUM(CASE WHEN status IN ('submitted','verified','approved','closed') THEN 1 ELSE 0 END),0) AS completed_closings,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(verification_status,'')) IN ('pending','awaiting','unverified') THEN 1 ELSE 0 END),0) AS awaiting_verification,
              COALESCE(SUM(ABS(COALESCE(variance,0))),0) AS absolute_variance
       FROM daily_closings
       WHERE closing_date BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS low_stock_count FROM products
       WHERE is_active = TRUE AND quantity <= low_stock_threshold`
    ),
    pool.query(
      `SELECT COALESCE(SUM(CASE WHEN LOWER(severity) IN ('critical','high','serious') THEN 1 ELSE 0 END),0) AS serious_incidents,
              COUNT(*) AS incidents
       FROM mining_incidents
       WHERE DATE(incident_datetime) BETWEEN ? AND ?`,
      [start, end]
    ),
  ]);

  const salesRow = sales[0] || {};
  const expenseRow = expenses[0] || {};
  const debtRow = debt[0] || {};
  const closingRow = dailyClosing[0] || {};
  const stockRow = lowStock[0] || {};
  const incidentRow = incidents[0] || {};

  const salesTotal = numeric(salesRow.sales_total);
  const expensesTotal = numeric(expenseRow.expenses_total);

  return {
    salesCount: numeric(salesRow.sales_count),
    salesTotal,
    paymentsReceived: numeric(salesRow.payments_received),
    expensesTotal,
    estimatedOperatingResult: salesTotal - expensesTotal,
    outstandingDebt: numeric(debtRow.outstanding_debt),
    debtAccounts: numeric(debtRow.debt_accounts),
    closings: numeric(closingRow.closings),
    completedClosings: numeric(closingRow.completed_closings),
    awaitingVerification: numeric(closingRow.awaiting_verification),
    absoluteVariance: numeric(closingRow.absolute_variance),
    lowStockCount: numeric(stockRow.low_stock_count),
    seriousIncidents: numeric(incidentRow.serious_incidents),
    incidents: numeric(incidentRow.incidents),
  };
}

function buildAdvice(metrics, type) {
  const advice = [];
  if (metrics.estimatedOperatingResult < 0) advice.push("Operating result is negative for this period; review expenses and low-margin sales before the next period.");
  if (metrics.outstandingDebt > 0) advice.push(`Outstanding customer debt is ${money(metrics.outstandingDebt)}; strengthen collection follow-up and ageing review.`);
  if (metrics.absoluteVariance > 0) advice.push(`Daily Closing variances total ${money(metrics.absoluteVariance)} in absolute value; reconcile exceptions before the next reporting cycle.`);
  if (metrics.awaitingVerification > 0) advice.push(`${metrics.awaitingVerification} closing record(s) still need independent verification.`);
  if (metrics.lowStockCount > 0) advice.push(`${metrics.lowStockCount} product(s) are at or below restock level; review purchasing priorities.`);
  if (metrics.seriousIncidents > 0) advice.push(`${metrics.seriousIncidents} serious/high Mining incident(s) occurred during the period; confirm corrective actions and closure.`);
  if (!advice.length) advice.push(type === "weekly" ? "Controls are stable. Keep daily closing, approval and customer collection discipline consistent." : "The period closed without a major exception in the monitored control set. Maintain the current controls and continue independent review.");
  return advice.slice(0, 5);
}

function buildMessage(type, period, metrics, recipientLabel) {
  const title = type === "weekly" ? "Chalin 03 Weekly Business Intelligence" : "Chalin 03 Monthly Business Intelligence";
  const periodLabel = type === "weekly" ? `${period.start} to ${period.end}` : `${period.start.slice(0,7)}`;
  const advice = buildAdvice(metrics, type);
  const resultLabel = metrics.estimatedOperatingResult >= 0 ? "estimated operating surplus" : "estimated operating shortfall";
  return {
    title,
    message:
      `${recipientLabel}: ${title} for ${periodLabel}. ` +
      `Sales ${money(metrics.salesTotal)} across ${metrics.salesCount} sale(s); payments received ${money(metrics.paymentsReceived)}; expenses ${money(metrics.expensesTotal)}; ${resultLabel} ${money(Math.abs(metrics.estimatedOperatingResult))}; outstanding debt ${money(metrics.outstandingDebt)}. ` +
      `Daily closing: ${metrics.completedClosings}/${metrics.closings} completed, ${metrics.awaitingVerification} awaiting verification, variance exposure ${money(metrics.absoluteVariance)}. ` +
      `Operations: ${metrics.lowStockCount} low-stock product(s), ${metrics.incidents} Mining incident(s) including ${metrics.seriousIncidents} serious/high. ` +
      `Management advice: ${advice.join(" ")}`,
    advice,
  };
}

async function sendToRoles(notification, rule, roles) {
  if (!rule?.sms_allowed) return;
  const [users] = await pool.query(
    `SELECT id, role, phone FROM users WHERE is_active = TRUE AND phone IS NOT NULL AND phone <> '' AND role IN (${roles.map(() => '?').join(',')})`,
    roles
  );
  for (const user of users) {
    const result = await sendSmsAlertToPhone({
      branchId: 1,
      phone: user.phone,
      message: notification.message,
      smsType: notification.type,
      sourceReference: notification.notification_key,
      sentBy: user.id,
    });
    await pool.query(
      `INSERT INTO notification_escalations
        (notification_id, escalation_channel, status, destination_masked, provider_reference, response_message, attempted_by)
       VALUES (?, 'sms', ?, ?, ?, ?, ?)`,
      [notification.id, result?.status || (result?.ok ? 'submitted' : 'failed'), result?.phone ? `${String(result.phone).slice(0,7)}***` : null, result?.provider_message_id || null, result?.message || result?.error || null, user.id]
    );
  }
}

async function sendBusinessReport(type, { force = false, date = new Date() } = {}) {
  const rules = await ensureRules();
  const rule = type === 'weekly' ? rules.weekly : rules.monthly;
  if (!rule || !Number(rule.is_enabled)) return { skipped: true, reason: 'report_rule_disabled' };

  if (!force) {
    if (type === 'weekly' && !isWeeklySendWindow(date)) return { skipped: true, reason: 'not_weekly_send_window' };
    if (type === 'monthly' && !isMonthEndSendWindow(date)) return { skipped: true, reason: 'not_month_end_send_window' };
  }

  const period = currentPeriod(type, date);
  const metrics = await buildBusinessMetrics(period.start, period.end);
  const notificationKey = `${type === 'weekly' ? WEEKLY_RULE : MONTHLY_RULE}.${period.key}`;
  const [existing] = await pool.query(`SELECT id FROM notifications WHERE notification_key = ? LIMIT 1`, [notificationKey]);
  if (existing.length && !force) return { skipped: true, reason: 'already_sent', notification_id: existing[0].id, period };

  const recipientRoles = type === 'weekly' ? ['admin','manager','auditor'] : ['admin','manager','auditor'];
  const message = buildMessage(type, period, metrics, 'Management');

  let notificationId = existing[0]?.id;
  if (notificationId) {
    await pool.query(`UPDATE notifications SET title=?, message=?, status='active', metadata_json=?, updated_at=NOW() WHERE id=?`, [message.title, message.message, JSON.stringify({ type, period, metrics, advice: message.advice }), notificationId]);
  } else {
    const [insert] = await pool.query(
      `INSERT INTO notifications (notification_key, rule_id, rule_code, workspace_code, target_role, target_permission, category, notification_type, severity, title, message, action_path, source_type, source_reference, status, auto_generated, occurred_at, metadata_json)
       VALUES (?, ?, ?, 'group', 'admin', 'notifications.view', 'executive', ?, ?, ?, ?, '/group-executive-control', 'executive_business_report', ?, 'active', TRUE, NOW(), ?)`,
      [notificationKey, rule.id, rule.rule_code, type === 'weekly' ? 'weekly_business_intelligence' : 'monthly_business_intelligence', metrics.estimatedOperatingResult < 0 ? 'high' : 'medium', message.title, message.message, period.key, JSON.stringify({ type, period, metrics, advice: message.advice })]
    );
    notificationId = insert.insertId;
  }

  await sendToRoles({ id: notificationId, notification_key: notificationKey, message: message.message, type: type === 'weekly' ? 'weekly_business_intelligence' : 'monthly_business_intelligence' }, rule, recipientRoles);

  const ownerMessage = `${message.title}: ${message.message}`;
  if (rule.sms_allowed) {
    await sendOwnerSmsAlert({ branchId: 1, message: ownerMessage, smsType: type === 'weekly' ? 'weekly_business_intelligence' : 'monthly_business_intelligence', sourceReference: notificationKey });
  }

  return { skipped: false, type, period, metrics, advice: message.advice, notification_id: notificationId };
}

async function runScheduledBusinessReports({ date = new Date(), logger = console } = {}) {
  const results = {};
  try { results.weekly = await sendBusinessReport('weekly', { date }); } catch (error) { logger.warn('Weekly business intelligence skipped:', error.message); results.weekly = { skipped: true, reason: error.message }; }
  try { results.monthly = await sendBusinessReport('monthly', { date }); } catch (error) { logger.warn('Monthly business intelligence skipped:', error.message); results.monthly = { skipped: true, reason: error.message }; }
  return results;
}

module.exports = { WEEKLY_RULE, MONTHLY_RULE, DEFAULT_CLOSE_HOUR, configuredCloseHour, isWeeklySendWindow, isMonthEndSendWindow, sendBusinessReport, runScheduledBusinessReports };
