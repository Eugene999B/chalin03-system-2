const http = require("node:http");
const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { buildExecutiveIntelligence } = require("./executiveIntelligenceService");

const INSTALL_FLAG = Symbol.for("chalin03.executivePackNotificationDeliveryInstalled");
const PENDING_DISPATCHES = new Map();
const DISPATCH_DELAY_MS = 1200;

function isExecutivePackRequest(request) {
  if (String(request?.method || "").toUpperCase() !== "POST") return false;
  const path = String(request?.originalUrl || request?.url || "").split("?")[0];
  if (path !== "/notifications/manual" && path !== "/api/notifications/manual") return false;
  const body = request?.body || {};
  return String(body.category || "").trim().toLowerCase() === "executive"
    && String(body.source_reference || "").trim().startsWith("executive-message-pack:");
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function money(value) {
  const n = Number(value);
  return `GHS ${(Number.isFinite(n) ? n : 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "GHS 0";
  if (Math.abs(n) >= 1000000) return `GHS ${(n / 1000000).toFixed(2)}m`;
  if (Math.abs(n) >= 1000) return `GHS ${(n / 1000).toFixed(1)}k`;
  return `GHS ${n.toFixed(0)}`;
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function parsePackRequest(request) {
  if (!isExecutivePackRequest(request)) return null;
  const source = String(request.body?.source_reference || "").trim();
  const parts = source.split(":");
  const from = parts[1];
  const to = parts[2];
  const recipientId = Number(request.body?.target_user_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (!Number.isInteger(recipientId) || recipientId <= 0) return null;
  return { from, to, recipientId };
}

function roleAudience(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "auditor") return "auditor";
  if (normalized === "manager") return "manager";
  if (normalized === "admin") return "admin";
  return "executive";
}

function trimSms(value, max = 320) {
  const text = cleanLine(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 3);
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > max * 0.72 ? clipped.slice(0, boundary) : clipped).trim()}...`;
}

function topAction(intelligence) {
  const weight = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...(intelligence?.actions || [])]
    .sort((a, b) => (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9))[0] || null;
}

function distinctLowStock(spare) {
  const zero = Number(spare.out_of_stock_count || 0);
  return Math.max(0, Number(spare.low_stock_count || 0) - zero);
}

function dominantExposure(spare, finance) {
  const exposures = [
    { value: Number(spare.uncollected_sales_value || 0), label: "Spare Parts uncollected sales" },
    { value: Number(spare.overdue_debt_balance || 0), label: "overdue customer debt" },
    { value: Number(finance.overdue_amount || 0), label: "Finance arrears" },
    { value: Number(finance.outstanding_amount || 0), label: "Finance outstanding exposure" },
  ].filter((item) => item.value > 0);
  return exposures.sort((a, b) => b.value - a.value)[0] || { value: 0, label: "no material cash exposure surfaced" };
}

function buildDecision(intelligence, role) {
  const spare = intelligence?.spare_parts || {};
  const finance = intelligence?.installment_finance || {};
  const health = Number(intelligence?.health_score || 0);
  const action = topAction(intelligence);
  const uncollected = Number(spare.uncollected_sales_value || 0);
  const overdueDebt = Number(spare.overdue_debt_balance || 0);
  const financeOverdue = Number(finance.overdue_amount || 0);
  const riskAccounts = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  const stockZero = Number(spare.out_of_stock_count || 0);
  const stockLow = distinctLowStock(spare);
  const voids = Number(spare.voided_sales_count || 0);
  const result = Number(spare.estimated_operating_result || 0);

  if (role === "auditor") {
    if (action?.severity === "critical") return `Audit priority: independently substantiate the critical exception before management relies on the affected figure.`;
    if (voids > 0 || Number(finance.reversals_in_period || 0) > 0) return `Audit priority: trace exceptions to origin, approval, user, supporting evidence and period cut-off.`;
    if (uncollected > 0 || overdueDebt > 0) return `Audit priority: reconcile recorded receivables to source transactions and subsequent collections.`;
    return `Audit priority: confirm completeness, cut-off and approval evidence behind the reported position.`;
  }

  if (role === "manager") {
    if (stockZero > 0) return `Manager priority: recover sales capacity by assigning replenishment owners to the ${stockZero} zero-stock items, while chasing the highest-value customer balances.`;
    if (financeOverdue > 0 || riskAccounts > 0) return `Manager priority: protect collections by escalating overdue/high-risk Finance accounts before the next due-date cycle.`;
    if (uncollected > 0 || overdueDebt > 0) return `Manager priority: convert outstanding sales/debt into cash with named owners, dates and escalation.`;
    return `Manager priority: sustain daily reconciliation, stock accuracy and collection discipline before expanding exposure.`;
  }

  if (role === "admin") {
    if (health < 65 || action?.severity === "critical") return `Admin decision: resolve the highest-value control/cash exception first and require evidence of closure.`;
    if (financeOverdue > 0 || riskAccounts > 0) return `Admin decision: protect Finance capital by forcing follow-up on overdue and high-risk exposure.`;
    if (uncollected > 0 || overdueDebt > 0) return `Admin decision: close the sales-to-cash gap before adding discretionary spending.`;
    if (stockZero > 0 || stockLow > 0 || voids > 0) return `Admin decision: remove stock and transaction-control exceptions before they become margin leakage.`;
    return `Admin decision: preserve the current position and tighten evidence, ownership and reconciliation controls.`;
  }

  if (health < 65 || action?.severity === "critical") return `Boss decision: intervene on the largest cash/control exposure now; do not allow secondary leakage to build.`;
  if (financeOverdue > 0 || riskAccounts > 0) return `Boss decision: protect capital by prioritising Finance recovery and restricting new exposure where risk is rising.`;
  if (uncollected > 0 || overdueDebt > 0) return `Boss decision: accelerate cash conversion; reported sales are not fully becoming usable cash.`;
  if (stockZero > 0 || stockLow > 0 || voids > 0) return `Boss decision: keep growth controlled while operating exceptions are cleared and accountability is visible.`;
  if (result < 0) return `Boss decision: enforce cost discipline because recorded expenses are absorbing the period's sales value.`;
  return `Boss decision: maintain control, preserve cash quality and act early on any deterioration in collection, stock or Finance risk.`;
}

function buildTwoMessageSms({ intelligence, role }) {
  const spare = intelligence?.spare_parts || {};
  const finance = intelligence?.installment_finance || {};
  const range = `${intelligence?.range?.from || "-"} to ${intelligence?.range?.to || "-"}`;
  const action = topAction(intelligence);
  const dominant = dominantExposure(spare, finance);
  const lowStock = distinctLowStock(spare);
  const health = Number(intelligence?.health_score || 0);
  const collection = Number(spare.collection_rate || 0);
  const gap = Number(spare.uncollected_sales_value || 0);
  const expenseRatio = Number(spare.expense_ratio || 0);
  const margin = Number(spare.operating_margin_proxy || 0);
  const financeRisk = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  const due7Share = Number(finance.due_next_7_days_share || 0);
  const reversalCount = Number(finance.reversals_in_period || 0);

  let analysis = "";
  let decision = "";

  if (role === "auditor") {
    analysis = `CHALIN03 AUDITOR ${range}: ${money(spare.sales_count)} completed sales? No—${spare.sales_count || 0} completed sales worth ${compactMoney(spare.revenue)}; ${percent(collection)} collected, leaving ${compactMoney(gap)} open. Expenses ${compactMoney(spare.expenses)} = ${percent(expenseRatio)} of sales; ${spare.voided_sales_count || 0} voids worth ${compactMoney(spare.voided_sales_value)}; Finance ${compactMoney(finance.overdue_amount)} overdue, ${finance.overdue_accounts || 0} accounts.`;
    decision = `AUDIT DECISION: ${buildDecision(intelligence, role)} Review ${spare.voided_sales_count || 0} voids, ${reversalCount} Finance reversals and the largest receivable/Finance variances against source records; do not treat a signal as a finding.`;
  } else if (role === "manager") {
    analysis = `CHALIN03 MANAGER ${range}: Sales ${compactMoney(spare.revenue)}; ${percent(collection)} collected, ${compactMoney(gap)} still open. Costs ${compactMoney(spare.expenses)} (${percent(expenseRatio)}), leaving ${compactMoney(spare.estimated_operating_result)} result proxy. Stock: ${spare.out_of_stock_count || 0} zero/${lowStock} low. Finance ${compactMoney(finance.outstanding_amount)} outstanding; ${compactMoney(finance.overdue_amount)} overdue; ${compactMoney(finance.due_next_7_days)} due in 7d.`;
    decision = `MANAGER DECISION: ${buildDecision(intelligence, role)} Next 7d due cash is ${percent(due7Share)} of Finance outstanding; assign owners before due dates and escalate broken promises.`;
  } else if (role === "admin") {
    analysis = `CHALIN03 ADMIN ${range}: Health ${health}/100. Sales ${compactMoney(spare.revenue)}, collected ${percent(collection)}; ${compactMoney(gap)} sales cash gap. Costs ${compactMoney(spare.expenses)} (${percent(expenseRatio)}), margin proxy ${percent(margin)}. Finance ${compactMoney(finance.outstanding_amount)} outstanding/${compactMoney(finance.overdue_amount)} overdue; ${financeRisk} high/critical. Stock ${spare.out_of_stock_count || 0} zero/${lowStock} low; ${spare.voided_sales_count || 0} voids.`;
    decision = `ADMIN DECISION: ${buildDecision(intelligence, role)} Largest exposure is ${dominant.label} at ${compactMoney(dominant.value)}. Require named owner, evidence and closure date for the priority exception.`;
  } else {
    analysis = `CHALIN03 BOSS ALERT ${range}: Health ${health}/100. Sales ${compactMoney(spare.revenue)}; ${percent(collection)} converted to cash, leaving ${compactMoney(gap)} uncollected. Finance exposure ${compactMoney(finance.outstanding_amount)}; ${compactMoney(finance.overdue_amount)} overdue, ${financeRisk} high/critical. Costs ${compactMoney(spare.expenses)} = ${percent(expenseRatio)} of sales; margin proxy ${percent(margin)}.`;
    decision = `BOSS DECISION: ${buildDecision(intelligence, role)} The largest quantified exposure is ${dominant.label} (${compactMoney(dominant.value)}). Decision trigger: ${action?.title || "monitor for material deterioration"}.`;
  }

  return [trimSms(analysis), trimSms(decision)];
}

async function deliverExecutivePackSmsBatch({ from, to, recipientId }) {
  try {
    const smsSourceReference = `executive-message-pack:${from}:${to}:${recipientId}:two-message`;
    const [existing] = await pool.query(
      `SELECT id FROM sms_log WHERE source_reference = ? ORDER BY id DESC LIMIT 1`,
      [smsSourceReference]
    );
    if (existing.length) return;

    const [rows] = await pool.query(
      `SELECT phone, role FROM users WHERE id = ? AND is_active = TRUE LIMIT 1`,
      [recipientId]
    );
    const recipient = rows[0];
    if (!recipient?.phone) return;

    const intelligence = await buildExecutiveIntelligence({ from, to });
    const role = roleAudience(recipient.role);
    const messages = buildTwoMessageSms({ intelligence, role });

    for (let index = 0; index < messages.length; index += 1) {
      await sendSmsAlertToPhone({
        branchId: 1,
        phone: recipient.phone,
        message: messages[index],
        smsType: "executive_intelligence_pack",
        sourceReference: `${smsSourceReference}:${index + 1}`,
      });
    }
  } catch (error) {
    console.error("Executive intelligence two-message SMS delivery failed:", error.message);
  }
}

function scheduleExecutivePackSms(request) {
  const parsed = parsePackRequest(request);
  if (!parsed) return;
  const key = `${parsed.from}:${parsed.to}:${parsed.recipientId}`;
  const prior = PENDING_DISPATCHES.get(key);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    PENDING_DISPATCHES.delete(key);
    void deliverExecutivePackSmsBatch(parsed);
  }, DISPATCH_DELAY_MS);
  PENDING_DISPATCHES.set(key, timer);
}

function installExecutivePackNotificationDelivery() {
  if (globalThis[INSTALL_FLAG]) return false;
  const originalEnd = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function executivePackAwareEnd(...args) {
    const request = this.req;
    const result = originalEnd.apply(this, args);
    if (request && isExecutivePackRequest(request)) scheduleExecutivePackSms(request);
    return result;
  };
  Object.defineProperty(globalThis, INSTALL_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return true;
}

installExecutivePackNotificationDelivery();
module.exports = { installExecutivePackNotificationDelivery, buildTwoMessageSms };
