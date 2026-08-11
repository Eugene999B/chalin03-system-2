"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildOperationsSnapshot,
  buildPerformanceDiagnostics,
  buildProductionCostHealth,
  buildStockFuelHealth,
  loadMiningIntelligence,
} = require("../services/aiMiningIntelligenceService");

let registered = false;

const DATE_PROPERTIES = Object.freeze({
  start_date: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Optional inclusive start date in YYYY-MM-DD format.",
  },
  end_date: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Optional inclusive end date in YYYY-MM-DD format.",
  },
});

function evidenceFor(viewKey, output) {
  return [
    {
      source_type: "mining_snapshot",
      source_ref: `mining:${viewKey}:site:${output.scope.mining_site_id}`,
      source_version: "live-read-only-v1",
      label:
        viewKey === "stock-fuel"
          ? "Mining stockpile and fuel health"
          : viewKey === "production-cost"
          ? "Mining production, cost and utilization health"
          : viewKey === "performance"
          ? "Mining site performance diagnostics"
          : "Mining operations snapshot",
      excerpt_text: JSON.stringify(output).slice(0, 10000),
      as_of_at: output.generated_at,
      classification: "internal",
      workspace_code: "mining",
      metadata: {
        mining_site_id: output.scope.mining_site_id,
        start_date: output.scope.start_date,
        end_date: output.scope.end_date,
        aggregate_only: true,
        execution_authority: "read_only",
      },
    },
  ];
}

async function runView({ input, context, loader, projector, viewKey }) {
  const intelligence = await loader({ context, input });
  const output = projector(intelligence);
  return {
    ...output,
    evidence: evidenceFor(viewKey, output),
    execution_authority: "read_only",
  };
}

function registerMiningAiTools(
  registry = aiToolRegistry,
  { loader = loadMiningIntelligence } = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  const common = {
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read"],
    allowed_workspaces: ["mining"],
    scope_requirements: { mining_site: true },
    evidence_required: true,
    max_input_bytes: 2000,
    max_output_bytes: 80000,
    timeout_ms: 12000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: DATE_PROPERTIES,
    },
  };

  registry.register({
    ...common,
    key: "mining.operations_snapshot",
    title: "Mining operations snapshot",
    description:
      "Returns a read-only site-scoped view of production, dispatch, stockpile, fuel, crew, closing, equipment-utilization, cost and incident health.",
    required_business_permissions: ["mining.reports.view"],
    handler: async ({ input, context }) =>
      runView({ input, context, loader, projector: buildOperationsSnapshot, viewKey: "operations" }),
  });

  registry.register({
    ...common,
    key: "mining.stock_fuel_health",
    title: "Mining stockpile and fuel health",
    description:
      "Returns low-stockpile and low-fuel-tank signals for the selected Mining site without write authority.",
    required_business_permissions: [
      "mining.stockpiles.view",
      "mining.fuel_control.view",
    ],
    handler: async ({ input, context }) =>
      runView({ input, context, loader, projector: buildStockFuelHealth, viewKey: "stock-fuel" }),
  });

  registry.register({
    ...common,
    key: "mining.production_cost_health",
    title: "Mining production and cost health",
    description:
      "Returns production, operating-cost, cost-per-unit, equipment utilization, incident and site-closing signals for the selected site.",
    required_business_permissions: [
      "mining.production.view",
      "mining.expenses.view",
      "mining.equipment_logs.view",
      "mining.incidents.view",
    ],
    handler: async ({ input, context }) =>
      runView({ input, context, loader, projector: buildProductionCostHealth, viewKey: "production-cost" }),
  });

  registry.register({
    ...common,
    key: "mining.performance_diagnostics",
    title: "Mining site performance diagnostics",
    description:
      "Explains read-only site performance using production target-reference pressure, operating expense per recorded unit, equipment utilization/idle/breakdown, dispatch flow, stockpile/fuel constraints, pending controls and incident risk. It explicitly does not invent Mining revenue or profit.",
    required_business_permissions: ["mining.reports.view"],
    handler: async ({ input, context }) =>
      runView({ input, context, loader, projector: buildPerformanceDiagnostics, viewKey: "performance" }),
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  DATE_PROPERTIES,
  evidenceFor,
  registerMiningAiTools,
  runView,
};
