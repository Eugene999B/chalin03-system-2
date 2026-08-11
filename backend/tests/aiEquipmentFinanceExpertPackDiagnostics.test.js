"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  isChalinProductKnowledgeTurn,
  productKnowledgeInstruction,
} = require("../services/aiProductKnowledgeService");
const { buildReasoningPlan } = require("../services/aiReasoningService");
const {
  buildEquipmentFinancePerformanceDiagnostics,
} = require("../services/aiEquipmentFinancePerformanceDiagnosticsService");
const {
  registerEquipmentFinanceAiTools,
} = require("../ai-tools/equipmentFinanceTools");
const {
  LocalEquipmentFinanceGovernedProvider,
  composeFinancePerformanceAnswer,
  composeFinanceProductAnswer,
  localFinancePerformanceToolCall,
  shouldUseFinancePerformanceTool,
} = require("../ai-providers/localEquipmentFinanceGovernedProvider");

function fixture() {
  const portfolio = {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      hire_location_selection_required: false,
      date_from: "2026-08-01",
      date_to: "2026-08-11",
    },
    summary: {
      agreement_count: 20,
      active_count: 12,
      completed_count: 3,
      overdue_count: 5,
      portfolio_value: 500000,
      deposits_received: 50000,
      lifetime_collections: 200000,
      outstanding_balance: 300000,
      overdue_balance: 120000,
      average_paid_percent: 40,
      period_payment_count: 10,
      period_collections: 80000,
      reconciliation_attention_count: 2,
    },
    statuses: [],
    aging: [],
    upcoming: [],
    applications: {
      application_count: 18,
      draft_count: 2,
      submitted_count: 3,
      under_review_count: 4,
      changes_requested_count: 2,
      approved_count: 5,
      declined_count: 2,
      withdrawn_count: 0,
      kyc_verified_count: 10,
      kyc_pending_count: 8,
      affordability_eligible_count: 9,
      affordability_manual_review_count: 3,
      high_risk_count: 2,
    },
    sales_inventory: {
      sale_capable_assets: 10,
      available_for_sale: 0,
      held_for_finance: 5,
      sold_assets: 2,
      maintenance_or_breakdown: 3,
    },
    alerts: [],
    customer_rows_exposed: false,
    generated_at: "2026-08-11T13:00:00.000Z",
  };
  const arrears = {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      as_of: "2026-08-11",
    },
    summary: { accounts: 5, arrears: 100000, outstanding: 180000 },
    aging: [
      { bucket: "1_30", accounts: 2, arrears: 20000, outstanding: 40000, missed_lines: 2 },
      { bucket: "31_60", accounts: 1, arrears: 20000, outstanding: 30000, missed_lines: 2 },
      { bucket: "over_90", accounts: 2, arrears: 60000, outstanding: 110000, missed_lines: 6 },
    ],
    customer_rows_exposed: false,
    generated_at: "2026-08-11T13:00:00.000Z",
  };
  const cashflow = {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
      date_from: "2026-08-01",
      date_to: "2026-08-11",
    },
    totals: {
      collected_amount: 50000,
      expected_open_schedule_amount: 100000,
      collection_vs_open_schedule_percent: 50,
    },
    monthly_collections: [],
    monthly_expected: [],
    payment_methods: [],
    customer_rows_exposed: false,
    generated_at: "2026-08-11T13:00:00.000Z",
  };
  const salesPipeline = {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
    },
    applications: portfolio.applications,
    sales_inventory: portfolio.sales_inventory,
    alerts: [],
    customer_rows_exposed: false,
    generated_at: "2026-08-11T13:00:00.000Z",
  };
  return { portfolio, arrears, cashflow, salesPipeline };
}

test("Equipment Finance expert pack teaches lifecycle and accounting boundaries", () => {
  const pack = getExpertPack("equipment_finance_operations");
  assert.equal(pack.key, "equipment_finance_operations");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.finance_scope_is_company_wide, true);
  assert.equal(pack.boundaries.hire_location_selection_not_required_for_finance_ai, true);
  assert.equal(pack.boundaries.approved_application_is_not_activated_agreement, true);
  assert.equal(pack.boundaries.partial_deposit_is_not_machine_reservation, true);
  assert.equal(pack.boundaries.overdue_is_part_of_outstanding_exposure, true);
  assert.equal(pack.boundaries.deposits_must_not_be_double_counted_with_collections, true);
  assert.equal(pack.boundaries.portfolio_and_collections_are_not_certified_profit, true);
  assert.equal(pack.boundaries.aggregate_finance_tools_expose_no_customer_rows, true);
  assert.ok(pack.facts.some((fact) => fact.key === "agreement_activation_boundary"));
  assert.ok(pack.facts.some((fact) => fact.key === "deposit_reservation_boundary"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "finance_performance"));
});

test("Equipment Finance expert selection stays domain-specific and combines with Hire when asked", () => {
  const finance = expertPacksForPrompt(
    "How does Equipment Installment Finance portfolio and arrears work in CHALIN?"
  );
  assert.deepEqual(finance.map((pack) => pack.key), ["equipment_finance_operations"]);

  const mining = expertPacksForPrompt("How does Mining stockpile performance work in CHALIN?");
  assert.equal(mining.some((pack) => pack.key === "equipment_finance_operations"), false);

  const combined = expertPacksForPrompt(
    "How do Equipment Hire and Equipment Finance share machines without mixing operations?"
  );
  assert.deepEqual(
    new Set(combined.map((pack) => pack.key)),
    new Set(["equipment_hire_operations", "equipment_finance_operations"])
  );
});

test("product knowledge receives Finance rules while current performance stays a live reasoning task", () => {
  const instruction = productKnowledgeInstruction(
    "How does Equipment Installment Finance work in CHALIN?"
  );
  assert.match(instruction, /Equipment Installment Finance, Portfolio & Collections Intelligence/);
  assert.match(instruction, /Never treat an approved credit application as an activated agreement/i);
  assert.match(instruction, /overdue\/arrears as delinquent exposure within outstanding balance/i);
  assert.equal(
    isChalinProductKnowledgeTurn("How does Equipment Installment Finance work in CHALIN?"),
    true
  );

  for (const prompt of [
    "Show me current Installment Finance arrears",
    "Give me the latest Installment Finance portfolio balance",
  ]) {
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }

  const causalLivePlan = buildReasoningPlan({
    prompt: "Why is Installment Finance performance poor today?",
    history: [],
    persona: "copilot",
  });
  assert.equal(causalLivePlan.live_data_required, true);
});

test("Finance diagnostics separate portfolio, arrears, cash conversion, credit controls and inventory", () => {
  const output = buildEquipmentFinancePerformanceDiagnostics(fixture());
  assert.equal(output.scope.finance_scope, "company_wide");
  assert.equal(output.scope.hire_location_selection_required, false);
  assert.equal(output.performance_view.outstanding_share_of_portfolio_percent, 60);
  assert.equal(output.performance_view.overdue_share_of_outstanding_percent, 40);
  assert.equal(output.performance_view.collection_vs_open_schedule_percent, 50);
  assert.equal(output.certainty.customer_rows_exposed, false);
  assert.equal(output.certainty.overdue_is_part_of_outstanding_exposure, true);
  assert.equal(output.certainty.deposits_are_part_of_payment_state_and_must_not_be_double_counted, true);
  assert.equal(output.certainty.portfolio_and_collections_are_not_certified_profit, true);

  const byKey = new Map(output.drivers.map((driver) => [driver.key, driver]));
  assert.equal(byKey.get("reconciliation_attention").effect, "balance_reliability_pressure");
  assert.equal(byKey.get("overdue_portfolio_pressure").effect, "delinquency_pressure");
  assert.equal(byKey.get("aged_arrears_pressure").effect, "old_debt_collection_pressure");
  assert.equal(byKey.get("cash_conversion_reference_pressure").effect, "cash_conversion_pressure");
  assert.equal(byKey.get("application_review_backlog").effect, "credit_conversion_timing_pressure");
  assert.equal(byKey.get("kyc_completion_pressure").effect, "application_readiness_pressure");
  assert.equal(byKey.get("no_available_sale_assets").effect, "equipment_conversion_constraint");
  assert.match(byKey.get("overdue_portfolio_pressure").explanation, /must not be added to outstanding/i);
  assert.match(byKey.get("cash_conversion_reference_pressure").explanation, /not a certified accounting collection rate/i);
});

test("Finance performance diagnostics register as Risk-1 company-wide aggregate evidence", async () => {
  const data = buildEquipmentFinancePerformanceDiagnostics(fixture());
  const registry = new AiToolRegistry();
  registerEquipmentFinanceAiTools(registry, {
    portfolio: async () => fixture().portfolio,
    arrears: async () => fixture().arrears,
    cashflow: async () => fixture().cashflow,
    salesPipeline: async () => fixture().salesPipeline,
    performance: async () => data,
  });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const definition = tools.find((tool) => tool.key === "equipment_finance.performance_diagnostics");
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.allowed_workspaces, ["equipment_hire"]);
  assert.equal(definition.required_equipment_division, "finance");
  assert.equal(definition.scope_requirements.hire_location, false);
  assert.deepEqual(definition.required_business_permissions, ["fleet.assets.view"]);
  assert.match(definition.description, /does not double-count deposits/i);

  const output = await registry.get("equipment_finance.performance_diagnostics").handler({
    input: { start_date: "2026-08-01", end_date: "2026-08-11" },
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence.length, 1);
  assert.equal(output.evidence[0].label, "Installment Finance performance diagnostics");
  assert.equal(output.evidence[0].classification, "confidential");
  assert.equal(output.evidence[0].metadata.aggregate_only, true);
  assert.equal(output.evidence[0].metadata.customer_rows_exposed, false);
  assert.equal(output.evidence[0].metadata.finance_scope, "company_wide");
});

test("Local Finance extension chooses diagnostics for causal live questions with supported date input", async () => {
  const data = buildEquipmentFinancePerformanceDiagnostics(fixture());
  const registry = new AiToolRegistry();
  registerEquipmentFinanceAiTools(registry, { performance: async () => data });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const messages = [
    { role: "user", content: "Why is Installment Finance performance poor today?" },
  ];

  const selected = shouldUseFinancePerformanceTool({
    messages,
    tools,
    providerContext: { workspace_code: "equipment_hire" },
  });
  assert.equal(selected.key, "equipment_finance.performance_diagnostics");
  const call = localFinancePerformanceToolCall(selected, messages);
  assert.equal(call.tool_key, "equipment_finance.performance_diagnostics");
  assert.match(call.input.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(call.input.start_date, call.input.end_date);

  const provider = new LocalEquipmentFinanceGovernedProvider();
  const response = await provider.generate({
    messages,
    tools,
    provider_context: { workspace_code: "equipment_hire" },
  });
  assert.equal(response.finish_reason, "local_read_only_tool");
  assert.equal(response.tool_calls[0].tool_key, "equipment_finance.performance_diagnostics");
  assert.equal(response.tool_calls[0].input.start_date, response.tool_calls[0].input.end_date);
});

test("Local Finance evidence synthesis is readable and preserves balance/privacy boundaries", async () => {
  const data = buildEquipmentFinancePerformanceDiagnostics(fixture());
  const direct = composeFinancePerformanceAnswer({
    citation: "E1",
    heading: "Installment Finance performance diagnostics",
    excerpt: JSON.stringify(data),
  });
  assert.match(direct, /live company-wide Installment Finance diagnosis/i);
  assert.match(direct, /Do not add overdue on top of outstanding/i);
  assert.match(direct, /cash-conversion evidence, not a certified accounting collection rate or profit measure/i);
  assert.match(direct, /Main evidence-backed drivers/i);
  assert.match(direct, /does not expose customer rows/i);
  assert.match(direct, /\[E1\]/);

  const provider = new LocalEquipmentFinanceGovernedProvider();
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: `[E1] Installment Finance performance diagnostics\n${JSON.stringify(data)}`,
      },
      { role: "user", content: "Why is Finance performance poor?" },
    ],
    tools: [],
    provider_context: { workspace_code: "equipment_hire" },
  });
  assert.match(response.text, /Do not add overdue on top of outstanding/i);
  assert.match(response.text, /not a certified accounting collection rate or profit measure/i);
});

test("Local product explanation teaches Finance lifecycle without collapsing controlled stages", async () => {
  const direct = composeFinanceProductAnswer();
  assert.match(direct, /Credit Application/i);
  assert.match(direct, /Independent Approval/i);
  assert.match(direct, /approval is not agreement activation/i);
  assert.match(direct, /partial deposit records Finance payment evidence but does not reserve/i);
  assert.match(direct, /overdue is part of outstanding exposure/i);

  const provider = new LocalEquipmentFinanceGovernedProvider();
  const response = await provider.generate({
    messages: [
      { role: "user", content: "How does Equipment Installment Finance work in CHALIN?" },
    ],
    tools: [],
    provider_context: { public_safe_system_turn: true },
  });
  assert.match(response.text, /company-wide Finance operating flow/i);
  assert.match(response.text, /activation is not machine reservation/i);
  assert.match(response.text, /Portfolio value and cash collections do not by themselves prove profit/i);
});
