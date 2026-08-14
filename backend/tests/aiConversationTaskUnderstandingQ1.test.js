"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  inferDomains,
  understandConversationTask,
} = require("../services/aiConversationTaskUnderstandingService");
const {
  buildMultiToolTaskPlan,
} = require("../services/aiTaskPlannerService");
const {
  latestTaskUnderstanding,
  routingObjectives,
} = require("../services/aiProviderToolRoutingService");

function tool(key, description) {
  return Object.freeze({
    key,
    title: key.replace(/[._-]+/g, " "),
    description,
    risk_level: 1,
  });
}

test("Q1 understands Payroll plus Audit as one explanation task", () => {
  const task = understandConversationTask({
    prompt: "How are Payroll approval and audit controls governed in CHALIN?",
  });

  assert.equal(task.answer_mode, "explanation");
  assert.deepEqual(task.domains, ["payroll", "audit_controls_security"]);
  assert.equal(task.domain_confidence, "high");
  assert.equal(task.live_data_required, false);
  assert.equal(task.continuity_required, false);
  assert.deepEqual(task.evidence_families, ["payroll", "worker", "audit"]);
});

test("Q1 keeps diagnosis and comparison facets without dropping compound objectives", () => {
  const task = understandConversationTask({
    prompt: "Main Store sales are higher today but profit is lower. What happened, and compare it with yesterday?",
  });

  assert.equal(task.answer_mode, "diagnosis");
  assert.ok(task.answer_facets.includes("diagnosis"));
  assert.ok(task.answer_facets.includes("comparison"));
  assert.deepEqual(task.domains, ["spare_parts"]);
  assert.equal(task.live_data_required, true);
  assert.equal(task.objective_count, 2);
  assert.match(task.objectives[0], /Main Store sales are higher today/i);
  assert.match(task.objectives[1], /compare it with yesterday/i);
  assert.ok(task.metric_hints.includes("sales"));
  assert.ok(task.metric_hints.includes("profit"));
  assert.ok(task.time_hints.includes("today"));
  assert.ok(task.time_hints.includes("yesterday"));
});

test("Q1 short why follow-up inherits domain and live task context", () => {
  const history = [
    { role: "user", content: "Why is Main Store profit low today?" },
    { role: "assistant", content: "The margin is under pressure today." },
  ];
  const task = understandConversationTask({
    prompt: "And why?",
    history,
  });

  assert.equal(task.continuity_required, true);
  assert.deepEqual(task.domains, ["spare_parts"]);
  assert.equal(task.domain_source, "conversation_continuity");
  assert.equal(task.live_data_required, true);
  assert.ok(task.metric_hints.includes("profit"));
  assert.ok(task.time_hints.includes("today"));
});

test("Q1 resumes the assistant's offered investigation when the owner says yes do it", () => {
  const first = understandConversationTask({
    prompt: "have anybody bought something today",
    workspaceCode: "spare_parts",
  });

  assert.deepEqual(first.domains, ["spare_parts"]);
  assert.equal(first.domain_source, "authorized_workspace_context");
  assert.equal(first.live_data_required, true);
  assert.ok(first.metric_hints.includes("sales"));
  assert.ok(first.time_hints.includes("today"));

  const history = [
    { role: "user", content: "have anybody bought something today" },
    {
      role: "assistant",
      content: "No sales have been recorded at Main Store today. I can investigate why sales are zero today and compare operations with recent activity.",
    },
  ];
  const second = understandConversationTask({
    prompt: "yes do it",
    history,
    workspaceCode: "spare_parts",
    taskState: {
      working_state: first.working_state,
      resolved_prompt: first.current_prompt,
    },
  });

  assert.equal(second.continuity_required, true);
  assert.equal(second.confirmation_continuation, true);
  assert.match(second.confirmed_assistant_offer, /I can investigate why sales are zero today/i);
  assert.equal(second.answer_mode, "diagnosis");
  assert.equal(second.objective_count, 1);
  assert.match(second.objectives[0], /^investigate why sales are zero today/i);
  assert.notEqual(second.objectives[0].toLowerCase(), "yes do it");
  assert.deepEqual(second.domains, ["spare_parts"]);
  assert.equal(second.domain_source, "working_state_continuity");
  assert.equal(second.live_data_required, true);
  assert.equal(second.working_state.subject, first.working_state.subject);
  assert.match(second.working_state.objective, /^investigate why sales are zero today/i);
  assert.ok(second.working_state.metrics.includes("sales"));
  assert.ok(second.working_state.periods.active.includes("today"));

  const thirdHistory = [
    ...history,
    { role: "user", content: "yes do it" },
    {
      role: "assistant",
      content: "Today's zero sales need comparison with stock availability and transaction activity before drawing a cause.",
    },
  ];
  const third = understandConversationTask({
    prompt: "generate pdf format of yesterday sales",
    history: thirdHistory,
    workspaceCode: "spare_parts",
    taskState: {
      working_state: second.working_state,
      resolved_prompt: second.working_state.objective,
    },
  });

  assert.equal(third.continuity_required, true);
  assert.deepEqual(third.domains, ["spare_parts"]);
  assert.equal(third.answer_mode, "action");
  assert.ok(third.metric_hints.includes("sales"));
  assert.ok(third.time_hints.includes("yesterday"));
  assert.deepEqual(third.working_state.domains, ["spare_parts"]);
  assert.equal(third.working_state.answer_mode, "action");
  assert.ok(third.working_state.metrics.includes("sales"));
  assert.ok(third.working_state.periods.active.includes("yesterday"));
  assert.ok(third.working_state.periods.comparison.includes("today"));
});

test("Q1 recognizes common confirmation variants as continuation without inventing a new objective", () => {
  const history = [
    { role: "user", content: "Why are Main Store sales low today?" },
    { role: "assistant", content: "I can investigate the sales drop against stock availability." },
  ];
  const taskState = {
    working_state: understandConversationTask({
      prompt: "Why are Main Store sales low today?",
      workspaceCode: "spare_parts",
    }).working_state,
  };

  for (const prompt of ["yes do it", "okay do that", "go ahead", "please do it"]) {
    const task = understandConversationTask({ prompt, history, workspaceCode: "spare_parts", taskState });
    assert.equal(task.continuity_required, true, prompt);
    assert.equal(task.confirmation_continuation, true, prompt);
    assert.match(task.objectives[0], /^investigate the sales drop/i, prompt);
  }
});

test("Q1 CHALIN business-description question stays static product explanation", () => {
  const task = understandConversationTask({
    prompt: "Tell me more about CHALIN and its businesses",
  });

  assert.equal(task.answer_mode, "explanation");
  assert.deepEqual(task.domains, ["chalin_product"]);
  assert.equal(task.live_data_required, false);
  assert.equal(task.ambiguous_domain, false);
});

test("Q1 does not guess an operational domain without evidence", () => {
  const unscoped = understandConversationTask({
    prompt: "Why are sales lower?",
  });
  assert.deepEqual(unscoped.domains, []);
  assert.equal(unscoped.domain_confidence, "low");
  assert.equal(unscoped.ambiguous_domain, true);

  const scoped = understandConversationTask({
    prompt: "Why are sales lower today?",
    workspaceCode: "spare_parts",
  });
  assert.deepEqual(scoped.domains, ["spare_parts"]);
  assert.equal(scoped.domain_source, "authorized_workspace_context");
  assert.equal(scoped.domain_confidence, "medium");
  assert.equal(scoped.live_data_required, true);
});

test("Q1 recognizes customer owing questions as live customer-accounting investigation", () => {
  const task = understandConversationTask({
    prompt: "How much does Kwame owe us?",
  });

  assert.deepEqual(task.domains, ["customer_accounting"]);
  assert.ok(["investigation", "direct_fact"].includes(task.answer_mode));
  assert.equal(task.live_data_required, true);
  assert.deepEqual(task.evidence_families, ["customer", "debt"]);
});

test("multi-tool planner consumes the same Q1 domains and evidence families", () => {
  const prompt = "How are Payroll approval and audit controls governed in CHALIN?";
  const plan = buildMultiToolTaskPlan({
    prompt,
    reasoningPlan: {
      intent: "explain",
      live_data_required: false,
      task_state: {
        current_prompt: prompt,
        resolved_prompt: prompt,
        follow_up: false,
        referential_language: false,
        inherited_turns: [],
        subquestions: [prompt],
      },
    },
    tools: [
      tool("payroll.compensation_snapshot", "Payroll salary compensation worker read"),
      tool("system.audit_controls_health", "Audit controls security governance activity read"),
      tool("mining.operations_snapshot", "Mining production operations read"),
    ],
  });

  assert.equal(plan.version, 2);
  assert.equal(plan.answer_mode, "explanation");
  assert.deepEqual(plan.task_domains, ["payroll", "audit_controls_security"]);
  assert.ok(plan.objectives[0].evidence_needs.includes("payroll"));
  assert.ok(plan.objectives[0].evidence_needs.includes("worker"));
  assert.ok(plan.objectives[0].evidence_needs.includes("audit"));
  const candidateKeys = plan.objectives[0].candidate_tools.map((entry) => entry.key);
  assert.ok(candidateKeys.includes("payroll.compensation_snapshot"));
  assert.ok(candidateKeys.includes("system.audit_controls_health"));
  assert.equal(candidateKeys.includes("mining.operations_snapshot"), false);
});

test("provider router exposes one latest structured task while preserving recent objectives", () => {
  const messages = [
    { role: "user", content: "How much did Main Store sell today?" },
    { role: "assistant", content: "Main Store sales answer." },
    { role: "user", content: "What about yesterday?" },
  ];

  const task = latestTaskUnderstanding(messages);
  assert.equal(task.continuity_required, true);
  assert.deepEqual(task.domains, ["spare_parts"]);
  assert.equal(task.live_data_required, true);

  const objectives = routingObjectives(messages);
  assert.equal(objectives.length, 2);
  assert.ok(objectives[0].evidence_needs.includes("sales"));
  assert.equal(objectives[1].continuity_required, true);
});

test("domain inference treats unknown business wording as ambiguous instead of widening scope", () => {
  const result = inferDomains({ prompt: "Check the current outstanding problem" });
  assert.deepEqual(result.domains, []);
  assert.equal(result.confidence, "low");
});
