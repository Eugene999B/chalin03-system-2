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

function closeHour(env = process.env) {
  const value = Number(env.EXECUTIVE_BUSINESS_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR);
  return Number.isFinite(value) ? Math.min(23, Math.max(0, Math.floor(value))) : DEFAULT_CLOSE_HOUR;
}

function periodFor(type, date = new Date()) {
  if (type === "weekly") {
    const start = new Date(date);
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startText = start.toISOString().slice(0, 10);
    const endText = end.toISOString().slice(0, 10);
    return { start: startText, end: endText, key: `${startText}_${endText}` };
  }

  const year = date.getFullYear();
  const month = date.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDate = new Date(year, month + 1, 0);
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end, key: `${year}-${String(month + 1).padStart(2, "0")}` };
}

function isWeeklySendWindow(date = new Date(), env = process.env) {
  return date.getDay() === 6 && date.getHours() >= closeHour(env);
}

function isMonthEndSendWindow(date = new Date(), env = process.env) {
  const tomorrow = new Date(date);
  tomorrow.setDate(date.getDate() + 1);
  return tomorrow.getMonth() !== date.getMonth() && date.getHours() >= closeHour(env);
}

async function hasConfirmedClosing(dateText) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS closing_count,
            COALESCE(SUM(counted_confirmed = 1), 0) AS confirmed_count
     FROM daily_closings
     WHERE closing_date = ?`,
    [dateText]
  );
  const row = rows[0] || {};
  const closingCount = numeric(row.closing_count);
  const confirmedCount = numeric(row.confirmed_count);
  return {
    closing_count: closingCount,
    confirmed_count: confirmedCount,
    confirmed: closingCount > 0 && confirmedCount >= closingCount,
  };
}

async function ensureRules() {
  await pool.query(
    `INSERT INTO notification_rules
      (rule_code, rule_name, workspace_code, category, default_severity, target_role, target_permission, escalation_minutes, sms_allowed, is_enabled, description)
     VALUES
      (?, 'Weekly business intelligence', 'group', 'executive', 'high', 'admin', 'notifications.view', 60, TRUE, TRUE, 'Weekly business performance, cash, debt, operations and risk intelligence after Saturday closing.'),
      (?, 'Monthly business intelligence', 'group', 'executive', 'high', 'admin', 'notifications.view', 60, TRUE, TRUE, 'Monthly management intelligence after the final daily closing of the month.')
     ON DUPLICATE KEY UPDATE rule_name = VALUES(rule_name), description = VALUES(description)`,
    [WEEKLY_RULE, MONTHLY_RULE]
  );

  const [rows] = await pool.query(`SELECT * FROM notification_rules WHERE rule_code IN (?, ?)`, [WEEKLY_RULE, MONTHLY_RULE]);
  return {
    weekly: rows.find((row) => row.rule_code === WEEKLY_RULE),
    monthly: rows.find((row) => row.rule_code === MONTHLY_RULE),
  };
}

async function buildMetrics(start, end) {
  const [[sales], [expenses], [debts], [closings], [stock], [incidents], [hire]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS sale_count, COALESCE(SUM(total),0) AS sales_total,
              COALESCE(SUM(amount_paid),0) AS payments_received,
              COALESCE(SUM(balance),0) AS credit_created
       FROM sales
       WHERE DATE(created_at) BETWEEN ? AND ?
         AND is_voided = 0 AND sale_status = 'completed'`,
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
      `SELECT COUNT(*) AS closing_count,
              COALESCE(SUM(verification_status = 'verified'),0) AS verified_closings,
              COALESCE(SUM(counted_confirmed = 1 AND verification_status <> 'verified'),0) AS awaiting_verification,
              COALESCE(SUM(ABS(difference_total)),0) AS absolute_variance,
              COALESCE(SUM(difference_total < -0.009),0) AS shortage_count,
              COALESCE(SUM(ABS(difference_total) >= 0.01),0) AS variance_count,
              COALESCE(SUM(stale_after_close = 1),0) AS changed_after_close_count
       FROM daily_closings
       WHERE closing_date BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS low_stock_count
       FROM products WHERE is_active = TRUE AND quantity <= low_stock_threshold`
    ),
    pool.query(
      `SELECT COUNT(*) AS incident_count,
              COALESCE(SUM(LOWER(severity) IN ('critical','high','serious')),0) AS serious_incidents
       FROM mining_incidents
       WHERE DATE(incident_datetime) BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS hire_invoices,
              COALESCE(SUM(total_amount),0) AS hire_invoiced,
              COALESCE(SUM(amount_paid),0) AS hire_paid,
              COALESCE(SUM(balance),0) AS hire_balance
       FROM hire_invoices WHERE invoice_date BETWEEN ? AND ?`,
      [start, end]
    ),
  ]);

  const s = sales[0] || {};
  const e = expenses[0] || {};
  const d = debts[0] || {};
  const c = closings[0] || {};
  const st = stock[0] || {};
  const i = incidents[0] || {};
  const h = hire[0] || {};
  const salesTotal = numeric(s.sales_total);
  const expensesTotal = numeric(e.expenses_total);

  return {
    saleCount: numeric(s.sale_count),
    salesTotal,
    paymentsReceived: numeric(s.payments_received),
    creditCreated: numeric(s.credit_created),
    expenseCount: numeric(e.expense_count),
    expensesTotal,
    estimatedOperatingResult: salesTotal - expensesTotal,
    outstandingDebt: numeric(d.outstanding_debt),
    debtAccounts: numeric(d.debt_accounts),
    closingCount: numeric(c.closing_count),
    verifiedClosings: numeric(c.verified_closings),
    awaitingVerification: numeric(c.awaiting_verification),
    absoluteVariance: numeric(c.absolute_variance),
    shortageCount: numeric(c.shortage_count),
    varianceCount: numeric(c.variance_count),
    changedAfterCloseCount: numeric(c.changed_after_close_count),
    lowStockCount: numeric(st.low_stock_count),
    incidentCount: numeric(i.incident_count),
    seriousIncidents: numeric(i.serious_incidents),
    hireInvoices: numeric(h.hire_invoices),
    hireInvoiced: numeric(h.hire_invoiced),
    hirePaid: numeric(h.hire_paid),
    hireBalance: numeric(h.hire_balance),
  };
}

function adviceFor(metrics, type) {
  const advice = [];
  if (metrics.estimatedOperatingResult < 0) advice.push(`The period closed with an estimated operating shortfall of ${money(Math.abs(metrics.estimatedOperatingResult))}; management should review controllable expenses and pricing.`);
  else advice.push(`The period produced an estimated operating result of ${money(metrics.estimatedOperatingResult)} before cost-of-goods and other accounting adjustments.`);
  if (metrics.outstandingDebt > 0) advice.push(`Customer debt remains at ${money(metrics.outstandingDebt)} across ${metrics.debtAccounts} account(s); prioritize ageing and collection.`);
  if (metrics.absoluteVariance > 0) advice.push(`Daily Closing variance exposure is ${money(metrics.absoluteVariance)}; reconcile shortages and exceptions before the next cycle.`);
  if (metrics.awaitingVerification > 0) advice.push(`${metrics.awaitingVerification} closing record(s) are awaiting independent verification.`);
  if (metrics.lowStockCount > 0) advice.push(`${metrics.lowStockCount} product(s) require stock review or replenishment.`);
  if (metrics.seriousIncidents > 0) advice.push(`${metrics.seriousIncidents} serious/high Mining incident(s) were recorded; confirm corrective actions and closure.`);
  if (!advice.length) advice.push(type === "weekly" ? "Controls are stable. Maintain disciplined daily closing, independent verification and customer collection." : "The month closed without a major monitored exception. Maintain the current controls and continue independent review.");
  return advice.slice(0, 5);
}

function roleMessage(type, role, period, metrics) {
  const reportName = type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence";
  const label = type === "weekly" ? `${period.start} to ${period.end}` : period.start.slice(0, 7);
  const advice = adviceFor(metrics, type);

  if (role === "auditor") {
    return `Chalin 03 ${reportName} — ${label}. Audit focus: ${metrics.closingCount} daily closing record(s), ${metrics.awaitingVerification} awaiting verification, ${metrics.changedAfterCloseCount} changed after close, ${metrics.varianceCount} variance record(s), variance exposure ${money(metrics.absoluteVariance)}. Customer debt ${money(metrics.outstandingDebt)}. Serious/high Mining incidents: ${metrics.seriousIncidents}. Please review exceptions, supporting evidence and sign-offs. Management intelligence: ${advice.slice(0, 3).join(" ")}`;
  }

  if (role === "manager") {
    return `Chalin 03 ${reportName} — ${label}. Operations: sales ${money(metrics.salesTotal)} from ${metrics.saleCount} sale(s), expenses ${money(metrics.expensesTotal)}, estimated operating result ${money(metrics.estimatedOperatingResult)}, customer debt ${money(metrics.outstandingDebt)}, low stock ${metrics.lowStockCount}, Mining serious/high incidents ${metrics.seriousIncidents}, Equipment Hire invoiced ${money(metrics.hireInvoiced)} and unpaid hire balance ${money(metrics.hireBalance)}. Priority actions: ${advice.slice(0, 4).join(" ")}`;
  }

  return `Chalin 03 ${reportName} — ${label}. Business result: sales ${money(metrics.salesTotal)} from ${metrics.saleCount} sale(s); payments received ${money(metrics.paymentsReceived)}; expenses ${money(metrics.expensesTotal)}; estimated operating result ${money(metrics.estimatedOperatingResult)}; outstanding customer debt ${money(metrics.outstandingDebt)}. Daily Closing: ${metrics.verifiedClosings}/${metrics.closingCount} verified, ${metrics.awaitingVerification} awaiting verification, ${metrics.varianceCount} variance record(s), ${metrics.changedAfterCloseCount} changed after close. Stock: ${metrics.lowStockCount} low item(s). Mining: ${metrics.incidentCount} incident(s), ${metrics.seriousIncidents} serious/high. Equipment Hire: invoiced ${money(metrics.hireInvoiced)}, paid ${money(metrics.hirePaid)}, balance ${money(metrics.hireBalance)}. Management advice: ${advice.join(" ")}`;
}

async function sendRoleSms(notificationId, notificationKey, type, role, message) {
  const [users] = await pool.query(`SELECT id, phone FROM users WHERE is_active = TRUE AND role = ? AND phone IS NOT NULL AND phone <> ''`, [role]);
  for (const user of users) {
    const result = await sendSmsAlertToPhone({ branchId: 1, phone: user.phone, message, smsType: `${type}_business_intelligence`, sourceReference: notificationKey, sentBy: user.id });
    await pool.query(
      `INSERT INTO notification_escalations (notification_id, escalation_channel, status, destination_masked, provider_reference, response_message, attempted_by)
       VALUES (?, 'sms', ?, ?, ?, ?, ?)`,
      [notificationId, result?.status || (result?.ok ? 'submitted' : 'failed'), result?.phone ? `${String(result.phone).slice(0,7)}***` : null, result?.provider_message_id || null, result?.message || result?.error || null, user.id]
    );
  }
}

async function sendBusinessReport(type, { force = false, date = new Date() } = {}) {
  const rules = await ensureRules();
  const rule = type === "weekly" ? rules.weekly : rules.monthly;
  if (!rule || !Number(rule.is_enabled)) return { skipped: true, reason: "report_rule_disabled" };

  const period = periodFor(type, date);
  if (!force && type === "weekly") {
    if (!isWeeklySendWindow(date)) return { skipped: true, reason: "not_weekly_send_window" };
    const closing = await hasConfirmedClosing(period.end);
    if (!closing.confirmed) return { skipped: true, reason: "saturday_closing_not_confirmed", closing };
  }
  if (!force && type === "monthly") {
    if (!isMonthEndSendWindow(date)) return { skipped: true, reason: "not_month_end_send_window" };
    const closing = await hasConfirmedClosing(period.end);
    if (!closing.confirmed) return { skipped: true, reason: "month_end_closing_not_confirmed", closing };
  }

  const metrics = await buildMetrics(period.start, period.end);
  const notificationKey = `${type === "weekly" ? WEEKLY_RULE : MONTHLY_RULE}.${period.key}`;
  const [existing] = await pool.query(`SELECT id FROM notifications WHERE notification_key = ? LIMIT 1`, [notificationKey]);
  const roles = ["admin", "manager", "auditor"];
  const messages = Object.fromEntries(roles.map((role) => [role, roleMessage(type, role, period, metrics)]));

  let notificationId = existing[0]?.id || null;
  if (notificationId) {
    await pool.query(`UPDATE notifications SET title=?, message=?, metadata_json=?, updated_at=NOW() WHERE id=?`, [type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence", messages.admin, JSON.stringify({ type, period, metrics }), notificationId]);
  } else {
    const [insert] = await pool.query(
      `INSERT INTO notifications (notification_key, rule_id, rule_code, workspace_code, target_role, target_permission, category, notification_type, severity, title, message, action_path, source_type, source_reference, status, auto_generated, occurred_at, metadata_json)
       VALUES (?, ?, ?, 'group', 'admin', 'notifications.view', 'executive', ?, ?, ?, ?, '/group-executive-control', 'executive_business_report', ?, 'active', TRUE, NOW(), ?)`,
      [notificationKey, rule.id, rule.rule_code, `${type}_business_intelligence`, metrics.estimatedOperatingResult < 0 ? "high" : "medium", type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence", messages.admin, period.key, JSON.stringify({ type, period, metrics })]
    );
    notificationId = insert.insertId;
  }

  if (Number(rule.sms_allowed)) {
    for (const role of roles) await sendRoleSms(notificationId, notificationKey, type, role, messages[role]);
    await sendOwnerSmsAlert({ branchId: 1, message: messages.admin, smsType: `${type}_business_intelligence`, sourceReference: notificationKey });
  }

  return { skipped: false, type, period, metrics, messages, notification_id: notificationId };
}

async function runScheduledBusinessReports({ date = new Date(), logger = console } = {}) {
  const result = {};
  try { result.weekly = await sendBusinessReport("weekly", { date }); } catch (error) { logger.warn("Weekly business intelligence skipped:", error.message); result.weekly = { skipped: true, reason: error.message }; }
  try { result.monthly = await sendBusinessReport("monthly", { date }); } catch (error) { logger.warn("Monthly business intelligence skipped:", error.message); result.monthly = { skipped: true, reason: error.message }; }
  return result;
}

module.exports = { WEEKLY_RULE, MONTHLY_RULE, DEFAULT_CLOSE_HOUR, closeHour, isWeeklySendWindow, isMonthEndSendWindow, sendBusinessReport, runScheduledBusinessReports };
