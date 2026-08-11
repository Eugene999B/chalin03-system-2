"use strict";

const {
  renderSystemKnowledgeManifest,
} = require("./aiSystemKnowledgeManifestService");
const {
  expertPacksForPrompt,
  renderExpertPacks,
} = require("./aiExpertPackService");

const PUBLIC_SYSTEM_MAX_LENGTH = 16000;
const MAX_PUBLIC_CONTINUITY_MESSAGES = 6;
const SYSTEM_KNOWLEDGE_VERSION = "2026-08-10-conversation-learning-v1";

// Product/advisory routing must be anchored to an actual CHALIN/product topic.
// Generic question verbs such as "what is", "explain" or "recommend" are not
// enough on their own, otherwise ordinary world-knowledge questions get routed
// into the CHALIN product context instead of the general/current-information lane.
const CHALIN_OR_ADVISORY_PATTERN = /(?:\bchalin(?:\s*03|\s*one)?\b|\b(?:audit intelligence|accounting intelligence|payroll|worker profile|spare parts|mining|equipment hire|installment finance|content studio|chalin intelligence)\b|\b(?:our|this|the|chalin(?:\s*03|\s*one)?)\s+(?:system|software|platform|module|feature|workspace|website|marketing|branding|sales strategy|customer experience|it|technology|technical architecture|cybersecurity|security design|database design|workflow|process|procedure)\b)/i;

const LIVE_RECORD_REQUEST_PATTERN = /\b(?:show|list|find|lookup|pull|retrieve|fetch|check|investigate|analy[sz]e|review|open|tell me|give me)\b[\s\S]{0,100}\b(?:customer|worker|employee|staff|salary|payroll|payment|sale|sales|sold|selling|stock|transaction|invoice|receipt|debt|balance|inventory|account|application|contract|arrears|collection|expense|revenue|profit|cash|bank|supplier|store|branch)\b|\b(?:today'?s?|current|currently|latest|live|actual|real-time|right now|this month|this week|outstanding|overdue)\b[\s\S]{0,100}\b(?:sale|sales|sold|selling|payment|payments|stock|inventory|balance|debt|debts|arrears|collection|collections|payroll|salary|salaries|invoice|invoices|transaction|transactions|cash|revenue|profit|worker|employee|customer|performance|operations|health|store|branch)\b|\b(?:sale|sales|sold|selling|sell|revenue|cash|payments?|collections?|invoice|invoices|invoiced|billing|performance|operations|health|portfolio|arrears|overdue|outstanding|balance)\b[\s\S]{0,100}\b(?:today|yesterday|this week|this month|current|latest|live|right now)\b|\b(?:production|produce|produced|dispatch|dispatched|fuel|diesel|stockpile|utili[sz]ation|breakdown|operating cost|cost per unit|mining cost|incident|crew|site closing)\b[\s\S]{0,120}\b(?:today|yesterday|this week|this month|current|currently|latest|live|actual|real-time|right now)\b|\b(?:today'?s?|yesterday|this week|this month|current|currently|latest|live|actual|real-time|right now)\b[\s\S]{0,120}\b(?:production|produce|produced|dispatch|dispatched|fuel|diesel|stockpile|utili[sz]ation|breakdown|operating cost|cost per unit|mining cost|incident|crew|site closing)\b|\b(?:whole[- ]system|group|company[- ]wide|all (?:businesses|workspaces|operations))\b[\s\S]{0,80}\b(?:performance|operations|health|figures|numbers|results|position|status|today|current|latest|live)\b|\b(?:my|our|this|that)\s+(?:customer|worker|employee|staff|salary|payroll|payment|sale|sales|transaction|invoice|receipt|debt|balance|stock|inventory|account|application|contract|arrears|collection|expense|revenue|profit|cash|bank|supplier|store|branch)\b|\b(?:worker|employee|staff)\s+(?:salary|wage|pay|debt|balance|account|payment|payments)\b|\b(?:salary|wage|pay)\s+(?:of|for)\s+(?:the\s+)?(?:worker|employee|staff|person)\b|\b(?:which|what)\s+(?:customer|worker|employee|staff)\b|\b(?:at|in|from|for)\s+(?:the\s+)?(?:main|head|first|second|current|selected|same|other)?\s*(?:store|branch|site|location)\b|\b(?:main|head)\s+(?:store|branch)\b/i;

const PRIVATE_RESULT_PATTERN = /\b(?:branch\s+id|site\s+id|location\s+id|worker\s+id|employee\s+id|customer\s+id|transaction\s+count|total\s+sales|total\s+paid|total\s+balance|collection\s+rate|account\s+number|phone\s+number|email\s+address|salary\s+amount)\b/i;

const PRIVATE_CONTINUITY_MARKER_PATTERN = /(?:\b(?:private|confidential|restricted|internal)\b[\s\S]{0,80}\b(?:chalin|system context|sales snapshot|business data|business record|evidence|operational|financial|payroll|customer|worker|staff)\b|\b(?:approved|governed)\s+evidence\b|\[(?:E|M)\d+\]|\bconversation rollover\b|\bhistorical context only\b)/i;

const SENSITIVE_LITERAL_PATTERN = /(?:\b(?:ghs|gh¢|usd|eur|gbp)\s*\d|\b\d{7,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:api[_-]?key|password|secret|token)\s*[:=])/i;

const CHALIN_PRODUCT_CONTEXT = String.raw`
CHALIN 03 / CHALIN ONE is an integrated business operating system with protected workspaces and shared intelligence. Treat this as product knowledge, not as live company data.

System knowledge version: ${SYSTEM_KNOWLEDGE_VERSION}.

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

How CHALIN Copilot should behave:
- Treat short replies as possible continuations of the immediately preceding task. If Copilot asked for a branch, store, date, worker or other missing detail, the user's next short answer should resume that task rather than restart the conversation.
- Understand natural business wording, imperfect grammar and ordinary synonyms such as sold/selling/sell, bought/purchased, collected/received and common short location answers such as "main store".
- Explain the requested feature directly in plain language before giving technical detail.
- For IT/software questions, reason about architecture, reliability, security, UX, data flows, integrations, deployment and maintainability using the known CHALIN product context plus general technical knowledge.
- For marketing/branding/sales questions, act like a capable marketing and product strategist: identify audiences, positioning, benefits, proof points, channels, campaigns, messaging, conversion paths and measurement ideas. Do not invent live CHALIN revenue, customer counts or campaign results.
- For business/process advice, diagnose the problem, compare options, state trade-offs and recommend practical next steps.
- For general external knowledge, answer normally from the model's knowledge while being clear when current live web verification would be required.
- Prefer a direct answer first. Do not bury a simple answer under a long menu tutorial or unrelated explanation.
- Never expose passwords, API keys, secrets, authentication tokens or another user's private conversation.
- Product knowledge may be discussed across all CHALIN workspaces. Live records remain permission-scoped and should only be fetched when the user actually asks for current/private business data.

${renderSystemKnowledgeManifest()}
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
  if (PRIVATE_CONTINUITY_MARKER_PATTERN.test(text)) return false;
  if (isLikelyLiveRecordRequest(text) && !isChalinProductKnowledgeTurn(text)) return false;
  return true;
}

function productKnowledgeInstruction(prompt = "") {
  const packs = expertPacksForPrompt(prompt);
  const renderedPacks = renderExpertPacks(packs);
  return [
    "This is a CHALIN system/product/advisory reasoning turn. Use the static product context below and your general reasoning ability. Do not claim that static product context is a live database result. Answer naturally like a strong general-purpose AI assistant; interpret the user's intent instead of dumping fields or policy text. Preserve the immediately relevant safe conversation thread when supplied. Answer directly first, then add only the detail that helps.",
    CHALIN_PRODUCT_CONTEXT,
    renderedPacks
      ? `Relevant source-derived expert knowledge for this question:\n${renderedPacks}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function latestUserPrompt(messages = []) {
  for (let index = (Array.isArray(messages) ? messages.length : 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const content = clean(message?.content, PUBLIC_SYSTEM_MAX_LENGTH);
    if (content) return content;
  }
  return "";
}

function safePublicContinuityMessages(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const latestUserIndex = (() => {
    for (let index = source.length - 1; index >= 0; index -= 1) {
      if (String(source[index]?.role || "").toLowerCase() === "user") return index;
    }
    return -1;
  })();
  if (latestUserIndex <= 0) return Object.freeze([]);

  const selected = [];
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const role = String(source[index]?.role || "").toLowerCase();
    if (!["user", "assistant"].includes(role)) continue;
    const content = clean(source[index]?.content, 12000);
    if (!content) continue;
    if (!isSafePublicContinuityText(content)) break;
    selected.unshift(Object.freeze({ role, content }));
    if (selected.length >= MAX_PUBLIC_CONTINUITY_MESSAGES) break;
  }
  return Object.freeze(selected);
}

function productKnowledgeMessages(messages = []) {
  const prompt = latestUserPrompt(messages);
  if (!prompt) return Object.freeze([]);

  // External product/advisory reasoning may receive only a contiguous, sanitized
  // public-safe tail. The moment recent history looks live/private, continuity
  // stops so private CHALIN records cannot cross the public provider boundary.
  return Object.freeze([
    Object.freeze({ role: "system", content: productKnowledgeInstruction(prompt) }),
    ...safePublicContinuityMessages(messages),
    Object.freeze({ role: "user", content: prompt }),
  ]);
}

module.exports = {
  CHALIN_OR_ADVISORY_PATTERN,
  CHALIN_PRODUCT_CONTEXT,
  LIVE_RECORD_REQUEST_PATTERN,
  MAX_PUBLIC_CONTINUITY_MESSAGES,
  PRIVATE_CONTINUITY_MARKER_PATTERN,
  PRIVATE_RESULT_PATTERN,
  PUBLIC_SYSTEM_MAX_LENGTH,
  SENSITIVE_LITERAL_PATTERN,
  SYSTEM_KNOWLEDGE_VERSION,
  clean,
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  isSafePublicContinuityText,
  latestUserPrompt,
  productKnowledgeInstruction,
  productKnowledgeMessages,
  safePublicContinuityMessages,
};
