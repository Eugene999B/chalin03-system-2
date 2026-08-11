"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildMultiToolTaskPlan,
  publicTaskPlan,
} = require("../services/aiTaskPlannerService");
const {
  buildPerformanceDiagnostics,
} = require("../services/aiSparePartsIntelligenceService");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  productKnowledgeInstruction,
  isChalinProductKnowledgeTurn,
} = require("../services/aiProductKnowledgeService");
const {
  registerSparePartsAiTools,
  withOperationsDefaultWindow,
} = require("../ai-tools/sparePartsTools");
const {
  chooseLocalReadTool,
  composePublicSafeSystemAnswer,
  composeSparePartsPerformanceAnswer,
} = require("../ai-providers/localGovernedProvider");

function fixture() {
  return {
    scope: {
      selected_branch_id: 1,
      selected_branch_code: "MAIN",
      selected_branch_name: "Main Store",
      start_date: "2026-08-11",
      end_date: "2026-08-11",
      days: 1,
    },
    sales: {
      transaction_count: 20,
      total_sales: 10000,
      total_paid: 6000,
      total_balance: 4000,
      total_discount: 1000,
      average_sale: 500,
      collection_rate: 60,
    },
    expenses: {
      expense_count: 8,
      total_expenses: 6000,
    },
    debts: {
      active_debt_count: 10,
      total_debt_balance: 7000,
      new_debt_amount: 2000,
      debt_payments: 500,
      aging: [{ bucket: "60+ days", count: 2, total: 2500 }],
    },
    stock: {
      product_count: 100,
      total_quantity: 700,
      low_stock_count: 3,
      negative_stock_count: 1,
      estimated_stock_cost_value: 45000,
      estimated_stock_retail_value: 70000,
    },
    purchases: {
      purchase_count: 5,
      total_purchases: 8000,
      amount_paid: 5000,
      balance: 3000,
    },
    returns: {
      return_count: 3,
      total_return_amount: 1200,
      total_return_quantity: 4,
    },
    stock_adjustments: {
      adjustment_count: 4,
      decrease_count: 2,
      set_count: 1,
      damaged_count: 1,
      lost_count: 0,
    },
    stock_transfers: {
      transfer_count: 3,
      dispatched_not_received_count: 1,
      quantity_mismatch_count: 1,
    },
    profit_and_loss: {
      gross_sales: 10000,
      discounts: 1000,
      net_sales: 9000,
      operating_expenses: 6000,
      purchases_cost_signal: 8000,
      estimated_net_before_stock_cost: 3000,
      conservative_cash_position: -5000,
      warning:
        "True profit requires reliable cost of goods sold. This report gives a strong management estimate and highlights what data must improve next.",
    },
    audit: {
      audit_score: 55,
      audit_status: "warning",
      flags: [],
    },
    recommendations: [
      {
        priority: "high",
        title: "Review expenses",
        action: "Check the largest expense categories.",
      },
    ],
    generated_at: "2026-08-11T10:00:00.000Z",
  };
}

const context = Object.freeze({
  actor: Object.freeze({ id: 1, role: "admin" }),
  scope: Object.freeze({
    persona: "copilot",
    workspace_code: "spare_parts",
    branch_id: 1,
    mining_site_id: null,
    hire_location_id: null,
  }),
});

test("Spare Parts expert pack teaches commercial relationships and accounting boundaries", () => {
  const pack = getExpertPack("spare_parts_operations");
  assert.equal(pack.key, "spare_parts_operations");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.purchases_are_not_certified_cogs, true);
  assert.equal(pack.boundaries.current_profit_is_management_estimate_before_reliable_cogs, true);
  assert.ok(pack.facts.some((fact) => fact.key === "sale_payment_debt_chain"));
  assert.ok(pack.facts.some((fact) => fact.key === "returns_and_refunds"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "branch_performance"));
});

test("expert pack selection is topic-specific and can combine domains", () => {
  const spareParts = expertPacksForPrompt("How does Spare Parts true profit work in CHALIN?");
  assert.deepEqual(spareParts.map((pack) => pack.key), ["spare_parts_operations"]);

  const payroll = expertPacksForPrompt("How does a worker salary flow into payroll?");
  assert.deepEqual(payroll.map((pack) => pack.key), ["people_employment_payroll"]);

  const combined = expertPacksForPrompt(
    "How do Spare Parts workers and payroll relate to store operations?"
  );
  assert.deepEqual(
    new Set(combined.map((pack) => pack.key)),
    new Set(["people_employment_payroll", "spare_parts_operations"])
  );
});

test("product lane receives Spare Parts expert knowledge but live branch questions remain private", () => {
  const instruction = productKnowledgeInstruction(
    "How does Spare Parts profit work in CHALIN?"
  );
  assert.match(instruction, /Spare Parts Operations & Commercial Intelligence/);
  assert.match(instruction, /Never equate purchases with cost of goods sold/i);
  assert.match(instruction, /management estimate/i);
  assert.equal(
    isChalinProductKnowledgeTurn("How does Spare Parts profit work in CHALIN?"),
    true
  );
  assert.equal(
    isChalinProductKnowledgeTurn("Why is Main Store profit low today?"),
    false
  );
});

test("performance diagnostics distinguish profit, cash, inventory and control causes", () => {
  const output = buildPerformanceDiagnostics(fixture(), context);
  assert.equal(output.scope.branch_name, "Main Store");
  assert.equal(output.scope.branch_code, "MAIN");
  assert.equal(output.certainty.certified_profit_available, false);
  assert.equal(output.certainty.purchases_are_certified_cogs, false);
  assert.equal(output.certainty.collections_are_profit, false);
  assert.equal(output.certainty.returns_automatically_deducted_from_current_estimate, false);

  const byKey = new Map(output.drivers.map((driver) => [driver.key, driver]));
  assert.equal(byKey.get("operating_expense_pressure").effect, "reduces_management_net_and_cash");
  assert.equal(byKey.get("collection_pressure").effect, "cash_conversion_not_profit");
  assert.equal(
    byKey.get("inventory_purchase_pressure").effect,
    "cash_outflow_and_inventory_build_not_certified_cogs"
  );
  assert.equal(byKey.get("negative_stock_integrity").severity, "high");
  assert.equal(byKey.get("transfer_reconciliation").severity, "high");
  assert.match(byKey.get("return_refund_pressure").explanation, /does not automatically prove/i);
});

test("performance diagnostics defaults to today and registers as a Risk-1 governed read tool", async () => {
  const window = withOperationsDefaultWindow(
    "performance",
    {},
    new Date("2026-08-11T10:15:00.000Z")
  );
  assert.deepEqual(window, {
    start_date: "2026-08-11",
    end_date: "2026-08-11",
  });

  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, {
    loader: async () => ({ intelligence: fixture() }),
  });
  const definition = registry
    .list({ persona: "copilot", workspace: "spare_parts" })
    .find((tool) => tool.key === "spare_parts.performance_diagnostics");
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.required_business_permissions, ["spare_parts.read"]);
  assert.match(definition.description, /profit-estimate/i);
  assert.match(definition.description, /never treats purchases as certified COGS/i);

  const output = await registry.get("spare_parts.performance_diagnostics").handler({
    input: {},
    context,
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence.length, 1);
  assert.equal(output.evidence[0].label, "Spare Parts cross-module performance diagnostics");
  assert.equal(output.evidence[0].metadata.causal_diagnostics, true);
  assert.equal(output.evidence[0].metadata.branch_name, "Main Store");
});

test("task planner and Local fallback prefer performance diagnostics for live profit questions", () => {
  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, {
    loader: async () => ({ intelligence: fixture() }),
  });
  const tools = registry.list({ persona: "copilot", workspace: "spare_parts" });

  const plan = publicTaskPlan(
    buildMultiToolTaskPlan({
      prompt: "Why is Main Store profit low today?",
      reasoningPlan: {
        intent: "investigate",
        live_data_required: true,
        task_state: {
          current_prompt: "Why is Main Store profit low today?",
          subquestions: [],
        },
      },
      tools,
    })
  );
  assert.equal(
    plan.objectives[0].candidate_tool_keys[0],
    "spare_parts.performance_diagnostics"
  );

  const selected = chooseLocalReadTool({
    messages: [{ role: "user", content: "Why is Main Store profit low today?" }],
    tools,
    providerContext: { workspace_code: "spare_parts" },
  });
  assert.equal(selected.key, "spare_parts.performance_diagnostics");
});

test("Local synthesis explains live diagnostic evidence instead of dumping fields", () => {
  const data = buildPerformanceDiagnostics(fixture(), context);
  const item = {
    citation: "E1",
    heading: "Spare Parts cross-module performance diagnostics",
    excerpt: JSON.stringify({
      branch_name: data.scope.branch_name,
      branch_code: data.scope.branch_code,
      period: [data.scope.start_date, data.scope.end_date],
      financial_view: data.financial_view,
      certainty: data.certainty,
      drivers: data.drivers,
    }),
  };
  const answer = composeSparePartsPerformanceAnswer(item);
  assert.match(answer, /management net estimate before reliable stock cost/i);
  assert.match(answer, /Cash conversion is separate/i);
  assert.match(answer, /collection pressure/i);
  assert.match(answer, /Accounting boundary/i);
  assert.match(answer, /\[E1\]/);

  const productAnswer = composePublicSafeSystemAnswer([
    { role: "user", content: "How does Spare Parts true profit work?" },
  ]);
  assert.match(productAnswer, /sales are not profit/i);
  assert.match(productAnswer, /purchases are not automatically COGS/i);
});
