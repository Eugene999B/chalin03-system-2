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
} = require("../services/aiMiningIntelligenceService");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  productKnowledgeInstruction,
  isChalinProductKnowledgeTurn,
} = require("../services/aiProductKnowledgeService");
const {
  registerMiningAiTools,
} = require("../ai-tools/miningTools");
const {
  chooseLocalReadTool,
  composeMiningPerformanceAnswer,
  composePublicSafeSystemAnswer,
} = require("../ai-providers/localGovernedProvider");

function fixture() {
  return {
    scope: {
      workspace_code: "mining",
      mining_site_id: 7,
      site_code: "OBU",
      site_name: "Obuasi Site",
      location: "Obuasi",
      material_type: "gold ore",
      production_unit: "tonnes",
      daily_target: 100,
      start_date: "2026-08-11",
      end_date: "2026-08-11",
    },
    summary: {
      stockpile_count: 4,
      stockpile_quantity: 240,
      low_stockpiles: 1,
      dispatch_count: 2,
      dispatched_quantity: 30,
      pending_dispatches: 1,
      tank_count: 2,
      fuel_balance_litres: 600,
      low_tanks: 1,
      crew_count: 2,
      crew_headcount: 18,
      pending_crews: 1,
      closing_count: 1,
      pending_closings: 1,
      production_quantity: 60,
      operating_cost: 12000,
      working_hours: 4,
      idle_hours: 4,
      breakdown_hours: 2,
      open_incidents: 2,
      serious_incidents: 1,
      cost_per_unit: 200,
      utilization_percent: 40,
    },
    low_stockpiles: [
      {
        stockpile_id: 1,
        code: "SP-1",
        name: "Primary Ore",
        current_quantity: 20,
        minimum_quantity: 30,
      },
    ],
    low_fuel_tanks: [
      {
        tank_id: 1,
        code: "FT-1",
        name: "Main Diesel",
        current_balance_litres: 200,
        minimum_level_litres: 250,
      },
    ],
    alerts: [],
    generated_at: "2026-08-11T12:00:00.000Z",
    execution_authority: "read_only",
  };
}

const context = Object.freeze({
  actor: Object.freeze({ id: 1, role: "admin" }),
  scope: Object.freeze({
    persona: "copilot",
    workspace_code: "mining",
    branch_id: null,
    mining_site_id: 7,
    hire_location_id: null,
  }),
});

test("Mining expert pack teaches verified workflow and evidence boundaries", () => {
  const pack = getExpertPack("mining_operations");
  assert.equal(pack.key, "mining_operations");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.aggregate_live_tools_are_site_scoped, true);
  assert.equal(pack.boundaries.current_mining_snapshot_has_no_revenue_or_certified_profit, true);
  assert.equal(pack.boundaries.production_dispatch_gap_is_not_automatic_loss, true);
  assert.ok(pack.facts.some((fact) => fact.key === "operating_chain"));
  assert.ok(pack.facts.some((fact) => fact.key === "cost_per_unit_boundary"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "site_performance"));
});

test("Mining expert selection stays domain-specific and can combine with Payroll", () => {
  const mining = expertPacksForPrompt("How does Mining site performance work in CHALIN?");
  assert.deepEqual(mining.map((pack) => pack.key), ["mining_operations"]);

  const spareParts = expertPacksForPrompt("How does Spare Parts true profit work in CHALIN?");
  assert.equal(spareParts.some((pack) => pack.key === "mining_operations"), false);

  const combined = expertPacksForPrompt(
    "How do Mining workers and payroll relate to mine site operations?"
  );
  assert.deepEqual(
    new Set(combined.map((pack) => pack.key)),
    new Set(["people_employment_payroll", "mining_operations"])
  );
});

test("product knowledge receives Mining expert rules while live site facts remain governed", () => {
  const instruction = productKnowledgeInstruction(
    "How does Mining site performance work in CHALIN?"
  );
  assert.match(instruction, /Mining Operations & Site Performance Intelligence/);
  assert.match(instruction, /Never equate Mining production quantity with revenue or profit/i);
  assert.match(instruction, /operating expense divided by recorded production/i);
  assert.equal(
    isChalinProductKnowledgeTurn("How does Mining site performance work in CHALIN?"),
    true
  );
  for (const prompt of [
    "How much did this Mining site produce today?",
    "What is the current Mining fuel level?",
    "What was Mining cost per unit yesterday?",
    "Show me current Mining equipment utilization",
  ]) {
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
});

test("Mining performance diagnostics separate output, efficiency, flow and control causes", () => {
  const output = buildPerformanceDiagnostics(fixture());
  assert.equal(output.scope.site_name, "Obuasi Site");
  assert.equal(output.performance_view.target_reference_quantity, 100);
  assert.equal(output.performance_view.target_attainment_percent, 60);
  assert.equal(output.performance_view.dispatch_to_production_percent, 50);
  assert.equal(output.performance_view.operating_cost_per_recorded_unit, 200);
  assert.equal(output.performance_view.equipment_utilization_percent, 40);
  assert.equal(output.certainty.has_mining_revenue_evidence, false);
  assert.equal(output.certainty.has_certified_mining_profit_evidence, false);
  assert.equal(output.certainty.production_dispatch_gap_is_not_automatic_loss, true);
  assert.equal(output.certainty.current_fuel_balance_is_not_period_consumption, true);

  const byKey = new Map(output.drivers.map((driver) => [driver.key, driver]));
  assert.equal(byKey.get("production_target_pressure").effect, "production_pressure");
  assert.equal(byKey.get("low_equipment_utilization").effect, "output_and_cost_efficiency_pressure");
  assert.equal(byKey.get("low_fuel_availability").effect, "operational_constraint");
  assert.equal(byKey.get("production_dispatch_flow_gap").effect, "dispatch_flow_review");
  assert.equal(byKey.get("serious_incident_risk").severity, "danger");
  assert.match(byKey.get("production_dispatch_flow_gap").explanation, /not automatic evidence of loss/i);
});

test("Mining performance diagnostics register as a Risk-1 governed site-scoped tool", async () => {
  const registry = new AiToolRegistry();
  registerMiningAiTools(registry, {
    loader: async () => fixture(),
  });
  const tools = registry.list({ persona: "copilot", workspace: "mining" });
  const definition = tools.find((tool) => tool.key === "mining.performance_diagnostics");
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.deepEqual(definition.allowed_workspaces, ["mining"]);
  assert.equal(definition.scope_requirements.mining_site, true);
  assert.equal(definition.scope_requirements.branch, false);
  assert.equal(definition.scope_requirements.hire_location, false);
  assert.deepEqual(definition.required_business_permissions, ["mining.reports.view"]);
  assert.match(definition.description, /does not invent Mining revenue or profit/i);

  const output = await registry.get("mining.performance_diagnostics").handler({
    input: {},
    context,
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence.length, 1);
  assert.equal(output.evidence[0].label, "Mining site performance diagnostics");
  assert.equal(output.evidence[0].metadata.aggregate_only, true);
  assert.equal(output.evidence[0].metadata.mining_site_id, 7);
});

test("task planner includes Mining performance diagnostics for causal production questions", () => {
  const registry = new AiToolRegistry();
  registerMiningAiTools(registry, {
    loader: async () => fixture(),
  });
  const tools = registry.list({ persona: "copilot", workspace: "mining" });
  const plan = publicTaskPlan(
    buildMultiToolTaskPlan({
      prompt: "Why is Mining site production low today?",
      reasoningPlan: {
        intent: "investigate",
        live_data_required: true,
        task_state: {
          current_prompt: "Why is Mining site production low today?",
          subquestions: [],
        },
      },
      tools,
    })
  );
  assert.ok(
    plan.objectives[0].candidate_tool_keys.includes("mining.performance_diagnostics")
  );
});

test("Local fallback chooses and explains Mining performance diagnostics", () => {
  const registry = new AiToolRegistry();
  registerMiningAiTools(registry, {
    loader: async () => fixture(),
  });
  const tools = registry.list({ persona: "copilot", workspace: "mining" });

  const selected = chooseLocalReadTool({
    messages: [
      { role: "user", content: "Why is Mining site production low today?" },
    ],
    tools,
    providerContext: { workspace_code: "mining" },
  });
  assert.equal(selected.key, "mining.performance_diagnostics");

  const data = buildPerformanceDiagnostics(fixture());
  const answer = composeMiningPerformanceAnswer({
    citation: "E1",
    heading: "Mining site performance diagnostics",
    excerpt: JSON.stringify(data),
  });
  assert.match(answer, /recorded production/i);
  assert.match(answer, /target-reference attainment/i);
  assert.match(answer, /Main evidence-backed drivers/i);
  assert.match(answer, /not a Mining revenue or profit calculation|does not calculate Mining revenue/i);
  assert.match(answer, /\[E1\]/);
});

test("Local product explanation never turns Mining production into profit", () => {
  const answer = composePublicSafeSystemAnswer([
    { role: "user", content: "Tell me how Mining performance works in CHALIN" },
  ]);
  assert.match(answer, /site-scoped operating system/i);
  assert.match(answer, /Production and dispatch are related but different measures/i);
  assert.match(answer, /does not expose Mining revenue or certified profit/i);
  assert.doesNotMatch(answer, /production is profit/i);
});
