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
  buildHirePerformanceDiagnostics,
} = require("../services/aiHirePerformanceDiagnosticsService");
const { registerHireAiTools } = require("../ai-tools/hireTools");
const {
  LocalEquipmentHireGovernedProvider,
  composeHirePerformanceAnswer,
  composeHireProductAnswer,
  localHirePerformanceToolCall,
  shouldUseHirePerformanceTool,
} = require("../ai-providers/localEquipmentHireGovernedProvider");

function fixture() {
  return {
    scope: {
      workspace_code: "equipment_hire",
      hire_location_id: 11,
      hire_location_code: "ACCRA-YARD",
      hire_location_name: "Accra Hire Yard",
      location_type: "yard",
      address: "Accra",
    },
    fleet: {
      total_assets: 10,
      available_assets: 3,
      maintenance_assets: 3,
      assets_on_hire: 4,
      returned_asset_assignments: 1,
    },
    pipeline: {
      total_enquiries: 12,
      active_enquiries: 5,
      won_enquiries: 4,
      inactive_enquiries: 3,
      total_quotations: 8,
      draft_quotations: 2,
      approved_quotations: 3,
      inactive_quotations: 1,
      open_quotation_value: 20000,
      total_contracts: 7,
      active_contracts: 3,
      draft_contracts: 1,
      completed_contracts: 3,
      returned_pending_closure: 1,
      closed_with_balance: 1,
    },
    work: {
      work_logs: 20,
      billable_hours_30d: 60,
      breakdown_hours_30d: 30,
      unapproved_logs: 2,
      approved_uninvoiced_work_logs: 2,
    },
    receivables: {
      invoices: 10,
      invoiced_amount: 100000,
      paid_amount: 50000,
      outstanding_amount: 50000,
      outstanding_invoices: 5,
      overdue_invoices: 2,
      overdue_amount: 30000,
      collection_rate: 50,
      aging: {
        current: { invoice_count: 2, balance: 10000 },
        "1_30": { invoice_count: 1, balance: 10000 },
        "31_60": { invoice_count: 1, balance: 10000 },
        "61_90": { invoice_count: 0, balance: 0 },
        over_90: { invoice_count: 1, balance: 20000 },
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

test("Equipment Hire expert pack teaches verified workflow and evidence boundaries", () => {
  const pack = getExpertPack("equipment_hire_operations");
  assert.equal(pack.key, "equipment_hire_operations");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.aggregate_live_tools_are_hire_location_scoped, true);
  assert.equal(pack.boundaries.open_quotation_value_is_pipeline_not_revenue, true);
  assert.equal(pack.boundaries.paid_amount_is_cash_collection_not_profit, true);
  assert.equal(pack.boundaries.fleet_assignment_counts_are_not_time_based_utilization, true);
  assert.equal(pack.boundaries.current_hire_snapshot_has_no_certified_profit_or_margin, true);
  assert.ok(pack.facts.some((fact) => fact.key === "commercial_operating_chain"));
  assert.ok(pack.facts.some((fact) => fact.key === "work_to_invoice_control"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "hire_performance"));
});

test("Equipment Hire expert selection stays domain-specific and can combine with Payroll", () => {
  const hire = expertPacksForPrompt("How does Equipment Hire fleet and billing work in CHALIN?");
  assert.deepEqual(hire.map((pack) => pack.key), ["equipment_hire_operations"]);

  const mining = expertPacksForPrompt("How does Mining stockpile performance work in CHALIN?");
  assert.equal(mining.some((pack) => pack.key === "equipment_hire_operations"), false);

  const combined = expertPacksForPrompt(
    "How do Equipment Hire workers and payroll relate to Hire operations?"
  );
  assert.deepEqual(
    new Set(combined.map((pack) => pack.key)),
    new Set(["people_employment_payroll", "equipment_hire_operations"])
  );
});

test("product knowledge receives Hire expert rules while live location facts remain governed", () => {
  const instruction = productKnowledgeInstruction(
    "How does Equipment Hire performance work in CHALIN?"
  );
  assert.match(instruction, /Equipment Hire Operations, Commercial Flow & Fleet Performance Intelligence/);
  assert.match(instruction, /Never treat open quotation value as recognized revenue/i);
  assert.match(instruction, /paid amount as cash collection/i);
  assert.equal(
    isChalinProductKnowledgeTurn("How does Equipment Hire performance work in CHALIN?"),
    true
  );

  for (const prompt of [
    "What are the current Equipment Hire overdue invoices?",
    "How much did Equipment Hire invoice today?",
    "Show me current Hire receivables",
  ]) {
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }

  const causalLivePlan = buildReasoningPlan({
    prompt: "Why is Equipment Hire performance poor today?",
    history: [],
    persona: "copilot",
  });
  assert.equal(causalLivePlan.live_data_required, true);
});

test("Hire performance diagnostics separate fleet, billing, cash and lifecycle pressure", () => {
  const output = buildHirePerformanceDiagnostics(fixture());
  assert.equal(output.scope.hire_location_name, "Accra Hire Yard");
  assert.equal(output.performance_view.maintenance_share_percent, 30);
  assert.equal(output.performance_view.breakdown_share_reference_percent, 33.33);
  assert.equal(output.performance_view.collection_rate, 50);
  assert.equal(output.certainty.has_operating_cost_evidence, false);
  assert.equal(output.certainty.has_certified_hire_profit_or_margin_evidence, false);
  assert.equal(output.certainty.open_quotation_value_is_pipeline_not_revenue, true);
  assert.equal(output.certainty.paid_amount_is_cash_collection_not_profit, true);
  assert.equal(output.certainty.fleet_assignment_counts_are_not_time_based_utilization, true);
  assert.equal(output.certainty.breakdown_share_reference_is_not_certified_utilization, true);

  const byKey = new Map(output.drivers.map((driver) => [driver.key, driver]));
  assert.equal(byKey.get("fleet_maintenance_pressure").effect, "availability_pressure");
  assert.equal(byKey.get("approved_uninvoiced_work").effect, "billing_completeness_pressure");
  assert.equal(byKey.get("overdue_receivables_pressure").effect, "collection_pressure");
  assert.equal(byKey.get("weak_collection_rate").effect, "cash_conversion_pressure");
  assert.equal(byKey.get("return_cycle_backlog").effect, "asset_release_pressure");
  assert.match(byKey.get("approved_uninvoiced_work").explanation, /not proof of a known revenue loss/i);
  assert.match(byKey.get("recorded_breakdown_hour_pressure").explanation, /not a certified fleet-utilization percentage/i);
});

test("Hire performance diagnostics register as a Risk-1 governed location-scoped tool", async () => {
  const registry = new AiToolRegistry();
  registerHireAiTools(registry, { loader: async () => fixture() });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const definition = tools.find((tool) => tool.key === "equipment_hire.performance_diagnostics");
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.allowed_workspaces, ["equipment_hire"]);
  assert.equal(definition.scope_requirements.hire_location, true);
  assert.equal(definition.scope_requirements.branch, false);
  assert.equal(definition.scope_requirements.mining_site, false);
  assert.deepEqual(definition.required_business_permissions, ["hire.reports.view"]);
  assert.match(definition.description, /does not invent certified Hire profit/i);

  const output = await registry.get("equipment_hire.performance_diagnostics").handler({
    input: {},
    context,
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence.length, 1);
  assert.equal(output.evidence[0].label, "Equipment Hire performance diagnostics");
  assert.equal(output.evidence[0].metadata.aggregate_only, true);
  assert.equal(output.evidence[0].metadata.hire_location_id, 11);
});

test("Local Hire extension chooses performance diagnostics for causal live questions", async () => {
  const registry = new AiToolRegistry();
  registerHireAiTools(registry, { loader: async () => fixture() });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  const messages = [
    { role: "user", content: "Why is Equipment Hire performance poor today?" },
  ];

  const selected = shouldUseHirePerformanceTool({
    messages,
    tools,
    providerContext: { workspace_code: "equipment_hire" },
  });
  assert.equal(selected.key, "equipment_hire.performance_diagnostics");
  assert.deepEqual(localHirePerformanceToolCall(selected).input, {});

  const provider = new LocalEquipmentHireGovernedProvider();
  const response = await provider.generate({
    messages,
    tools,
    provider_context: { workspace_code: "equipment_hire" },
  });
  assert.equal(response.finish_reason, "local_read_only_tool");
  assert.equal(response.tool_calls[0].tool_key, "equipment_hire.performance_diagnostics");
  assert.deepEqual(response.tool_calls[0].input, {});
});

test("Local Hire evidence synthesis is readable and preserves accounting/utilization boundaries", async () => {
  const data = buildHirePerformanceDiagnostics(fixture());
  const direct = composeHirePerformanceAnswer({
    citation: "E1",
    heading: "Equipment Hire performance diagnostics",
    excerpt: JSON.stringify(data),
  });
  assert.match(direct, /live Equipment Hire performance diagnosis/i);
  assert.match(direct, /Billing and cash conversion are separate/i);
  assert.match(direct, /pipeline exposure, not recognized revenue or profit/i);
  assert.match(direct, /Main evidence-backed drivers/i);
  assert.match(direct, /does not calculate certified Hire profit or margin/i);
  assert.match(direct, /\[E1\]/);

  const provider = new LocalEquipmentHireGovernedProvider();
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: `[E1] Equipment Hire performance diagnostics\n${JSON.stringify(data)}`,
      },
      { role: "user", content: "Why is Hire performance poor?" },
    ],
    tools: [],
    provider_context: { workspace_code: "equipment_hire" },
  });
  assert.match(response.text, /Billing and cash conversion are separate/i);
  assert.match(response.text, /not recognized revenue or profit/i);
});

test("Local product explanation teaches Hire workflow without inventing profit or utilization", async () => {
  const direct = composeHireProductAnswer();
  assert.match(direct, /Authorized Hire Location/i);
  assert.match(direct, /Quotation\/Approval/i);
  assert.match(direct, /paid amount is cash collection/i);
  assert.match(direct, /do not contain the operating-cost evidence required to certify Hire profit/i);
  assert.match(direct, /not a time-based utilization percentage/i);

  const provider = new LocalEquipmentHireGovernedProvider();
  const response = await provider.generate({
    messages: [
      { role: "user", content: "How does Equipment Hire performance work in CHALIN?" },
    ],
    tools: [],
    provider_context: { public_safe_system_turn: true },
  });
  assert.match(response.text, /Equipment Hire is a location-scoped operating business/i);
  assert.match(response.text, /open quotation value is pipeline/i);
  assert.match(response.text, /not a time-based utilization percentage/i);
});
