"use strict";

const { CHALIN_PRODUCT_CONTEXT } = require("../services/aiProductKnowledgeService");

const MAX_EVIDENCE_ITEMS = 5;
const MAX_EXCERPT_LENGTH = 1200;
const MAX_READABLE_FACTS = 14;
const LOCAL_MODEL_KEY = "chalin-local-governed-v1";

const LOCAL_LIVE_TOOL_KEYS = Object.freeze([
  "system.group_intelligence",
  "spare_parts.operations_snapshot",
  "spare_parts.inventory_health",
  "spare_parts.collections_health",
  "mining.operations_snapshot",
  "mining.stock_fuel_health",
  "mining.production_cost_health",
  "equipment_hire.operations_snapshot",
  "equipment_hire.fleet_health",
  "equipment_hire.receivables_health",
  "equipment_finance.portfolio_health",
  "equipment_finance.arrears_health",
  "equipment_finance.cashflow_health",
  "equipment_finance.sales_pipeline",
]);

const TOOL_HINTS = Object.freeze([
  Object.freeze({
    key: "system.group_intelligence",
    pattern: /\b(?:whole[- ]system|group performance|group intelligence|across all (?:businesses|workspaces|operations)|all (?:businesses|workspaces|operations)|company[- ]wide operations|overall chalin performance)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.arrears_health",
    pattern: /\b(arrears?|overdue|delinquen|late payment|past due)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.cashflow_health",
    pattern: /\b(cash\s*flow|collection trend|scheduled payment|payment method|expected collection)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.sales_pipeline",
    pattern: /\b(credit application|kyc|affordability|sales pipeline|finance application|application pipeline)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance.portfolio_health",
    pattern: /\b(installment|finance portfolio|financed equipment|portfolio health)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.fleet_health",
    pattern: /\b(fleet|asset availability|maintenance|breakdown|utili[sz]ation|on hire)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.receivables_health",
    pattern: /\b(hire receivable|hire invoice|uninvoiced|hire collection|hire overdue)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire.operations_snapshot",
    pattern: /\b(hire operation|quotation|hire contract|work log|equipment hire)\b/i,
  }),
  Object.freeze({
    key: "mining.stock_fuel_health",
    pattern: /\b(fuel|stockpile|diesel|tank|ore stock|mining stock)\b/i,
  }),
  Object.freeze({
    key: "mining.production_cost_health",
    pattern: /\b(production|cost per|operating cost|mining cost|equipment utili[sz]ation|incident)\b/i,
  }),
  Object.freeze({
    key: "mining.operations_snapshot",
    pattern: /\b(mining|mine|site operation|dispatch|crew|site closing)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.inventory_health",
    pattern: /\b(inventory|stock|low stock|negative stock|product quantity|stock value)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.collections_health",
    pattern: /\b(debt|debtor|collection|credit sale|outstanding balance|receivable)\b/i,
  }),
  Object.freeze({
    key: "spare_parts.operations_snapshot",
    pattern: /\b(spare parts|sales|purchase|return|expense|branch operation|store performance)\b/i,
  }),
]);

const WORKSPACE_DEFAULT_TOOLS = Object.freeze({
  spare_parts: Object.freeze(["spare_parts.operations_snapshot"]),
  mining: Object.freeze(["mining.operations_snapshot"]),
  equipment_hire: Object.freeze([
    "equipment_hire.operations_snapshot",
    "equipment_finance.portfolio_health",
  ]),
});

function clean(value, maximum = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function evidenceFromMessages(messages = []) {
  const seen = new Set();
  const evidence = [];
  const pattern = /\[(E\d+)\]\s+([^\n]+)\n([\s\S]*?)(?=\n\n\[E\d+\]|$)/g;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!["system", "developer"].includes(String(message?.role || "").toLowerCase())) {
      continue;
    }
    const content = String(message?.content || "");
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) && evidence.length < MAX_EVIDENCE_ITEMS) {
      const citation = match[1];
      if (seen.has(citation)) continue;
      const heading = clean(match[2], 360);
      const excerpt = clean(match[3], MAX_EXCERPT_LENGTH);
      if (!excerpt) continue;
      seen.add(citation);
      evidence.push({ citation, heading, excerpt });
    }
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
  }

  return evidence;
}

function latestUserQuestion(messages = []) {
  for (let index = (Array.isArray(messages) ? messages.length : 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const question = clean(message?.content, 2000);
    if (question) return question;
  }
  return "";
}

function offeredReadOnlyToolMap(tools = []) {
  const allowed = new Set(LOCAL_LIVE_TOOL_KEYS);
  const result = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const key = clean(tool?.key, 150).toLowerCase();
    if (!allowed.has(key)) continue;
    if (Number(tool?.risk_level || 0) !== 1) continue;
    result.set(key, tool);
  }
  return result;
}

function chooseLocalReadTool({ messages = [], tools = [], providerContext = {} } = {}) {
  if (
    providerContext?.public_safe_social_turn === true ||
    providerContext?.public_safe_system_turn === true ||
    providerContext?.public_safe_general_turn === true
  ) {
    return null;
  }
  if (evidenceFromMessages(messages).length > 0) return null;

  const offered = offeredReadOnlyToolMap(tools);
  if (offered.size === 0) return null;

  const question = latestUserQuestion(messages);
  for (const hint of TOOL_HINTS) {
    if (hint.pattern.test(question) && offered.has(hint.key)) {
      return offered.get(hint.key);
    }
  }

  const workspace = clean(providerContext?.workspace_code, 50).toLowerCase();
  for (const key of WORKSPACE_DEFAULT_TOOLS[workspace] || []) {
    if (offered.has(key)) return offered.get(key);
  }

  if (offered.size === 1) return [...offered.values()][0];
  return null;
}

function readableLabel(value) {
  return clean(value, 200)
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function collectReadableFacts(value, path = [], facts = [], depth = 0) {
  if (facts.length >= MAX_READABLE_FACTS || depth > 4 || value === null || value === undefined) {
    return facts;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    const label = readableLabel(path.join(" ") || "Value");
    facts.push(`${label}: ${clean(value, 240)}`);
    return facts;
  }

  if (Array.isArray(value)) {
    if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
      const label = readableLabel(path.join(" ") || "Values");
      facts.push(`${label}: ${value.slice(0, 6).map((item) => clean(item, 80)).join(", ")}`);
      return facts;
    }
    const label = readableLabel(path.join(" ") || "Items");
    facts.push(`${label}: ${value.length} item${value.length === 1 ? "" : "s"}`);
    for (const item of value.slice(0, 2)) {
      collectReadableFacts(item, path, facts, depth + 1);
      if (facts.length >= MAX_READABLE_FACTS) break;
    }
    return facts;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectReadableFacts(item, [...path, key], facts, depth + 1);
      if (facts.length >= MAX_READABLE_FACTS) break;
    }
  }
  return facts;
}

function readableExcerpt(excerpt) {
  const raw = clean(excerpt, MAX_EXCERPT_LENGTH);
  if (!raw) return "";
  if (!/^[\[{]/.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    const facts = collectReadableFacts(parsed);
    return facts.length > 0 ? facts.join("; ") : raw;
  } catch {
    return raw;
  }
}

function composeEvidenceAnswer(messages = []) {
  const evidence = evidenceFromMessages(messages);
  if (evidence.length === 0) {
    return "I do not have enough approved live CHALIN evidence to answer that reliably in local fallback mode. I will not guess or substitute an unrelated workspace snapshot.";
  }

  const lines = evidence.map((item) => {
    const excerpt = readableExcerpt(item.excerpt);
    return `- ${item.heading}: ${excerpt}${excerpt.endsWith(".") ? "" : "."} [${item.citation}]`;
  });
  return [
    "Here is what the approved CHALIN evidence shows:",
    "",
    ...lines,
    "",
    "This is the local governed fallback. It used only the supplied evidence and did not execute a business change.",
  ].join("\n");
}

function composePublicSafeSocialAnswer(messages = []) {
  const question = latestUserQuestion(messages).toLowerCase();
  if (/\b(?:thanks|thank you)\b/.test(question)) {
    return "You’re welcome. I’m ready whenever you need help with CHALIN or a general question.";
  }
  if (/\b(?:bye|goodbye|see you)\b/.test(question)) {
    return "Goodbye. I’ll be here when you need me.";
  }
  if (/\bwho are you\b/.test(question)) {
    return "I’m CHALIN Copilot, your governed assistant for the CHALIN system. I can explain the product, help think through IT, marketing and business questions, and investigate approved live business information when your permissions allow it.";
  }
  if (/\b(?:what can you do|how can you help|can you help)\b/.test(question)) {
    return "I can explain CHALIN workflows, help with IT and marketing ideas, reason through business problems, and answer approved live business questions using the information and read-only tools your account is allowed to access.";
  }
  return "Hi! I’m ready to help. You can ask about CHALIN, IT, marketing, business decisions or your authorized operational information.";
}

function composePublicSafeSystemAnswer(messages = []) {
  const question = latestUserQuestion(messages).toLowerCase();

  if (/\baudit(?:\s+|-)intelligence\b|\badvanced accounting intelligence\b/.test(question)) {
    return [
      "Audit Intelligence is CHALIN’s management and audit observatory. It is meant to help you understand whether the business records make sense and where management should investigate.",
      "",
      "It brings together signals from sales and collections, unpaid balances and debts, expenses and purchases, returns/refunds, stock adjustments and transfers, SMS delivery, sensitive system events, backup/restore and maintenance activity, audit unlocks and sign-off controls. It then presents items such as an audit score/status, an audit review checklist, profit-and-loss intelligence, management ledger and debt/aging intelligence.",
      "",
      "So the purpose is not simply to display numbers. It should help answer questions such as: what looks unusual, where controls are weak, what is not reconciling, what risk needs attention, and what management should review next.",
    ].join("\n");
  }

  if (/\bpayroll\b|\bworker profile\b|\bsalary\b/.test(question)) {
    return "In CHALIN, People & Employment should be the source of worker identity and compensation. A worker’s effective salary/pay-frequency record should flow into Monthly Payroll so the salary is not retyped every month. Payroll then previews the workers and authoritative salaries for the period before approval, payment and payslip generation.";
  }

  if (/\bmarketing\b|\badvertis|\bbrand|\bcampaign|\bpositioning\b/.test(question)) {
    return "For CHALIN marketing, position the product around operational control rather than a long feature list: one governed system for sales, stock, people, payroll, mining, equipment operations, finance, audit and management intelligence. Build separate messages for each buyer type, show concrete before/after workflows, use demonstrations and proof points, and measure qualified leads, demo-to-trial conversion, activation and retained business use. A full external reasoning provider can develop campaigns, copy and channel strategy in much more depth.";
  }

  if (/\barchitecture\b|\bsoftware\b|\bit\b|\btechnical\b|\bdatabase\b|\bsecurity\b|\bcyber/.test(question)) {
    return "CHALIN should be treated as a multi-workspace business platform with server-enforced permissions, scoped business services, audit evidence and a separate AI tool boundary. For IT decisions, prioritize reliability, explicit workspace/data boundaries, least privilege, transactional business operations, observable deployments, recoverability and APIs that the AI can use through governed tools instead of direct database access.";
  }

  return `I can explain this from CHALIN’s product model and help reason about it. The local fallback has the following static system context available: ${clean(CHALIN_PRODUCT_CONTEXT, 900)}… A configured external reasoning model is preferred for a deeper, more conversational answer.`;
}

function composePublicSafeGeneralAnswer() {
  return "This question does not require private CHALIN records. A configured external reasoning provider should answer it normally. CHALIN Local is only the governed fallback, so I will not pretend it has broad world knowledge that it does not have.";
}

function localToolCall(tool) {
  const key = clean(tool?.key, 150).toLowerCase();
  return Object.freeze({
    id: `local_${key.replace(/[^a-z0-9]+/gi, "_").slice(0, 90)}`,
    tool_key: key,
    input: Object.freeze({}),
  });
}

class LocalGovernedProvider {
  constructor() {
    this.key = "local";
  }

  async generate({ messages = [], tools = [], provider_context = {} } = {}) {
    if (provider_context?.public_safe_social_turn === true) {
      const text = composePublicSafeSocialAnswer(messages);
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    }

    if (provider_context?.public_safe_system_turn === true) {
      const text = composePublicSafeSystemAnswer(messages);
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    }

    if (provider_context?.public_safe_general_turn === true) {
      const text = composePublicSafeGeneralAnswer(messages);
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    }

    const selectedTool = chooseLocalReadTool({
      messages,
      tools,
      providerContext: provider_context,
    });

    if (selectedTool) {
      const text = `Checking the approved ${clean(selectedTool.title || selectedTool.key, 180)} evidence before answering.`;
      return {
        text,
        model_key: LOCAL_MODEL_KEY,
        input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
        output_tokens: Math.ceil(text.length / 4),
        cost_micros: 0,
        finish_reason: "local_read_only_tool",
        tool_calls: [localToolCall(selectedTool)],
        provider_store_enabled: false,
      };
    }

    const text = composeEvidenceAnswer(messages);
    return {
      text,
      model_key: LOCAL_MODEL_KEY,
      input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
      output_tokens: Math.ceil(text.length / 4),
      cost_micros: 0,
      finish_reason: "stop",
      tool_calls: [],
      provider_store_enabled: false,
    };
  }
}

module.exports = {
  LOCAL_LIVE_TOOL_KEYS,
  LOCAL_MODEL_KEY,
  LocalGovernedProvider,
  TOOL_HINTS,
  WORKSPACE_DEFAULT_TOOLS,
  chooseLocalReadTool,
  collectReadableFacts,
  composeEvidenceAnswer,
  composePublicSafeGeneralAnswer,
  composePublicSafeSocialAnswer,
  composePublicSafeSystemAnswer,
  evidenceFromMessages,
  latestUserQuestion,
  localToolCall,
  offeredReadOnlyToolMap,
  readableExcerpt,
};
