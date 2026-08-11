"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  understandConversationTask,
} = require("../services/aiConversationTaskUnderstandingService");
const {
  MAX_GRAPH_DOMAINS,
  MAX_GRAPH_EVIDENCE_FAMILIES,
  MAX_GRAPH_OBJECTIVES,
  MAX_GRAPH_RELATIONSHIPS,
  buildCrossDomainReasoningGraph,
} = require("../services/aiCrossDomainReasoningGraphService");
const {
  buildMultiToolTaskPlan,
} = require("../services/aiTaskPlannerService");
const {
  routingObjectives,
} = require("../services/aiProviderToolRoutingService");
const {
  buildReasoningPlan,
  reasoningPromptBlock,
} = require("../services/aiReasoningService");

test("Q3 connects Main Store profit drivers with customer receivables without inventing authority", () => {
  const task = understandConversationTask({
    prompt: "Main Store sales are up today, profit is down, and customer debt is rising. What is going on?",
  });
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });

  assert.equal(graph.source_of_truth, false);
  assert.equal(graph.permission_authority, false);
  assert.equal(graph.execution_authority, false);
  assert.equal(graph.cross_domain, true);
  assert.ok(graph.domains.includes("spare_parts"));
  assert.ok(graph.domains.includes("customer_accounting"));
  assert.ok(graph.relationship_keys.includes("profit_driver_bridge"));
  assert.ok(graph.relationship_keys.includes("receivables_cash_conversion_bridge"));
  for (const family of ["profit", "sales", "inventory", "customer", "debt"]) {
    assert.ok(graph.evidence_families.includes(family), family);
  }
  assert.equal(graph.live_data_required, true);
});

test("Q3 keeps Equipment Finance arrears inside Finance instead of widening to customer accounting", () => {
  const task = understandConversationTask({
    prompt: "Why are Equipment Finance arrears rising this month?",
  });
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });

  assert.ok(graph.domains.includes("equipment_finance"));
  assert.equal(graph.domains.includes("customer_accounting"), false);
  assert.ok(graph.relationship_keys.includes("equipment_finance_portfolio_bridge"));
  assert.equal(graph.cross_domain, false);
  assert.equal(graph.live_data_required, true);
});

test("Q3 turns a CHALIN business follow-up into a live enterprise comparison", () => {
  const history = [
    { role: "user", content: "Tell me more about CHALIN and its businesses" },
    { role: "assistant", content: "CHALIN has several operating businesses." },
  ];
  const plan = buildReasoningPlan({
    prompt: "Which one makes the most money?",
    history,
    persona: "executive",
  });

  assert.equal(plan.intent, "compare");
  assert.equal(plan.live_data_required, true);
  assert.equal(plan.reasoning_graph.cross_domain, true);
  assert.ok(plan.reasoning_graph.primary_domains.includes("chalin_product"));
  for (const domain of ["spare_parts", "mining", "equipment_hire", "equipment_finance"]) {
    assert.ok(plan.reasoning_graph.domains.includes(domain), domain);
  }
  assert.ok(
    plan.reasoning_graph.relationship_keys.includes("enterprise_business_performance_comparison")
  );
});

test("Q3 recognizes broad current operating-health diagnosis as governed live coverage", () => {
  const plan = buildReasoningPlan({
    prompt: "Things don't look good today. What's wrong?",
    persona: "executive",
  });

  assert.equal(plan.intent, "diagnose");
  assert.equal(plan.live_data_required, true);
  assert.ok(
    plan.reasoning_graph.relationship_keys.includes("enterprise_operating_health_diagnosis")
  );
  for (const domain of ["spare_parts", "mining", "equipment_hire", "equipment_finance", "customer_accounting", "payroll"]) {
    assert.ok(plan.reasoning_graph.domains.includes(domain), domain);
  }
});

test("Q3 planner keeps cross-domain evidence objective-specific", () => {
  const prompt = "How is Payroll approval governed, and compare Main Store profit today with yesterday?";
  const reasoningPlan = buildReasoningPlan({ prompt, persona: "executive" });
  const plan = buildMultiToolTaskPlan({ prompt, reasoningPlan, tools: [] });

  assert.equal(plan.objectives.length, 2);
  const payrollObjective = plan.objectives[0];
  const storeObjective = plan.objectives[1];

  assert.ok(payrollObjective.evidence_needs.includes("payroll"));
  assert.ok(payrollObjective.evidence_needs.includes("worker"));
  assert.ok(payrollObjective.evidence_needs.includes("audit"));
  assert.equal(payrollObjective.evidence_needs.includes("inventory"), false);

  assert.ok(storeObjective.evidence_needs.includes("profit"));
  assert.ok(storeObjective.evidence_needs.includes("sales"));
  assert.ok(storeObjective.evidence_needs.includes("inventory"));
  assert.equal(storeObjective.evidence_needs.includes("payroll"), false);
  assert.equal(storeObjective.evidence_needs.includes("audit"), false);
});

test("Q3 provider routing objectives carry the same cross-domain evidence map", () => {
  const objectives = routingObjectives([
    {
      role: "user",
      content: "Main Store profit is down today and customer debt is rising. Why?",
    },
  ]);

  assert.equal(objectives.length, 1);
  const objective = objectives[0];
  for (const family of ["profit", "sales", "inventory", "customer", "debt"]) {
    assert.ok(objective.evidence_needs.includes(family), family);
  }
  assert.ok(objective.task_domains.includes("spare_parts"));
  assert.ok(objective.task_domains.includes("customer_accounting"));
  assert.equal(objective.live_data_required, true);
});

test("Q3 reasoning prompt exposes a bounded coverage map, never chain-of-thought", () => {
  const plan = buildReasoningPlan({
    prompt: "Main Store profit is down today and customer debt is rising. Why?",
    persona: "executive",
  });
  const block = reasoningPromptBlock({
    plan,
    confidence: { level: "low" },
    tensions: [],
  });

  assert.match(block, /Cross-domain coverage required: yes/i);
  assert.match(block, /profit_driver_bridge/i);
  assert.match(block, /receivables_cash_conversion_bridge/i);
  assert.match(block, /coverage map only/i);
  assert.doesNotMatch(JSON.stringify(plan.reasoning_graph), /chain[-_ ]?of[-_ ]?thought|hidden reasoning/i);
});

test("Q3 graph limits remain bounded even with oversized supplied task metadata", () => {
  const task = {
    current_prompt: "Things don't look good today. What's wrong?",
    domains: Array.from({ length: 100 }, (_, index) => index % 2 ? "spare_parts" : "mining"),
    evidence_families: Array.from({ length: 100 }, () => "sales"),
    objectives: Array.from({ length: 100 }, (_, index) => `objective ${index}`),
    live_data_required: true,
  };
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });

  assert.ok(graph.domains.length <= MAX_GRAPH_DOMAINS);
  assert.ok(graph.evidence_families.length <= MAX_GRAPH_EVIDENCE_FAMILIES);
  assert.ok(graph.relationships.length <= MAX_GRAPH_RELATIONSHIPS);
  assert.ok(graph.objectives.length <= MAX_GRAPH_OBJECTIVES);
});
