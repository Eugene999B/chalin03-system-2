"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  loadCustomerCommercialIntelligence,
} = require("../services/aiCustomerCommercialIntelligenceService");

let registered = false;

const DATE_PROPERTIES = Object.freeze({
  start_date: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Optional inclusive activity-period start date in YYYY-MM-DD format.",
  },
  end_date: {
    type: "string",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Optional inclusive activity-period end date in YYYY-MM-DD format.",
  },
});

function evidenceExcerpt(output = {}) {
  if (output.mode === "top_customers") {
    return {
      scope: output.scope,
      mode: output.mode,
      ranking_basis: output.ranking_basis,
      branch_period_sales: output.branch_period_sales,
      customers: output.customers,
      phone_numbers_masked: output.phone_numbers_masked,
    };
  }
  return {
    scope: output.scope,
    mode: output.mode,
    resolution_status: output.resolution_status,
    customer: output.customer || null,
    candidates: output.candidates || [],
    phone_numbers_masked: output.phone_numbers_masked,
  };
}

function buildCustomerCommercialEvidence(output = {}) {
  const branchId = Number(output?.scope?.branch_id || 0);
  return [
    {
      source_type: "customer_commercial_intelligence",
      source_ref: `spare_parts:customer-commercial:${output.mode || "unknown"}:branch:${branchId}`,
      source_version: "live-sensitive-read-v1",
      label:
        output.mode === "top_customers"
          ? "Spare Parts customer contribution and debt ranking"
          : "Spare Parts customer commercial 360",
      excerpt_text: JSON.stringify(evidenceExcerpt(output)).slice(0, 14000),
      as_of_at: output.generated_at,
      classification: "sensitive",
      workspace_code: "spare_parts",
      metadata: {
        branch_id: branchId,
        start_date: output?.scope?.start_date || null,
        end_date: output?.scope?.end_date || null,
        customer_rows_exposed: output.customer_rows_exposed === true,
        phones_masked: output.phone_numbers_masked === true,
        exact_identity_resolution_only: true,
        ranking_basis: output.ranking_basis || null,
        execution_authority: "read_only_sensitive",
      },
    },
  ];
}

function registerCustomerCommercialAiTools(
  registry = aiToolRegistry,
  { loader = loadCustomerCommercialIntelligence } = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  registry.register({
    key: "spare_parts.customer_commercial_360",
    version: "1",
    title: "Customer commercial 360 and contribution ranking",
    description:
      "Returns sensitive branch-scoped customer commercial intelligence. It can rank the highest-contributing customers by valid sales value for a selected period, or resolve one exact customer and show selected-period purchases plus current open/overdue debt. Phone numbers are masked. Customer contribution means sales value, not profit. Exact customer resolution never uses fuzzy guessing.",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read_sensitive"],
    required_business_permissions: ["spare_parts.audit"],
    allowed_workspaces: ["spare_parts"],
    scope_requirements: { branch: true },
    evidence_required: true,
    max_input_bytes: 2400,
    max_output_bytes: 90000,
    timeout_ms: 15000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["top_customers", "customer_account"],
          description:
            "Use top_customers to rank customer contribution; use customer_account for an exact customer commercial/debt view.",
        },
        customer_id: {
          type: "integer",
          minimum: 1,
          description: "Exact customer ID for customer_account mode when known.",
        },
        customer_query: {
          type: "string",
          maxLength: 180,
          description:
            "Exact customer name or phone reference. Ambiguous exact matches are returned for clarification; no fuzzy match is selected automatically.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Maximum number of ranked customers; defaults to 5.",
        },
        ...DATE_PROPERTIES,
      },
    },
    handler: async ({ input, context }) => {
      const output = await loader({ context, input });
      return {
        ...output,
        evidence: buildCustomerCommercialEvidence(output),
        execution_authority: "read_only_sensitive",
      };
    },
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  DATE_PROPERTIES,
  buildCustomerCommercialEvidence,
  evidenceExcerpt,
  registerCustomerCommercialAiTools,
};
