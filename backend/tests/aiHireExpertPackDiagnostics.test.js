"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildMultiToolTaskPlan,
  publicTaskPlan,
} = require("../services/aiTaskPlannerService");
const {
  buildHirePerformanceDiagnostics,
} = require("../services/aiHireDiagnosticsService");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  productKnowledgeInstruction,
  isChalinProductKnowledgeTurn,
} = require("../services/aiProductKnowledgeService");
const {
  registerHireAiTools,
} = require("../ai-tools/hireTools");
const {
  chooseLocalReadTool,
  composeHirePerformanceAnswer,
  composePublicSafeSystemAnswer,
} = require("../ai-providers/localGovernedProvider");

function fixture() {
  return {
    scope: {
      workspace_code: "equipment_hire",
      hire_location_id: 11,
      hire_location_code: "TEMA",
      hire_location_name: "Tema Hire Base",
      location_type: "yard",
      address: "Tema",
    },
    fleet: {
      total_assets: 10,
      available_assets: 2,
      maintenance_assets: 2,
      assets_on_hire: 6,
      returned_asset_assignments: 1,
    },
    pipeline: {
      total_enquiries: 8,
      active_enquiries: 3,
      won_enquiries: 2,
      inactive_enquiries: 3,
      total_quotations: 5,
      draft_quotations: 1,
      approved_quotations: 2,
      inactive_quotations: 1,
      open_quotation_value: 50000,
      total_contracts: 7,
      active_contracts: 4,
      draft_contracts: 1,
      completed_contracts: 2,
      returned_pending_closure: 1,
      closed_with_balance: 1,
    },
    work: {
      work_logs: 18,
      billable_hours_30d: 120,
      breakdown_hours_30d: 15,
      unapproved_logs: 2,
      approved_uninvoiced_work_logs: 3,
    },
    receivables: {
      invoices: 9,
      invoiced_amount: 100000,
      paid_amount: 60000,
      outstanding_amount: 40000,
      outstanding_invoices: 4,
      overdue_invoices: 2,
      overdue_amount: 25000,
      collection_rate: 60,
      aging: {
        current: { invoice_count: 1, balance: 10000 },
        "1_30": { invoice_count: 1, balance: 5000 },
        "31_60": { invoice_count: 1, balance: 10000 },
        "61_90": { invoice_count: 0, balance: 0 },
        over_90: { invoice_count: 1, balance: 15000 },
      },
    },
    returns: {
      returns_due_or_incomplete: 2,
      contracts_ready_for_closure: 1,
    },
    alerts: [],
    generated_at: "2026-08-11T13:00:00.000Z",
    execution_authority: "read_only",
  };
}

const context = Object.freeze({
  actor: Object.freeze({ id: 1, role: "admin" }),
  scope: Object.freeze({
    persona: "copilot",
    workspace_code: "equipment_hire",
    branch_id: null,
    mining_site_id: null,
    hire_location_id: 11,
  }),
});

test("Equipment Hire expert pack teaches verified workflow and accounting boundaries", () => {
  const pack = getExpertPack("equipment_hire_operations");
  assert.equal(pack.key, "equipment_hire_operations");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.aggregate_live_tools_are_hire_location_scoped, true);
  assert.equal(pack.boundaries.shared_fleet_is_asset_source_of_truth, true);
  assert.equal(pack.boundaries.quotation_value_is_pipeline_not_realized_revenue, true);
  assert.equal(pack.boundaries.current_hire_snapshot_has_no_certified_profit, true);
  assert.ok(pack.facts.some((fact) => fact.key === "commercial_operating_chain"));
  assert.ok(pack.facts.some((fact) => fact.key === "invoice_payment_receivable_distinction"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "hire_performance"));
});

test("Equipment Hire expert selection stays domain-specific and can combine with Payroll", () => {
  const hire = expertPacksForPrompt(
    "How does Equipment Hire commercial performance work in CHALIN?"
  );
  assert.deepEqual(hire.map((pack) => pack.key), ["equipment_hire_operations"]);

  const mining = expertPacksForPrompt("How does Mining site performance work in CHALIN?");
  assert.equal(mining.some((pack) => pack.key === "equipment_hire_operations"), false);

  const combined = expertPacksForPrompt(
    "How do Equipment Hire workers and payroll relate to Hire operations?"
  );
  assert.deepEqual(
    new Set(combined.map((pack) => pack.key)),
    new Set(["people_employment_payroll", "equipment_hire_operations"])
  );
});

test("product knowledge receives Hire expert rules while current Hire metrics remain governed", () => {
  const instruction = productKnowledgeInstruction(
    "How does Equipment Hire commercial performance work in CHALIN?"
  );
  assert.match(instruction, /Equipment Hire Commercial, Fleet & Contract Intelligence/);
  assert.match(instruction, /Never report open quotation value as realized revenue/i);
  assert.match(instruction, /do not invent Equipment Hire profit/i);
  assert.equal(
    isChalinProductKnowledgeTurn(
      "How does Equipment Hire commercial performance work in CHALIN?"
    ),
    true
  );
  for (const prompt of [
    "How many Equipment Hire assets are available right now?",
    "What is the current Equipment Hire overdue receivable?",
    "How many Equipment Hire contracts are active today?",
    "Show me current Equipment Hire invoices",
  ]) {
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
});

test("Hire performance diagnostics separate pipeline, capacity, billing, cash and closure pressure", () => {
  const output = buildHirePerformanceDiagnostics(fixture());
  assert.equal(output.scope.hire_location_name, "Tema Hire Base");
  assert.equal(output.performance_view.fleet_availability_percent, 20);
  assert.equal(output.performance_view.fleet_on_hire_percent, 60);
  assert.equal(output.performance_view.fleet_maintenance_percent, 20);
  assert.equal(output.performance_view.overdue_share_of_outstanding_percent, 62.5);
  assert.equal(output.performance_view.open_quotation_value, 50000);
  assert.equal(output.performance_view.invoiced_amount, 100000);
  assert.equal(output.performance_view.paid_amount, 60000);
  assert.equal(output.performance_view.outstanding_amount, 40000);
  assert.equal(output.certainty.has_complete_hire_cost_evidence, false);
  assert.equal(output.certainty.has_certified_hire_profit_evidence, false);
  assert.equal(output.certainty.quotation_value_is_pipeline_not_realized_revenue, true);
  assert.equal(output.certainty.approved_uninvoiced_work_is_not_automatic_lost_revenue, true);

  const byKey = new Map(output.drivers.map((item) => [item.key, item]));
  assert.equal(byKey.get("fleet_maintenance_pressure").effect, "capacity_and_service_pressure");
  assert.equal(byKey.get("recorded_breakdown_hours").effect, "billable_capacity_pressure");
  assert.equal(byKey.get("approved_uninvoiced_work").effect, "billing_lag_and_control_risk");
  assert.equal(byKey.get("overdue_receivables_pressure").effect, "cash_conversion_pressure");
  assert.equal(byKey.get("financial_closure_risk").severity, "danger");
  assert.equal(byKey.get("return_completion_pressure").effect, "asset_turnaround_and_closure_pressure");
  assert.equal(byKey.get("open_commercial_pipeline").effect, "potential_future_commercial_value");
  assert.match(byKey.get("approved_uninvoiced_work").explanation, /not be reported as confirmed lost revenue/i);
});

test("Hire performance diagnostics register as a Risk-1 governed location-scoped tool", async () => {
  const registry = new AiToolRegistry();
  registerHireAiTools(registry, { loader: async () => fixture() });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const definition = tools.find(
    (tool) => tool.key === "equipment_hire.performance_diagnostics"
  );
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.allowed_workspaces, ["equipment_hire"]);
  assert.equal(definition.scope_requirements.hire_location, true);
  assert.equal(definition.scope_requirements.branch, false);
  assert.equal(definition.scope_requirements.mining_site, false);
  assert.deepEqual(definition.required_business_permissions, ["hire.reports.view"]);
  assert.equal(definition.required_equipment_division, "hire");
  assert.match(definition.description, /without inventing Hire profit/i);

  const output = await registry.get("equipment_hire.performance_diagnostics").handler({
    input: {},
    context,
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence.length, 1);
  assert.equal(
    output.evidence[0].label,
    "Equipment Hire commercial and fleet performance diagnostics"
  );
  assert.equal(output.evidence[0].metadata.aggregate_only, true);
  assert.equal(output.evidence[0].metadata.hire_location_id, 11);
});

test("task planner includes Hire performance diagnostics for causal commercial questions", () => {
  const registry = new AiToolRegistry();
  registerHireAiTools(registry, { loader: async () => fixture() });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const plan = publicTaskPlan(
    buildMultiToolTaskPlan({
      prompt: "Why is Equipment Hire performance weak and collections low?",
      reasoningPlan: {
        intent: "investigate",
        live_data_required: true,
        task_state: {
          current_prompt: "Why is Equipment Hire performance weak and collections low?",
          subquestions: [],
        },
      },
      tools,
    })
  );
  assert.ok(
    plan.objectives[0].candidate_tool_keys.includes(
      "equipment_hire.performance_diagnostics"
    )
  );
});

test("Local fallback chooses and explains Hire performance diagnostics", () => {
  const registry = new AiToolRegistry();
  registerHireAiTools(registry, { loader: async () => fixture() });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });

  const selected = chooseLocalReadTool({
    messages: [
      {
        role: "user",
        content: "Why are Equipment Hire collections low and billing delayed?",
      },
    ],
    tools,
    providerContext: { workspace_code: "equipment_hire" },
  });
  assert.equal(selected.key, "equipment_hire.performance_diagnostics");

  const data = buildHirePerformanceDiagnostics(fixture());
  const answer = composeHirePerformanceAnswer({
    citation: "E1",
    heading: "Equipment Hire commercial and fleet performance diagnostics",
    excerpt: JSON.stringify(data),
  });
  assert.match(answer, /fleet asset/i);
  assert.match(answer, /open quotation pipeline/i);
  assert.match(answer, /billed on non-void invoices/i);
  assert.match(answer, /Main evidence-backed drivers/i);
  assert.match(answer, /not provide a complete cost model|not a certified profit calculation/i);
  assert.match(answer, /\[E1\]/);
});

test("Local product explanation keeps Hire pipeline, billing, cash and profit distinct", () => {
  const answer = composePublicSafeSystemAnswer([
    {
      role: "user",
      content: "Tell me how Equipment Hire performance works in CHALIN",
    },
  ]);
  assert.match(answer, /location-scoped commercial and fleet workflow/i);
  assert.match(answer, /Open quotation value is pipeline/i);
  assert.match(answer, /invoice totals are billed commercial value/i);
  assert.match(answer, /payments are collections/i);
  assert.match(answer, /does not provide a complete Hire cost model or certified profit/i);
  assert.doesNotMatch(answer, /quotation value is profit/i);
});
