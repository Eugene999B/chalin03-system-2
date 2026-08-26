const { pool } = require("../config/db");
const { sendOwnerSmsAlert, sendSmsAlertToPhone } = require("./smsAlertService");

const REPORT_TYPES = {
  weekly: "weekly",
  monthly: "monthly",
};

const ROLE_RULES = {
  weekly: {
    admin: "spare_parts.executive.weekly.admin",
    manager: "spare_parts.executive.weekly.manager",
    auditor: "spare_parts.executive.weekly.auditor",
  },
  monthly: {
    admin: "spare_parts.executive.monthly.admin",
    manager: "spare_parts.executive.monthly.manager",
    auditor: "spare_parts.executive.monthly.auditor",
  },
};

const DEFAULT_CLOSE_HOUR = 20;

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `GHS ${numeric(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function closeHour(env = process.env) {
  const value = Number(env.EXECUTIVE_BUSINESS_CLOSE_HOUR ?? DEFAULT_CLOSE_HOUR);
  return Number.isFinite(value)
    ? Math.min(23, Math.max(0, Math.floor(value)))
    : DEFAULT_CLOSE_HOUR;
}

function periodFor(type, date = new Date()) {
  if (type === REPORT_TYPES.weekly) {
    const end = new Date(date);
    const mondayOffset = (end.getDay() + 6) % 7;
    end.setDate(end.getDate() - 0);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    if (end.getDay() !== 6) {
      start.setDate(end.getDate() - ((end.getDay() + 6) % 7));
      end.setDate(start.getDate() + 6);
    }
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

async function ensureReportRules() {
  await pool.query(
    `INSERT INTO notification_rules
      (rule_code, rule_name, workspace_code, category, default_severity,
       target_role, target_permission, escalation_minutes, sms_allowed, is_enabled, description)
     VALUES
      (?, 'Weekly intelligence — administrators / boss', 'spare_parts', 'executive_report', 'high', 'admin', 'notifications.view', 0, TRUE, TRUE, 'Detailed Saturday business intelligence for the owner and administrators.'),
      (?, 'Weekly intelligence — managers', 'spare_parts', 'executive_report', 'high', 'manager', 'notifications.view', 0, TRUE, TRUE, 'Operational Saturday business intelligence for managers.'),
      (?, 'Weekly intelligence — auditors', 'spare_parts', 'executive_report', 'high', 'auditor', 'accounting.audit', 0, TRUE, TRUE, 'Control and audit Saturday intelligence for auditors.'),
      (?, 'Monthly intelligence — administrators / boss', 'spare_parts', 'executive_report', 'high', 'admin', 'notifications.view', 0, TRUE, TRUE, 'Detailed month-end business intelligence for the owner and administrators.'),
      (?, 'Monthly intelligence — managers', 'spare_parts', 'executive_report', 'high', 'manager', 'notifications.view', 0, TRUE, TRUE, 'Operational month-end business intelligence for managers.'),
      (?, 'Monthly intelligence — auditors', 'spare_parts', 'executive_report', 'high', 'auditor', 'accounting.audit', 0, TRUE, TRUE, 'Control and audit month-end intelligence for auditors.')
     ON DUPLICATE KEY UPDATE
       rule_name = VALUES(rule_name),
       workspace_code = VALUES(workspace_code),
       category = VALUES(category),
       target_role = VALUES(target_role),
       target_permission = VALUES(target_permission),
       description = VALUES(description)`,
    [
      ROLE_RULES.weekly.admin,
      ROLE_RULES.weekly.manager,
      ROLE_RULES.weekly.auditor,
      ROLE_RULES.monthly.admin,
      ROLE_RULES.monthly.manager,
      ROLE_RULES.monthly.auditor,
    ]
  );

  const [rows] = await pool.query(
    `SELECT * FROM notification_rules
     WHERE rule_code IN (?, ?, ?, ?, ?, ?)
     ORDER BY id ASC`,
    [
      ROLE_RULES.weekly.admin,
      ROLE_RULES.weekly.manager,
      ROLE_RULES.weekly.auditor,
      ROLE_RULES.monthly.admin,
      ROLE_RULES.monthly.manager,
      ROLE_RULES.monthly.auditor,
    ]
  );
  return rows.reduce((result, row) => {
    result[row.rule_code] = row;
    return result;
  }, {});
}

async function buildMetrics(start, end) {
  const [
    [salesRows],
    [expenseRows],
    [debtRows],
    [stockRows],
    [closingRows],
    [installmentRows],
    [installmentPaymentRows],
    [customerRows],
    [previousSalesRows],
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(DISTINCT s.id) AS sale_count,
         COALESCE(SUM(s.total), 0) AS sales_total,
         COALESCE(SUM(s.amount_paid), 0) AS payments_received,
         COALESCE(SUM(s.balance), 0) AS credit_created,
         COALESCE(SUM(si.quantity * COALESCE(p.cost_price, 0)), 0) AS cost_of_goods
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE DATE(s.created_at) BETWEEN ? AND ?
         AND s.is_voided = 0
         AND s.sale_status = 'completed'`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS expense_count,
              COALESCE(SUM(amount), 0) AS expenses_total
       FROM expenses
       WHERE expense_date BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS overdue_accounts,
              COALESCE(SUM(balance), 0) AS outstanding_debt,
              COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdue_debt
       FROM debts
       WHERE balance > 0
         AND status <> 'paid'`
    ),
    pool.query(
      `SELECT COUNT(*) AS low_stock_count,
              COALESCE(SUM(quantity * cost_price), 0) AS stock_cost_value,
              COALESCE(SUM(quantity * selling_price), 0) AS stock_selling_value
       FROM products
       WHERE is_active = TRUE`
    ),
    pool.query(
      `SELECT COUNT(*) AS closing_count,
              COALESCE(SUM(verification_status = 'verified'), 0) AS verified_closings,
              COALESCE(SUM(ABS(difference_total)), 0) AS variance_exposure,
              COALESCE(SUM(difference_total < -0.009), 0) AS shortage_count,
              COALESCE(SUM(stale_after_close = 1), 0) AS changed_after_close_count
       FROM daily_closings
       WHERE closing_date BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS agreement_count,
              COALESCE(SUM(sale_total), 0) AS agreement_sales,
              COALESCE(SUM(deposit_amount), 0) AS deposits,
              COALESCE(SUM(amount_paid), 0) AS amount_paid,
              COALESCE(SUM(outstanding_balance), 0) AS outstanding_installment_balance,
              COALESCE(SUM(overdue_amount), 0) AS overdue_installment_amount,
              COALESCE(SUM(agreement_status IN ('overdue','defaulted')), 0) AS arrears_agreements,
              COALESCE(SUM(agreement_status = 'completed'), 0) AS completed_agreements
       FROM installment_agreements
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS payment_count,
              COALESCE(SUM(amount), 0) AS payment_total
       FROM installment_payments
       WHERE DATE(paid_at) BETWEEN ? AND ?
         AND is_voided = FALSE`,
      [start, end]
    ),
    pool.query(
      `SELECT COUNT(*) AS new_customers
       FROM customers
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [start, end]
    ),
    pool.query(
      `SELECT COALESCE(SUM(total), 0) AS previous_sales
       FROM sales
       WHERE DATE(created_at) BETWEEN DATE_SUB(?, INTERVAL DATEDIFF(?, ?) + 1 DAY) AND DATE_SUB(?, INTERVAL 1 DAY)
         AND is_voided = 0
         AND sale_status = 'completed'`,
      [start, start, end, start]
    ),
  ]);

  const sales = salesRows[0] || {};
  const expenses = expenseRows[0] || {};
  const debts = debtRows[0] || {};
  const stock = stockRows[0] || {};
  const closings = closingRows[0] || {};
  const installments = installmentRows[0] || {};
  const installmentPayments = installmentPaymentRows[0] || {};
  const customers = customerRows[0] || {};
  const previous = previousSalesRows[0] || {};

  const salesTotal = numeric(sales.sales_total);
  const cogs = numeric(sales.cost_of_goods);
  const grossProfit = salesTotal - cogs;
  const expensesTotal = numeric(expenses.expenses_total);
  const operatingResult = grossProfit - expensesTotal;
  const previousSales = numeric(previous.previous_sales);
  const salesChangePct = previousSales > 0 ? ((salesTotal - previousSales) / previousSales) * 100 : null;

  return {
    saleCount: numeric(sales.sale_count),
    salesTotal,
    paymentsReceived: numeric(sales.payments_received),
    creditCreated: numeric(sales.credit_created),
    costOfGoods: cogs,
    grossProfit,
    grossMarginPct: salesTotal > 0 ? (grossProfit / salesTotal) * 100 : 0,
    expenseCount: numeric(expenses.expense_count),
    expensesTotal,
    operatingResult,
    outstandingDebt: numeric(debts.outstanding_debt),
    overdueDebt: numeric(debts.overdue_debt),
    overdueDebtAccounts: numeric(debts.overdue_accounts),
    lowStockCount: numeric(stock.low_stock_count),
    stockCostValue: numeric(stock.stock_cost_value),
    stockSellingValue: numeric(stock.stock_selling_value),
    closingCount: numeric(closings.closing_count),
    verifiedClosings: numeric(closings.verified_closings),
    varianceExposure: numeric(closings.variance_exposure),
    shortageCount: numeric(closings.shortage_count),
    changedAfterCloseCount: numeric(closings.changed_after_close_count),
    installmentAgreementCount: numeric(installments.agreement_count),
    installmentSales: numeric(installments.agreement_sales),
    installmentDeposits: numeric(installments.deposits),
    installmentAmountPaid: numeric(installments.amount_paid),
    installmentOutstanding: numeric(installments.outstanding_installment_balance),
    installmentOverdue: numeric(installments.overdue_installment_amount),
    installmentArrearsAgreements: numeric(installments.arrears_agreements),
    installmentCompleted: numeric(installments.completed_agreements),
    installmentPaymentCount: numeric(installmentPayments.payment_count),
    installmentPaymentTotal: numeric(installmentPayments.payment_total),
    newCustomers: numeric(customers.new_customers),
    salesChangePct,
  };
}

function adviceFor(m, type) {
  const advice = [];
  if (m.grossMarginPct < 20 && m.salesTotal > 0) advice.push(`Gross margin is ${m.grossMarginPct.toFixed(1)}%; review discounting and cost-sensitive fast movers.`);
  if (m.overdueDebt > 0) advice.push(`${money(m.overdueDebt)} of customer debt is overdue across ${m.overdueDebtAccounts} account(s); prioritise ageing and collection.`);
  if (m.lowStockCount > 0) advice.push(`${m.lowStockCount} active product(s) need replenishment review before stock-outs affect sales.`);
  if (m.installmentOverdue > 0) advice.push(`${money(m.installmentOverdue)} of installment obligations are overdue; review arrears, customer contact and recovery actions.`);
  if (m.varianceExposure > 0) advice.push(`${money(m.varianceExposure)} of Daily Closing variance exposure was recorded; reconcile every exception.`);
  if (m.salesChangePct !== null) advice.push(`Sales are ${Math.abs(m.salesChangePct).toFixed(1)}% ${m.salesChangePct >= 0 ? "higher" : "lower"} than the preceding comparable period.`);
  if (!advice.length) advice.push(type === "weekly" ? "No major monitored exception requires immediate management intervention." : "The month is within the monitored control range; maintain collection, stock and closing discipline.");
  return advice.slice(0, 5);
}

function bossMessage(type, period, m) {
  const advice = adviceFor(m, type);
  const label = type === "weekly" ? `${period.start} to ${period.end}` : period.key;
  return `Chalin 03 ${type === "weekly" ? "Weekly" : "Monthly"} Business Intelligence — ${label}. Sales ${money(m.salesTotal)} from ${m.saleCount} sale(s); payments received ${money(m.paymentsReceived)}; cost of goods ${money(m.costOfGoods)}; gross profit ${money(m.grossProfit)} (${m.grossMarginPct.toFixed(1)}% margin); operating expenses ${money(m.expensesTotal)}; estimated operating result ${money(m.operatingResult)}. Customer debt ${money(m.outstandingDebt)}, overdue ${money(m.overdueDebt)}. Spare Parts low stock ${m.lowStockCount}; stock cost value ${money(m.stockCostValue)}. Installment agreements ${m.installmentAgreementCount}; installment payments ${money(m.installmentPaymentTotal)}; installment outstanding ${money(m.installmentOutstanding)}; overdue installments ${money(m.installmentOverdue)}. Daily Closing: ${m.verifiedClosings}/${m.closingCount} verified, variance exposure ${money(m.varianceExposure)}, changed-after-close ${m.changedAfterCloseCount}. Management priorities: ${advice.join(" ")}`;
}

function managerMessage(type, period, m) {
  const advice = adviceFor(m, type);
  const label = type === "weekly" ? `${period.start} to ${period.end}` : period.key;
  return `Chalin 03 ${type === "weekly" ? "Weekly" : "Monthly"} Manager Intelligence — ${label}. Sales ${money(m.salesTotal)}; gross profit ${money(m.grossProfit)}; expenses ${money(m.expensesTotal)}. Low-stock items ${m.lowStockCount}. Overdue customer debt ${money(m.overdueDebt)}. Installment arrears ${money(m.installmentOverdue)} across ${m.installmentArrearsAgreements} agreement(s). Payments collected on installments ${money(m.installmentPaymentTotal)}. Closing variance exposure ${money(m.varianceExposure)}. Actions: ${advice.join(" ")}`;
}

function auditorMessage(type, period, m) {
  const label = type === "weekly" ? `${period.start} to ${period.end}` : period.key;
  return `Chalin 03 ${type === "weekly" ? "Weekly" : "Monthly"} Audit Intelligence — ${label}. Daily Closings ${m.closingCount}; verified ${m.verifiedClosings}; variance exposure ${money(m.varianceExposure)}; shortage records ${m.shortageCount}; changed-after-close ${m.changedAfterCloseCount}. Customer debt outstanding ${money(m.outstandingDebt)}, overdue ${money(m.overdueDebt)}. Installment agreements created ${m.installmentAgreementCount}; installment payments ${money(m.installmentPaymentTotal)}; installment arrears ${money(m.installmentOverdue)}. Review supporting evidence, payment allocations, overdue accounts and all unverified cash-control exceptions.`;
}

function messageForRole(role, type, period, metrics) {
  if (role === "manager") return managerMessage(type, period, metrics);
  if (role === "auditor") return auditorMessage(type, period, metrics);
  return bossMessage(type, period, metrics);
}

async function hasConfirmedClosing(endDate) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS closing_count,
            SUM(CASE WHEN counted_confirmed = 1 THEN 1 ELSE 0 END) AS confirmed_count
     FROM daily_closings
     WHERE closing_date = ?`,
    [endDate]
  );
  const closingCount = Number(rows[0]?.closing_count || 0);
  const confirmedCount = Number(rows[0]?.confirmed_count || 0);
  return closingCount > 0 && confirmedCount > 0;
}

async function upsertReportNotification(rule, period, type, message) {
  const notificationKey = `${rule.rule_code}.${period.key}`;
  const [result] = await pool.query(
    `INSERT INTO notifications (
      notification_key, rule_id, rule_code, workspace_code, target_role,
      target_permission, category, notification_type, severity, title, message,
      action_path, source_type, source_reference, status, auto_generated,
      occurred_at, metadata_json
    ) VALUES (?, ?, ?, 'spare_parts', ?, ?, 'executive_report', 'business_intelligence', 'high', ?, ?, '/group-executive-control', 'business_intelligence', ?, 'active', TRUE, NOW(), ?)
    ON DUPLICATE KEY UPDATE
      message = VALUES(message),
      status = 'active',
      metadata_json = VALUES(metadata_json),
      last_detected_at = NOW(),
      updated_at = NOW()`,
    [
      notificationKey,
      rule.id,
      rule.rule_code,
      rule.target_role,
      rule.target_permission,
      type === REPORT_TYPES.weekly ? "Weekly Business Intelligence" : "Monthly Business Intelligence",
      message,
      period.key,
      JSON.stringify({ period, report_type: type, role: rule.target_role }),
    ]
  );

  const [rows] = await pool.query(
    `SELECT id, notification_key FROM notifications WHERE notification_key = ? LIMIT 1`,
    [notificationKey]
  );

  return rows[0] || { id: result.insertId, notification_key: notificationKey };
}

async function sendRoleSms(rule, notification, message, role) {
  if (!rule || !Number(rule.is_enabled) || !Number(rule.sms_allowed)) return { sent: 0 };
  const results = [];

  if (role === "admin") {
    const owner = await sendOwnerSmsAlert({
      branchId: 1,
      message,
      smsType: "business_intelligence",
      sourceReference: notification.notification_key,
    });
    results.push(owner);

    const [admins] = await pool.query(
      `SELECT id, phone FROM users WHERE is_active = TRUE AND role = 'admin' AND phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id`
    );
    const ownerPhone = String(owner?.phone || "");
    for (const admin of admins) {
      if (String(admin.phone) === ownerPhone) continue;
      results.push(await sendSmsAlertToPhone({
        branchId: 1,
        phone: admin.phone,
        message,
        smsType: "business_intelligence",
        sourceReference: notification.notification_key,
        sentBy: admin.id,
      }));
    }
  } else {
    const [users] = await pool.query(
      `SELECT id, phone FROM users WHERE is_active = TRUE AND role = ? AND phone IS NOT NULL AND TRIM(phone) <> '' ORDER BY id`,
      [role]
    );
    for (const user of users) {
      results.push(await sendSmsAlertToPhone({
        branchId: 1,
        phone: user.phone,
        message,
        smsType: "business_intelligence",
        sourceReference: notification.notification_key,
        sentBy: user.id,
      }));
    }
  }

  return { sent: results.filter((result) => result?.status === "accepted" || result?.status === "delivered" || result?.ok).length };
}

async function sendBusinessReport(type, { force = false, date = new Date() } = {}) {
  if (!Object.values(REPORT_TYPES).includes(type)) throw new Error("Unknown business report type.");
  const period = periodFor(type, date);

  if (!force) {
    if (type === REPORT_TYPES.weekly && !isWeeklySendWindow(date)) return { skipped: true, reason: "not_weekly_send_window", type, period };
    if (type === REPORT_TYPES.monthly && !isMonthEndSendWindow(date)) return { skipped: true, reason: "not_month_end_send_window", type, period };
    if (!(await hasConfirmedClosing(period.end))) return { skipped: true, reason: "period_closing_not_confirmed", type, period };
  }

  const rules = await ensureReportRules();
  const metrics = await buildMetrics(period.start, period.end);
  const roles = ["admin", "manager", "auditor"];
  const messages = {};
  const results = {};

  for (const role of roles) {
    const ruleCode = ROLE_RULES[type][role];
    const rule = rules[ruleCode];
    if (!rule) continue;
    const message = messageForRole(role, type, period, metrics);
    messages[role] = message;
    const notification = await upsertReportNotification(rule, period, type, message);
    if (Number(rule.is_enabled) && Number(rule.sms_allowed)) {
      results[role] = await sendRoleSms(rule, notification, message, role);
    } else {
      results[role] = { sent: 0, disabled: true };
    }
  }

  return { skipped: false, type, period, metrics, messages, results };
}

async function runScheduledBusinessReports({ date = new Date(), logger = console } = {}) {
  const result = {};
  try {
    result.weekly = await sendBusinessReport(REPORT_TYPES.weekly, { date });
  } catch (error) {
    logger.warn("Weekly business intelligence skipped:", error.message);
    result.weekly = { skipped: true, reason: error.message };
  }
  try {
    result.monthly = await sendBusinessReport(REPORT_TYPES.monthly, { date });
  } catch (error) {
    logger.warn("Monthly business intelligence skipped:", error.message);
    result.monthly = { skipped: true, reason: error.message };
  }
  return result;
}

module.exports = {
  REPORT_TYPES,
  ROLE_RULES,
  DEFAULT_CLOSE_HOUR,
  closeHour,
  isWeeklySendWindow,
  isMonthEndSendWindow,
  ensureReportRules,
  sendBusinessReport,
  runScheduledBusinessReports,
};
