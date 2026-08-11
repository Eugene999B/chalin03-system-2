"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMultiToolTaskPlan,
  evidenceNeedsForQuestion,
  publicTaskPlan,
  rankedCandidateTools,
  taskPlannerPromptBlock,
  updateTaskPlanCoverage,
} = require("../services/aiTaskPlannerService");
const {
  filterReadOnlyInvestigationTools,
  investigationPromptBlock,
} = require("../services/aiInvestigationLoopService");

const tools = Object.freeze([
  Object.freeze({
    key: "spare_parts.operations_snapshot",
    title: "Spare Parts operations snapshot",
    description: "Read sales, revenue, collections and operations for the authorized branch.",
    risk_level: 1,
    allowed_workspaces: ["spare_parts"],
  }),
  Object.freeze({
    key: "spare_parts.inventory_snapshot",
    title: "Spare Parts inventory snapshot",
    description: "Read inventory, stock quantity, valuation and reorder signals.",
    risk_level: 1,
    allowed_workspaces: ["spare_parts"],
  }),
  Object.freeze({
    key: "customer.identity_lookup",
    title: "Customer identity lookup",
    description: "Find an authorized customer or buyer and resolve identity.",
    risk_level: 1,
    allowed_workspaces: ["spare_parts"],
  }),
  Object.freeze({
    key: "customer.debt_snapshot",
    title: "Customer debt snapshot",
    description: "Read outstanding customer debt, arrears, payments and collections.",
    risk_level: 1,
    allowed_workspaces: ["spare_parts"],
  }),
  Object.freeze({
    key: "spare_parts.stock_adjustment",
    title: "Stock adjustment",
    description: "Change stock quantity.",
    risk_level: 4,
    allowed_workspaces: ["spare_parts"],
  }),
]);

test("planner infers evidence families for profit, customers and debt", () => {
  assert.deepEqual(
    evidenceNeedsForQuestion("How much profit did Main Store make today?"),
    ["profit", "sales", "inventory"]
  );
  assert.deepEqual(
    evidenceNeedsForQuestion("Which customer bought the most and what does he owe us?"),
    ["customer", "debt"]
  );
  assert.deepEqual(
    evidenceNeedsForQuestion("Generate the management report as PDF"),
    ["document", "conversation_context"]
  );
});

test("candidate ranking uses only read tools and prefers evidence-relevant tools", () => {
  const ranked = rankedCandidateTools(
    {
      question: "What does this customer still owe us?",
      evidence_needs: ["debt", "customer"],
    },
    tools
  );
  assert.equal(ranked[0].key, "customer.debt_snapshot");
  assert.ok(ranked.some((entry) => entry.key === "customer.identity_lookup"));
  assert.equal(ranked.some((entry) => entry.key === "spare_parts.stock_adjustment"), false);
});

test("compound request becomes multiple explicit planner objectives", () => {
  const plan = buildMultiToolTaskPlan({
    prompt: "ignored because task state has explicit subquestions",
    reasoningPlan: {
      intent: "diagnose",
      live_data_required: true,
      task_state: {
        current_prompt: "Tell me sales and profit",
        subquestions: [
          "Tell me today's sales at Main Store",
          "how much profit we made",
          "who bought the most",
          "whether anybody still owes us",
          "tell me why profit is lower than yesterday",
        ],
      },
    },
    tools,
  });

  assert.equal(plan.objective_count, 5);
  assert.equal(plan.unresolved_count, 5);
  assert.equal(plan.objectives[0].evidence_needs.includes("sales"), true);
  assert.equal(plan.objectives[1].evidence_needs.includes("profit"), true);
  assert.equal(plan.objectives[2].evidence_needs.includes("customer"), true);
  assert.equal(plan.objectives[3].evidence_needs.includes("debt"), true);
  assert.equal(plan.objectives[4].live_data_required, true);
});

test("coverage tracks which objectives have governed tool evidence", () => {
  const initial = buildMultiToolTaskPlan({
    prompt: "customer debt and stock",
    reasoningPlan: {
      intent: "lookup",
      live_data_required: true,
      task_state: {
        subquestions: ["What does this customer owe us?", "What stock is available?"],
      },
    },
    tools,
  });

  const afterDebt = updateTaskPlanCoverage(initial, [
    { tool: { key: "customer.debt_snapshot" } },
  ]);
  assert.equal(afterDebt.objectives[0].status, "evidence_collected");
  assert.equal(afterDebt.objectives[1].status, "pending");
  assert.equal(afterDebt.unresolved_count, 1);

  const afterAll = updateTaskPlanCoverage(initial, [
    { tool: { key: "customer.debt_snapshot" } },
    { tool: { key: "spare_parts.inventory_snapshot" } },
  ]);
  assert.equal(afterAll.all_resolved, true);
  assert.equal(afterAll.unresolved_count, 0);
});

test("read-tool filter enriches authorized tools with planner evidence tags", () => {
  const filtered = filterReadOnlyInvestigationTools(tools);
  assert.equal(filtered.some((tool) => tool.risk_level > 1), false);

  const debt = filtered.find((tool) => tool.key === "customer.debt_snapshot");
  assert.ok(debt);
  assert.ok(debt.planner_evidence_tags.includes("debt"));
  assert.ok(debt.planner_evidence_tags.includes("customer"));
  assert.match(debt.description, /Planner evidence tags:/);
});

test("investigation contract requires complete subquestion coverage", () => {
  const prompt = investigationPromptBlock({
    config: { max_tool_rounds: 3, max_provider_rounds: 4 },
    toolRound: 1,
    totalToolCalls: 2,
  });
  assert.match(prompt, /server-resolved active task and subquestions/i);
  assert.match(prompt, /do not silently drop one/i);
  assert.match(prompt, /planner evidence tags/i);
  assert.match(prompt, /explicitly identify any objective that could not be verified/i);
  assert.match(prompt, /no autonomous write authority/i);
});

test("public task plan exposes coverage without internal ranking scores", () => {
  const plan = buildMultiToolTaskPlan({
    prompt: "What does the customer owe?",
    reasoningPlan: {
      intent: "lookup",
      live_data_required: true,
      task_state: { current_prompt: "What does the customer owe?", subquestions: [] },
    },
    tools,
  });
  const publicPlan = publicTaskPlan(plan);
  assert.equal(publicPlan.objective_count, 1);
  assert.ok(publicPlan.objectives[0].candidate_tool_keys.includes("customer.debt_snapshot"));
  assert.equal(JSON.stringify(publicPlan).includes('"score"'), false);
});

test("task-plan prompt makes unresolved objectives explicit", () => {
  const plan = buildMultiToolTaskPlan({
    prompt: "What does the customer owe?",
    reasoningPlan: {
      intent: "lookup",
      live_data_required: true,
      task_state: { current_prompt: "What does the customer owe?", subquestions: [] },
    },
    tools,
  });
  const text = taskPlannerPromptBlock(plan);
  assert.match(text, /Unresolved objectives: 1 of 1/);
  assert.match(text, /customer\.debt_snapshot/);
  assert.match(text, /do not silently drop one/i);
  assert.match(text, /Never claim a document\/action was generated or executed/i);
});
