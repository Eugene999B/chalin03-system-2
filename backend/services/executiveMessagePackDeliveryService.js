const { pool } = require("../config/db");
const { sendSmsAlertToPhone } = require("./smsAlertService");
const { buildExecutiveIntelligence, listRecipients } = require("./executiveIntelligenceService");

const AUDIENCES = new Set(["executive", "auditor", "manager"]);

function money(value) {
  const number = Number(value);
  return `GHS ${(Number.isFinite(number) ? number : 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cleanDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateRange(from, to) {
  const end = cleanDate(to) || new Date().toISOString().slice(0, 10);
  const suppliedStart = cleanDate(from);
  if (suppliedStart && suppliedStart <= end) return { from: suppliedStart, to: end };
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: end };
}

function severityFor(intelligence, item) {
  if (item?.severity) return item.severity;
  if ((intelligence?.actions || []).some((action) => action.severity === "critical")) return "critical";
  if ((intelligence?.actions || []).some((action) => action.severity === "high")) return "high";
  return "medium";
}

function buildMessagePack(intelligence, audience) {
  const spare = intelligence.spare_parts || {};
  const finance = intelligence.installment_finance || {};
  const actions = [...(intelligence.actions || [])].sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] ?? 9) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.severity] ?? 9));
  const urgent = actions.filter((item) => ["critical", "high"].includes(item.severity));
  const range = `${intelligence.range.from} to ${intelligence.range.to}`;
  if (audience === "auditor") {
    return [
      { code: "audit-summary", title: "Audit Control Summary", severity: urgent.length ? "high" : "medium", message: `Period ${range}. Spare Parts completed sales are ${money(spare.revenue)} with ${money(spare.payments_received)} collected (${spare.collection_rate ?? 0}%). Installment Finance has ${finance.active_accounts ?? 0} active agreement(s), ${money(finance.outstanding_amount)} outstanding and ${money(finance.overdue_amount)} overdue.`, action: "Confirm the source ledgers, reconciliations and period cut-off before relying on management totals." },
      { code: "audit-exceptions", title: "Exceptions & Unusual Activity", severity: urgent.some((item) => item.severity === "critical") ? "critical" : urgent.length ? "high" : "medium", message: `There are ${spare.voided_sales_count ?? 0} voided Spare Parts sale(s), ${finance.reversals_in_period ?? 0} Finance reversal/refund record(s), ${finance.overdue_accounts ?? 0} overdue Finance account(s), and ${finance.critical_risk_accounts ?? 0} critical-risk Finance account(s).`, action: "Trace each exception to the original record, approval, supporting document and final disposition. A signal is not an accusation." },
      { code: "audit-evidence", title: "Evidence the Auditor Should Request", severity: "high", message: `Priority evidence includes overdue customer balances, high/critical Finance accounts, voided sales, payment reversals and stock pressure (${spare.low_stock_count ?? 0} low-stock; ${spare.out_of_stock_count ?? 0} zero-stock).`, action: "Request supporting receipts, approvals, collection notes, reversal reasons, inventory counts and responsible-user history for sampled cases." },
      { code: "audit-governance", title: "Control Improvement Advice", severity: "medium", message: "The strongest audit posture is independent, evidence-led and exception-focused rather than dependent on summaries alone.", action: "Give high-value exceptions a named reviewer, resolution date and independent sign-off." },
      { code: "audit-system", title: "Website & System Audit Advice", severity: "medium", message: "System quality affects control quality: incomplete customer records, unresolved approvals, weak audit trails and failed notifications can hide operational risk.", action: "Test permissions, approval trails, customer-contact completeness, audit logs and notification delivery as part of routine assurance." },
    ];
  }
  if (audience === "manager") {
    return [
      { code: "manager-today", title: "Priority Actions Today", severity: urgent.length ? "high" : "medium", message: `${urgent.length} high/critical action(s) are currently surfaced across the monitored businesses.`, action: urgent.slice(0, 4).map((item) => `${item.title}: ${item.action}`).join(" | ") || "Maintain daily reconciliation, collection discipline and stock review." },
      { code: "manager-cash", title: "Cash & Customer Follow-up", severity: spare.overdue_debt_balance > 0 || finance.overdue_amount > 0 ? "high" : "medium", message: `Spare Parts overdue customer debt is ${money(spare.overdue_debt_balance)}; Finance overdue exposure is ${money(finance.overdue_amount)} across ${finance.overdue_accounts ?? 0} account(s).`, action: "Assign named owners to the largest and oldest balances, set follow-up dates and escalate broken promises." },
      { code: "manager-stock", title: "Stock & Sales Protection", severity: spare.out_of_stock_count > 0 ? "high" : "medium", message: `${spare.out_of_stock_count ?? 0} product(s) are at zero stock and ${spare.low_stock_count ?? 0} are at or below restock level.`, action: "Protect fast-moving parts first and reconcile website stock status with physical counts." },
      { code: "manager-finance", title: "Installment Portfolio Discipline", severity: finance.critical_risk_accounts > 0 ? "critical" : finance.high_risk_accounts > 0 ? "high" : "medium", message: `${finance.critical_risk_accounts ?? 0} critical-risk and ${finance.high_risk_accounts ?? 0} high-risk Finance account(s) need controlled follow-up; ${money(finance.due_next_7_days)} is due within seven days.`, action: "Review the largest exposures, confirm contact attempts and record the recovery decision before the next due-date cycle." },
      { code: "manager-system", title: "Website & Process Improvements", severity: "medium", message: "The operating system should make the next correct action obvious: alerts, complete records, visible approvals, trusted stock and reliable notifications.", action: "Review dashboard alerts, customer information completeness, approval queues, search usability and notification delivery every week." },
    ];
  }
  return [
    { code: "executive-snapshot", title: "Executive Snapshot", severity: intelligence.health_score < 65 ? "critical" : intelligence.health_score < 85 ? "high" : "medium", message: `For ${range}, Spare Parts recorded ${money(spare.revenue)} in completed sales and collected ${money(spare.payments_received)} (${spare.collection_rate ?? 0}%). Installment Finance carries ${money(finance.outstanding_amount)} outstanding across ${finance.active_accounts ?? 0} active agreement(s).`, action: "Use the next messages together to understand the cash, risk, unfinished decisions and control improvements behind this headline." },
    { code: "executive-cash", title: "Cash, Collections & Profit Pressure", severity: spare.overdue_debt_balance > 0 || finance.overdue_amount > 0 ? "high" : "medium", message: `Spare Parts has ${money(spare.overdue_debt_balance)} in overdue customer debt. Finance has ${money(finance.overdue_amount)} overdue, while ${money(finance.due_next_7_days)} is due in the next seven days. Spare Parts estimated revenue less recorded expenses is ${money(spare.estimated_operating_result)}.`, action: "Protect cash first: assign collection owners, escalate old/high-value balances and keep near-term Finance collections visible to leadership." },
    { code: "executive-risk", title: "Risk & Suspicion Review", severity: urgent.some((item) => item.severity === "critical") ? "critical" : urgent.length ? "high" : "medium", message: `The control picture includes ${spare.voided_sales_count ?? 0} voided Spare Parts sale(s), ${finance.reversals_in_period ?? 0} Finance reversal/refund record(s), ${finance.high_risk_accounts ?? 0} high-risk and ${finance.critical_risk_accounts ?? 0} critical-risk Finance account(s).`, action: "Ask for evidence and explanations before concluding anything. Identify the responsible user, approval history, source document and resolution for unusual cases." },
    { code: "executive-decisions", title: "Decisions Management Should Confirm", severity: urgent.length ? "high" : "medium", message: urgent.length ? urgent.slice(0, 4).map((item) => item.title).join(" • ") : "No critical exception is currently surfaced.", action: urgent.length ? urgent.slice(0, 4).map((item) => item.action).join(" | ") : "Confirm that stock review, customer collection, Finance monitoring and independent reconciliation have clear owners and due dates." },
    { code: "executive-system", title: "Website & Operating-System Improvement", severity: "medium", message: "The website is a management control surface, not just a data display. Weak alerts, incomplete records or unclear approvals can weaken decisions.", action: "Strengthen alert visibility, customer data completeness, approval ownership, stock trust and notification delivery; review these controls before the next leadership meeting." },
    { code: "executive-governance", title: "What I Would Put on the Boss's Desk", severity: urgent.length ? "high" : "medium", message: `Leadership picture: health ${intelligence.health_score ?? 0}/100; ${spare.out_of_stock_count ?? 0} Spare Parts zero-stock item(s); ${spare.overdue_debt_accounts ?? 0} overdue Spare Parts debt account(s); ${finance.overdue_accounts ?? 0} overdue Finance account(s); ${finance.critical_risk_accounts ?? 0} critical-risk Finance account(s).`, action: "Ask: What is costing us cash? Which risk needs a decision today? Which control should be strengthened before the next review?" },
  ];
}

function recipientIdsFromSelection(allRecipients, { userIds = [], roles = [] } = {}) {
  const ids = new Set((Array.isArray(userIds) ? userIds : []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  const roleSet = new Set((Array.isArray(roles) ? roles : []).map((role) => String(role).trim().toLowerCase()).filter(Boolean));
  for (const recipient of allRecipients) if (roleSet.has(String(recipient.role).toLowerCase())) ids.add(Number(recipient.id));
  return allRecipients.filter((recipient) => ids.has(Number(recipient.id)));
}

async function insertNotification({ recipient, item, intelligence, createdBy }) {
  const notificationKey = `executive.pack.${createdBy}.${recipient.id}.${Date.now()}.${Math.random().toString(16).slice(2, 10)}`;
  const message = `${item.message}\n\nRecommended action: ${item.action}`;
  const metadata = JSON.stringify({ pack_code: item.code, audience: intelligence.audience, intelligence_scope: intelligence.scope, intelligence_range: intelligence.range, health_score: intelligence.health_score });
  const [result] = await pool.query(
    `INSERT INTO notifications (notification_key, workspace_code, branch_id, target_user_id, category, notification_type, severity, title, message, action_path, source_type, source_reference, status, auto_generated, occurred_at, metadata_json, created_by) VALUES (?, 'group', NULL, ?, 'executive', 'executive_message_pack', ?, ?, ?, ?, 'executive_intelligence', ?, 'active', FALSE, NOW(), ?, ?)`,
    [notificationKey, recipient.id, severityFor(intelligence, item), item.title, message, item.action_path || "/group-executive-control", `executive-message-pack:${intelligence.range.from}:${intelligence.range.to}:${intelligence.audience}:${item.code}`, metadata, createdBy]
  );
  return Number(result.insertId);
}

async function sendPackSms({ recipient, intelligence, pack, createdBy }) {
  if (!recipient.phone) return { status: "no_phone" };
  const urgent = pack.filter((item) => ["critical", "high"].includes(item.severity));
  const smsText = `CHALIN 03: Your ${pack.length}-message ${intelligence.audience} briefing is ready. ${urgent.length ? `${urgent.length} item(s) require urgent attention.` : "Review the notification centre for the full briefing."}`;
  return sendSmsAlertToPhone({ branchId: 1, phone: recipient.phone, message: smsText, logMessage: smsText, smsType: "executive_intelligence_pack", sentBy: createdBy, sourceReference: `executive-message-pack:${intelligence.range.from}:${intelligence.range.to}:${intelligence.audience}:${recipient.id}` });
}

async function dispatchExecutiveMessagePack({ from, to, audience = "executive", userIds = [], roles = [], sendSms = false, createdBy }) {
  const normalisedAudience = AUDIENCES.has(String(audience).toLowerCase()) ? String(audience).toLowerCase() : "executive";
  const intelligence = await buildExecutiveIntelligence({ from, to });
  intelligence.audience = normalisedAudience;
  const pack = buildMessagePack(intelligence, normalisedAudience);
  const recipients = recipientIdsFromSelection(await listRecipients(), { userIds, roles });
  if (!recipients.length) throw new Error("Select at least one active recipient.");
  const dispatched = [];
  for (const recipient of recipients) {
    const notificationIds = [];
    for (const item of pack) notificationIds.push(await insertNotification({ recipient, item, intelligence, createdBy }));
    const sms = sendSms ? await sendPackSms({ recipient, intelligence, pack, createdBy }) : { status: "not_requested" };
    dispatched.push({ recipient_id: recipient.id, recipient: recipient.name, role: recipient.role, message_count: notificationIds.length, notification_ids: notificationIds, sms_status: sms.status || "not_requested", sms_log_id: sms.log_id || null });
  }
  return { status: "success", audience: normalisedAudience, range: intelligence.range, scope: intelligence.scope, message_count_per_recipient: pack.length, total_notifications: dispatched.reduce((sum, row) => sum + row.message_count, 0), recipient_count: dispatched.length, sms_requested: Boolean(sendSms), dispatched, messages: pack, intelligence };
}

module.exports = { dispatchExecutiveMessagePack, buildMessagePack };
