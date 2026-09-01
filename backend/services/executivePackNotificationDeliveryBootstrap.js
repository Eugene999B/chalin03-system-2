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
  const riskAccounts = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  const outOfStock = Number(spare.out_of_stock_count || 0);
  const lowStock = Math.max(0, Number(spare.low_stock_count || 0) - outOfStock);
  const voidCount = Number(spare.voided_sales_count || 0);
  const operatingResult = Number(spare.estimated_operating_result || 0);
  if (health < 65 || actions.some((item) => item.severity === "critical")) {
    return `Immediate attention is justified: resolve the highest-value cash/control exposure first and prevent secondary leakage.`;
  }
  if (uncollected > 0 && overdueDebt > 0 && overdueDebt >= overdueFinance) {
    return `Cash conversion is the clearest weakness: ${money(uncollected)} remains uncollected and ${money(overdueDebt)} is already overdue in customer debt.`;
  }
  if (overdueFinance > 0 || riskAccounts > 0) {
    return `Finance is the main risk point: ${money(overdueFinance)} is overdue across ${finance.overdue_accounts} account(s), with ${riskAccounts} high/critical-risk account(s).`;
  }
  if (outOfStock > 0 || lowStock > 0 || voidCount > 0) {
    return `The core financial position is more controlled than the operating signals; close void and stock exceptions before they become lost cash or margin.`;
  }
  if (operatingResult < 0) {
    return `The period is financially pressured because recorded expenses exceed sales value; cost discipline should precede discretionary expansion.`;
  }
  return `The period is broadly controlled; preserve cash discipline, stock availability and Finance quality while watching for drift.`;
}

function buildTwoMessageSms({ intelligence, role }) {
  const spare = intelligence?.spare_parts || {};
  const finance = intelligence?.installment_finance || {};
  const range = `${intelligence?.range?.from || "-"} to ${intelligence?.range?.to || "-"}`;
  const actions = selectTopActions(intelligence?.actions || [], 3);
  const primaryAction = actions[0];
  const secondaryAction = actions[1];
  const uncollected = Number(spare.uncollected_sales_value || 0);
  const collectionGap = Number(spare.collection_gap_rate || Math.max(0, 100 - Number(spare.collection_rate || 0)));
  const expenseRatio = Number(spare.expense_ratio || 0);
  const operatingResult = Number(spare.estimated_operating_result || 0);
  const outOfStock = Number(spare.out_of_stock_count || 0);
  const lowStock = Math.max(0, Number(spare.low_stock_count || 0) - outOfStock);
  const financeRisk = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  const overdueShare = Number(finance.overdue_share_of_outstanding || 0);
  const due7Share = Number(finance.due_next_7_days_share || 0);
  const decisionReading = buildDecisionReading({ intelligence, spare, finance, actions });

  let analysis;
  let advice;
  if (role === "auditor") {
    analysis = `CHALIN 03 AUDIT ANALYSIS ${range}: Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${percent(spare.collection_rate)}), leaving ${money(uncollected)} (${percent(collectionGap)}) uncollected. Expenses ${money(spare.expenses)} (${percent(expenseRatio)} of sales); result proxy ${money(operatingResult)}. Voids ${spare.voided_sales_count}/${money(spare.voided_sales_value)}; Finance overdue ${money(finance.overdue_amount)}.`;
    advice = `CHALIN 03 AUDIT DECISION: ${primaryAction ? primaryAction.title : "No material exception surfaced"}. Test the largest variances, voids and Finance movements to source records, approvals, user responsibility and cut-off. ${secondaryAction ? secondaryAction.title + "." : "Close only when evidence agrees with the ledger."}`;
  } else if (role === "manager") {
    analysis = `CHALIN 03 MANAGER ANALYSIS ${range}: Sales ${money(spare.revenue)}; ${percent(spare.collection_rate)} collected, ${money(uncollected)} outstanding. Expenses ${money(spare.expenses)} (${percent(expenseRatio)} of sales) leave ${money(operatingResult)} result proxy. Stock: ${outOfStock} zero, ${lowStock} low. Finance ${money(finance.outstanding_amount)} outstanding, ${money(finance.overdue_amount)} overdue.`;
    advice = `CHALIN 03 MANAGER DECISION: ${decisionReading} ${primaryAction ? "Act first on " + primaryAction.title.toLowerCase() + "." : "Assign owners to the highest-value collection, stock and Finance actions."} Protect the next 7-day Finance inflow (${money(finance.due_next_7_days)}, ${percent(due7Share)} of outstanding).`;
  } else if (role === "admin") {
    analysis = `CHALIN 03 ADMIN ANALYSIS ${range}: Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${percent(spare.collection_rate)}), gap ${money(uncollected)}. Costs ${money(spare.expenses)} (${percent(expenseRatio)} of sales); result proxy ${money(operatingResult)}. Finance ${money(finance.outstanding_amount)} outstanding/${money(finance.overdue_amount)} overdue; ${finance.overdue_accounts} overdue account(s), ${financeRisk} high/critical-risk. Stock ${outOfStock} zero/${lowStock} low; ${spare.voided_sales_count} voids.`;
    advice = `CHALIN 03 ADMIN DECISION: ${decisionReading} ${primaryAction ? "First control: " + primaryAction.title.toLowerCase() + "." : "Reconcile material exceptions and document closure."} Current Finance arrears represent ${percent(overdueShare)} of outstanding.`;
  } else {
    analysis = `CHALIN 03 EXECUTIVE ANALYSIS ${range}: Sales ${money(spare.revenue)}; ${percent(spare.collection_rate)} collected, ${money(uncollected)} still exposed. Costs ${money(spare.expenses)} (${percent(expenseRatio)} of sales); result proxy ${money(operatingResult)}. Finance ${money(finance.outstanding_amount)} outstanding; overdue ${money(finance.overdue_amount)}; ${financeRisk} high/critical-risk account(s).`;
    advice = `CHALIN 03 EXECUTIVE DECISION: ${decisionReading} ${primaryAction ? "Decision trigger: " + primaryAction.title + "." : "Maintain disciplined monitoring and act on material deterioration."} Capital priority is cash conversion before further exposure.`;
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
