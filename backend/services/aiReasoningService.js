"use strict";

const { normalizeEvidenceList } = require("./aiEvidenceService");

const MAX_RETRIEVAL_QUERIES = 6;
const MAX_REASONING_EVIDENCE = 12;
const MAX_HISTORY_MESSAGES = 12;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "its",
  "may",
  "might",
  "more",
  "most",
  "not",
  "now",
  "our",
  "please",
  "should",
  "show",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "today",
  "under",
  "very",
  "was",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const TIME_WORDS = new Set([
  "active",
  "currently",
  "current",
  "latest",
  "live",
  "now",
  "outstanding",
  "overdue",
  "recent",
  "status",
  "today",
  "tonight",
  "yesterday",
]);

const OPERATIONAL_WORDS = new Set([
  "arrears",
  "balance",
  "cash",
  "contract",
  "contracts",
  "customer",
  "customers",
  "debt",
  "debts",
  "equipment",
  "finance",
  "hire",
  "inventory",
  "payment",
  "payments",
  "quantity",
  "revenue",
  "sale",
  "sales",
  "stock",
  "transaction",
  "transactions",
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

function clean(value, maxLength = 8000) {
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
  const text = clean(prompt, 8000);
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }
  return "lookup";
}

function requiresLiveData(prompt) {
  const tokens = new Set(tokenizeReasoning(prompt));
  const hasOperational = [...tokens].some((token) => OPERATIONAL_WORDS.has(token));
  const hasTimeSignal = [...tokens].some((token) => TIME_WORDS.has(token));
  const intrinsicallyLive = /\b(stock|quantity|balance|outstanding|overdue|active (?:hire|finance|contract)|sales? today|payments? today|cash position|current status)\b/i.test(
    clean(prompt)
  );
  return intrinsicallyLive || (hasOperational && hasTimeSignal);
}

function quotedPhrases(prompt) {
  const matches = [];
  const pattern = /["“”']([^"“”']{3,100})["“”']/g;
  let match;
  while ((match = pattern.exec(clean(prompt, 8000)))) {
    const phrase = clean(match[1], 100);
    if (phrase) matches.push(phrase);
  }
  return [...new Set(matches)].slice(0, 3);
}

function comparisonSides(prompt) {
  const text = clean(prompt, 8000);
  const match = text.match(/(.{2,100}?)\s+(?:vs\.?|versus|compared? (?:with|to)|against)\s+(.{2,100})/i);
  if (!match) return [];
  return [clean(match[1], 100), clean(match[2], 100)].filter(Boolean);
}

function addUniqueQuery(target, value) {
  const query = clean(value, 240).replace(/\s+/g, " ");
  if (!query || query.length < 2) return;
  const identity = query.toLowerCase();
  if (target.some((item) => item.toLowerCase() === identity)) return;
  target.push(query);
}

function buildRetrievalQueries({ prompt, history = [] } = {}) {
  const queries = [];
  const text = clean(prompt, 8000);
  addUniqueQuery(queries, text);

  for (const phrase of quotedPhrases(text)) addUniqueQuery(queries, phrase);
  for (const side of comparisonSides(text)) addUniqueQuery(queries, side);

  const keywords = meaningfulTokens(text).filter((token) => token.length >= 3);
  if (keywords.length) addUniqueQuery(queries, keywords.slice(0, 10).join(" "));

  const priorUser = [...history]
    .reverse()
    .find((item) => item?.role === "user" && clean(item?.content, 1200));
  if (priorUser) {
    const carry = meaningfulTokens(`${priorUser.content} ${text}`)
      .filter((token) => token.length >= 3)
      .slice(0, 10)
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
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.8;
  if (ageDays <= 180) return 0.55;
  if (ageDays <= 365) return 0.35;
  return 0.15;
}

function scoreEvidence(item, queries, now = Date.now()) {
  const searchable = `${item?.label || ""} ${item?.source_ref || ""} ${item?.excerpt_text || ""}`;
  const lexical = Math.max(
    0,
    ...queries.map((query) => overlapScore(query, searchable))
  );
  const retrieval = Math.max(
    0,
    Math.min(1, Number(item?.metadata?.retrieval_score || 0))
  );
  const freshness = freshnessScore(item?.as_of_at, now);
  const sourceAuthority = String(item?.source_type || "").startsWith("knowledge_document.")
    ? 1
    : String(item?.source_type || "").startsWith("knowledge.")
      ? 0.9
      : 0.75;
  const score = lexical * 0.55 + retrieval * 0.27 + freshness * 0.1 + sourceAuthority * 0.08;
  return Number(Math.max(0, Math.min(1, score)).toFixed(6));
}

function rankEvidence({ evidence = [], queries = [], limit = MAX_REASONING_EVIDENCE, now = Date.now() } = {}) {
  const safeLimit = Math.max(1, Math.min(MAX_REASONING_EVIDENCE, Number(limit) || MAX_REASONING_EVIDENCE));
  const normalized = normalizeEvidenceList(evidence, { maximum: 100 });
  const effectiveQueries = queries.length ? queries : [""];
  const scored = normalized
    .map((item) => ({
      item,
      root: evidenceRoot(item),
      score: scoreEvidence(item, effectiveQueries, now),
    }))
    .sort((left, right) => right.score - left.score);

  const selected = [];
  const rootCounts = new Map();
  for (const candidate of scored) {
    const count = rootCounts.get(candidate.root) || 0;
    if (count >= 2) continue;
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
      metadata: {
        ...(item.metadata || {}),
        reasoning_score: score,
      },
    })),
    { maximum: MAX_REASONING_EVIDENCE }
  );
}

function numericSignature(value) {
  const matches = clean(value, 3000).match(/(?:ghs\s*|gh¢\s*|usd\s*|\$\s*)?\d[\d,]*(?:\.\d+)?%?/gi) || [];
  return [...new Set(matches.map((item) => item.toLowerCase().replace(/\s+/g, "")))].slice(0, 12);
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
  const normalized = normalizeEvidenceList(evidence);
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
      tensions.push(
        Object.freeze({
          left: left.citation,
          right: right.citation,
          topic: clean(left.label, 180),
          reason: "similar evidence contains different numeric facts",
        })
      );
      if (tensions.length >= 5) return Object.freeze(tensions);
    }
  }
  return Object.freeze(tensions);
}

function isLiveOperationalEvidence(item = {}) {
  const sourceType = clean(item?.source_type, 160).toLowerCase();
  return (
    LIVE_OPERATIONAL_EVIDENCE_TYPES.has(sourceType) &&
    Boolean(item?.as_of_at)
  );
}

function isLiveOperationalToolResult(result = {}) {
  const key = clean(result?.tool?.key || result?.tool_key, 160);
  if (!key || NON_OPERATIONAL_TOOL_KEYS.has(key)) return false;
  const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
  return evidence.some(isLiveOperationalEvidence);
}

function assessEvidenceConfidence({
  evidence = [],
  tensions = [],
  liveDataRequired = false,
  toolResults = [],
} = {}) {
  const normalized = normalizeEvidenceList(evidence);
  const roots = new Set(normalized.map(evidenceRoot));
  const averageScore = normalized.length
    ? normalized.reduce((sum, item) => sum + Number(item?.metadata?.reasoning_score || item?.metadata?.retrieval_score || 0), 0) /
      normalized.length
    : 0;
  const liveToolsUsed =
    Array.isArray(toolResults) && toolResults.some(isLiveOperationalToolResult);
  let points = 0;
  const reasons = [];

  if (normalized.length >= 6) points += 3;
  else if (normalized.length >= 3) points += 2;
  else if (normalized.length >= 1) points += 1;
  else reasons.push("no approved evidence was retrieved");

  if (roots.size >= 3) points += 2;
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
    reasons.push(
      level === "high"
        ? "multiple relevant governed sources support the answer"
        : "approved evidence supports the answer with normal limitations"
    );
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
    reasons: Object.freeze(reasons.slice(0, 5)),
  });
}

function selectRelevantHistory(history = [], prompt = "", { maximum = MAX_HISTORY_MESSAGES } = {}) {
  const source = Array.isArray(history) ? history : [];
  const safeMaximum = Math.max(4, Math.min(MAX_HISTORY_MESSAGES, Number(maximum) || MAX_HISTORY_MESSAGES));
  if (source.length <= safeMaximum) return Object.freeze(source.map((item) => Object.freeze({ ...item })));
  const promptTokens = new Set(meaningfulTokens(prompt));
  const lastAlways = new Set(source.slice(-4).map((_, index) => source.length - 4 + index));
  const ranked = source.map((item, index) => {
    const tokens = meaningfulTokens(item?.content || "");
    const overlap = tokens.length
      ? tokens.filter((token) => promptTokens.has(token)).length / Math.max(1, promptTokens.size)
      : 0;
    const recency = (index + 1) / source.length;
    return { index, item, score: overlap * 0.7 + recency * 0.3 };
  });
  const selectedIndexes = new Set(lastAlways);
  for (const candidate of ranked.sort((a, b) => b.score - a.score)) {
    selectedIndexes.add(candidate.index);
    if (selectedIndexes.size >= safeMaximum) break;
  }
  return Object.freeze(
    [...selectedIndexes]
      .sort((a, b) => a - b)
      .map((index) => Object.freeze({ ...source[index] }))
  );
}

function answerShapeForIntent(intent) {
  if (intent === "compare") return ["bottom line", "comparison", "trade-offs", "unknowns"];
  if (intent === "diagnose") return ["diagnosis", "supporting evidence", "alternative explanations", "next checks"];
  if (intent === "forecast") return ["scenario", "assumptions", "evidence", "uncertainty"];
  if (intent === "decision_support") return ["recommendation", "why", "risks", "what would change the recommendation"];
  if (intent === "summarize") return ["summary", "important facts", "exceptions", "open items"];
  if (intent === "explain") return ["direct explanation", "supporting evidence", "limits"];
  return ["direct answer", "supporting evidence", "limits"];
}

function buildReasoningPlan({ prompt, history = [], persona = "copilot" } = {}) {
  const intent = classifyIntent(prompt);
  const retrievalQueries = buildRetrievalQueries({ prompt, history });
  const live = requiresLiveData(prompt);
  return Object.freeze({
    persona,
    intent,
    live_data_required: live,
    retrieval_queries: retrievalQueries,
    answer_shape: Object.freeze(answerShapeForIntent(intent)),
    directives: Object.freeze([
      "Prefer governed live tool results for current operational facts.",
      "Use approved knowledge for policy, procedure, historical and explanatory context.",
      "Separate supported facts from inference, assumptions and unknowns.",
      "Treat conflicting evidence explicitly instead of silently choosing a side.",
      "Never invent a figure, record, customer fact or operational state.",
    ]),
  });
}

function reasoningPromptBlock({ plan, confidence, tensions = [] } = {}) {
  const safePlan = plan || {};
  const safeConfidence = confidence || {};
  const tensionText = tensions.length
    ? tensions.map((item) => `${item.left} vs ${item.right}: ${item.reason}`).join("; ")
    : "none detected";
  return [
    "CHALIN reasoning contract:",
    "- Think through the problem internally before answering, but do not reveal hidden chain-of-thought.",
    `- Intent: ${safePlan.intent || "lookup"}.`,
    `- Live operational data required: ${safePlan.live_data_required === true ? "yes" : "no"}.`,
    `- Evidence confidence before final answer: ${safeConfidence.level || "low"}.`,
    `- Potential evidence tensions: ${tensionText}.`,
    "- Give the conclusion first. Cite supported factual claims with [E#].",
    "- Clearly label inference, assumptions, scenarios and unknowns; do not present them as facts.",
    "- If the request needs live operational data and no governed live tool result is available, say that the live state is unverified rather than guessing.",
    "- If evidence conflicts, explain the conflict and which source is newer or more authoritative when that is actually supported.",
    "- Recommendations must state the evidence and the main risk or condition that could change the recommendation.",
  ].join("\n");
}

function citationIntegrity(answer, evidence = []) {
  const normalized = normalizeEvidenceList(evidence);
  const maximum = normalized.length;
  const cited = [];
  const pattern = /\[E(\d+)\]/g;
  let match;
  while ((match = pattern.exec(clean(answer, 24000)))) cited.push(Number(match[1]));
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
  INTENT_PATTERNS,
  LIVE_OPERATIONAL_EVIDENCE_TYPES,
  MAX_HISTORY_MESSAGES,
  MAX_REASONING_EVIDENCE,
  MAX_RETRIEVAL_QUERIES,
  NON_OPERATIONAL_TOOL_KEYS,
  OPERATIONAL_WORDS,
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
  detectEvidenceTensions,
  evidenceRoot,
  freshnessScore,
  isLiveOperationalEvidence,
  isLiveOperationalToolResult,
  jaccard,
  meaningfulTokens,
  numericSignature,
  overlapScore,
  quotedPhrases,
  rankEvidence,
  reasoningPromptBlock,
  requiresLiveData,
  scoreEvidence,
  selectRelevantHistory,
  tokenizeReasoning,
};
