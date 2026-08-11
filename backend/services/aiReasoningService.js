"use strict";

const { normalizeEvidenceList } = require("./aiEvidenceService");
const {
  understandConversationTask,
} = require("./aiConversationTaskUnderstandingService");
const {
  buildCrossDomainReasoningGraph,
} = require("./aiCrossDomainReasoningGraphService");

const MAX_RETRIEVAL_QUERIES = 10;
const MAX_REASONING_EVIDENCE = 32;
const MAX_HISTORY_MESSAGES = 48;
const MAX_TASK_CONTEXT_TURNS = 8;
const MAX_SUBQUESTIONS = 8;

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "are", "because",
  "been", "before", "being", "between", "but", "can", "could", "did",
  "does", "doing", "for", "from", "had", "has", "have", "how", "into",
  "its", "may", "might", "more", "most", "not", "now", "our", "please",
  "should", "show", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "through", "today", "under",
  "very", "was", "what", "when", "where", "which", "while", "who", "why",
  "will", "with", "would", "you", "your",
]);

const TIME_WORDS = new Set([
  "active", "currently", "current", "latest", "live", "now", "outstanding",
  "overdue", "recent", "status", "today", "tonight", "yesterday",
]);

const OPERATIONAL_WORDS = new Set([
  "arrears", "balance", "cash", "collection", "collections", "collected",
  "contract", "contracts", "cost", "costs", "customer", "customers", "debt",
  "debts", "employee", "employees", "equipment", "expense", "expenses",
  "finance", "hire", "inventory", "margin", "margins", "owe", "owes",
  "owing", "payment", "payments", "payroll", "profit", "profits", "purchase",
  "purchases", "purchased", "bought", "quantity", "received", "revenue",
  "sale", "sales", "salary", "sell", "selling", "sold", "stock",
  "transaction", "transactions", "worker", "workers",
]);

const NON_OPERATIONAL_TOOL_KEYS = new Set([
  "knowledge.search",
  "conversation.memory",
  "system.scope_summary",
  "system.ai_feature_status",
]);

const LIVE_OPERATIONAL_EVIDENCE_TYPES = new Set([
  "system_snapshot",
  "mining_snapshot",
  "equipment_finance_snapshot",
  "hire_snapshot",
]);

const INTENT_PATTERNS = Object.freeze([
  ["compare", /\b(compare|comparison|versus|vs\.?|difference|better than|worse than)\b/i],
  ["diagnose", /\b(why|cause|caused|diagnose|problem|issue|wrong|drop|increase|decrease|variance|anomaly)\b/i],
  ["forecast", /\b(forecast|predict|projection|project|scenario|what if|likely|next week|next month|future)\b/i],
  ["summarize", /\b(summarize|summary|recap|overview|brief|digest)\b/i],
  ["decision_support", /\b(recommend|recommendation|should we|what should|decision|priority|prioritize|best option|risk)\b/i],
  ["explain", /\b(explain|how does|how do|meaning|procedure|process|policy|rule|steps)\b/i],
]);

const FOLLOW_UP_START_PATTERN =
  /^(?:and\b|also\b|then\b|what about\b|how about\b|what if\b|why\b|who\b|which\b|where\b|when\b|how much\b|how many\b|profit\b|sales?\b|margin\b|yesterday\b|today\b|tomorrow\b|there\b|same\b|the same\b|do it\b|generate it\b|print it\b|put that\b|put it\b|compare them\b|summarize it\b|continue\b|proceed\b)/i;
const REFERENTIAL_PATTERN =
  /\b(?:it|its|that|this|these|those|them|they|he|his|him|she|her|there|same|other|another|everything|above|previous|earlier)\b/i;
const SOCIAL_ONLY_PATTERN =
  /^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|okay|ok|alright|great|nice|cool|bye)[!.\s]*$/i;
const COMPOUND_CLAUSE_START =
  /(?:and\s+)?(?:tell|show|calculate|compute|compare|generate|create|summarize|identify|find|explain|give|put|include|who|what|why|how|whether|which)\b/i;

function clean(value, maxLength = 32000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function tokenizeReasoning(value) {
  return (
    clean(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9][a-z0-9._-]{1,}/g) || []
  ).map((token) => token.replace(/^[-_.]+|[-_.]+$/g, "")).filter(Boolean);
}

function meaningfulTokens(value) {
  return [...new Set(tokenizeReasoning(value).filter((token) => !STOP_WORDS.has(token)))];
}

function classifyIntent(prompt) {
  const text = clean(prompt, 32000);
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }
  return "lookup";
}

function requiresLiveData(prompt) {
  const text = clean(prompt);
  const tokens = new Set(tokenizeReasoning(text));
  const hasOperational = [...tokens].some((token) => OPERATIONAL_WORDS.has(token));
  const hasTimeSignal = [...tokens].some((token) => TIME_WORDS.has(token));
  const intrinsicallyLive = /\b(stock|quantity|balance|outstanding|overdue|owe|owes|owing|active (?:hire|finance|contract)|sales? today|sold today|selling today|payments? today|collections? today|profit today|margin today|cash position|current status)\b/i.test(text);
  return intrinsicallyLive || (hasOperational && hasTimeSignal);
}

function quotedPhrases(prompt) {
  const matches = [];
  const pattern = /["“”']([^"“”']{3,100})["“”']/g;
  let match;
  while ((match = pattern.exec(clean(prompt, 32000)))) {
    const phrase = clean(match[1], 100);
    if (phrase) matches.push(phrase);
  }
  return [...new Set(matches)].slice(0, 5);
}

function comparisonSides(prompt) {
  const text = clean(prompt, 32000);
  const match = text.match(/(.{2,160}?)\s+(?:vs\.?|versus|compared? (?:with|to)|against)\s+(.{2,160})/i);
  if (!match) return [];
  return [clean(match[1], 160), clean(match[2], 160)].filter(Boolean);
}

function addUniqueQuery(target, value) {
  const query = clean(value, 500).replace(/\s+/g, " ");
  if (!query || query.length < 2) return;
  const identity = query.toLowerCase();
  if (target.some((item) => item.toLowerCase() === identity)) return;
  target.push(query);
}

function isSubstantiveTaskTurn(item = {}) {
  if (!["user", "assistant"].includes(item?.role)) return false;
  const text = clean(item?.content, 4000);
  if (!text) return false;
  if (item.role === "user" && SOCIAL_ONLY_PATTERN.test(text)) return false;
  return true;
}

function recentTaskTurns(history = [], maximum = MAX_TASK_CONTEXT_TURNS) {
  const source = Array.isArray(history) ? history : [];
  const safeMaximum = Math.max(2, Math.min(16, Number(maximum) || MAX_TASK_CONTEXT_TURNS));
  return Object.freeze(
    source
      .filter(isSubstantiveTaskTurn)
      .slice(-safeMaximum)
      .map((item) =>
        Object.freeze({
          role: item.role,
          content: clean(item.content, 4000),
          authority: item.role === "assistant" ? "continuity_only_not_evidence" : "user_instruction_context",
        })
      )
  );
}

function isLikelyFollowUp(prompt, history = []) {
  const text = clean(prompt, 2000);
  if (!text || SOCIAL_ONLY_PATTERN.test(text)) return false;
  const taskTurns = recentTaskTurns(history, MAX_TASK_CONTEXT_TURNS);
  if (!taskTurns.length) return false;
  if (FOLLOW_UP_START_PATTERN.test(text) || REFERENTIAL_PATTERN.test(text)) return true;

  const tokens = tokenizeReasoning(text);
  if (tokens.length <= 5) {
    return tokens.some(
      (token) =>
        TIME_WORDS.has(token) ||
        OPERATIONAL_WORDS.has(token) ||
        ["more", "again", "same", "other", "document", "pdf", "excel", "word"].includes(token)
    );
  }
  return false;
}

function normalizeSubquestion(value) {
  return clean(value, 700)
    .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
    .replace(/^and\s+/i, "")
    .trim();
}

function decomposeSubquestions(prompt) {
  const text = clean(prompt, 12000);
  if (!text) return Object.freeze([]);

  const firstPass = text
    .split(/[?;\n]+/)
    .map(normalizeSubquestion)
    .filter(Boolean);
  const expanded = [];

  for (const part of firstPass) {
    const commaParts = part.split(/,\s*(?=(?:and\s+)?(?:tell|show|calculate|compute|compare|generate|create|summarize|identify|find|explain|give|put|include|who|what|why|how|whether|which)\b)/i);
    for (const commaPart of commaParts) {
      const conjunctionParts = commaPart.split(/\s+and\s+(?=(?:tell|show|calculate|compute|compare|generate|create|summarize|identify|find|explain|give|put|include|who|what|why|how|whether|which)\b)/i);
      expanded.push(...conjunctionParts);
    }
  }

  const unique = [];
  for (const value of expanded.map(normalizeSubquestion).filter(Boolean)) {
    const identity = value.toLowerCase();
    if (unique.some((item) => item.toLowerCase() === identity)) continue;
    unique.push(value);
    if (unique.length >= MAX_SUBQUESTIONS) break;
  }

  if (unique.length === 1 && COMPOUND_CLAUSE_START.test(unique[0]) === false) {
    return Object.freeze(unique);
  }
  return Object.freeze(unique);
}

function resolveConversationTaskState({ prompt, history = [] } = {}) {
  const currentPrompt = clean(prompt, 12000);
  const followUp = isLikelyFollowUp(currentPrompt, history);
  const contextTurns = followUp
    ? recentTaskTurns(history, MAX_TASK_CONTEXT_TURNS)
    : Object.freeze([]);
  const subquestions = decomposeSubquestions(currentPrompt);
  const hasReferentialLanguage = REFERENTIAL_PATTERN.test(currentPrompt);

  const resolvedPrompt = followUp
    ? [
        "Continue the existing user task using the following conversation context.",
        ...contextTurns.map((item) =>
          item.role === "assistant"
            ? `Assistant continuity only (not current evidence): ${item.content}`
            : `Prior user instruction/context: ${item.content}`
        ),
        `Current follow-up; this takes precedence anywhere it changes the earlier scope: ${currentPrompt}`,
      ].join("\n")
    : currentPrompt;

  return Object.freeze({
    follow_up: followUp,
    referential_language: hasReferentialLanguage,
    current_prompt: currentPrompt,
    resolved_prompt: resolvedPrompt,
    inherited_turn_count: contextTurns.length,
    inherited_turns: contextTurns,
    subquestions,
    subquestion_count: subquestions.length,
  });
}

function buildRetrievalQueries({ prompt, history = [] } = {}) {
  const queries = [];
  const text = clean(prompt, 32000);
  addUniqueQuery(queries, text);

  for (const phrase of quotedPhrases(text)) addUniqueQuery(queries, phrase);
  for (const side of comparisonSides(text)) addUniqueQuery(queries, side);

  const keywords = meaningfulTokens(text).filter((token) => token.length >= 3);
  if (keywords.length) addUniqueQuery(queries, keywords.slice(0, 16).join(" "));

  const priorUserTurns = [...history]
    .reverse()
    .filter((item) => item?.role === "user" && clean(item?.content, 2000))
    .slice(0, 4);
  for (const priorUser of priorUserTurns) {
    const carry = meaningfulTokens(`${priorUser.content} ${text}`)
      .filter((token) => token.length >= 3)
      .slice(0, 18)
      .join(" ");
    addUniqueQuery(queries, carry);
  }

  return Object.freeze(queries.slice(0, MAX_RETRIEVAL_QUERIES));
}

function overlapScore(query, text) {
  const queryTokens = meaningfulTokens(query);
  if (!queryTokens.length) return 0;
  const textTokens = new Set(meaningfulTokens(text));
  let matched = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) matched += 1;
  }
  return matched / queryTokens.length;
}

function evidenceRoot(item = {}) {
  const ref = clean(item.source_ref, 220);
  if (!ref) return "unknown";
  return ref.split("#", 1)[0].split(":chunk:", 1)[0];
}

function freshnessScore(value, now = Date.now()) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (now - time) / 86400000);
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.95;
  if (ageDays <= 30) return 0.82;
  if (ageDays <= 180) return 0.58;
  if (ageDays <= 365) return 0.38;
  return 0.16;
}

function scoreEvidence(item, queries, now = Date.now()) {
  const searchable = `${item?.label || ""} ${item?.source_ref || ""} ${item?.excerpt_text || ""}`;
  const lexical = Math.max(0, ...queries.map((query) => overlapScore(query, searchable)));
  const retrieval = Math.max(0, Math.min(1, Number(item?.metadata?.retrieval_score || 0)));
  const freshness = freshnessScore(item?.as_of_at, now);
  const sourceAuthority = String(item?.source_type || "").startsWith("knowledge_document.")
    ? 1
    : String(item?.source_type || "").startsWith("knowledge.")
      ? 0.9
      : 0.8;
  const score = lexical * 0.52 + retrieval * 0.27 + freshness * 0.12 + sourceAuthority * 0.09;
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

function rankEvidence({ evidence = [], queries = [], limit = MAX_REASONING_EVIDENCE, now = Date.now() } = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_REASONING_EVIDENCE, Number(limit) || MAX_REASONING_EVIDENCE));
  const normalized = normalizeEvidenceList(evidence, { maximum: 200 });
  const effectiveQueries = queries.length ? queries : [""];
  const scored = normalized
    .map((item) => ({ item, root: evidenceRoot(item), score: scoreEvidence(item, effectiveQueries, now) }))
    .sort((left, right) => right.score - left.score);

  const selected = [];
  const rootCounts = new Map();
  for (const candidate of scored) {
    const count = rootCounts.get(candidate.root) || 0;
    if (count >= 4) continue;
    selected.push(candidate);
    rootCounts.set(candidate.root, count + 1);
    if (selected.length >= safeLimit) break;
  }
  if (selected.length < safeLimit) {
    const identities = new Set(selected.map(({ item }) => `${item.source_type}|${item.source_ref}|${item.source_version || ""}`));
    for (const candidate of scored) {
      const identity = `${candidate.item.source_type}|${candidate.item.source_ref}|${candidate.item.source_version || ""}`;
      if (identities.has(identity)) continue;
      selected.push(candidate);
      identities.add(identity);
      if (selected.length >= safeLimit) break;
    }
  }

  return normalizeEvidenceList(
    selected.map(({ item, score }) => ({
      ...item,
      metadata: { ...(item.metadata || {}), reasoning_score: score },
    })),
    { maximum: MAX_REASONING_EVIDENCE }
  );
}

function numericSignature(value) {
  const matches = clean(value, 8000).match(/(?:ghs\s*|gh¢\s*|usd\s*|\$\s*)?\d[\d,]*(?:\.\d+)?%?/gi) || [];
  return [...new Set(matches.map((item) => item.toLowerCase().replace(/\s+/g, "")))].slice(0, 24);
}

function jaccard(left, right) {
  const a = new Set(meaningfulTokens(left));
  const b = new Set(meaningfulTokens(right));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
}

function detectEvidenceTensions(evidence = []) {
  const normalized = normalizeEvidenceList(evidence, { maximum: MAX_REASONING_EVIDENCE });
  const tensions = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      if (evidenceRoot(left) === evidenceRoot(right)) continue;
      if (jaccard(left.label, right.label) < 0.45) continue;
      const leftNumbers = numericSignature(left.excerpt_text);
      const rightNumbers = numericSignature(right.excerpt_text);
      if (!leftNumbers.length || !rightNumbers.length) continue;
      const shared = leftNumbers.some((value) => rightNumbers.includes(value));
      if (shared) continue;
      tensions.push(Object.freeze({
        left: left.citation,
        right: right.citation,
        topic: clean(left.label, 180),
        reason: "similar evidence contains different numeric facts",
      }));
      if (tensions.length >= 8) return Object.freeze(tensions);
    }
  }
  return Object.freeze(tensions);
}

function isLiveOperationalEvidence(item = {}) {
  const sourceType = clean(item?.source_type, 160).toLowerCase();
  return LIVE_OPERATIONAL_EVIDENCE_TYPES.has(sourceType) && Boolean(item?.as_of_at);
}

function isLiveOperationalToolResult(result = {}) {
  const key = clean(result?.tool?.key || result?.tool_key, 160);
  if (!key || NON_OPERATIONAL_TOOL_KEYS.has(key)) return false;
  const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
  return evidence.some(isLiveOperationalEvidence);
}

function assessEvidenceConfidence({ evidence = [], tensions = [], liveDataRequired = false, toolResults = [] } = {}) {
  const normalized = normalizeEvidenceList(evidence, { maximum: MAX_REASONING_EVIDENCE });
  const roots = new Set(normalized.map(evidenceRoot));
  const averageScore = normalized.length
    ? normalized.reduce((sum, item) => sum + Number(item?.metadata?.reasoning_score || item?.metadata?.retrieval_score || 0), 0) / normalized.length
    : 0;
  const liveToolsUsed = Array.isArray(toolResults) && toolResults.some(isLiveOperationalToolResult);
  let points = 0;
  const reasons = [];

  if (normalized.length >= 10) points += 3;
  else if (normalized.length >= 4) points += 2;
  else if (normalized.length >= 1) points += 1;
  else reasons.push("no approved evidence was retrieved");

  if (roots.size >= 4) points += 2;
  else if (roots.size >= 2) points += 1;
  else if (normalized.length) reasons.push("evidence comes from a single source family");

  if (averageScore >= 0.55) points += 2;
  else if (averageScore >= 0.25) points += 1;
  else if (normalized.length) reasons.push("retrieval relevance is weak");

  if (tensions.length) {
    points -= 2;
    reasons.push("potential evidence conflicts require explicit treatment");
  }

  if (liveDataRequired) {
    if (liveToolsUsed) points += 2;
    else {
      points -= 4;
      reasons.push("the question requires live operational data but no governed live tool result was used");
    }
  }

  const level = points >= 6 ? "high" : points >= 3 ? "medium" : "low";
  if (!reasons.length) {
    reasons.push(level === "high" ? "multiple relevant governed sources support the answer" : "approved evidence supports the answer with normal limitations");
  }

  return Object.freeze({
    level,
    score: Math.max(0, Math.min(10, points)),
    evidence_count: normalized.length,
    source_family_count: roots.size,
    average_reasoning_score: Number(averageScore.toFixed(4)),
    live_data_required: liveDataRequired,
    live_tools_used: liveToolsUsed,
    tension_count: tensions.length,
    reasons: Object.freeze(reasons.slice(0, 8)),
  });
}

function selectRelevantHistory(history = [], prompt = "", { maximum = MAX_HISTORY_MESSAGES } = {}) {
  const source = Array.isArray(history) ? history : [];
  const safeMaximum = Math.max(8, Math.min(MAX_HISTORY_MESSAGES, Number(maximum) || MAX_HISTORY_MESSAGES));
  if (source.length <= safeMaximum) return Object.freeze(source.map((item) => Object.freeze({ ...item })));
  const promptTokens = new Set(meaningfulTokens(prompt));
  const lastAlways = new Set(source.slice(-12).map((_, index) => source.length - 12 + index));
  const ranked = source.map((item, index) => {
    const tokens = meaningfulTokens(item?.content || "");
    const overlap = tokens.length
      ? tokens.filter((token) => promptTokens.has(token)).length / Math.max(1, promptTokens.size)
      : 0;
    const recency = (index + 1) / source.length;
    return { index, item, score: overlap * 0.72 + recency * 0.28 };
  });
  const selectedIndexes = new Set(lastAlways);
  for (const candidate of ranked.sort((a, b) => b.score - a.score)) {
    selectedIndexes.add(candidate.index);
    if (selectedIndexes.size >= safeMaximum) break;
  }
  return Object.freeze([...selectedIndexes].sort((a, b) => a - b).map((index) => Object.freeze({ ...source[index] })));
}

function answerShapeForIntent(intent) {
  if (intent === "compare") return ["bottom line", "comparison", "meaning", "trade-offs", "recommendation"];
  if (intent === "diagnose") return ["diagnosis", "why it matters", "supporting evidence", "alternative explanations", "next checks"];
  if (intent === "forecast") return ["most likely scenario", "upside/downside", "assumptions", "leading indicators", "uncertainty"];
  if (intent === "decision_support") return ["recommendation", "why", "alternatives", "risks", "next move"];
  if (intent === "summarize") return ["executive summary", "important facts", "implications", "exceptions", "open items"];
  if (intent === "explain") return ["direct explanation", "why", "example or implication", "limits"];
  return ["direct answer", "what matters", "supporting evidence", "next step if useful"];
}

function graphAwareIntent(baseIntent, graph = {}) {
  const keys = new Set(Array.isArray(graph.relationship_keys) ? graph.relationship_keys : []);
  if (baseIntent === "lookup" && keys.has("enterprise_business_performance_comparison")) return "compare";
  if (baseIntent === "lookup" && keys.has("enterprise_operating_health_diagnosis")) return "diagnose";
  return baseIntent;
}

function buildReasoningPlan({ prompt, history = [], persona = "copilot" } = {}) {
  const taskState = resolveConversationTaskState({ prompt, history });
  const taskUnderstanding = understandConversationTask({
    prompt: taskState.current_prompt || prompt,
    history,
    taskState,
    resolvedPrompt: taskState.resolved_prompt || "",
    subquestions: taskState.subquestions || [],
  });
  const reasoningGraph = buildCrossDomainReasoningGraph({ taskUnderstanding });
  const baseIntent = classifyIntent(taskState.current_prompt || taskState.resolved_prompt);
  const intent = graphAwareIntent(baseIntent, reasoningGraph);
  const retrievalQueries = buildRetrievalQueries({
    prompt: taskState.resolved_prompt,
    history,
  });
  const live =
    requiresLiveData(taskState.resolved_prompt) ||
    taskUnderstanding.live_data_required === true ||
    reasoningGraph.live_data_required === true;
  return Object.freeze({
    persona,
    intent,
    live_data_required: live,
    retrieval_queries: retrievalQueries,
    answer_shape: Object.freeze(answerShapeForIntent(intent)),
    task_state: Object.freeze({
      ...taskState,
      working_state: taskUnderstanding.working_state,
    }),
    task_understanding: taskUnderstanding,
    reasoning_graph: reasoningGraph,
    directives: Object.freeze([
      "Understand the user's actual question before reaching for a tool; casual conversation should remain natural.",
      "Treat a short or referential sub-question as a continuation of the active task when the recent conversation supports that reading.",
      "The newest user turn overrides earlier date, location, entity, metric or output scope when it changes one of them.",
      "When a request contains multiple sub-questions, answer every material part rather than silently dropping later clauses.",
      "For business questions, investigate the strongest relevant governed sources and live tools before concluding.",
      "When the server reasoning graph connects multiple domains, verify the material bridges instead of answering each domain as an isolated keyword match.",
      "Synthesize evidence into meaning, implications, alternatives and recommended next steps instead of reciting raw fields.",
      "Prefer governed live tool results for current operational facts and approved knowledge for policy/procedure context.",
      "Use relevant conversation continuity to remember goals and prior work, but never treat old assistant text as current evidence.",
      "Separate supported facts from inference, assumptions and unknowns.",
      "Challenge the first explanation when diagnosis or decision support is requested; consider plausible alternatives.",
      "Treat conflicting evidence explicitly instead of silently choosing a side.",
      "Never invent a figure, record, customer fact or operational state.",
    ]),
  });
}

function reasoningPromptBlock({ plan, confidence, tensions = [] } = {}) {
  const safePlan = plan || {};
  const safeConfidence = confidence || {};
  const taskState = safePlan.task_state || {};
  const graph = safePlan.reasoning_graph || {};
  const tensionText = tensions.length
    ? tensions.map((item) => `${item.left} vs ${item.right}: ${item.reason}`).join("; ")
    : "none detected";
  const subquestionText = Array.isArray(taskState.subquestions) && taskState.subquestions.length
    ? taskState.subquestions.map((item, index) => `${index + 1}. ${item}`).join(" | ")
    : "single current question";
  return [
    "CHALIN deep-reasoning answer contract:",
    "- Think deeply and privately before answering; never reveal hidden chain-of-thought.",
    `- Intent: ${safePlan.intent || "lookup"}.`,
    `- Follow-up/sub-question continuation: ${taskState.follow_up === true ? "yes" : "no"}.`,
    `- Resolved task context: ${clean(taskState.resolved_prompt || taskState.current_prompt || "", 5000) || "none"}.`,
    `- Current request parts that must not be silently omitted: ${subquestionText}.`,
    `- Cross-domain coverage required: ${graph.cross_domain === true ? "yes" : "no"}.`,
    `- Primary domains: ${(graph.primary_domains || []).join(", ") || "unresolved/general"}.`,
    `- Related domains to verify: ${(graph.related_domains || []).join(", ") || "none"}.`,
    `- Reasoning bridges to test: ${(graph.relationship_keys || []).join(", ") || "none"}.`,
    `- Evidence families to verify: ${(graph.evidence_families || []).join(", ") || "general reasoning"}.`,
    `- Live operational data required: ${safePlan.live_data_required === true ? "yes" : "no"}.`,
    `- Evidence confidence before final answer: ${safeConfidence.level || "low"}.`,
    `- Potential evidence tensions: ${tensionText}.`,
    "- The reasoning graph is a server-owned coverage map only. It is not evidence, permission, scope or execution authority.",
    "- Be conversational and answer the actual question first. Do not lead with a mechanical evidence dump.",
    "- If this is a follow-up, preserve the active customer/worker/transaction/branch/date/task unless the current user turn changes it.",
    "- Old assistant messages may help resolve words like he, it, that or them, but they are continuity only; re-check live facts before treating them as current.",
    "- For analytical questions: state the bottom line, explain what is driving it, identify implications, test alternative explanations, and recommend the next useful move.",
    "- When several business domains are connected, explain the material relationship between them rather than presenting disconnected mini-answers.",
    "- Convert raw snapshots into interpretation. Mention only the figures that materially support the conclusion.",
    "- Cite supported business factual claims with [E#], but do not attach citations to ordinary social conversation or generic reasoning that does not depend on CHALIN evidence.",
    "- Clearly distinguish fact, inference, scenario and unknown when that distinction matters; do not clutter simple answers with labels unnecessarily.",
    "- If the request needs live operational data and no governed live tool result is available, say exactly what is unverified and continue with any useful non-live reasoning that remains possible.",
    "- If evidence conflicts, explain the conflict and which source is newer or more authoritative only when the evidence supports that judgment.",
    "- Recommendations must explain the strongest reason, the main downside, and what new evidence would change the recommendation.",
    "- Never answer a greeting, thanks or general conversation by dumping an operational snapshot unless the user actually asked for business data.",
  ].join("\n");
}

function citationIntegrity(answer, evidence = []) {
  const normalized = normalizeEvidenceList(evidence, { maximum: MAX_REASONING_EVIDENCE });
  const maximum = normalized.length;
  const cited = [];
  const pattern = /\[E(\d+)\]/g;
  let match;
  while ((match = pattern.exec(clean(answer, 120000)))) cited.push(Number(match[1]));
  const unique = [...new Set(cited)];
  const unsupported = unique.filter((number) => number < 1 || number > maximum);
  return Object.freeze({
    valid: unsupported.length === 0,
    citation_required: maximum > 0,
    citation_present: unique.length > 0,
    cited: Object.freeze(unique),
    unsupported: Object.freeze(unsupported),
  });
}

module.exports = {
  COMPOUND_CLAUSE_START,
  FOLLOW_UP_START_PATTERN,
  INTENT_PATTERNS,
  LIVE_OPERATIONAL_EVIDENCE_TYPES,
  MAX_HISTORY_MESSAGES,
  MAX_REASONING_EVIDENCE,
  MAX_RETRIEVAL_QUERIES,
  MAX_SUBQUESTIONS,
  MAX_TASK_CONTEXT_TURNS,
  NON_OPERATIONAL_TOOL_KEYS,
  OPERATIONAL_WORDS,
  REFERENTIAL_PATTERN,
  SOCIAL_ONLY_PATTERN,
  STOP_WORDS,
  TIME_WORDS,
  addUniqueQuery,
  answerShapeForIntent,
  assessEvidenceConfidence,
  buildReasoningPlan,
  buildRetrievalQueries,
  citationIntegrity,
  classifyIntent,
  comparisonSides,
  decomposeSubquestions,
  detectEvidenceTensions,
  evidenceRoot,
  freshnessScore,
  graphAwareIntent,
  isLikelyFollowUp,
  isLiveOperationalEvidence,
  isLiveOperationalToolResult,
  isSubstantiveTaskTurn,
  jaccard,
  meaningfulTokens,
  normalizeSubquestion,
  numericSignature,
  overlapScore,
  quotedPhrases,
  rankEvidence,
  reasoningPromptBlock,
  recentTaskTurns,
  requiresLiveData,
  resolveConversationTaskState,
  scoreEvidence,
  selectRelevantHistory,
  tokenizeReasoning,
};
