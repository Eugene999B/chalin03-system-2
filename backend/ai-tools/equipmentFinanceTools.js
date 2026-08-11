"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  loadEquipmentFinancePerformanceDiagnostics,
} = require("../services/aiEquipmentFinanceDiagnosticsService");
const {
  loadArrearsHealth,
  loadCashFlowHealth,
  loadPortfolioHealth,
  loadSalesPipelineHealth,
} = require("../services/aiEquipmentFinanceIntelligenceService");

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
    description: "Optional inclusive end/as-of date in YYYY-MM-DD format.",
  },
});

function evidenceFor(viewKey, output) {
  return [
    {
      source_type: "equipment_finance_snapshot",
      source_ref: `equipment_finance:${viewKey}:company_wide`,
      source_version: "live-read-only-v1",
      label:
        viewKey === "arrears"
          ? "Installment Finance arrears health"
          : viewKey === "cashflow"
          ? "Installment Finance cash-flow health"
          : viewKey === "sales-pipeline"
          ? "Equipment sales and credit-application pipeline"
          : viewKey === "performance"
          ? "Equipment Finance portfolio and arrears performance diagnostics"
          : "Installment Finance portfolio health",
      excerpt_text: JSON.stringify(output).slice(0, 12000),
      as_of_at: output.generated_at,
      classification: "confidential",
      workspace_code: "equipment_hire",
      metadata: {
        equipment_division: "finance",
        finance_scope: "company_wide",
        aggregate_only: true,
        customer_rows_exposed: false,
        execution_authority: "read_only",
      },
    },
  ];
}

async function runView({ input, loader, viewKey }) {
  const output = await loader({ input });
  return {
    ...output,
    evidence: evidenceFor(viewKey, output),
    execution_authority: "read_only",
  };
}

function registerEquipmentFinanceAiTools(
  registry = aiToolRegistry,
  loaders = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  const portfolioLoader = loaders.portfolio || loadPortfolioHealth;
  const arrearsLoader = loaders.arrears || loadArrearsHealth;
  const cashflowLoader = loaders.cashflow || loadCashFlowHealth;
  const salesPipelineLoader = loaders.salesPipeline || loadSalesPipelineHealth;
  const performanceLoader =
    loaders.performance || loadEquipmentFinancePerformanceDiagnostics;

  const common = {
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read"],
    required_business_permissions: ["fleet.assets.view"],
    required_equipment_division: "finance",
    allowed_workspaces: ["equipment_hire"],
    scope_requirements: {},
    evidence_required: true,
    max_input_bytes: 2000,
    max_output_bytes: 90000,
    timeout_ms: 15000,
  };

  registry.register({
    ...common,
    key: "equipment_finance.portfolio_health",
    title: "Installment Finance portfolio health",
    description:
      "Returns company-wide aggregate installment portfolio value, collections, outstanding/overdue balances, reconciliation health, application pipeline and sale-capable equipment availability without customer rows.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: DATE_PROPERTIES,
    },
    handler: async ({ input }) =>
      runView({ input, loader: portfolioLoader, viewKey: "portfolio" }),
  });

  registry.register({
    ...common,
    key: "equipment_finance.performance_diagnostics",
    title: "Equipment Finance portfolio and arrears performance diagnostics",
    description:
      "Explains company-wide Finance performance pressure across origination, portfolio conversion, collections, outstanding versus arrears, aging, reconciliation and sale-asset readiness without customer rows and without inventing Finance profit or yield.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: DATE_PROPERTIES,
    },
    handler: async ({ input }) =>
      runView({ input, loader: performanceLoader, viewKey: "performance" }),
  });

  registry.register({
    ...common,
    key: "equipment_finance.arrears_health",
    title: "Installment Finance arrears health",
    description:
      "Returns aggregate overdue account counts, arrears, outstanding balances and aging buckets without customer names, phones or agreement-level rows.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        end_date: DATE_PROPERTIES.end_date,
      },
    },
    handler: async ({ input }) =>
      runView({ input, loader: arrearsLoader, viewKey: "arrears" }),
  });

  registry.register({
    ...common,
    key: "equipment_finance.cashflow_health",
    title: "Installment Finance cash-flow health",
    description:
      "Returns aggregate actual collections, open scheduled amounts, monthly collection/expectation trends and payment-method totals for Finance.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: DATE_PROPERTIES,
    },
    handler: async ({ input }) =>
      runView({ input, loader: cashflowLoader, viewKey: "cashflow" }),
  });

  registry.register({
    ...common,
    key: "equipment_finance.sales_pipeline",
    title: "Equipment sales and Finance pipeline",
    description:
      "Returns aggregate sale-capable equipment availability plus credit-application, KYC, affordability and risk pipeline counts without applicant identities.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    handler: async ({ input }) =>
      runView({ input, loader: salesPipelineLoader, viewKey: "sales-pipeline" }),
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  DATE_PROPERTIES,
  evidenceFor,
  registerEquipmentFinanceAiTools,
  runView,
};
