"use strict";

const MAX_EVIDENCE_ITEMS = 5;
const MAX_EXCERPT_LENGTH = 1200;
const MAX_READABLE_FACTS = 14;
const LOCAL_MODEL_KEY = "chalin-local-governed-v1";

const LOCAL_LIVE_TOOL_KEYS = Object.freeze([
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
    return "I do not have enough approved CHALIN evidence to answer that reliably in zero-cost local mode. Please use the governed enquiry path or try a question covered by published or approved system information.";
  }

  const lines = evidence.map((item) => {
    const excerpt = readableExcerpt(item.excerpt);
    return `- ${item.heading}: ${excerpt}${excerpt.endsWith(".") ? "" : "."} [${item.citation}]`;
  });
  return [
    "Based on the CHALIN evidence available to this conversation:",
    "",
    ...lines,
    "",
    "Zero-cost local mode used only approved CHALIN evidence. It did not invent missing facts or execute a business change.",
  ].join("\n");
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
  evidenceFromMessages,
  latestUserQuestion,
  localToolCall,
  offeredReadOnlyToolMap,
  readableExcerpt,
};
