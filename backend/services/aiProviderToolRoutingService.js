"use strict";

const {
  evidenceNeedsForQuestion,
  rankedCandidateTools,
} = require("./aiTaskPlannerService");

const MAX_PROVIDER_ROUTED_TOOLS = 12;
const MAX_ROUTING_USER_TURNS = 4;
const MAX_ROUTING_TURN_CHARACTERS = 2400;

function clean(value, maximum = MAX_ROUTING_TURN_CHARACTERS) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function recentUserRoutingQuestions(messages = [], maximum = MAX_ROUTING_USER_TURNS) {
  const source = Array.isArray(messages) ? messages : [];
  const limit = Math.max(1, Math.min(8, Number(maximum) || MAX_ROUTING_USER_TURNS));
  const selected = [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (String(source[index]?.role || "").toLowerCase() !== "user") continue;
    const text = clean(source[index]?.content);
    if (!text) continue;
    if (selected[0]?.toLowerCase() === text.toLowerCase()) continue;
    selected.unshift(text);
    if (selected.length >= limit) break;
  }
  return Object.freeze(selected);
}

function routingObjectives(messages = []) {
  const questions = recentUserRoutingQuestions(messages);
  return Object.freeze(
    questions.map((question) =>
      Object.freeze({
        question,
        evidence_needs: evidenceNeedsForQuestion(question),
      })
    )
  );
}

function rankedToolUnion(objectives = [], tools = [], maximum = MAX_PROVIDER_ROUTED_TOOLS) {
  const candidates = new Map();
  for (let objectiveIndex = 0; objectiveIndex < objectives.length; objectiveIndex += 1) {
    const objective = objectives[objectiveIndex];
    for (const entry of rankedCandidateTools(objective, tools)) {
      const key = String(entry?.key || "").trim();
      if (!key) continue;
      const existing = candidates.get(key) || {
        key,
        score: 0,
        objective_hits: 0,
        newest_objective_index: -1,
      };
      existing.score = Math.max(existing.score, Number(entry.score || 0));
      existing.objective_hits += 1;
      existing.newest_objective_index = Math.max(existing.newest_objective_index, objectiveIndex);
      candidates.set(key, existing);
    }
  }

  return [...candidates.values()]
    .sort(
      (left, right) =>
        right.objective_hits - left.objective_hits ||
        right.newest_objective_index - left.newest_objective_index ||
        right.score - left.score ||
        left.key.localeCompare(right.key)
    )
    .slice(0, Math.max(1, Math.min(20, Number(maximum) || MAX_PROVIDER_ROUTED_TOOLS)));
}

function selectRelevantProviderTools({
  messages = [],
  tools = [],
  maximum = MAX_PROVIDER_ROUTED_TOOLS,
} = {}) {
  const source = Array.isArray(tools) ? tools : [];
  const safeMaximum = Math.max(1, Math.min(20, Number(maximum) || MAX_PROVIDER_ROUTED_TOOLS));

  if (source.length <= safeMaximum) {
    return Object.freeze({
      tools: Object.freeze([...source]),
      mode: "all_small_catalogue",
      original_count: source.length,
      selected_count: source.length,
      objective_count: 0,
      selected_keys: Object.freeze(source.map((tool) => String(tool?.key || "")).filter(Boolean)),
    });
  }

  const objectives = routingObjectives(messages);
  const ranked = rankedToolUnion(objectives, source, safeMaximum);

  // A low-confidence router must not silently remove a capability. If none of
  // the server-side planner objectives can identify a relevant tool, preserve
  // the full already-authorized catalogue and let the existing provider/tool
  // governance decide. Transport compaction still protects this fallback path.
  if (ranked.length === 0) {
    return Object.freeze({
      tools: Object.freeze([...source]),
      mode: "fallback_full_catalogue",
      original_count: source.length,
      selected_count: source.length,
      objective_count: objectives.length,
      selected_keys: Object.freeze(source.map((tool) => String(tool?.key || "")).filter(Boolean)),
    });
  }

  const byKey = new Map(source.map((tool) => [String(tool?.key || ""), tool]));
  const selected = ranked.map((entry) => byKey.get(entry.key)).filter(Boolean);
  return Object.freeze({
    tools: Object.freeze(selected),
    mode: "prompt_ranked",
    original_count: source.length,
    selected_count: selected.length,
    objective_count: objectives.length,
    selected_keys: Object.freeze(selected.map((tool) => String(tool?.key || "")).filter(Boolean)),
  });
}

module.exports = {
  MAX_PROVIDER_ROUTED_TOOLS,
  MAX_ROUTING_TURN_CHARACTERS,
  MAX_ROUTING_USER_TURNS,
  clean,
  rankedToolUnion,
  recentUserRoutingQuestions,
  routingObjectives,
  selectRelevantProviderTools,
};
