"use strict";

const PUBLIC_SYSTEM_MAX_LENGTH = 16000;

const CHALIN_OR_ADVISORY_PATTERN = /\b(?:chalin(?:\s*03|\s*one)?|system|software|platform|module|feature|workspace|audit intelligence|accounting intelligence|payroll|worker profile|people|employment|spare parts|mining|equipment hire|installment finance|content studio|website|marketing|advertis(?:e|ing)|brand(?:ing)?|sales strategy|customer experience|it\b|technology|technical|architecture|cybersecurity|security design|database design|workflow|process|procedure|how does|how do|what does|what is|explain|describe|purpose|help me understand|advise|advice|recommend|strategy|idea|improve|design|plan)\b/i;

const LIVE_RECORD_REQUEST_PATTERN = /\b(?:show|list|find|lookup|pull|retrieve|fetch|check|investigate|analy[sz]e|review|open)\b[\s\S]{0,80}\b(?:customer|worker|employee|staff|salary|payroll|payment|sale|sales|transaction|invoice|receipt|debt|balance|stock|inventory|account|application|contract|arrears|collection|expense|revenue|profit|cash|bank|supplier)\b|\b(?:today'?s?|current|currently|latest|live|actual|real-time|right now|this month|this week|outstanding|overdue)\b[\s\S]{0,80}\b(?:sale|sales|payment|payments|stock|inventory|balance|debt|debts|arrears|collection|collections|payroll|salary|salaries|invoice|invoices|transaction|transactions|cash|revenue|profit|worker|employee|customer)\b|\b(?:salary|wage|pay)\s+(?:of|for)\s+(?:the\s+)?(?:worker|employee|staff|person)\b|\b(?:which|what)\s+(?:customer|worker|employee|staff)\b|\bhow\s+much\s+(?:does|did|is|are|was|were)\b/i;

const PRIVATE_RESULT_PATTERN = /\b(?:branch\s+id|site\s+id|location\s+id|worker\s+id|employee\s+id|customer\s+id|transaction\s+count|total\s+sales|total\s+paid|total\s+balance|collection\s+rate|account\s+number|phone\s+number|email\s+address|salary\s+amount)\b/i;

const SENSITIVE_LITERAL_PATTERN = /(?:\b(?:ghs|gh¢|usd|eur|gbp)\s*\d|\b\d{7,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:api[_-]?key|password|secret|token)\s*[:=])/i;

const CHALIN_PRODUCT_CONTEXT = String.raw`
CHALIN 03 / CHALIN ONE is an integrated business operating system with protected workspaces and shared intelligence. Treat this as product knowledge, not as live company data.

Core product areas:
- Spare Parts: stores/branches, products, suppliers, purchases, sales, receipts, customers, debts/collections, returns/refunds, stock adjustments, stock transfers, daily closing, reports, users, worker profiles and employment documents.
- Mining Operations: mining sites, shifts/daily logs, production, stockpiles, equipment activity, fuel control, workforce/contractors, expenses/site cost, safety/incidents, reports and operational intelligence.
- Equipment Hire: enquiries, quotations, availability, contracts, dispatch, job cards/work logs, invoices, payments, returns, fleet utilization, maintenance and receivables intelligence.
- Equipment Installment Finance: credit applications, KYC, affordability, approvals, financed equipment, installment accounts, schedules, collections, arrears, portfolio health, cash-flow intelligence, documents and ownership transfer.
- People & Employment / Payroll: worker profiles, employment information, effective-dated compensation, basic salary/pay frequency, payroll preview, approval, payment and payslips. Salary entered for a worker should flow from the worker's authoritative compensation record into payroll rather than being retyped every month.
- Content Studio: governed editorial drafting, independent review, approval and publishing for public content.
- Public Website: company/product information and public-facing content.
- CHALIN Intelligence: Copilot and Executive experiences that combine system/product knowledge, permission-scoped business evidence, conversation continuity and approved tools.

Audit / Advanced Accounting Intelligence:
- It is a management and audit observatory, not merely a sales report.
- It reviews a selected period and authorized store scope across sales, collections, unpaid balances, debts, expenses, purchases, returns/refunds, stock adjustments, stock transfers, SMS delivery signals, backup/restore activity, maintenance activity, audit unlocks, sensitive system events and sign-off controls.
- It presents an audit score/status, audit review checklist, financial command snapshot, profit-and-loss intelligence, management ledger, debt/aging intelligence and control signals that help management identify inconsistencies, risk and areas requiring investigation.
- A product-help question about Audit Intelligence should explain this purpose and workflow. It should never trigger a random live Spare Parts snapshot unless the user explicitly asks for current operational figures.

How CHALIN Copilot should behave for product/advisory questions:
- Explain the requested feature directly in plain language before giving technical detail.
- For IT/software questions, reason about architecture, reliability, security, UX, data flows, integrations, deployment and maintainability using the known CHALIN product context plus general technical knowledge.
- For marketing/branding/sales questions, act like a capable marketing and product strategist: identify audiences, positioning, benefits, proof points, channels, campaigns, messaging, conversion paths and measurement ideas. Do not invent live CHALIN revenue, customer counts or campaign results.
- For business/process advice, diagnose the problem, compare options, state trade-offs and recommend practical next steps.
- For general external knowledge, answer normally from the model's knowledge while being clear when current live web verification would be required.
- Never expose passwords, API keys, secrets, authentication tokens or another user's private conversation.
- Product knowledge may be discussed across all CHALIN workspaces. Live records remain permission-scoped and should only be fetched when the user actually asks for current/private business data.
`;

function clean(value, maximum = PUBLIC_SYSTEM_MAX_LENGTH) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function isLikelyLiveRecordRequest(value) {
  const text = clean(value);
  if (!text) return false;
  if (SENSITIVE_LITERAL_PATTERN.test(text)) return true;
  return LIVE_RECORD_REQUEST_PATTERN.test(text);
}

function isChalinProductKnowledgeTurn(value) {
  const text = clean(value);
  if (!text || text.length > PUBLIC_SYSTEM_MAX_LENGTH) return false;
  if (!CHALIN_OR_ADVISORY_PATTERN.test(text)) return false;
  if (isLikelyLiveRecordRequest(text)) return false;
  return true;
}

function isSafePublicContinuityText(value) {
  const text = clean(value, 12000);
  if (!text) return false;
  if (SENSITIVE_LITERAL_PATTERN.test(text)) return false;
  if (PRIVATE_RESULT_PATTERN.test(text)) return false;
  if (isLikelyLiveRecordRequest(text) && !isChalinProductKnowledgeTurn(text)) return false;
  return true;
}

function productKnowledgeInstruction() {
  return [
    "This is a CHALIN system/product/advisory reasoning turn. Use the static product context below and your general reasoning ability. Do not claim that static product context is a live database result. Answer naturally like a strong general-purpose AI assistant; interpret the user's intent instead of dumping fields or policy text.",
    CHALIN_PRODUCT_CONTEXT,
  ].join("\n\n");
}

function productKnowledgeMessages(messages = []) {
  const safeHistory = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || "").toLowerCase();
    if (!["user", "assistant"].includes(role)) continue;
    const content = clean(message?.content, 12000);
    if (!isSafePublicContinuityText(content)) continue;
    safeHistory.push(Object.freeze({ role, content }));
  }

  const limitedHistory = safeHistory.slice(-16);
  return Object.freeze([
    Object.freeze({ role: "system", content: productKnowledgeInstruction() }),
    ...limitedHistory,
  ]);
}

module.exports = {
  CHALIN_OR_ADVISORY_PATTERN,
  CHALIN_PRODUCT_CONTEXT,
  LIVE_RECORD_REQUEST_PATTERN,
  PRIVATE_RESULT_PATTERN,
  PUBLIC_SYSTEM_MAX_LENGTH,
  SENSITIVE_LITERAL_PATTERN,
  clean,
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  isSafePublicContinuityText,
  productKnowledgeInstruction,
  productKnowledgeMessages,
};
