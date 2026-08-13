"use strict";

const {
  buildPersonaPresentationPlan,
  personaPresentationPromptLines,
} = require("./aiPersonaPresentationService");

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

const SOCIAL_CONVERSATION_PATTERN = /^(?:(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening))|(?:how\s+(?:are|r)\s+you(?:\s+doing)?|how(?:'s|\s+is)\s+it\s+going|what(?:'s|\s+is)\s+up)|(?:thanks|thank\s+you(?:\s+very\s+much)?|okay|ok|alright|cool|great|nice|bye|goodbye|see\s+you))[\s!.?,'-]*$/i;
const BUSINESS_METRIC_PATTERN = /\b(?:sales?|revenue|turnover|profit|margin|stock|inventory|debt|collections?|payments?|expenses?|payroll|salary|production|hire|finance|arrears|receivables?|operations?|performance)\b/i;
const DOCUMENT_REQUEST_PATTERN = /\b(?:generate|create|make|prepare|export|produce|build|give me|put together|turn into)\b[\s\S]{0,120}\b(?:document|report|statement|file|pdf|word|docx|excel|xlsx|spreadsheet|csv)\b|\b(?:document|report|statement|pdf|word|docx|excel|xlsx|spreadsheet|csv)\b[\s\S]{0,120}\b(?:generate|create|make|prepare|export|produce|build)\b/i;
const EXPLICIT_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;
const RELATIVE_TIME_PATTERN = /\b(?:today|yesterday|this\s+week|last\s+week|this\s+month|last\s+month|past\s+(?:7|30)\s+days|last\s+(?:7|30)\s+days|lately|recent|recently|latest|current(?:ly)?|right\s+now)\b/i;
const RECENT_TIME_PATTERN = /\b(?:lately|recent|recently|latest|past\s+30\s+days|last\s+30\s+days)\b/i;
const PERFORMANCE_TREND_PATTERN = /\b(?:performance|trend|doing|going|lately|recent|recently|latest|compare|comparison|better|worse|increase|decrease|up|down)\b/i;

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

function utcDateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return utcDateOnly(new Date());
  return date.toISOString().slice(0, 10);
}

function utcMidnight(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(value, days) {
  const date = utcMidnight(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date;
}

function startOfUtcMonth(value) {
  const date = utcMidnight(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(value) {
  const start = startOfUtcMonth(value);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
}

function startOfUtcWeek(value) {
  const date = utcMidnight(value);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addUtcDays(date, mondayOffset);
}

function periodShape(label, start, end, { source = "explicit_relative", comparison = false } = {}) {
  const result = {
    label,
    start_date: utcDateOnly(start),
    end_date: utcDateOnly(end),
    source,
    defaulted: source === "business_default",
  };
  if (comparison) {
    const durationDays = Math.max(1, Math.round((utcMidnight(end) - utcMidnight(start)) / 86400000) + 1);
    const comparisonEnd = addUtcDays(start, -1);
    const comparisonStart = addUtcDays(comparisonEnd, -(durationDays - 1));
    result.comparison_start_date = utcDateOnly(comparisonStart);
    result.comparison_end_date = utcDateOnly(comparisonEnd);
  }
  return Object.freeze(result);
}

function inferTemporalGuidance(prompt, { now = new Date(), liveDataRequired = false } = {}) {
  const text = clean(prompt, 12000);
  const today = utcMidnight(now);
  const business = BUSINESS_METRIC_PATTERN.test(text);
  const documentRequest = DOCUMENT_REQUEST_PATTERN.test(text) && business;
  const compare = business && PERFORMANCE_TREND_PATTERN.test(text);

  if (!business) {
    return Object.freeze({
      current_date: utcDateOnly(today),
      requires_live_data: liveDataRequired === true,
      period: null,
      operational_document_default: false,
    });
  }

  if (EXPLICIT_DATE_PATTERN.test(text)) {
    return Object.freeze({
      current_date: utcDateOnly(today),
      requires_live_data: true,
      period: null,
      explicit_dates_present: true,
      operational_document_default: false,
    });
  }

  let period = null;
  if (/\btoday\b|\bright\s+now\b|\bcurrently\b|\bcurrent\b/i.test(text)) {
    period = periodShape("today", today, today, { comparison: false });
  } else if (/\byesterday\b/i.test(text)) {
    const day = addUtcDays(today, -1);
    period = periodShape("yesterday", day, day, { comparison: false });
  } else if (/\bthis\s+week\b/i.test(text)) {
    period = periodShape("this week to date", startOfUtcWeek(today), today, { comparison: compare });
  } else if (/\blast\s+week\b/i.test(text)) {
    const end = addUtcDays(startOfUtcWeek(today), -1);
    period = periodShape("last week", addUtcDays(end, -6), end, { comparison: compare });
  } else if (/\bthis\s+month\b/i.test(text)) {
    period = periodShape("this month to date", startOfUtcMonth(today), today, { comparison: compare });
  } else if (/\blast\s+month\b/i.test(text)) {
    const priorMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    period = periodShape("last month", startOfUtcMonth(priorMonthDate), endOfUtcMonth(priorMonthDate), { comparison: compare });
  } else if (/\b(?:past|last)\s+7\s+days\b/i.test(text)) {
    period = periodShape("last 7 days", addUtcDays(today, -6), today, { comparison: compare });
  } else if (RECENT_TIME_PATTERN.test(text)) {
    period = periodShape("recent 30 days", addUtcDays(today, -29), today, { comparison: compare });
  } else if (documentRequest && !RELATIVE_TIME_PATTERN.test(text)) {
    period = periodShape("recent 30 days", addUtcDays(today, -29), today, {
      source: "business_default",
      comparison: compare,
    });
  }

  return Object.freeze({
    current_date: utcDateOnly(today),
    requires_live_data: liveDataRequired === true || Boolean(period) || documentRequest,
    period,
    explicit_dates_present: false,
    operational_document_default: Boolean(documentRequest && period?.defaulted),
  });
}

function isSocialConversationPrompt(prompt) {
  return SOCIAL_CONVERSATION_PATTERN.test(clean(prompt, 500));
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
  const personaPresentation = buildPersonaPresentationPlan(context.persona);
  const baseLiveDataRequired =
    task.live_data_required === true ||
    graph.live_data_required === true ||
    context.live_data_required === true;
  const temporal = inferTemporalGuidance(prompt, {
    liveDataRequired: baseLiveDataRequired,
  });
  const socialConversation = isSocialConversationPrompt(prompt);

  return Object.freeze({
    version: 2,
    source_of_truth: false,
    permission_authority: false,
    execution_authority: false,
    mode,
    objectives,
    objective_count: objectives.length,
    structure: MODE_STRUCTURES[mode] || MODE_STRUCTURES.direct_answer,
    answer_first: true,
    plain_language: true,
    persona: personaPresentation.persona,
    persona_presentation: personaPresentation,
    cross_domain: graph.cross_domain === true,
    domains: Object.freeze(unique(graph.domains || task.domains, 8)),
    relationship_keys: Object.freeze(unique(graph.relationship_keys, 12)),
    live_data_required: temporal.requires_live_data === true,
    continuity_required: task.continuity_required === true,
    social_conversation: socialConversation,
    temporal,
    anchors,
  });
}

function temporalPromptLines(temporal = {}) {
  const lines = [`- Current business date (UTC/Ghana): ${clean(temporal.current_date, 20) || utcDateOnly()}.`];
  const period = temporal.period;
  if (period) {
    lines.push(
      `- Time interpretation: ${period.label} = ${period.start_date} through ${period.end_date}. Use these exact dates for governed date-range tools unless the user explicitly supplied a different period.`
    );
    if (period.comparison_start_date && period.comparison_end_date) {
      lines.push(
        `- For trend/performance judgment, compare against the immediately preceding equal window ${period.comparison_start_date} through ${period.comparison_end_date} when the available governed tools can do so efficiently.`
      );
    }
  }
  if (temporal.operational_document_default === true) {
    lines.push(
      "- The user requested an operational business document but omitted a period. Do not stop to ask for one: use the bounded recent period above, use the already-authorized workspace/store, verify the live figures, and state the exact dates prominently in the finished document."
    );
  }
  if (temporal.requires_live_data === true) {
    lines.push(
      "- Do not answer this operational request from memory or generic business advice alone. Use the supplied governed live tools/evidence before stating current figures or performance conclusions."
    );
  }
  return lines;
}

function answerComposerPromptBlock(plan = {}) {
  const objectives = Array.isArray(plan.objectives) ? plan.objectives : [];
  const anchors = plan.anchors || {};
  const personaPresentation = buildPersonaPresentationPlan(
    plan?.persona_presentation?.persona || plan.persona
  );
  const personaLines = personaPresentationPromptLines(personaPresentation);
  const objectiveText = objectives.length
    ? objectives.map((item, index) => `${index + 1}. ${clean(item, 600)}`).join(" | ")
    : "answer the newest user request";
  const anchorText = [
    anchors.subject ? `subject=${clean(anchors.subject, 180)}` : null,
    anchors.entities?.length ? `entities=${anchors.entities.join(", ")}` : null,
    anchors.periods?.length ? `periods=${anchors.periods.join(", ")}` : null,
    anchors.metrics?.length ? `metrics=${anchors.metrics.join(", ")}` : null,
  ].filter(Boolean).join("; ") || "none";
  const socialLines = plan.social_conversation === true
    ? [
        "- This is ordinary social conversation. Reply naturally in one or two short sentences and stop.",
        "- Never answer social small talk with boilerplate such as ‘As an AI assistant’, ‘I operate continuously’, ‘I do not get tired’, model/provider explanations, evidence talk, system-capability lists, or a long introduction.",
        "- Sound like a capable colleague: warm, concise and ready to help, without pretending to have human feelings or experiences.",
      ]
    : [];

  return [
    "CHALIN universal answer-composer contract:",
    `- Answer mode: ${plan.mode || "direct_answer"}.`,
    `- Required user objectives: ${objectiveText}.`,
    `- Preferred answer flow: ${(plan.structure || MODE_STRUCTURES.direct_answer).join(" -> ")}.`,
    `- Active continuity anchors: ${anchorText}.`,
    `- Cross-domain synthesis: ${plan.cross_domain === true ? "yes" : "no"}.`,
    `- Live verification required: ${plan.live_data_required === true ? "yes" : "no"}.`,
    ...temporalPromptLines(plan.temporal || {}),
    ...socialLines,
    ...personaLines,
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
    return "I reached this turn’s reasoning limit before I could finish the verified answer. The conversation and active business context are intact, so your next message can continue from the same point without starting over.";
  }
  if (code === "AI_PROVIDER_TIMEOUT") {
    return "The intelligence provider did not finish this turn in time. Your conversation and active business context are intact; no business record was changed.";
  }
  if (["AI_DAILY_USER_LIMIT_EXCEEDED", "AI_DAILY_WORKSPACE_LIMIT_EXCEEDED"].includes(code)) {
    return "CHALIN's technical AI usage guardrail stopped this turn before completion. Your conversation and business data are unchanged.";
  }
  return "I couldn't complete this intelligence turn safely. The conversation is preserved and ordinary business operations are unaffected.";
}

module.exports = {
  BUSINESS_METRIC_PATTERN,
  DOCUMENT_REQUEST_PATTERN,
  EXPLICIT_DATE_PATTERN,
  MAX_ANCHORS,
  MAX_COMPOSER_BLOCK,
  MAX_OBJECTIVES,
  MODE_ALIASES,
  MODE_STRUCTURES,
  PERFORMANCE_TREND_PATTERN,
  RECENT_TIME_PATTERN,
  RELATIVE_TIME_PATTERN,
  SOCIAL_CONVERSATION_PATTERN,
  addUtcDays,
  answerComposerPromptBlock,
  appendAnswerComposerInstruction,
  buildAnswerCompositionPlan,
  clean,
  inferTemporalGuidance,
  isSocialConversationPrompt,
  normalizeMode,
  periodShape,
  startOfUtcMonth,
  startOfUtcWeek,
  taskObjectives,
  temporalPromptLines,
  userFacingAiFailureMessage,
  utcDateOnly,
  utcMidnight,
  workingStateAnchors,
};