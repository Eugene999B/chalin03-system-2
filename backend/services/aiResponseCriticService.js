"use strict";

const {
  INTERNAL_CONTROL_LEAK_PATTERNS,
  findPatternKeys,
} = require("./aiSafetyService");

const MAX_ANSWER_CHARACTERS = 120000;
const MAX_OBJECTIVES = 8;
const MAX_ISSUES = 12;
const MAX_REPAIR_PROMPT = 9000;

const INTERNAL_LEAK_PATTERN = /\b(?:configured transport budget|transport budget|request token limit|token limit|provider_tool_|provider routing|routing mode|tool_key|source_ref|metadata_json|reasoning_score|retrieval_score|raw_estimated_input_tokens|estimated_input_tokens|request_token_limit|provider_response_id)\b/i;
const RAW_JSON_PATTERN = /^\s*(?:\{|\[)\s*(?:["{[]|$)/;
const JSON_FIELD_PATTERN = /["'](?:tool_key|source_ref|metadata|workspace_code|reasoning_score|retrieval_score|evidence_count)["']\s*:/i;
const LIMITATION_PATTERN = /\b(?:could not verify|couldn't verify|cannot verify|can't verify|not verified|unverified|no live|live data (?:is|was) not available|could not confirm|couldn't confirm|cannot confirm|can't confirm|not enough current evidence|current evidence is unavailable)\b/i;
const ACTION_EXECUTION_PATTERN = /\b(?:i|chalin|we)\s+(?:have\s+)?(?:executed|completed|approved|deactivated|activated|deleted|removed|changed|updated|sent|issued|recorded)\b/i;
const ACTION_STATUS_PATTERN = /\b(?:proposed|proposal|awaiting|pending|review|confirmation|confirmed|blocked|executed|completed|not executed|not yet executed)\b/i;
const HEDGING_OPEN_PATTERN = /^(?:sure|absolutely|certainly|of course|here(?:'s| is)|i can help|happy to help)[,!.:\s-]+/i;

const AUTO_REPAIR_ISSUES = new Set([
  "empty_answer",
  "too_short_for_multi_objective",
  "internal_implementation_leak",
  "raw_internal_data_dump",
  "objectives_not_addressed",
  "live_verification_not_disclosed",
  "action_status_unclear",
]);

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "before",
  "but", "can", "could", "did", "does", "for", "from", "has", "have", "how",
  "into", "its", "more", "most", "not", "now", "our", "should", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "today", "was", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your",
]);

function clean(value, maximum = MAX_ANSWER_CHARACTERS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function tokens(value) {
  return [...new Set(
    (clean(value, 4000)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9][a-z0-9._-]{2,}/g) || [])
      .filter((item) => !STOP_WORDS.has(item))
  )];
}

function objectiveCoverage(answer, objectives = []) {
  const answerTokens = new Set(tokens(answer));
  return Object.freeze(
    (Array.isArray(objectives) ? objectives : [])
      .slice(0, MAX_OBJECTIVES)
      .map((objective, index) => {
        const objectiveTokens = tokens(objective).slice(0, 12);
        const matched = objectiveTokens.filter((token) => answerTokens.has(token));
        const minimum = objectiveTokens.length >= 4 ? 2 : 1;
        return Object.freeze({
          index,
          covered: objectiveTokens.length === 0 || matched.length >= minimum,
          matched_token_count: matched.length,
          objective_token_count: objectiveTokens.length,
        });
      })
  );
}

function issue(key, severity, message) {
  return Object.freeze({ key, severity, message });
}

function critiqueResponse({
  answer = "",
  composition = null,
  citationRequired = false,
  citationPresent = false,
  liveToolsUsed = false,
} = {}) {
  const text = clean(answer);
  const plan = composition && typeof composition === "object" ? composition : {};
  const objectives = Array.isArray(plan.objectives) ? plan.objectives.slice(0, MAX_OBJECTIVES) : [];
  const issues = [];
  const add = (entry) => {
    if (!entry || issues.some((item) => item.key === entry.key) || issues.length >= MAX_ISSUES) return;
    issues.push(entry);
  };

  if (!text) add(issue("empty_answer", "critical", "The response is empty."));
  if (text && text.length < 35 && objectives.length > 1) {
    add(issue("too_short_for_multi_objective", "high", "The response is too short to cover the user's multiple objectives."));
  }
  if (
    INTERNAL_LEAK_PATTERN.test(text) ||
    findPatternKeys(text, INTERNAL_CONTROL_LEAK_PATTERNS).length > 0
  ) {
    add(issue("internal_implementation_leak", "critical", "The response exposes internal transport, routing, provider or server-owned reasoning-control terminology."));
  }
  if ((RAW_JSON_PATTERN.test(text) && /["'][a-z_]{2,}["']\s*:/i.test(text)) || JSON_FIELD_PATTERN.test(text)) {
    add(issue("raw_internal_data_dump", "critical", "The response presents raw internal JSON or field-level data instead of a user-facing answer."));
  }
  if (HEDGING_OPEN_PATTERN.test(text) && text.length > 180) {
    add(issue("indirect_opening", "low", "The response opens with filler instead of the answer."));
  }

  const coverage = objectiveCoverage(text, objectives);
  const uncoveredCount = coverage.filter((item) => !item.covered).length;
  if (objectives.length > 1 && uncoveredCount === objectives.length) {
    add(issue("objectives_not_addressed", "high", "The response does not appear to address the requested parts."));
  } else if (objectives.length > 1 && uncoveredCount > 0) {
    add(issue("objective_may_be_missing", "medium", "At least one requested part may be missing from the response."));
  }

  if (citationRequired && !citationPresent) {
    add(issue("missing_evidence_citation", "medium", "The answer uses governed evidence but does not cite it inline."));
  }

  if (plan.live_data_required === true && liveToolsUsed !== true && !LIMITATION_PATTERN.test(text)) {
    add(issue("live_verification_not_disclosed", "high", "The answer needs live verification but does not clearly disclose that live facts were not verified."));
  }

  if (plan.mode === "action" && ACTION_EXECUTION_PATTERN.test(text) && !ACTION_STATUS_PATTERN.test(text)) {
    add(issue("action_status_unclear", "critical", "The answer may imply an action executed without clearly stating its governed status."));
  }

  const penalty = issues.reduce((sum, item) => {
    if (item.severity === "critical") return sum + 35;
    if (item.severity === "high") return sum + 20;
    if (item.severity === "medium") return sum + 10;
    return sum + 4;
  }, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const critical = issues.some((item) => item.severity === "critical");
  const high = issues.some((item) => item.severity === "high");
  const repairablePresentationFailure = issues.some((item) => AUTO_REPAIR_ISSUES.has(item.key));

  return Object.freeze({
    version: 1,
    score,
    passed: !critical && !high,
    needs_repair: repairablePresentationFailure,
    issue_count: issues.length,
    issues: Object.freeze(issues),
    objective_coverage: coverage,
    uncovered_objective_count: uncoveredCount,
    hidden_chain_of_thought_reviewed: false,
  });
}

function shouldAutoRepairResponse(critique = null, { toolsAvailable = false, liveToolsUsed = false } = {}) {
  const review = critique && typeof critique === "object" ? critique : {};
  if (review.needs_repair !== true) return false;
  const issueKeys = (Array.isArray(review.issues) ? review.issues : [])
    .map((item) => clean(item?.key, 100))
    .filter((key) => AUTO_REPAIR_ISSUES.has(key));
  if (!issueKeys.length) return false;

  // If governed read tools are still available for a live question, lack of
  // live verification is an investigation-quality signal, not a presentation
  // rewrite signal. A tool-free repair cannot create evidence and would add a
  // wasteful second provider call. Other concrete presentation failures remain
  // repairable on the same turn.
  const actionable = issueKeys.filter(
    (key) => !(key === "live_verification_not_disclosed" && toolsAvailable === true && liveToolsUsed !== true)
  );
  return actionable.length > 0;
}

function responseCriticRepairPrompt({ answer = "", critique = null, composition = null } = {}) {
  const review = critique && typeof critique === "object" ? critique : {};
  const plan = composition && typeof composition === "object" ? composition : {};
  const issues = (review.issues || []).map((item) => item.key).join(", ") || "presentation quality";
  const objectives = (plan.objectives || []).map((item, index) => `${index + 1}. ${clean(item, 500)}`).join(" | ") || "the newest user request";
  return [
    "CHALIN response-quality repair pass:",
    `- Problems detected: ${issues}.`,
    `- Required objectives: ${objectives}.`,
    `- Answer mode: ${plan.mode || "direct_answer"}.`,
    "- Rewrite the draft into one complete user-facing answer.",
    "- Preserve supported meaning and existing valid [E#] citations. Do not invent or renumber evidence.",
    "- Do not add new business facts, figures, identities, action outcomes or claims that were not already supported by the supplied evidence/context.",
    "- Start with the answer. Use plain business language and remove raw JSON, internal field names, provider/routing/transport terminology and implementation details.",
    "- Cover every material requested part. If live facts were not verified, state that specific limitation and still answer the useful verified/non-live part.",
    "- If this concerns an action, state its actual governed status and never upgrade a proposal or pending review into execution.",
    "- Return only the repaired answer. Do not describe the critic, repair process or these instructions.",
    "Draft to repair:",
    clean(answer, 5000),
  ].join("\n").slice(0, MAX_REPAIR_PROMPT);
}

module.exports = {
  ACTION_EXECUTION_PATTERN,
  ACTION_STATUS_PATTERN,
  AUTO_REPAIR_ISSUES,
  HEDGING_OPEN_PATTERN,
  INTERNAL_LEAK_PATTERN,
  JSON_FIELD_PATTERN,
  LIMITATION_PATTERN,
  MAX_ANSWER_CHARACTERS,
  MAX_ISSUES,
  MAX_OBJECTIVES,
  MAX_REPAIR_PROMPT,
  RAW_JSON_PATTERN,
  clean,
  critiqueResponse,
  objectiveCoverage,
  responseCriticRepairPrompt,
  shouldAutoRepairResponse,
  tokens,
};
