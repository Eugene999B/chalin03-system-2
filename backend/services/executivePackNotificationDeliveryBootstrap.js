const http = require("node:http");
const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { buildExecutiveIntelligence } = require("./executiveIntelligenceService");

const INSTALL_FLAG = Symbol.for("chalin03.executivePackNotificationDeliveryInstalled");
const PENDING_DISPATCHES = new Map();
const DISPATCH_DELAY_MS = 1200;

function isExecutivePackRequest(request) {
  if (String(request?.method || "").toUpperCase() !== "POST") return false;
  const path = String(request?.originalUrl || request?.url || "").split("?", 1)[0];
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

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function parsePackRequest(request) {
  if (!isExecutivePackRequest(request)) return null;
  const source = String(request.body?.source_reference || "").trim();
  const parts = source.split(":");
  const from = parts[1];
  const to = parts[2];
  const audience = parts[3];
  const recipientId = Number(request.body?.target_user_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  if (!Number.isInteger(recipientId) || recipientId <= 0) return null;
  return { from, to, audience: String(audience || "executive").toLowerCase(), recipientId };
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

function selectTopActions(actions, count = 2) {
  const weight = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...(actions || [])]
    .sort((a, b) => (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9))
    .slice(0, count);
}

function buildDecisionReading({ intelligence, spare, finance, actions }) {
  const health = Number(intelligence?.health_score ?? 0);
  const uncollected = Number(spare.uncollected_sales_value || 0);
  const overdueDebt = Number(spare.overdue_debt_balance || 0);
  const overdueFinance = Number(finance.overdue_amount || 0);
  const pressureCount = Number(spare.stock_pressure_count || 0);
  const voidCount = Number(spare.voided_sales_count || 0);
  const riskAccounts = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  if (health < 65 || actions.some((item) => item.severity === "critical")) {
    return `Priority is immediate: protect cash, resolve the highest-risk exception and stop control leakage before exposure grows.`;
  }
  if (uncollected > 0 && overdueDebt > overdueFinance && overdueDebt > 0) {
    return `The clearest cash risk is customer collections: ${money(uncollected)} remains in sales balances and ${money(overdueDebt)} is overdue in customer debt.`;
  }
  if (overdueFinance > 0 || riskAccounts > 0) {
    return `Finance needs active protection: ${money(overdueFinance)} is overdue and ${riskAccounts} account(s) are high/critical risk.`;
  }
  if (pressureCount > 0 || voidCount > 0) {
    return `The financial position is currently more controlled than the operational signals: close stock and void exceptions before they become lost cash or revenue.`;
  }
  return `The period is broadly controlled; preserve collection discipline, stock availability and Finance quality while watching early warning changes.`;
}

function buildTwoMessageSms({ intelligence, role }) {
  const spare = intelligence?.spare_parts || {};
  const finance = intelligence?.installment_finance || {};
  const range = `${intelligence?.range?.from || "-"} to ${intelligence?.range?.to || "-"}`;
  const actions = selectTopActions(intelligence?.actions || [], 3);
  const primaryAction = actions[0];
  const secondaryAction = actions[1];
  const uncollected = Number(spare.uncollected_sales_value || 0);
  const health = Number(intelligence?.health_score ?? 0);
  const financeRisk = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  const stockPressure = Number(spare.stock_pressure_count || 0);
  const decisionReading = buildDecisionReading({ intelligence, spare, finance, actions });

  let analysis;
  let advice;
  if (role === "auditor") {
    analysis = `CHALIN 03 AUDIT ANALYSIS ${range}: Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${percent(spare.collection_rate)}); uncollected ${money(uncollected)}. Finance ${money(finance.outstanding_amount)} outstanding, ${money(finance.overdue_amount)} overdue; ${spare.voided_sales_count} voids/${money(spare.voided_sales_value)} and ${finance.reversals_in_period} Finance reversal/refund(s).`;
    advice = `CHALIN 03 AUDIT DECISION: ${primaryAction ? primaryAction.title : "No material exception"}. Trace the evidence to source records, approval, user responsibility and cut-off. ${secondaryAction ? secondaryAction.title + "." : "Close exceptions only when supporting evidence agrees with the ledger."}`;
  } else if (role === "manager") {
    analysis = `CHALIN 03 MANAGER ANALYSIS ${range}: Sales ${money(spare.revenue)}; ${percent(spare.collection_rate)} collected, leaving ${money(uncollected)} uncollected. Expenses ${money(spare.expenses)} (${percent(spare.expense_ratio)} of sales); result proxy ${money(spare.estimated_operating_result)}. Stock: ${spare.out_of_stock_count} zero, ${spare.low_stock_count} low. Finance ${money(finance.outstanding_amount)} outstanding.`;
    advice = `CHALIN 03 MANAGER DECISION: ${decisionReading} ${primaryAction ? "Focus: " + primaryAction.action : "Assign owners to the most material collection, stock and Finance exceptions."}`;
  } else if (role === "admin") {
    analysis = `CHALIN 03 ADMIN ANALYSIS ${range}: Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${percent(spare.collection_rate)}); gap ${money(uncollected)}. Expenses ${money(spare.expenses)} (${percent(spare.expense_ratio)} of sales); result proxy ${money(spare.estimated_operating_result)}. Finance ${money(finance.outstanding_amount)} outstanding, ${money(finance.overdue_amount)} overdue/${finance.overdue_accounts} account(s); ${spare.voided_sales_count} voids; ${spare.out_of_stock_count} zero-stock + ${spare.low_stock_count} low-stock.`;
    advice = `CHALIN 03 ADMIN DECISION: ${decisionReading} ${primaryAction ? "First action: " + primaryAction.action : "Reconcile material exceptions, assign ownership and document closure."}`;
  } else {
    analysis = `CHALIN 03 EXECUTIVE ANALYSIS ${range}: Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${percent(spare.collection_rate)}); ${money(uncollected)} remains uncollected. Recorded expenses ${money(spare.expenses)} (${percent(spare.expense_ratio)} of sales); result proxy ${money(spare.estimated_operating_result)}. Finance ${money(finance.outstanding_amount)} outstanding, ${money(finance.overdue_amount)} overdue; ${financeRisk} high/critical-risk account(s).`;
    advice = `CHALIN 03 EXECUTIVE DECISION: ${decisionReading} ${primaryAction ? "Decision trigger: " + primaryAction.title + "." : "Continue disciplined monitoring and act on any material deterioration."}`;
  }

  return [trimSms(analysis), trimSms(advice)];
}

async function deliverExecutivePackSmsBatch({ from, to, recipientId }) {
  try {
    const smsSourceReference = `executive-message-pack:${from}:${to}:${recipientId}:two-message`;
    const [existing] = await pool.query(`SELECT id FROM sms_log WHERE source_reference = ? ORDER BY id DESC LIMIT 1`, [smsSourceReference]);
    if (existing.length) return;

    const [rows] = await pool.query(`SELECT phone, role FROM users WHERE id = ? AND is_active = TRUE LIMIT 1`, [recipientId]);
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
  Object.defineProperty(globalThis, INSTALL_FLAG, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

installExecutivePackNotificationDelivery();
module.exports = { installExecutivePackNotificationDelivery, buildTwoMessageSms };
