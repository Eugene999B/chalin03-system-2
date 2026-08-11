"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  understandConversationTask,
} = require("../services/aiConversationTaskUnderstandingService");
const {
  buildMultiToolTaskPlan,
} = require("../services/aiTaskPlannerService");

test("Q2 task understanding exposes a non-authoritative working state", () => {
  const task = understandConversationTask({
    prompt: "How much did Main Store sell today?",
  });

  assert.ok(task.working_state);
  assert.equal(task.working_state.source_of_truth, false);
  assert.deepEqual(task.working_state.domains, ["spare_parts"]);
  assert.ok(task.working_state.metrics.includes("sales"));
  assert.ok(task.working_state.periods.active.includes("today"));
  assert.equal(task.working_state.live_verification_required, true);
});

test("Q2 short follow-up may inherit domain from bounded working state", () => {
  const previous = understandConversationTask({
    prompt: "How much did Main Store sell today?",
  });
  const task = understandConversationTask({
    prompt: "Profit?",
    taskState: {
      follow_up: true,
      current_prompt: "Profit?",
      resolved_prompt: "Prior user instruction/context: How much did Main Store sell today?\nCurrent follow-up: Profit?",
      subquestions: ["Profit?"],
      working_state: previous.working_state,
    },
  });

  assert.equal(task.continuity_required, true);
  assert.deepEqual(task.domains, ["spare_parts"]);
  assert.equal(task.domain_source, "working_state_continuity");
  assert.ok(task.working_state.metrics.includes("profit"));
  assert.ok(task.working_state.metrics.includes("sales"));
  assert.equal(task.working_state.entities[0].label, "Main Store");
});

test("Q2 explicit current domain beats prior working-state domain", () => {
  const previous = understandConversationTask({
    prompt: "How much did Main Store sell today?",
  });
  const task = understandConversationTask({
    prompt: "What about payroll today?",
    taskState: {
      follow_up: true,
      working_state: previous.working_state,
    },
  });

  assert.deepEqual(task.domains, ["payroll"]);
  assert.equal(task.domain_source, "current_prompt");
  assert.deepEqual(task.working_state.domains, ["payroll"]);
});

test("Q2 working state travels with the global planner task understanding", () => {
  const reasoningPlan = {
    intent: "lookup",
    live_data_required: true,
    task_state: {
      current_prompt: "How much did Main Store sell today?",
      resolved_prompt: "How much did Main Store sell today?",
      inherited_turns: [],
      subquestions: ["How much did Main Store sell today?"],
    },
  };
  const plan = buildMultiToolTaskPlan({
    prompt: reasoningPlan.task_state.current_prompt,
    reasoningPlan,
    tools: [],
  });

  assert.ok(plan.task_understanding.working_state);
  assert.equal(plan.task_understanding.working_state.source_of_truth, false);
  assert.equal(plan.task_understanding.working_state.live_verification_required, true);
});

test("Q2 does not reintroduce global domain evidence into separate objectives", () => {
  const reasoningPlan = {
    intent: "explain",
    live_data_required: false,
    task_state: {
      current_prompt: "Explain payroll, and explain audit controls",
      resolved_prompt: "Explain payroll, and explain audit controls",
      inherited_turns: [],
      subquestions: ["Explain payroll", "explain audit controls"],
    },
  };
  const plan = buildMultiToolTaskPlan({
    prompt: reasoningPlan.task_state.current_prompt,
    reasoningPlan,
    tools: [],
  });

  assert.equal(plan.objective_count, 2);
  assert.deepEqual(plan.objectives[0].task_domains, ["payroll"]);
  assert.ok(plan.objectives[0].evidence_needs.includes("payroll"));
  assert.equal(plan.objectives[0].evidence_needs.includes("audit"), false);
  assert.deepEqual(plan.objectives[1].task_domains, ["audit_controls_security"]);
  assert.ok(plan.objectives[1].evidence_needs.includes("audit"));
  assert.equal(plan.objectives[1].evidence_needs.includes("payroll"), false);
});
