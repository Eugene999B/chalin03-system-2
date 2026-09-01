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

function trimSms(value, max = 360) {
  const text = cleanLine(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${(boundary > max * 0.72 ? clipped.slice(0, boundary) : clipped).trim()}...`;
}

function buildTwoMessageSms({ intelligence, role }) {
  const spare = intelligence?.spare_parts || {};
  const finance = intelligence?.installment_finance || {};
  const actions = [...(intelligence?.actions || [])].sort((a, b) => {
    const weight = { critical: 0, high: 1, medium: 2, low: 3 };
    return (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9);
  });
  const urgent = actions.filter((item) => ["critical", "high"].includes(item.severity));
  const range = `${intelligence?.range?.from || "-"} to ${intelligence?.range?.to || "-"}`;
  const health = Number(intelligence?.health_score ?? 0);
  const cashExposure = Number(spare.overdue_debt_balance || 0) + Number(finance.overdue_amount || 0);
  const riskAccounts = Number(finance.critical_risk_accounts || 0) + Number(finance.high_risk_accounts || 0);
  const stockPressure = Number(spare.out_of_stock_count || 0) + Number(spare.low_stock_count || 0);
  const riskText = urgent.slice(0, 2).map((item) => cleanLine(item.title)).join("; ") || "No critical or high exception is currently surfaced";

  let reading;
  if (health < 65 || urgent.some((item) => item.severity === "critical")) {
    reading = `Evidence shows material pressure: ${riskAccounts} high/critical Finance account(s), ${money(cashExposure)} overdue cash exposure and ${stockPressure} stock-pressure item(s).`;
  } else if (health < 85 || urgent.length) {
    reading = `The picture is mixed: core activity is present, but ${riskAccounts} Finance risk account(s), ${money(cashExposure)} overdue cash exposure or stock pressure need active control.`;
  } else {
    reading = "The monitored control picture is stable, with no critical or high exception dominating the period. Keep the discipline that produced this position.";
  }

  let analysis;
  let advice;
  if (role === "auditor") {
    analysis = `CHALIN 03 AUDIT ANALYSIS ${range}. Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${spare.collection_rate ?? 0}%); Finance outstanding ${money(finance.outstanding_amount)}; overdue ${money(finance.overdue_amount)}. Controls: ${spare.voided_sales_count ?? 0} voided sale(s), ${finance.reversals_in_period ?? 0} reversal/refund(s), ${finance.critical_risk_accounts ?? 0} critical-risk account(s). ${reading}`;
    advice = `CHALIN 03 AUDIT ADVICE. Priority: ${riskText}. Warning: signals require evidence, not assumptions. Reconcile high-value exceptions to source records, approvals, cut-off and supporting documents; record the conclusion and closure.`;
  } else if (role === "manager") {
    analysis = `CHALIN 03 MANAGER ANALYSIS ${range}. Spare Parts sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${spare.collection_rate ?? 0}%); Finance outstanding ${money(finance.outstanding_amount)}; overdue ${money(finance.overdue_amount)}; ${spare.out_of_stock_count ?? 0} zero-stock, ${spare.low_stock_count ?? 0} low-stock. ${reading}`;
    advice = `CHALIN 03 MANAGER ADVICE. Priority: ${riskText}. ${health < 65 ? "Intervention is required now." : health < 85 || urgent.length ? "Targeted intervention is required before pressure grows." : "Maintain disciplined execution and watch early warning changes."} Act on collections, priority stock and high-risk Finance accounts; give each issue an owner and review date.`;
  } else if (role === "admin") {
    analysis = `CHALIN 03 ADMIN ANALYSIS ${range}. Sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${spare.collection_rate ?? 0}%); voided ${spare.voided_sales_count ?? 0}. Finance outstanding ${money(finance.outstanding_amount)}; overdue ${money(finance.overdue_amount)} across ${finance.overdue_accounts ?? 0} account(s). ${reading}`;
    advice = `CHALIN 03 ADMIN ADVICE. Priority: ${riskText}. ${health < 65 ? "Control intervention is required." : health < 85 || urgent.length ? "Strengthen controls before the pressure becomes expensive." : "Keep the current control discipline and monitor for drift."} Verify approvals, user responsibility, customer records, stock integrity and notification delivery, then close exceptions with evidence.`;
  } else {
    analysis = `CHALIN 03 EXECUTIVE ANALYSIS ${range}. Spare Parts sales ${money(spare.revenue)}; collected ${money(spare.payments_received)} (${spare.collection_rate ?? 0}%); recorded-result proxy ${money(spare.estimated_operating_result)}. Finance outstanding ${money(finance.outstanding_amount)}; overdue ${money(finance.overdue_amount)}. ${reading}`;
    advice = `CHALIN 03 EXECUTIVE ADVICE. Priority: ${riskText}. ${health < 65 ? "The evidence supports immediate intervention." : health < 85 || urgent.length ? "The evidence supports targeted intervention before pressure compounds." : "The evidence supports disciplined continuation with early-warning monitoring."} Protect cash conversion, stock availability and Finance risk; require a named owner, decision and review date for material exceptions.`;
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
    for (const message of messages) {
      await sendSmsAlertToPhone({
        branchId: 1,
        phone: recipient.phone,
        message,
        smsType: "executive_intelligence_pack",
        sourceReference: `${smsSourceReference}:${messages.indexOf(message) + 1}`,
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
