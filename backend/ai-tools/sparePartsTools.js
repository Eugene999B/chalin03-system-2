"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  buildCustomerAccountingCollectionsDiagnostics,
} = require("../services/aiCustomerAccountingCollectionsDiagnosticsService");
const {
  buildCollectionsHealth,
  buildInventoryHealth,
  buildOperationsSnapshot,
  buildPerformanceDiagnostics,
  loadSparePartsIntelligence,
} = require("../services/aiSparePartsIntelligenceService");

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

function utcDateOnly(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function recentUtcWindow(now = new Date(), days = 30) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
  const end = new Date(now);
  const start = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));
  return Object.freeze({
    start_date: utcDateOnly(start),
    end_date: utcDateOnly(end),
  });
}

function withOperationsDefaultWindow(viewKey, input = {}, now = new Date()) {
  const normalized = input && typeof input === "object" ? { ...input } : {};
  if (
    !String(normalized.start_date || "").trim() &&
    !String(normalized.end_date || "").trim()
  ) {
    const today = utcDateOnly(now);
    if (viewKey === "operations") {
      normalized.start_date = today;
      normalized.end_date = today;
    } else if (viewKey === "performance") {
      const recent = recentUtcWindow(now, 30);
      normalized.start_date = recent.start_date;
      normalized.end_date = recent.end_date;
    }
  }
  return normalized;
}

function collectionRateSemantics(totalSales, collectionRate) {
  const salesTotal = Number(totalSales);
  if (!Number.isFinite(salesTotal) || salesTotal <= 0) {
    return Object.freeze({
      collection_rate: null,
      collection_rate_applicable: false,
    });
  }
  const rate = Number(collectionRate);
  return Object.freeze({
    collection_rate: Number.isFinite(rate) ? rate : 0,
    collection_rate_applicable: true,
  });
}

function applyCollectionRateSemantics(viewKey, output) {
  if (!output || typeof output !== "object") return output;
  if (viewKey === "operations" && output.sales) {
    return {
      ...output,
      sales: {
        ...output.sales,
        ...collectionRateSemantics(output.sales.total_sales, output.sales.collection_rate),
      },
    };
  }
  if (viewKey === "collections" && output.collections) {
    return {
      ...output,
      collections: {
        ...output.collections,
        ...collectionRateSemantics(
          output.collections.sales_total,
          output.collections.collection_rate
        ),
      },
    };
  }
  if (viewKey === "performance" && output.financial_view) {
    return {
      ...output,
      financial_view: {
        ...output.financial_view,
        ...collectionRateSemantics(
          output.financial_view.gross_sales,
          output.financial_view.collection_rate
        ),
      },
    };
  }
  return output;
}

function evidenceScope(output) {
  return {
    branch_id: output.scope.branch_id,
    branch_code: output.scope.branch_code || null,
    branch_name: output.scope.branch_name || null,
    period: [output.scope.start_date, output.scope.end_date],
  };
}

function evidenceExcerpt(viewKey, output) {
  if (viewKey === "inventory") {
    return JSON.stringify({
      ...evidenceScope(output),
      product_count: output.inventory.product_count,
      low_stock_count: output.inventory.low_stock_count,
      negative_stock_count: output.inventory.negative_stock_count,
      estimated_stock_cost_value: output.inventory.estimated_stock_cost_value,
      estimated_stock_retail_value: output.inventory.estimated_stock_retail_value,
      stock_control: output.stock_control,
    });
  }
  if (viewKey === "collections") {
    return JSON.stringify({
      ...evidenceScope(output),
      active_debt_count: output.collections.active_debt_count,
      total_debt_balance: output.collections.total_debt_balance,
      debt_payments: output.collections.debt_payments,
      collection_rate: output.collections.collection_rate,
      collection_rate_applicable: output.collections.collection_rate_applicable,
      aging: output.collections.aging,
    });
  }
  if (viewKey === "customer-accounting") {
    return JSON.stringify({
      ...evidenceScope(output),
      performance_view: output.performance_view,
      certainty: output.certainty,
      causal_map: output.causal_map,
      drivers: output.drivers,
    });
  }
  if (viewKey === "performance") {
    return JSON.stringify({
      ...evidenceScope(output),
      financial_view: output.financial_view,
      inventory_view: output.inventory_view,
      certainty: output.certainty,
      causal_map: output.causal_map,
      drivers: output.drivers,
      audit: {
        score: output.audit.score,
        status: output.audit.status,
      },
    });
  }
  return JSON.stringify({
    ...evidenceScope(output),
    sales: output.sales,
    collections: output.collections,
    inventory: output.inventory,
    operations: output.operations,
    audit: {
      score: output.audit.score,
      status: output.audit.status,
    },
  });
}

function buildAggregateEvidence(viewKey, output) {
  const label =
    viewKey === "inventory"
      ? "Spare Parts inventory health snapshot"
      : viewKey === "collections"
        ? "Spare Parts collections health snapshot"
        : viewKey === "customer-accounting"
          ? "Customer accounting and collections diagnostics"
          : viewKey === "performance"
            ? "Spare Parts cross-module performance diagnostics"
            : "Spare Parts operations snapshot";
  return [
    {
      source_type: "system_snapshot",
      source_ref: `spare_parts:${viewKey}:branch:${output.scope.branch_id}`,
      source_version: "live-read-only",
      label,
      excerpt_text: evidenceExcerpt(viewKey, output).slice(0, 12000),
      as_of_at: output.generated_at,
      classification: "internal",
      workspace_code: "spare_parts",
      metadata: {
        branch_id: output.scope.branch_id,
        branch_code: output.scope.branch_code || null,
        branch_name: output.scope.branch_name || null,
        start_date: output.scope.start_date,
        end_date: output.scope.end_date,
        aggregate_only: true,
        customer_identity_included: false,
        execution_authority: "read_only",
        causal_diagnostics: ["performance", "customer-accounting"].includes(viewKey),
      },
    },
  ];
}

async function executeView({ input, context, loader, projector, viewKey }) {
  const effectiveInput = withOperationsDefaultWindow(viewKey, input);
  const { intelligence } = await loader({ context, input: effectiveInput });
  const projected = projector(intelligence, context);
  const output = applyCollectionRateSemantics(viewKey, projected);
  return {
    ...output,
    evidence: buildAggregateEvidence(viewKey, output),
    execution_authority: "read_only",
  };
}

function registerSparePartsAiTools(
  registry = aiToolRegistry,
  { loader = loadSparePartsIntelligence } = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  const common = {
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read"],
    required_business_permissions: ["spare_parts.read"],
    allowed_workspaces: ["spare_parts"],
    scope_requirements: { branch: true },
    evidence_required: true,
    max_input_bytes: 2000,
    max_output_bytes: 70000,
    timeout_ms: 12000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: DATE_PROPERTIES,
    },
  };

  registry.register({
    ...common,
    key: "spare_parts.operations_snapshot",
    title: "Spare Parts operations snapshot",
    description:
      "Returns branch-scoped aggregate sales, collections, inventory, expense, purchase, return and audit health without customer identities or raw rows. When no date window is supplied, the operations snapshot defaults to the current UTC business date so natural current/today questions do not accidentally return a 30-day range.",
    handler: async ({ input, context }) =>
      executeView({
        input,
        context,
        loader,
        projector: buildOperationsSnapshot,
        viewKey: "operations",
      }),
  });

  registry.register({
    ...common,
    key: "spare_parts.performance_diagnostics",
    title: "Spare Parts cross-module performance diagnostics",
    description:
      "Explains branch-scoped sales, profit-estimate, discount, expense, return/refund, collection/debt, purchase/stock and inventory-control drivers together. Distinguishes management profit estimates from cash flow, receivables, inventory availability and data-quality risk; never treats purchases as certified COGS. Use for questions such as why sales, cash or profit performance is weak. When no date range is supplied, performance diagnostics uses the most recent 30 calendar days ending on the current UTC business date, while explicit date ranges always take precedence.",
    handler: async ({ input, context }) =>
      executeView({
        input,
        context,
        loader,
        projector: buildPerformanceDiagnostics,
        viewKey: "performance",
      }),
  });

  registry.register({
    ...common,
    key: "spare_parts.inventory_health",
    title: "Spare Parts inventory health",
    description:
      "Returns branch-scoped stock value, low/negative stock signals and aggregate transfer/adjustment controls with evidence.",
    handler: async ({ input, context }) =>
      executeView({
        input,
        context,
        loader,
        projector: buildInventoryHealth,
        viewKey: "inventory",
      }),
  });

  registry.register({
    ...common,
    key: "spare_parts.collections_health",
    title: "Spare Parts collections health",
    description:
      "Returns aggregate debt balance, debt aging, payments and sales collection rate for the authorized branch without customer identities.",
    required_business_permissions: ["spare_parts.audit"],
    handler: async ({ input, context }) =>
      executeView({
        input,
        context,
        loader,
        projector: buildCollectionsHealth,
        viewKey: "collections",
      }),
  });

  registry.register({
    ...common,
    key: "spare_parts.customer_accounting_collections_diagnostics",
    title: "Customer accounting and collections diagnostics",
    description:
      "Explains branch-scoped aggregate customer receivables, selected-period sales balance, active debt, debt payments, aging, supplier-balance separation and accounting-confidence boundaries without customer identities or individual debt rows. It prevents double-counting period sales balance with current debt and prevents debt payments from being counted as new sales.",
    required_business_permissions: ["spare_parts.audit"],
    handler: async ({ input, context }) =>
      executeView({
        input,
        context,
        loader,
        projector: buildCustomerAccountingCollectionsDiagnostics,
        viewKey: "customer-accounting",
      }),
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  DATE_PROPERTIES,
  applyCollectionRateSemantics,
  buildAggregateEvidence,
  collectionRateSemantics,
  evidenceExcerpt,
  evidenceScope,
  executeView,
  recentUtcWindow,
  registerSparePartsAiTools,
  utcDateOnly,
  withOperationsDefaultWindow,
};
