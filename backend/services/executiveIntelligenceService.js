const { pool } = require("../config/db");
const { getInstallmentPortfolio } = require("./equipmentInstallmentReadModelService");
const { sendSmsAlertToPhone } = require("./smsAlertService");

const ALLOWED_ROLES = ["admin", "manager", "auditor"];
const DEFAULT_RANGE_DAYS = 30;
const MAX_RECIPIENTS = 50;

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `GHS ${number(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function rangeDates(from, to) {
  const end = dateOnly(to) || new Date().toISOString().slice(0, 10);
  const suppliedStart = dateOnly(from);
  if (suppliedStart && suppliedStart <= end) return { from: suppliedStart, to: end };
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - DEFAULT_RANGE_DAYS + 1);
  return { from: start.toISOString().slice(0, 10), to: end };
}

function cleanArray(values, mapper = (value) => value) {
  return [...new Set((Array.isArray(values) ? values : []).map(mapper).filter(Boolean))];
}

async function tableColumns(tableName) {
  const [rows] = await pool.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tableName]);
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function tableExists(tableName) {
  const [rows] = await pool.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`, [tableName]);
  return rows.length > 0;
}

async function loadSparePartsIntelligence(from, to) {
  const [salesRows, expenseRows, productRows, debtRows] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(CASE WHEN is_voided = 0 AND sale_status = 'completed' THEN 1 END) AS sales_count,
         COALESCE(SUM(CASE WHEN is_voided = 0 AND sale_status = 'completed' THEN total ELSE 0 END),0) AS sales_total,
         COALESCE(SUM(CASE WHEN is_voided = 0 AND sale_status = 'completed' THEN amount_paid ELSE 0 END),0) AS payments_received,
         COALESCE(SUM(CASE WHEN is_voided = 0 AND sale_status = 'completed' THEN balance ELSE 0 END),0) AS sales_balance,
         COALESCE(SUM(CASE WHEN is_voided = 1 THEN 1 ELSE 0 END),0) AS voided_sales_count,
         COALESCE(SUM(CASE WHEN is_voided = 1 THEN total ELSE 0 END),0) AS voided_sales_value
       FROM sales WHERE DATE(created_at) BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT COUNT(*) AS expense_count, COALESCE(SUM(amount),0) AS expenses_total FROM expenses WHERE expense_date BETWEEN ? AND ?`,
      [from, to]
    ),
    pool.query(
      `SELECT COUNT(*) AS product_count,
              COALESCE(SUM(quantity * cost_price),0) AS stock_cost_value,
              COALESCE(SUM(quantity * selling_price),0) AS stock_retail_value,
              COALESCE(SUM(CASE WHEN quantity <= low_stock_threshold THEN 1 ELSE 0 END),0) AS low_stock_count,
              COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END),0) AS out_of_stock_count
       FROM products WHERE is_active = TRUE`,
      []
    ),
    pool.query(
      `SELECT COUNT(*) AS overdue_accounts, COALESCE(SUM(balance),0) AS overdue_balance
       FROM debts
       WHERE balance > 0 AND due_date IS NOT NULL AND due_date < CURDATE()
         AND LOWER(COALESCE(status,'active')) NOT IN ('paid','void','cancelled')`,
      []
    ),
  ]);

  const sales = salesRows[0][0] || {};
  const expenses = expenseRows[0][0] || {};
  const products = productRows[0][0] || {};
  const debts = debtRows[0][0] || {};
  const revenue = number(sales.sales_total);
  const payments = number(sales.payments_received);
  const costs = number(expenses.expenses_total);
  const collectionRate = revenue > 0 ? (payments / revenue) * 100 : 0;
  const signals = [];

  if (number(sales.voided_sales_count) > 0) {
    signals.push({
      severity: number(sales.voided_sales_count) >= 5 ? "high" : "medium",
      title: "Voided sales require review",
      detail: `${number(sales.voided_sales_count)} sale(s) were voided, representing ${money(sales.voided_sales_value)} in recorded value. This is a control signal, not a finding of misconduct.`,
      action: "Review the supporting reasons, approvals and original receipts for the voided transactions.",
      path: "/sales",
    });
  }
  if (number(products.out_of_stock_count) > 0) {
    signals.push({
      severity: "high",
      title: "Revenue capacity may be constrained",
      detail: `${number(products.out_of_stock_count)} product(s) are at zero stock, while ${number(products.low_stock_count)} are at or below restock level.`,
      action: "Prioritise critical replenishment before lost sales accumulate.",
      path: "/low-stock",
    });
  }
  if (number(debts.overdue_accounts) > 0) {
    signals.push({
      severity: "high",
      title: "Customer cash is sitting outside the business",
      detail: `${number(debts.overdue_accounts)} overdue debt account(s) represent ${money(debts.overdue_balance)} outstanding.`,
      action: "Rank overdue customers by value and age, then assign collection owners.",
      path: "/debts",
    });
  }

  return {
    revenue,
    sales_count: number(sales.sales_count),
    payments_received: payments,
    outstanding_sales_balance: number(sales.sales_balance),
    expenses: costs,
    estimated_operating_result: revenue - costs,
    collection_rate: Number(collectionRate.toFixed(1)),
    product_count: number(products.product_count),
    stock_cost_value: number(products.stock_cost_value),
    stock_retail_value: number(products.stock_retail_value),
    low_stock_count: number(products.low_stock_count),
    out_of_stock_count: number(products.out_of_stock_count),
    overdue_debt_accounts: number(debts.overdue_accounts),
    overdue_debt_balance: number(debts.overdue_balance),
    voided_sales_count: number(sales.voided_sales_count),
    voided_sales_value: number(sales.voided_sales_value),
    signals,
  };
}

async function loadFinanceSignals(from, to) {
  const portfolio = await getInstallmentPortfolio();
  const summary = portfolio.summary || {};
  const signals = [];

  if (number(summary.overdue_accounts) > 0) {
    signals.push({
      severity: number(summary.critical_risk_accounts) > 0 ? "critical" : "high",
      title: "Installment arrears need management attention",
      detail: `${number(summary.overdue_accounts)} active agreement(s) are overdue with ${money(summary.overdue_amount)} already in arrears.`,
      action: "Review the oldest and highest-value overdue accounts, including guarantor follow-up where required.",
      path: "/equipment-installment-finance/collections",
    });
  }
  if (number(summary.critical_risk_accounts) > 0) {
    signals.push({
      severity: "critical",
      title: "High-risk financed machines need executive review",
      detail: `${number(summary.critical_risk_accounts)} active account(s) are in the critical risk band.`,
      action: "Review each account, guarantor position and recovery decision today.",
      path: "/equipment-installment-finance/collections",
    });
  } else if (number(summary.high_risk_accounts) > 0) {
    signals.push({
      severity: "high",
      title: "Finance portfolio contains elevated risk",
      detail: `${number(summary.high_risk_accounts)} active account(s) are in the high-risk band.`,
      action: "Review exposure before the next due-date cycle and confirm follow-up ownership.",
      path: "/equipment-installment-finance/collections",
    });
  }
  if (number(summary.due_next_7_days) > 0) {
    signals.push({
      severity: "medium",
      title: "Near-term installment cash flow needs protection",
      detail: `${money(summary.due_next_7_days)} is scheduled for collection over the next seven days.`,
      action: "Confirm the highest-value upcoming payments before their due dates.",
      path: "/equipment-installment-finance/payments",
    });
  }

  let paymentActivity = { payments: 0, amount: 0, reversals: 0, reversedAmount: 0 };
  if (await tableExists("equipment_sale_payments")) {
    const columns = await tableColumns("equipment_sale_payments");
    const amountColumn = columns.has("amount") ? "amount" : null;
    const dateColumn = columns.has("payment_date") ? "payment_date" : columns.has("created_at") ? "created_at" : null;
    const categoryColumn = columns.has("payment_category") ? "payment_category" : null;
    if (amountColumn && dateColumn) {
      const categoryClause = categoryColumn
        ? `, SUM(CASE WHEN LOWER(COALESCE(${categoryColumn},'')) IN ('refund','reversal','reversed') THEN 1 ELSE 0 END) AS reversals,
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(${categoryColumn},'')) IN ('refund','reversal','reversed') THEN ${amountColumn} ELSE 0 END),0) AS reversed_amount`
        : `, 0 AS reversals, 0 AS reversed_amount`;
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS payments, COALESCE(SUM(${amountColumn}),0) AS amount ${categoryClause}
         FROM equipment_sale_payments
         WHERE DATE(${dateColumn}) BETWEEN ? AND ?
           AND agreement_id IN (
             SELECT id FROM equipment_sale_agreements
             WHERE sale_type = 'installment' AND activation_source = 'approved_credit_application'
           )`,
        [from, to]
      );
      const row = rows[0] || {};
      paymentActivity = {
        payments: number(row.payments),
        amount: number(row.amount),
        reversals: number(row.reversals),
        reversedAmount: number(row.reversed_amount),
      };
      if (paymentActivity.reversals > 0) {
        signals.push({
          severity: paymentActivity.reversals >= 3 ? "high" : "medium",
          title: "Finance payment reversals are present",
          detail: `${paymentActivity.reversals} reversal/refund record(s) total ${money(paymentActivity.reversedAmount)} in the selected period.`,
          action: "Have Finance and Audit verify the reason, approval trail and customer impact of each reversal.",
          path: "/equipment-installment-finance/payments",
        });
      }
    }
  }

  return {
    active_accounts: number(summary.active_accounts),
    financed_amount: number(summary.financed_amount),
    collected_amount: number(summary.collected_amount),
    outstanding_amount: number(summary.outstanding_amount),
    overdue_amount: number(summary.overdue_amount),
    overdue_accounts: number(summary.overdue_accounts),
    defaulted_accounts: number(summary.defaulted_accounts),
    critical_risk_accounts: number(summary.critical_risk_accounts),
    high_risk_accounts: number(summary.high_risk_accounts),
    due_today_accounts: number(summary.due_today_accounts),
    due_next_7_days: number(summary.due_next_7_days),
    due_next_30_days: number(summary.due_next_30_days),
    collection_rate: number(summary.collection_rate),
    portfolio_at_risk_rate: number(summary.portfolio_at_risk_rate),
    payments_in_period: paymentActivity.payments,
    payments_amount_in_period: paymentActivity.amount,
    reversals_in_period: paymentActivity.reversals,
    reversed_amount_in_period: paymentActivity.reversedAmount,
    urgent_accounts: (portfolio.urgent_accounts || []).slice(0, 8).map((account) => ({
      agreement: account.agreement_number || `Agreement #${account.id}`,
      customer: account.customer_name_snapshot || "Customer",
      machine: account.asset_name_snapshot || account.asset_code_snapshot || "Machine",
      outstanding: number(account.outstanding_balance),
      overdue: number(account.overdue_amount),
      days_past_due: number(account.days_past_due),
      risk_band: account.risk_band,
      risk_score: number(account.risk_score),
      recommended_action: account.recommended_action,
    })),
    signals,
  };
}

function buildActions(spare, finance) {
  const actions = [...spare.signals, ...finance.signals]
    .sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] ?? 9) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.severity] ?? 9));
  if (spare.collection_rate < 80 && spare.revenue > 0) {
    actions.push({ severity: "high", title: "Improve Spare Parts cash conversion", detail: `Only ${spare.collection_rate.toFixed(1)}% of recorded Spare Parts sales value was collected in the period.`, action: "Review credit sales ageing and top outstanding balances.", path: "/debts" });
  }
  if (finance.portfolio_at_risk_rate >= 20) {
    actions.push({ severity: "high", title: "Protect the Finance book", detail: `${finance.portfolio_at_risk_rate.toFixed(1)}% of outstanding Finance exposure is currently overdue.`, action: "Escalate the highest-value overdue agreements and record recovery decisions.", path: "/equipment-installment-finance/collections" });
  }
  if (!actions.length) actions.push({ severity: "low", title: "No urgent exception detected", detail: "The monitored Spare Parts and Installment indicators are currently within the configured review thresholds.", action: "Keep daily reconciliation, collection follow-up and independent review disciplined.", path: "/group-executive-control" });
  return actions.slice(0, 10);
}

function buildAudienceMessage(intelligence, audience) {
  const { range, spare_parts: spare, installment_finance: finance, actions } = intelligence;
  const urgent = actions.filter((item) => ["critical", "high"].includes(item.severity));
  const audienceName = audience === "auditor" ? "Audit briefing" : audience === "manager" ? "Management action briefing" : "Boss / Executive briefing";
  const lines = [
    `${audienceName}: ${range.from} to ${range.to}.`,
    `Spare Parts: ${money(spare.revenue)} completed sales across ${spare.sales_count} sale(s); ${money(spare.payments_received)} collected (${spare.collection_rate.toFixed(1)}% collection); ${money(spare.estimated_operating_result)} estimated revenue less recorded expenses; ${spare.low_stock_count} low-stock and ${spare.out_of_stock_count} zero-stock product(s).`,
    `Installment Finance: ${finance.active_accounts} active agreement(s); ${money(finance.outstanding_amount)} outstanding; ${money(finance.overdue_amount)} overdue; ${finance.overdue_accounts} overdue account(s); ${finance.critical_risk_accounts + finance.high_risk_accounts} high/critical-risk account(s); ${money(finance.due_next_7_days)} due in the next 7 days.`,
  ];
  if (audience === "auditor") {
    lines.push(`Control focus: ${finance.reversals_in_period} Finance reversal/refund record(s) in the period and ${spare.voided_sales_count} Spare Parts voided sale(s). These are review indicators, not accusations.`);
    lines.push(`Audit priority: ${urgent.length ? urgent.map((item) => `${item.title} — ${item.action}`).join(" ") : "No urgent control exception is currently surfaced."}`);
    lines.push("Confirm transaction evidence, approval history and supporting documents before reaching a conclusion.");
  } else if (audience === "manager") {
    lines.push(`What needs to happen next: ${actions.slice(0, 5).map((item) => `${item.title}: ${item.action}`).join(" ")}`);
  } else {
    lines.push(`What deserves your attention now: ${urgent.length ? urgent.map((item) => `${item.title}. ${item.detail} Decision: ${item.action}`).join(" ") : "Continue protecting cash collection, stock availability and disciplined Finance follow-up."}`);
    lines.push("This briefing is designed to answer four executive questions: what is happening, why it matters, what looks unusual, and what decision should happen next. Risk signals are review prompts, not accusations.");
  }
  return lines.join(" ");
}

async function buildExecutiveIntelligence({ from, to } = {}) {
  const range = rangeDates(from, to);
  const [spare, finance] = await Promise.all([loadSparePartsIntelligence(range.from, range.to), loadFinanceSignals(range.from, range.to)]);
  const actions = buildActions(spare, finance);
  const riskWeight = actions.reduce((score, item) => score + ({ critical: 34, high: 18, medium: 7, low: 0 }[item.severity] || 0), 0);
  const healthScore = Math.max(0, Math.min(100, 100 - riskWeight));
  const intelligence = {
    generated_at: new Date().toISOString(),
    range,
    scope: "Spare Parts + Installment Finance",
    health_score: healthScore,
    health_label: healthScore >= 85 ? "Strong control picture" : healthScore >= 65 ? "Watch carefully" : "Immediate executive attention",
    spare_parts: spare,
    installment_finance: finance,
    actions,
  };
  intelligence.messages = {
    executive: buildAudienceMessage(intelligence, "executive"),
    auditor: buildAudienceMessage(intelligence, "auditor"),
    manager: buildAudienceMessage(intelligence, "manager"),
  };
  return intelligence;
}

async function listRecipients() {
  const [rows] = await pool.query(`SELECT id, full_name, username, role, phone, is_active FROM users WHERE is_active = TRUE AND role IS NOT NULL ORDER BY role, full_name, username`);
  return rows.map((row) => ({ id: Number(row.id), name: row.full_name || row.username || `User #${row.id}`, username: row.username || "", role: String(row.role).toLowerCase(), phone_available: Boolean(row.phone) }));
}

function selectedRecipients(allRecipients, { userIds, roles } = {}) {
  const wantedUsers = new Set(cleanArray(userIds, (value) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }));
  const wantedRoles = new Set(cleanArray(roles, (value) => { const role = String(value).trim().toLowerCase(); return ALLOWED_ROLES.includes(role) ? role : null; }));
  const users = allRecipients.filter((recipient) => wantedUsers.has(recipient.id) || wantedRoles.has(recipient.role));
  if (!users.length) throw new Error("Select at least one recipient.");
  if (users.length > MAX_RECIPIENTS) throw new Error(`A maximum of ${MAX_RECIPIENTS} recipients may be selected per dispatch.`);
  return users;
}

async function createNotificationForRecipient({ recipient, message, title, severity, intelligence, createdBy }) {
  const notificationKey = `executive.manual.${createdBy}.${recipient.id}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}`;
  const metadata = {
    intelligence_scope: intelligence.scope,
    intelligence_range: intelligence.range,
    recipient_role: recipient.role,
    health_score: intelligence.health_score,
    action_count: intelligence.actions.length,
  };
  const [result] = await pool.query(
    `INSERT INTO notifications (
       notification_key, workspace_code, branch_id, target_user_id, target_role,
       target_permission, category, notification_type, severity, title, message,
       action_path, source_type, source_reference, status, auto_generated,
       occurred_at, metadata_json, created_by
     ) VALUES (?, 'group', NULL, ?, NULL, 'notifications.view', 'executive',
       'executive_intelligence', ?, ?, ?, ?, 'executive_intelligence', ?,
       'active', FALSE, NOW(), ?, ?)`,
    [notificationKey, recipient.id, severity, title, message, "/group-executive-control", `${intelligence.range.from}_${intelligence.range.to}`, JSON.stringify(metadata), createdBy]
  );
  return Number(result.insertId);
}

async function dispatchExecutiveIntelligence({ from, to, audience = "executive", userIds = [], roles = [], sendSms = false, createdBy }) {
  const intelligence = await buildExecutiveIntelligence({ from, to });
  const recipients = selectedRecipients(await listRecipients(), { userIds, roles });
  const message = intelligence.messages[audience] || intelligence.messages.executive;
  const severity = intelligence.actions.some((item) => item.severity === "critical") ? "critical" : intelligence.actions.some((item) => item.severity === "high") ? "high" : "medium";
  const title = audience === "auditor" ? "Chalin 03 Executive Audit Intelligence" : audience === "manager" ? "Chalin 03 Management Action Intelligence" : "Chalin 03 Deep Executive Intelligence";
  const dispatched = [];
  for (const recipient of recipients) {
    const notificationId = await createNotificationForRecipient({ recipient, message, title, severity, intelligence, createdBy });
    let sms = { status: "not_requested" };
    if (sendSms) {
      const [phoneRows] = await pool.query(`SELECT phone FROM users WHERE id = ? LIMIT 1`, [recipient.id]);
      const phone = phoneRows[0]?.phone;
      if (phone) {
        try {
          sms = await sendSmsAlertToPhone({ branchId: 1, phone, message, smsType: "executive_intelligence", sourceReference: `notification:${notificationId}`, sentBy: createdBy });
        } catch (error) {
          sms = { ok: false, status: "failed", error: error.message };
        }
      } else {
        sms = { ok: false, status: "no_phone" };
      }
    }
    dispatched.push({ recipient: recipient.name, role: recipient.role, notification_id: notificationId, sms_status: sms?.status || "not_requested" });
  }
  return { intelligence, audience, recipient_count: dispatched.length, dispatched };
}

module.exports = {
  ALLOWED_ROLES,
  buildAudienceMessage,
  buildExecutiveIntelligence,
  dispatchExecutiveIntelligence,
  listRecipients,
};
