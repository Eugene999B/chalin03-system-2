"use strict";

const {
  buildConversationWorkingState,
} = require("./aiConversationWorkingStateService");

const MAX_PROMPT_CHARACTERS = 12000;
const MAX_HISTORY_TURNS = 8;
const MAX_OBJECTIVES = 8;

const DOMAIN_RULES = Object.freeze([
  Object.freeze({
    key: "payroll",
    pattern: /\b(?:payroll|salary|salaries|payslip|payslips|wage|wages|compensation|basic salary|pay frequency|salary deduction|salary allowance)\b/i,
  }),
  Object.freeze({
    key: "spare_parts",
    pattern: /\b(?:spare parts?|main store|debt desk|stock ledger|store sales|store profit|store inventory|branch sales|branch profit|branch inventory)\b/i,
  }),
  Object.freeze({
    key: "mining",
    pattern: /\b(?:mining|mine site|mining site|ore|site production|production shift|mining production|mining fuel)\b/i,
  }),
  Object.freeze({
    key: "equipment_hire",
    pattern: /\b(?:equipment hire|hire contract|hire quotation|hire invoice|rental|dispatcher|fleet utilisation|fleet utilization|hire location)\b/i,
  }),
  Object.freeze({
    key: "equipment_finance",
    pattern: /\b(?:equipment finance|installment finance|instalment finance|finance account|credit application|repayment schedule|opening deposit|down payment|installment agreement|instalment agreement)\b/i,
  }),
  Object.freeze({
    key: "customer_accounting",
    pattern: /\b(?:customer debt|customer account|customer statement|receivable|receivables|(?:what|how much) .* owe|owes us|owing us|collections?|debt payments?|customer payments?)\b/i,
  }),
  Object.freeze({
    key: "audit_controls_security",
    pattern: /\b(?:audit|audit trail|audit sign[- ]?off|security controls?|security events?|access controls?|permission changes?|backup restore|backup validation|unlock requests?|approval controls?|governance|risk[- ]?5)\b/i,
  }),
  Object.freeze({
    key: "chalin_product",
    pattern: /\b(?:tell me (?:more )?about chalin|what is chalin|chalin businesses|chalin business(?:es)?|chalin divisions?|what can chalin do|chalin capabilities|how does chalin work|chalin intelligence|chalin ai|chalin copilot|chalin executive|chalin guide|chalin system knowledge|chalin knowledge|chalin memory|chalin conversation|chalin provider|chalin tools?|chalin actions?|chalin document studio)\b/i,
  }),
]);

const WORKSPACE_DOMAIN = Object.freeze({
  spare_parts: "spare_parts",
  mining: "mining",
  equipment_hire: "equipment_hire",
  equipment_finance: "equipment_finance",
  installment_finance: "equipment_finance",
  instalment_finance: "equipment_finance",
});

const BUSINESS_SIGNAL_PATTERN = /\b(?:sale|sales|sold|sell|selling|profit|margin|stock|inventory|customer|debt|owe|owing|payment|collection|payroll|salary|worker|employee|production|cost|expense|contract|invoice|arrears|receivable)\b/i;
const LIVE_SIGNAL_PATTERN = /\b(?:today|yesterday|now|current|currently|latest|live|outstanding|overdue|active|this week|this month|last week|last month|right now)\b/i;
const INTRINSIC_LIVE_PATTERN = /\b(?:how much (?:did|do|does|is|are)|how many|current balance|current stock|stock level|outstanding debt|(?:what|how much) .* owe|owes us|owing us|sales today|sold today|profit today|margin today|production today|payments? today|collections? today)\b/i;
const REFERENTIAL_PATTERN = /\b(?:it|its|that|this|these|those|them|they|he|his|him|she|her|there|same|previous|earlier|yesterday)\b/i;
const FOLLOW_UP_START_PATTERN = /^(?:and\b|also\b|then\b|what about\b|how about\b|why\b|who\b|which\b|where\b|when\b|how much\b|how many\b|profit\b|sales?\b|margin\b|yesterday\b|today\b|there\b|same\b|do it\b|generate it\b|put that\b|put it\b|compare them\b|continue\b)/i;

const ANSWER_MODE_RULES = Object.freeze([
  Object.freeze({ key: "action", pattern: /^(?:please\s+)?(?:deactivate|disable|activate|rename|create|generate|export|send|issue|approve|reject|record|update|change|remove|archive|restore)\b/i }),
  Object.freeze({ key: "executive_brief", pattern: /\b(?:whole[- ]system|group[- ]wide|all businesses|all divisions|across (?:the )?(?:group|businesses|divisions)|executive brief|company[- ]wide performance)\b/i }),
  Object.freeze({ key: "decision_support", pattern: /\b(?:should we|what should|recommend|recommendation|best option|priorit(?:y|ize)|what do you suggest|decision)\b/i }),
  Object.freeze({ key: "diagnosis", pattern: /\b(?:why|what happened|cause|caused|diagnose|problem|issue|wrong|dropped|lower|higher|increase|decrease|variance|anomaly)\b/i }),
  Object.freeze({ key: "comparison", pattern: /\b(?:compare|comparison|versus|vs\.?|difference|better than|worse than|compared with|compared to)\b/i }),
  Object.freeze({ key: "investigation", pattern: /\b(?:trace|investigate|find out|which customer|who changed|who approved|(?:what|how much) .* owe|what did .* buy|did .* pay)\b/i }),
  Object.freeze({ key: "direct_fact", pattern: /^(?:how much|how many|who|which|when|where|what is the current|what's the current|show me (?:the )?(?:current|today))\b/i }),
  Object.freeze({ key: "explanation", pattern: /\b(?:explain|how does|how do|how is|how are|tell me about|tell me more about|what is|what are|procedure|process|policy|rule|work|works|governed)\b/i }),
]);

const DOMAIN_EVIDENCE_FAMILIES = Object.freeze({
  payroll: Object.freeze(["payroll", "worker"]),
  mining: Object.freeze(["mining"]),
  equipment_hire: Object.freeze(["equipment_hire"]),
  equipment_finance: Object.freeze(["equipment_finance"]),
  customer_accounting: Object.freeze(["customer", "debt"]),
  audit_controls_security: Object.freeze(["audit"]),
  spare_parts: Object.freeze([]),
  chalin_product: Object.freeze([]),
});

function clean(value, maximum = MAX_PROMPT_CHARACTERS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function recentTaskHistory(history = [], maximum = MAX_HISTORY_TURNS) {
  const source = Array.isArray(history) ? history : [];
  const limit = Math.max(1, Math.min(16, Number(maximum) || MAX_HISTORY_TURNS));
  return Object.freeze(
    source
      .filter((item) => ["user", "assistant"].includes(String(item?.role || "").toLowerCase()))
      .map((item) => Object.freeze({
        role: String(item.role).toLowerCase(),
        content: clean(item.content, 2400),
      }))
      .filter((item) => item.content)
      .slice(-limit)
  );
}

function isContinuation(prompt, history = [], explicitTaskState = null) {
  if (explicitTaskState?.follow_up === true || explicitTaskState?.referential_language === true) return true;
  const text = clean(prompt, 2400);
  if (!text || recentTaskHistory(history).length === 0) return false;
  if (FOLLOW_UP_START_PATTERN.test(text) || REFERENTIAL_PATTERN.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 5 && BUSINESS_SIGNAL_PATTERN.test(text);
}

function objectiveList(prompt, suppliedSubquestions = []) {
  const supplied = Array.isArray(suppliedSubquestions)
    ? suppliedSubquestions.map((item) => clean(item, 1000)).filter(Boolean)
    : [];
  if (supplied.length > 1) return Object.freeze(unique(supplied).slice(0, MAX_OBJECTIVES));

  const text = clean(prompt, 8000);
  if (!text) return Object.freeze([]);
  const parts = text
    .split(/[?;\n]+/)
    .flatMap((part) => part.split(/,\s*(?=(?:and\s+)?(?:compare|explain|show|tell|find|identify|why|what|who|how|whether|which)\b)/i))
    .map((part) => clean(part, 1000).replace(/^and\s+/i, "").trim())
    .filter(Boolean);
  return Object.freeze(unique(parts).slice(0, MAX_OBJECTIVES));
}

function domainMatches(text) {
  return unique(DOMAIN_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.key));
}

function workingStateDomains(taskState = null) {
  const allowed = new Set(DOMAIN_RULES.map((rule) => rule.key));
  return unique(
    (Array.isArray(taskState?.working_state?.domains) ? taskState.working_state.domains : [])
      .map((item) => clean(item, 80))
      .filter((item) => allowed.has(item))
  ).slice(0, 5);
}

function isShortContinuation(prompt) {
  const text = clean(prompt, 2400);
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 7 && (FOLLOW_UP_START_PATTERN.test(text) || REFERENTIAL_PATTERN.test(text) || BUSINESS_SIGNAL_PATTERN.test(text));
}

function inferDomains({ prompt, history = [], workspaceCode = "", taskState = null } = {}) {
  const current = clean(prompt, 6000);
  const continuity = isContinuation(current, history, taskState);
  const recent = recentTaskHistory(history)
    .filter((item) => item.role === "user")
    .map((item) => item.content)
    .join(" \n ");
  let domains = domainMatches(current);
  let source = domains.length ? "current_prompt" : "none";

  if (!domains.length && continuity && recent) {
    domains = domainMatches(recent);
    if (domains.length) source = "conversation_continuity";
  }

  if (!domains.length && continuity && isShortContinuation(current)) {
    domains = workingStateDomains(taskState);
    if (domains.length) source = "working_state_continuity";
  }

  const workspaceDomain = WORKSPACE_DOMAIN[clean(workspaceCode, 80).toLowerCase()] || null;
  if (!domains.length && workspaceDomain && BUSINESS_SIGNAL_PATTERN.test(current)) {
    domains = [workspaceDomain];
    source = "authorized_workspace_context";
  }

  const confidence = source === "current_prompt"
    ? "high"
    : source === "conversation_continuity" || source === "working_state_continuity" || source === "authorized_workspace_context"
      ? "medium"
      : "low";

  return Object.freeze({
    domains: Object.freeze(domains),
    source,
    confidence,
    ambiguous: domains.length === 0 && BUSINESS_SIGNAL_PATTERN.test(current),
  });
}

function answerMode(prompt) {
  const text = clean(prompt, 6000);
  for (const rule of ANSWER_MODE_RULES) {
    if (rule.pattern.test(text)) return rule.key;
  }
  return "generic";
}

function answerFacets(prompt) {
  const text = clean(prompt, 6000);
  return Object.freeze(unique(ANSWER_MODE_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.key)));
}

function inferLiveDataRequired({ prompt, resolvedPrompt = "", domains = [] } = {}) {
  const current = clean(prompt, 6000);
  const resolved = clean(resolvedPrompt, 12000);
  if (domains.includes("chalin_product") && !BUSINESS_SIGNAL_PATTERN.test(current)) return false;
  if (
    INTRINSIC_LIVE_PATTERN.test(current) &&
    (domains.length > 0 || BUSINESS_SIGNAL_PATTERN.test(current))
  ) {
    return true;
  }
  const searchable = `${current} ${resolved}`;
  return BUSINESS_SIGNAL_PATTERN.test(searchable) && LIVE_SIGNAL_PATTERN.test(searchable);
}

function evidenceFamiliesForDomains(domains = []) {
  return Object.freeze(unique(domains.flatMap((domain) => DOMAIN_EVIDENCE_FAMILIES[domain] || [])));
}

function inferHints(text) {
  const value = clean(text, 8000);
  const times = unique((value.match(/\b(?:today|yesterday|this week|last week|this month|last month|now|current(?:ly)?)\b/gi) || []).map((item) => item.toLowerCase())).slice(0, 4);
  const metrics = unique(
    (value.match(/\b(?:sales?|sell(?:ing)?|sold|profit|margin|stock|inventory|debt|outstanding|collections?|payments?|salary|payroll|production|costs?|expenses?|receivables?|arrears)\b/gi) || [])
      .map((item) => item.toLowerCase())
      .map((item) => /^(?:sale|sales|sell|selling|sold)$/.test(item) ? "sales" : item)
  ).slice(0, 8);
  const explicitLocations = /\bmain store\b/i.test(value) ? ["Main Store"] : [];
  const genericLocations = (value.match(/\b[a-z][a-z-]{1,30}(?:\s+[a-z][a-z-]{1,30}){0,2}\s+(?:store|branch|site|location)\b/gi) || [])
    .map((item) => clean(item, 80))
    .filter((item) => !/\bmain store$/i.test(item));
  const locations = unique([...explicitLocations, ...genericLocations]).slice(0, 4);
  return Object.freeze({
    time_hints: Object.freeze(times),
    metric_hints: Object.freeze(metrics),
    location_hints: Object.freeze(locations),
  });
}

function understandConversationTask({
  prompt,
  history = [],
  workspaceCode = "",
  taskState = null,
  resolvedPrompt = "",
  subquestions = [],
} = {}) {
  const currentPrompt = clean(prompt, 12000);
  const continuityRequired = isContinuation(currentPrompt, history, taskState);
  const historyText = continuityRequired
    ? recentTaskHistory(history)
        .filter((item) => item.role === "user")
        .map((item) => item.content)
        .join("\n")
    : "";
  const continuityContext = resolvedPrompt || taskState?.resolved_prompt || historyText;
  const domainResult = inferDomains({
    prompt: currentPrompt,
    history,
    workspaceCode,
    taskState,
  });
  const objectives = objectiveList(currentPrompt, subquestions.length ? subquestions : taskState?.subquestions);
  const mode = answerMode(currentPrompt);
  const facets = answerFacets(currentPrompt);
  const liveDataRequired = inferLiveDataRequired({
    prompt: currentPrompt,
    resolvedPrompt: continuityContext,
    domains: domainResult.domains,
  });
  const hints = inferHints(`${continuityContext}\n${currentPrompt}`);

  const result = {
    version: 1,
    current_prompt: currentPrompt,
    answer_mode: mode,
    answer_facets: facets,
    domains: domainResult.domains,
    domain_source: domainResult.source,
    domain_confidence: domainResult.confidence,
    ambiguous_domain: domainResult.ambiguous,
    live_data_required: liveDataRequired,
    continuity_required: continuityRequired,
    objectives,
    objective_count: objectives.length,
    evidence_families: evidenceFamiliesForDomains(domainResult.domains),
    ...hints,
  };

  result.working_state = buildConversationWorkingState({
    prompt: currentPrompt,
    conversation: history,
    previousState: taskState?.working_state || null,
    taskUnderstanding: result,
    taskState,
  });

  return Object.freeze(result);
}

module.exports = {
  ANSWER_MODE_RULES,
  BUSINESS_SIGNAL_PATTERN,
  DOMAIN_EVIDENCE_FAMILIES,
  DOMAIN_RULES,
  FOLLOW_UP_START_PATTERN,
  INTRINSIC_LIVE_PATTERN,
  LIVE_SIGNAL_PATTERN,
  MAX_HISTORY_TURNS,
  MAX_OBJECTIVES,
  MAX_PROMPT_CHARACTERS,
  REFERENTIAL_PATTERN,
  WORKSPACE_DOMAIN,
  answerFacets,
  answerMode,
  clean,
  domainMatches,
  evidenceFamiliesForDomains,
  inferDomains,
  inferHints,
  inferLiveDataRequired,
  isContinuation,
  objectiveList,
  recentTaskHistory,
  understandConversationTask,
  unique,
  workingStateDomains,
};
