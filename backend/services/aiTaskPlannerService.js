"use strict";

const {
  understandConversationTask,
  unique,
} = require("./aiConversationTaskUnderstandingService");
const {
  buildCrossDomainReasoningGraph,
} = require("./aiCrossDomainReasoningGraphService");

const MAX_OBJECTIVES = 8;
const MAX_CANDIDATE_TOOLS = 5;

const EVIDENCE_RULES = Object.freeze([
  Object.freeze({ key: "sales", pattern: /\b(sale|sales|sold|sell|selling|revenue|turnover)\b/i }),
  Object.freeze({ key: "profit", pattern: /\b(profit|margin|gross profit|net profit|cost of goods|cogs)\b/i }),
  Object.freeze({ key: "inventory", pattern: /\b(stock|inventory|quantity|reorder|dead stock|valuation)\b/i }),
  Object.freeze({ key: "customer", pattern: /\b(customer|buyer|client|bought|purchase history|lifetime value)\b/i }),
  Object.freeze({ key: "debt", pattern: /\b(debt|owe|owes|owing|outstanding|arrears|collection|collections|payment behaviour|payment behavior)\b/i }),
  Object.freeze({ key: "worker", pattern: /\b(worker|employee|staff|employment|hr|human resources)\b/i }),
  Object.freeze({ key: "payroll", pattern: /\b(payroll|salary|payslip|wage|allowance|deduction)\b/i }),
  Object.freeze({ key: "mining", pattern: /\b(mining|site production|fuel usage|ore|production shift)\b/i }),
  Object.freeze({ key: "equipment_hire", pattern: /\b(equipment hire|hire contract|rental|dispatcher|fleet utilisation|fleet utilization)\b/i }),
  Object.freeze({ key: "equipment_finance", pattern: /\b(installment|instalment|equipment finance|finance account|down payment|repayment schedule)\b/i }),
  Object.freeze({ key: "audit", pattern: /\b(audit|changed|who changed|activity log|trace|anomaly|suspicious)\b/i }),
  Object.freeze({ key: "document", pattern: /\b(pdf|excel|xlsx|csv|word|docx|document|statement|report|letter|board pack|management pack)\b/i }),
]);

const LIVE_PATTERNS = /\b(today|yesterday|now|current|currently|latest|outstanding|overdue|active|this week|this month|last week|last month)\b/i;

function clean(value, maximum = 12000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function tokenize(value) {
  return unique(
    (clean(value, 8000)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9][a-z0-9._-]{1,}/g) || [])
      .map((token) => token.replace(/^[-_.]+|[-_.]+$/g, ""))
      .filter((token) => token.length >= 3)
  );
}

function evidenceNeedsForQuestion(question) {
  const text = clean(question, 4000);
  const needs = EVIDENCE_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.key);

  if (needs.includes("profit")) {
    needs.push("sales", "inventory");
  }
  if (needs.includes("debt")) {
    needs.push("customer");
  }
  if (needs.includes("payroll")) {
    needs.push("worker");
  }
  if (needs.includes("document") && needs.length === 1) {
    needs.push("conversation_context");
  }

  return Object.freeze(unique(needs));
}

function toolSearchText(tool = {}) {
  return clean(
    [
      tool.key,
      tool.title,
      tool.description,
      ...(tool.allowed_workspaces || []),
    ]
      .filter(Boolean)
      .join(" "),
    6000
  ).toLowerCase();
}

function toolEvidenceTags(tool = {}) {
  const text = toolSearchText(tool);
  return unique(
    EVIDENCE_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.key)
  );
}

function candidateToolScore(tool, objective) {
  if (Number(tool?.risk_level || 0) > 1) return -1;

  const toolTags = new Set(toolEvidenceTags(tool));
  const needs = objective.evidence_needs || [];
  let tagMatches = 0;
  for (const need of needs) if (toolTags.has(need)) tagMatches += 1;

  // When the server has identified a concrete evidence family, a tool must
  // match at least one of those families. Generic words such as "snapshot" or
  // "status" may rank an otherwise-useful read, but they must never allow a
  // debt tool to satisfy an inventory objective (or another unrelated task).
  if (needs.length > 0 && tagMatches === 0) return 0;

  const questionTokens = tokenize(objective.question);
  const toolTokens = new Set(tokenize(toolSearchText(tool)));
  let lexicalMatches = 0;
  for (const token of questionTokens) if (toolTokens.has(token)) lexicalMatches += 1;

  const tagScore = needs.length ? tagMatches / needs.length : 0;
  const lexicalScore = questionTokens.length ? lexicalMatches / questionTokens.length : 0;
  const genericReadBonus = /snapshot|summary|search|lookup|intelligence|operations|status/.test(
    toolSearchText(tool)
  )
    ? 0.08
    : 0;

  return Number((tagScore * 0.72 + lexicalScore * 0.2 + genericReadBonus).toFixed(6));
}

function rankedCandidateTools(objective, tools = []) {
  return Object.freeze(
    (Array.isArray(tools) ? tools : [])
      .map((tool) => ({ key: String(tool.key || ""), score: candidateToolScore(tool, objective) }))
      .filter((entry) => entry.key && entry.score > 0)
      .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
      .slice(0, MAX_CANDIDATE_TOOLS)
      .map((entry) => Object.freeze(entry))
  );
}

function objectiveQuestionList({ prompt, reasoningPlan } = {}) {
  const fromPlan = Array.isArray(reasoningPlan?.task_state?.subquestions)
    ? reasoningPlan.task_state.subquestions.map((item) => clean(item, 1500)).filter(Boolean)
    : [];
  if (fromPlan.length > 1) return fromPlan.slice(0, MAX_OBJECTIVES);
  return [clean(reasoningPlan?.task_state?.current_prompt || prompt, 4000)].filter(Boolean);
}

function taskUnderstandingForPlan({ prompt, reasoningPlan = {} } = {}) {
  const taskState = reasoningPlan?.task_state || {};
  return understandConversationTask({
    prompt: taskState.current_prompt || prompt,
    history: taskState.inherited_turns || [],
    taskState,
    resolvedPrompt: taskState.resolved_prompt || "",
    subquestions: taskState.subquestions || [],
  });
}

function objectiveTaskUnderstanding(question, { reasoningPlan = {}, objectiveCount = 1 } = {}) {
  const taskState = reasoningPlan?.task_state || {};
  const mayInheritContinuity = Number(objectiveCount || 0) <= 1;
  return understandConversationTask({
    prompt: question,
    history: mayInheritContinuity ? taskState.inherited_turns || [] : [],
    taskState: mayInheritContinuity ? taskState : null,
    resolvedPrompt: mayInheritContinuity ? taskState.resolved_prompt || "" : "",
  });
}

function buildMultiToolTaskPlan({ prompt, reasoningPlan = {}, tools = [] } = {}) {
  const taskUnderstanding = taskUnderstandingForPlan({ prompt, reasoningPlan });
  const reasoningGraph = buildCrossDomainReasoningGraph({ taskUnderstanding });
  const questions = objectiveQuestionList({ prompt, reasoningPlan });
  const objectives = questions.map((question, index) => {
    // Each decomposed sub-question owns its evidence families. Whole-request
    // domains remain useful for answer synthesis, but must not leak one
    // objective's evidence into another and falsely mark it as resolved.
    const objectiveUnderstanding = objectiveTaskUnderstanding(question, {
      reasoningPlan,
      objectiveCount: questions.length,
    });
    const objectiveGraph = buildCrossDomainReasoningGraph({
      taskUnderstanding: objectiveUnderstanding,
    });
    const evidenceNeeds = Object.freeze(
      unique([
        ...evidenceNeedsForQuestion(question),
        ...objectiveUnderstanding.evidence_families,
        ...objectiveGraph.evidence_families,
      ])
    );
    const objective = {
      id: `objective_${index + 1}`,
      question,
      evidence_needs: evidenceNeeds,
      task_domains: objectiveGraph.domains,
      reasoning_relationship_keys: objectiveGraph.relationship_keys,
      live_data_required:
        reasoningPlan?.live_data_required === true ||
        objectiveUnderstanding.live_data_required === true ||
        objectiveGraph.live_data_required === true ||
        LIVE_PATTERNS.test(question),
      status: "pending",
      candidate_tools: Object.freeze([]),
      supporting_tool_keys: Object.freeze([]),
    };
    return Object.freeze({
      ...objective,
      candidate_tools: rankedCandidateTools(objective, tools),
    });
  });

  return Object.freeze({
    version: 2,
    intent: reasoningPlan?.intent || taskUnderstanding.answer_mode || "lookup",
    answer_mode: taskUnderstanding.answer_mode,
    task_domains: reasoningGraph.domains,
    domain_confidence: taskUnderstanding.domain_confidence,
    continuity_required: taskUnderstanding.continuity_required,
    task_understanding: taskUnderstanding,
    reasoning_graph: reasoningGraph,
    objective_count: objectives.length,
    objectives: Object.freeze(objectives),
    all_resolved: false,
    unresolved_count: objectives.length,
  });
}

function resultToolKey(result = {}) {
  return clean(result?.tool?.key || result?.tool_key, 160).toLowerCase();
}

function updateTaskPlanCoverage(plan, toolResults = []) {
  const usedToolKeys = new Set(
    (Array.isArray(toolResults) ? toolResults : []).map(resultToolKey).filter(Boolean)
  );

  const objectives = (plan?.objectives || []).map((objective) => {
    const candidateKeys = (objective.candidate_tools || []).map((entry) =>
      String(entry.key || "").toLowerCase()
    );
    const supporting = candidateKeys.filter((key) => usedToolKeys.has(key));
    const evidenceBacked = supporting.length > 0;
    const noToolCandidate = candidateKeys.length === 0;
    const status = evidenceBacked
      ? "evidence_collected"
      : noToolCandidate && !objective.live_data_required
        ? "reasoning_only"
        : "pending";

    return Object.freeze({
      ...objective,
      status,
      supporting_tool_keys: Object.freeze(supporting),
    });
  });

  const unresolved = objectives.filter((objective) => objective.status === "pending");
  return Object.freeze({
    ...plan,
    objectives: Object.freeze(objectives),
    all_resolved: unresolved.length === 0,
    unresolved_count: unresolved.length,
  });
}

function taskPlannerPromptBlock(plan = {}) {
  const objectives = Array.isArray(plan?.objectives) ? plan.objectives : [];
  const graph = plan?.reasoning_graph || {};
  const rows = objectives.map((objective, index) => {
    const candidates = (objective.candidate_tools || []).map((entry) => entry.key).join(", ") || "none";
    const supporting = (objective.supporting_tool_keys || []).join(", ") || "none";
    const relationships = (objective.reasoning_relationship_keys || []).join(", ") || "none";
    return `${index + 1}. [${objective.status || "pending"}] ${objective.question}\n   evidence needs: ${(objective.evidence_needs || []).join(", ") || "general reasoning"}\n   reasoning bridges: ${relationships}\n   candidate read tools: ${candidates}\n   tool evidence collected: ${supporting}`;
  });

  return [
    "CHALIN server-owned task plan:",
    `Answer mode: ${plan.answer_mode || plan.intent || "generic"}.`,
    `Task domains: ${(plan.task_domains || []).join(", ") || "unresolved/general"}.`,
    `Cross-domain reasoning required: ${graph.cross_domain === true ? "yes" : "no"}.`,
    `Reasoning bridges: ${(graph.relationship_keys || []).join(", ") || "none"}.`,
    `Conversation continuity required: ${plan.continuity_required === true ? "yes" : "no"}.`,
    ...rows,
    `Unresolved objectives: ${Number(plan?.unresolved_count || 0)} of ${objectives.length}.`,
    "Planner rules:",
    "- Treat every objective as part of the user's request; do not silently drop one.",
    "- The reasoning graph is an advisory coverage map, not evidence, permission, scope or execution authority.",
    "- Candidate tools are ranked hints, not permission bypasses. Request only tools actually supplied to you.",
    "- Prefer one tool call that resolves multiple objectives over repetitive calls.",
    "- Use additional read-tool rounds only for a material unresolved objective or to verify a conclusion.",
    "- If an objective remains unresolved on the final synthesis round, explicitly say what could not be verified and why.",
    "- A reasoning-only objective may be answered without a tool when it does not require live CHALIN facts.",
    "- Never claim a document/action was generated or executed unless an approved tool actually performed it.",
  ].join("\n");
}

function publicTaskPlan(plan = {}) {
  const graph = plan?.reasoning_graph || {};
  return Object.freeze({
    version: Number(plan.version || 1),
    answer_mode: plan.answer_mode || null,
    task_domains: Object.freeze([...(plan.task_domains || [])]),
    domain_confidence: plan.domain_confidence || "low",
    continuity_required: plan.continuity_required === true,
    cross_domain: graph.cross_domain === true,
    reasoning_relationship_keys: Object.freeze([...(graph.relationship_keys || [])]),
    related_domains: Object.freeze([...(graph.related_domains || [])]),
    objective_count: Number(plan.objective_count || 0),
    all_resolved: plan.all_resolved === true,
    unresolved_count: Number(plan.unresolved_count || 0),
    objectives: Object.freeze(
      (plan.objectives || []).map((objective) =>
        Object.freeze({
          id: objective.id,
          question: objective.question,
          evidence_needs: Object.freeze([...(objective.evidence_needs || [])]),
          task_domains: Object.freeze([...(objective.task_domains || [])]),
          reasoning_relationship_keys: Object.freeze([...(objective.reasoning_relationship_keys || [])]),
          live_data_required: objective.live_data_required === true,
          status: objective.status,
          candidate_tool_keys: Object.freeze(
            (objective.candidate_tools || []).map((entry) => entry.key)
          ),
          supporting_tool_keys: Object.freeze([...(objective.supporting_tool_keys || [])]),
        })
      )
    ),
  });
}

module.exports = {
  EVIDENCE_RULES,
  LIVE_PATTERNS,
  MAX_CANDIDATE_TOOLS,
  MAX_OBJECTIVES,
  buildMultiToolTaskPlan,
  candidateToolScore,
  evidenceNeedsForQuestion,
  objectiveQuestionList,
  objectiveTaskUnderstanding,
  publicTaskPlan,
  rankedCandidateTools,
  resultToolKey,
  taskPlannerPromptBlock,
  taskUnderstandingForPlan,
  toolEvidenceTags,
  toolSearchText,
  updateTaskPlanCoverage,
};
