"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildHirePerformanceDiagnostics,
} = require("../services/aiHireDiagnosticsService");
const {
  buildFleetHealth,
  buildOperationsSnapshot,
  buildReceivablesHealth,
  loadHireIntelligence,
} = require("../services/aiHireIntelligenceService");

let registered = false;

function evidenceFor(viewKey, output) {
  return [
    {
      source_type: "hire_snapshot",
      source_ref: `equipment_hire:${viewKey}:location:${output.scope.hire_location_id}`,
      source_version: "live-read-only-v1",
      label:
        viewKey === "fleet"
          ? "Equipment Hire fleet and utilization health"
          : viewKey === "receivables"
          ? "Equipment Hire receivables health"
          : viewKey === "performance"
          ? "Equipment Hire commercial and fleet performance diagnostics"
          : "Equipment Hire operations snapshot",
      excerpt_text: JSON.stringify(output).slice(0, 10000),
      as_of_at: output.generated_at,
      classification: "internal",
      workspace_code: "equipment_hire",
      metadata: {
        hire_location_id: output.scope.hire_location_id,
        equipment_division: "hire",
        aggregate_only: true,
        execution_authority: "read_only",
      },
    },
  ];
}

async function runView({ context, loader, projector, viewKey }) {
  const intelligence = await loader({ context });
  const output = projector(intelligence);
  return {
    ...output,
    evidence: evidenceFor(viewKey, output),
    execution_authority: "read_only",
  };
}

function registerHireAiTools(
  registry = aiToolRegistry,
  { loader = loadHireIntelligence } = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  const common = {
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read"],
    required_equipment_division: "hire",
    allowed_workspaces: ["equipment_hire"],
    scope_requirements: { hire_location: true },
    evidence_required: true,
    max_input_bytes: 1000,
    max_output_bytes: 80000,
    timeout_ms: 12000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  };

  registry.register({
    ...common,
    key: "equipment_hire.operations_snapshot",
    title: "Equipment Hire operations snapshot",
    description:
      "Returns a read-only location-scoped view of enquiries, quotations, contracts, fleet, work logs, receivables, overdue balances, returns and closure controls.",
    required_business_permissions: ["hire.reports.view"],
    handler: async ({ context }) =>
      runView({ context, loader, projector: buildOperationsSnapshot, viewKey: "operations" }),
  });

  registry.register({
    ...common,
    key: "equipment_hire.performance_diagnostics",
    title: "Equipment Hire commercial and fleet performance diagnostics",
    description:
      "Explains read-only Hire performance pressure across demand pipeline, fleet capacity/reliability, work-to-invoice conversion, collections/receivables and return/closure controls for the selected Hire location without inventing Hire profit.",
    required_business_permissions: ["hire.reports.view"],
    handler: async ({ context }) =>
      runView({
        context,
        loader,
        projector: buildHirePerformanceDiagnostics,
        viewKey: "performance",
      }),
  });

  registry.register({
    ...common,
    key: "equipment_hire.fleet_health",
    title: "Equipment Hire fleet health",
    description:
      "Returns fleet availability, maintenance/breakdown, assets on hire, billable/breakdown hours, return and closure signals for the selected Hire location.",
    required_business_permissions: [
      "fleet.assets.view",
      "hire.work_logs.view",
      "hire.contracts.view",
      "hire.returns.view",
    ],
    handler: async ({ context }) =>
      runView({ context, loader, projector: buildFleetHealth, viewKey: "fleet" }),
  });

  registry.register({
    ...common,
    key: "equipment_hire.receivables_health",
    title: "Equipment Hire receivables health",
    description:
      "Returns current invoices, paid and outstanding amounts, overdue balances, aging, collection rate and uninvoiced-work signals for the selected Hire location.",
    required_business_permissions: [
      "hire.invoices.view",
      "hire.payments.view",
    ],
    handler: async ({ context }) =>
      runView({ context, loader, projector: buildReceivablesHealth, viewKey: "receivables" }),
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  evidenceFor,
  registerHireAiTools,
  runView,
};
