"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildMultiToolTaskPlan,
  publicTaskPlan,
} = require("../services/aiTaskPlannerService");
const {
  buildEquipmentFinancePerformanceDiagnostics,
  loadEquipmentFinancePerformanceDiagnostics,
} = require("../services/aiEquipmentFinanceDiagnosticsService");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeInstruction,
} = require("../services/aiProductKnowledgeService");
const {
  registerEquipmentFinanceAiTools,
} = require("../ai-tools/equipmentFinanceTools");
const {
  LocalEquipmentFinanceGovernedProvider,
  composeFinancePerformanceAnswer,
  composeFinanceProductAnswer,
  shouldUseFinancePerformanceTool,
} = require("../ai-providers/localEquipmentFinanceGovernedProvider");

function portfolioFixture() {
  return {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      hire_location_selection_required: false,
      date_from: "2026-01-01",
      date_to: "2026-08-11",
    },
    summary: {
      agreement_count: 20,
      active_count: 15,
      completed_count: 5,
      overdue_count: 6,
      portfolio_value: 1000000,
      deposits_received: 200000,
      lifetime_collections: 450000,
      outstanding_balance: 550000,
      overdue_balance: 180000,
      average_paid_percent: 45,
      period_payment_count: 32,
      period_collections: 150000,
      reconciliation_attention_count: 2,
    },
    statuses: [],
    aging: [],
    upcoming: [],
    applications: {
      application_count: 12,
      draft_count: 1,
      submitted_count: 1,
      under_review_count: 3,
      changes_requested_count: 2,
      approved_count: 2,
      declined_count: 1,
      withdrawn_count: 0,
      kyc_verified_count: 7,
      kyc_pending_count: 5,
      affordability_eligible_count: 4,
      affordability_manual_review_count: 2,
      high_risk_count: 2,
    },
    sales_inventory: {
      sale_capable_assets: 8,
      available_for_sale: 0,
      held_for_finance: 5,
      sold_assets: 2,
      maintenance_or_breakdown: 1,
    },
    alerts: [],
    customer_rows_exposed: false,
    generated_at: "2026-08-11T14:00:00.000Z",
  };
}

function arrearsFixture() {
  return {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      as_of: "2026-08-11",
    },
    summary: {
      accounts: 6,
      arrears: 180000,
      outstanding: 300000,
    },
    aging: [
      { bucket: "1_30", accounts: 2, arrears: 30000, outstanding: 70000, missed_lines: 2 },
      { bucket: "31_60", accounts: 1, arrears: 30000, outstanding: 50000, missed_lines: 2 },
      { bucket: "61_90", accounts: 1, arrears: 40000, outstanding: 60000, missed_lines: 3 },
      { bucket: "over_90", accounts: 2, arrears: 80000, outstanding: 120000, missed_lines: 7 },
    ],
    oldest_bucket: "over_90",
    customer_rows_exposed: false,
    generated_at: "2026-08-11T14:00:00.000Z",
  };
}

function cashflowFixture() {
  return {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      date_from: "2026-01-01",
      date_to: "2026-08-11",
    },
    totals: {
      collected_amount: 150000,
      expected_open_schedule_amount: 250000,
      collection_vs_open_schedule_percent: 60,
    },
    monthly_collections: [],
    monthly_expected: [],
    payment_methods: [],
    customer_rows_exposed: false,
    generated_at: "2026-08-11T14:00:00.000Z",
  };
}

function diagnosticFixture() {
  return buildEquipmentFinancePerformanceDiagnostics({
    portfolio: portfolioFixture(),
    arrears: arrearsFixture(),
    cashflow: cashflowFixture(),
  });
}

test("Equipment Finance expert pack teaches verified lifecycle and accounting boundaries", () => {
  const pack = getExpertPack("equipment_installment_finance");
  assert.equal(pack.key, "equipment_installment_finance");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.finance_scope_is_company_wide, true);
  assert.equal(pack.boundaries.finance_and_hire_divisions_are_separate, true);
  assert.equal(pack.boundaries.application_approval_is_not_agreement_activation, true);
  assert.equal(pack.boundaries.outstanding_is_not_arrears, true);
  assert.equal(pack.boundaries.aggregate_ai_exposes_no_customer_rows, true);
  assert.equal(pack.boundaries.current_finance_snapshot_has_no_certified_profit, true);
  assert.ok(pack.facts.some((fact) => fact.key === "cashflow_ratio_boundary"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "schedule_to_collections"));
});

test("Finance expert selection stays separate from Hire and combines only when asked", () => {
  const finance = expertPacksForPrompt(
    "How does Equipment Finance arrears and reconciliation work in CHALIN?"
  );
  assert.deepEqual(finance.map((pack) => pack.key), ["equipment_installment_finance"]);

  const hire = expertPacksForPrompt(
    "How does Equipment Hire fleet performance work in CHALIN?"
  );
  assert.equal(hire.some((pack) => pack.key === "equipment_installment_finance"), false);

  const combined = expertPacksForPrompt(
    "How do Payroll workers support Equipment Finance operations?"
  );
  assert.deepEqual(
    new Set(combined.map((pack) => pack.key)),
    new Set(["people_employment_payroll", "equipment_installment_finance"])
  );
});

test("Finance product knowledge is static while current portfolio questions stay governed", () => {
  const instruction = productKnowledgeInstruction(
    "Explain Equipment Finance outstanding versus arrears in CHALIN"
  );
  assert.match(
    instruction,
    /Equipment Installment Finance, Collections & Portfolio Intelligence/
  );
  assert.match(instruction, /Never equate outstanding balance with arrears/i);
  assert.match(instruction, /not automatically an on-time collection rate/i);

  const productPrompt = "Explain how Equipment Finance arrears work in CHALIN";
  assert.equal(isLikelyLiveRecordRequest(productPrompt), false);
  assert.equal(isChalinProductKnowledgeTurn(productPrompt), true);

  for (const prompt of [
    "What are current Equipment Finance arrears?",
    "Show me the current Finance portfolio balance",
    "How much is outstanding in Equipment Finance right now?",
    "What are the latest Finance collections?",
  ]) {
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
});

test("Finance performance diagnostics separate arrears, cash conversion, origination and integrity", () => {
  const output = diagnosticFixture();
  const view = output.performance_view;
  assert.equal(output.scope.finance_scope, "company_wide");
  assert.equal(output.scope.hire_location_selection_required, false);
  assert.equal(view.portfolio_value, 1000000);
  assert.equal(view.portfolio_outstanding_balance, 550000);
  assert.equal(view.calculated_arrears, 180000);
  assert.equal(view.arrears_share_of_portfolio_outstanding_percent, 32.73);
  assert.equal(view.aged_61_plus_arrears, 120000);
  assert.equal(view.over_90_arrears, 80000);
  assert.equal(view.selected_period_collections, 150000);
  assert.equal(view.selected_period_open_schedule_amount, 250000);
  assert.equal(view.collection_to_open_schedule_ratio_percent, 60);
  assert.equal(output.customer_rows_exposed, false);
  assert.equal(output.certainty.outstanding_balance_is_not_arrears, true);
  assert.equal(
    output.certainty.collection_to_open_schedule_ratio_is_not_automatic_on_time_rate,
    true
  );
  assert.equal(output.certainty.has_certified_finance_profit_or_yield_evidence, false);

  const drivers = new Map(output.drivers.map((item) => [item.key, item]));
  assert.equal(drivers.get("arrears_pressure").effect, "delinquency_and_cash_pressure");
  assert.equal(drivers.get("aged_arrears_pressure").effect, "recovery_priority_pressure");
  assert.equal(
    drivers.get("reconciliation_integrity_pressure").effect,
    "portfolio_confidence_pressure"
  );
  assert.equal(
    drivers.get("collection_to_schedule_pressure").effect,
    "period_cash_conversion_pressure"
  );
  assert.equal(
    drivers.get("origination_review_backlog").effect,
    "application_conversion_pressure"
  );
  assert.equal(
    drivers.get("approved_demand_asset_constraint").effect,
    "activation_or_delivery_capacity_pressure"
  );
  assert.match(
    drivers.get("collection_to_schedule_pressure").explanation,
    /not automatically an on-time collection rate/i
  );
});

test("Finance performance loader composes only sanitized aggregate views", async () => {
  const calls = [];
  const output = await loadEquipmentFinancePerformanceDiagnostics({
    input: { start_date: "2026-01-01", end_date: "2026-08-11" },
    portfolioLoader: async ({ input }) => {
      calls.push(["portfolio", input]);
      return portfolioFixture();
    },
    arrearsLoader: async ({ input }) => {
      calls.push(["arrears", input]);
      return arrearsFixture();
    },
    cashflowLoader: async ({ input }) => {
      calls.push(["cashflow", input]);
      return cashflowFixture();
    },
  });
  assert.deepEqual(calls[1], ["arrears", { end_date: "2026-08-11" }]);
  assert.equal(output.customer_rows_exposed, false);
  assert.doesNotMatch(JSON.stringify(output), /customer_name|customer_phone|agreement_number/);
});

test("Finance performance diagnostics register as a Risk-1 Finance-only tool", async () => {
  const registry = new AiToolRegistry();
  registerEquipmentFinanceAiTools(registry, {
    portfolio: async () => portfolioFixture(),
    arrears: async () => arrearsFixture(),
    cashflow: async () => cashflowFixture(),
    salesPipeline: async () => ({}),
    performance: async () => diagnosticFixture(),
  });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const definition = tools.find(
    (tool) => tool.key === "equipment_finance.performance_diagnostics"
  );
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.allowed_workspaces, ["equipment_hire"]);
  assert.equal(definition.required_equipment_division, "finance");
  assert.equal(definition.scope_requirements.hire_location, false);
  assert.deepEqual(definition.required_business_permissions, ["fleet.assets.view"]);
  assert.match(definition.description, /without customer rows/i);
  assert.match(definition.description, /without inventing Finance profit or yield/i);

  const output = await registry.get("equipment_finance.performance_diagnostics").handler({
    input: {},
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence.length, 1);
  assert.equal(
    output.evidence[0].label,
    "Equipment Finance portfolio and arrears performance diagnostics"
  );
  assert.equal(output.evidence[0].classification, "confidential");
  assert.equal(output.evidence[0].metadata.customer_rows_exposed, false);
  assert.equal(output.evidence[0].metadata.equipment_division, "finance");
});

test("task planner ranks Finance performance diagnostics for causal portfolio questions", () => {
  const registry = new AiToolRegistry();
  registerEquipmentFinanceAiTools(registry, {
    portfolio: async () => ({}),
    arrears: async () => ({}),
    cashflow: async () => ({}),
    salesPipeline: async () => ({}),
    performance: async () => ({}),
  });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const plan = publicTaskPlan(
    buildMultiToolTaskPlan({
      prompt: "Why are Equipment Finance arrears high and collections weak?",
      reasoningPlan: {
        intent: "investigate",
        live_data_required: true,
        task_state: {
          current_prompt: "Why are Equipment Finance arrears high and collections weak?",
          subquestions: [],
        },
      },
      tools,
    })
  );
  assert.ok(
    plan.objectives[0].candidate_tool_keys.includes(
      "equipment_finance.performance_diagnostics"
    )
  );
});

test("Local Finance layer selects diagnostics and preserves Hire sibling behavior", async () => {
  const financeTool = {
    key: "equipment_finance.performance_diagnostics",
    title: "Equipment Finance portfolio and arrears performance diagnostics",
    risk_level: 1,
  };
  const hireTool = {
    key: "equipment_hire.performance_diagnostics",
    title: "Equipment Hire performance diagnostics",
    risk_level: 1,
  };
  assert.equal(
    shouldUseFinancePerformanceTool({
      messages: [
        { role: "user", content: "Why are Equipment Finance arrears high today?" },
      ],
      tools: [financeTool, hireTool],
      providerContext: { workspace_code: "equipment_hire" },
    })?.key,
    "equipment_finance.performance_diagnostics"
  );
  assert.equal(
    shouldUseFinancePerformanceTool({
      messages: [
        { role: "user", content: "Why is Equipment Hire billing weak today?" },
      ],
      tools: [financeTool, hireTool],
      providerContext: { workspace_code: "equipment_hire" },
    }),
    null
  );

  const provider = new LocalEquipmentFinanceGovernedProvider();
  const financeCall = await provider.generate({
    messages: [
      { role: "user", content: "Why are Equipment Finance arrears high today?" },
    ],
    tools: [financeTool, hireTool],
    provider_context: { workspace_code: "equipment_hire" },
  });
  assert.equal(financeCall.tool_calls[0].tool_key, "equipment_finance.performance_diagnostics");
  assert.ok(financeCall.tool_calls[0].input.start_date);
  assert.ok(financeCall.tool_calls[0].input.end_date);

  const hireCall = await provider.generate({
    messages: [
      { role: "user", content: "Why is Equipment Hire billing weak today?" },
    ],
    tools: [financeTool, hireTool],
    provider_context: { workspace_code: "equipment_hire" },
  });
  assert.equal(hireCall.tool_calls[0].tool_key, "equipment_hire.performance_diagnostics");
  assert.deepEqual(hireCall.tool_calls[0].input, {});
});

test("Local Finance synthesis keeps portfolio, outstanding, arrears and cash distinct", () => {
  const answer = composeFinancePerformanceAnswer({
    citation: "E1",
    heading: "Equipment Finance portfolio and arrears performance diagnostics",
    excerpt: JSON.stringify(diagnosticFixture()),
  });
  assert.match(answer, /portfolio value/i);
  assert.match(answer, /outstanding/i);
  assert.match(answer, /calculated arrears/i);
  assert.match(answer, /not automatically an on-time collection rate/i);
  assert.match(answer, /Main evidence-backed drivers/i);
  assert.match(answer, /not customer-level data|does not expose customer rows/i);
  assert.match(answer, /\[E1\]/);
});

test("Local Finance product explanation protects activation, arrears and profit boundaries", () => {
  const answer = composeFinanceProductAnswer();
  assert.match(answer, /company-wide Finance division/i);
  assert.match(answer, /Approval.*Finance Agreement Activation/i);
  assert.match(answer, /Outstanding can include future obligations/i);
  assert.match(answer, /arrears are the past-due schedule portion/i);
  assert.match(answer, /not automatically an on-time collection rate/i);
  assert.match(answer, /do not contain the complete cost\/impairment evidence/i);
});
