"use strict";

const MAX_OBJECTIVES = 8;
const MAX_ANCHORS = 8;
const MAX_COMPOSER_BLOCK = 7000;

const MODE_ALIASES = Object.freeze({
  generic: "direct_answer",
  lookup: "direct_answer",
  direct_fact: "direct_answer",
  explain: "explanation",
  explanation: "explanation",
  diagnose: "diagnosis",
  diagnosis: "diagnosis",
  compare: "comparison",
  comparison: "comparison",
  investigation: "investigation",
  decision_support: "decision_support",
  action: "action",
  executive_brief: "executive_brief",
  forecast: "decision_support",
  summarize: "executive_brief",
});

const MODE_STRUCTURES = Object.freeze({
  direct_answer: Object.freeze(["answer", "supporting context", "next step if useful"]),
  explanation: Object.freeze(["direct explanation", "how it works", "important implication", "limits if material"]),
  diagnosis: Object.freeze(["bottom line", "main drivers", "alternative explanation", "what to check or do next"]),
  comparison: Object.freeze(["winner or key difference", "side-by-side evidence", "why the difference matters", "decision implication"]),
  investigation: Object.freeze(["finding", "supporting evidence", "unresolved point", "next verification"]),
  decision_support: Object.freeze(["recommendation", "strongest reason", "main downside", "what would change the recommendation"]),
  action: Object.freeze(["requested outcome", "current action status", "required review or confirmation", "next safe step"]),
  executive_brief: Object.freeze(["executive bottom line", "material drivers", "risks and opportunities", "priority next moves"]),
});

function clean(value, maximum = 1000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function unique(values = [], maximum = MAX_ANCHORS) {
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = clean(value, 240);
    if (!text) continue;
    if (output.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
    output.push(text);
    if (output.length >= maximum) break;
  }
  return output;
}

function normalizeMode(value) {
  const key = clean(value, 60).toLowerCase();
  return MODE_ALIASES[key] || "direct_answer";
}

function taskObjectives(task = {}, prompt = "") {
  const supplied = Array.isArray(task.objectives)
    ? task.objectives.map((item) => clean(item, 600)).filter(Boolean)
    : [];
  if (supplied.length) return Object.freeze(unique(supplied, MAX_OBJECTIVES));
  const current = clean(task.current_prompt || prompt, 1200);
  return Object.freeze(current ? [current] : []);
}

function workingStateAnchors(task = {}) {
  const state = task?.working_state && typeof task.working_state === "object"
    ? task.working_state
    : {};
  const entityLabels = Array.isArray(state.entities)
    ? state.entities.map((item) => clean(item?.label || item?.id, 120)).filter(Boolean)
    : [];
  const periods = [
    ...(Array.isArray(state?.periods?.active) ? state.periods.active : []),
    ...(Array.isArray(state?.periods?.comparison) ? state.periods.comparison : []),
  ];
  return Object.freeze({
    subject: clean(state.subject, 240) || null,
    entities: Object.freeze(unique(entityLabels, 4)),
    periods: Object.freeze(unique(periods, 4)),
    metrics: Object.freeze(unique(state.metrics, 8)),
  });
}

function buildAnswerCompositionPlan({
  prompt = "",
  taskUnderstanding = null,
  reasoningGraph = null,
  providerContext = null,
} = {}) {
  const task = taskUnderstanding && typeof taskUnderstanding === "object"
    ? taskUnderstanding
    : {};
  const graph = reasoningGraph && typeof reasoningGraph === "object"
    ? reasoningGraph
    : {};
  const context = providerContext && typeof providerContext === "object"
    ? providerContext
    : {};
  const mode = normalizeMode(task.answer_mode || context.intent);
  const objectives = taskObjectives(task, prompt);
  const anchors = workingStateAnchors(task);
  const liveDataRequired =
    task.live_data_required === true ||
    graph.live_data_required === true ||
    context.live_data_required === true;

  return Object.freeze({
    version: 1,
    source_of_truth: false,
    permission_authority: false,
    execution_authority: false,
    mode,
    objectives,
    objective_count: objectives.length,
    structure: MODE_STRUCTURES[mode] || MODE_STRUCTURES.direct_answer,
    answer_first: true,
    plain_language: true,
    cross_domain: graph.cross_domain === true,
    domains: Object.freeze(unique(graph.domains || task.domains, 8)),
    relationship_keys: Object.freeze(unique(graph.relationship_keys, 12)),
    live_data_required: liveDataRequired,
    continuity_required: task.continuity_required === true,
    anchors,
  });
}

function answerComposerPromptBlock(plan = {}) {
  const objectives = Array.isArray(plan.objectives) ? plan.objectives : [];
  const anchors = plan.anchors || {};
  const objectiveText = objectives.length
    ? objectives.map((item, index) => `${index + 1}. ${clean(item, 600)}`).join(" | ")
    : "answer the newest user request";
  const anchorText = [
    anchors.subject ? `subject=${clean(anchors.subject, 180)}` : null,
    anchors.entities?.length ? `entities=${anchors.entities.join(", ")}` : null,
    anchors.periods?.length ? `periods=${anchors.periods.join(", ")}` : null,
    anchors.metrics?.length ? `metrics=${anchors.metrics.join(", ")}` : null,
  ].filter(Boolean).join("; ") || "none";

  return [
    "CHALIN universal answer-composer contract:",
    `- Answer mode: ${plan.mode || "direct_answer"}.`,
    `- Required user objectives: ${objectiveText}.`,
    `- Preferred answer flow: ${(plan.structure || MODE_STRUCTURES.direct_answer).join(" -> ")}.`,
    `- Active continuity anchors: ${anchorText}.`,
    `- Cross-domain synthesis: ${plan.cross_domain === true ? "yes" : "no"}.`,
    `- Live verification required: ${plan.live_data_required === true ? "yes" : "no"}.`,
    "- Start with the answer, conclusion, finding or recommendation. Do not make the user read setup before learning the point.",
    "- Use natural plain language. Translate internal field names, tool names, JSON keys and database vocabulary into business language unless the user explicitly asks for technical details.",
    "- Never dump raw JSON, raw snapshot objects, routing metadata, transport budgets, token limits, provider names or internal error wording into the normal answer.",
    "- Cover every material objective. If the user asked diagnosis plus comparison, answer both in one coherent response rather than choosing one.",
    "- Preserve the active subject, entity, period and metric on short follow-ups unless the newest user turn changes them.",
    "- For cross-domain questions, explain the relationship between the domains; do not produce disconnected mini-answers.",
    "- Use headings or bullets only when they make a multi-part answer easier to scan. Do not force a template onto a simple question.",
    "- Cite material CHALIN facts with the supplied [E#] evidence references. Do not invent citations, figures or live facts.",
    "- If live verification is required but unavailable, say specifically what could not be verified, then give the useful verified or non-live part of the answer instead of returning a technical failure message.",
    "- Distinguish fact from inference when it matters, but do not clutter ordinary answers with mechanical labels.",
    "- For actions, state truthfully whether the action is only proposed, awaiting review/confirmation, blocked, or actually executed. Never imply execution from conversation alone.",
    "- End when the user's question is answered. Do not append a generic menu of unrelated capabilities.",
    "- This composer controls presentation only. It is not evidence, permission, scope, approval or execution authority.",
  ].join("\n").slice(0, MAX_COMPOSER_BLOCK);
}

function appendAnswerComposerInstruction(messages = [], plan = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const block = answerComposerPromptBlock(plan);
  if (!block) return Object.freeze([...source]);
  const latestUserIndex = (() => {
    for (let index = source.length - 1; index >= 0; index -= 1) {
      if (String(source[index]?.role || "").toLowerCase() === "user") return index;
    }
    return source.length;
  })();
  const output = [...source];
  output.splice(latestUserIndex, 0, Object.freeze({ role: "system", content: block }));
  return Object.freeze(output);
}

function userFacingAiFailureMessage(error = {}) {
  const code = clean(error?.code, 100).toUpperCase();
  if (code === "AI_REQUEST_TOKEN_LIMIT_EXCEEDED") {
    return "I couldn't complete the full answer in one pass. Your conversation is intact, so we can continue from the same topic without starting over.";
  }
  if (code === "AI_PROVIDER_TIMEOUT") {
    return "I couldn't finish the answer on this attempt. Your conversation and context are intact, so the next turn can continue from here.";
  }
  if (["AI_DAILY_USER_LIMIT_EXCEEDED", "AI_DAILY_WORKSPACE_LIMIT_EXCEEDED"].includes(code)) {
    return "CHALIN's technical AI guardrail stopped this turn before it could finish. Your conversation and business data are unchanged.";
  }
  return "CHALIN could not complete this turn safely. Your conversation is preserved and ordinary business operations are unaffected.";
}

module.exports = {
  MAX_ANCHORS,
  MAX_COMPOSER_BLOCK,
  MAX_OBJECTIVES,
  MODE_ALIASES,
  MODE_STRUCTURES,
  answerComposerPromptBlock,
  appendAnswerComposerInstruction,
  buildAnswerCompositionPlan,
  clean,
  normalizeMode,
  taskObjectives,
  userFacingAiFailureMessage,
  workingStateAnchors,
};
