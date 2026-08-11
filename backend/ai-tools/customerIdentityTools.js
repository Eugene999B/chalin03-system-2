"use strict";

const { aiToolRegistry } = require("../services/aiToolRegistry");
const {
  findDuplicateCustomerSuggestions,
} = require("../services/aiCustomerIdentityIntelligenceService");
const {
  registerCustomerCommercialAiTools,
} = require("./customerCommercialTools");

let registered = false;

function buildEvidence(output) {
  const excerpt = {
    branch_id: output.branch_id,
    algorithm_version: output.algorithm_version,
    minimum_score: output.minimum_score,
    database_customer_count: output.database_customer_count,
    scanned_customer_count: output.scanned_customer_count,
    scan_limited: output.scan_limited,
    total_matching_pairs: output.total_matching_pairs,
    returned_pairs: output.returned_pairs,
    suggestions: output.suggestions.slice(0, 12).map((pair) => ({
      pair_id: pair.pair_id,
      score: pair.score,
      confidence: pair.confidence,
      reasons: pair.reasons,
      warnings: pair.warnings,
      recommended_master_id: pair.recommended_master_id,
      customers: pair.customers.map((customer) => ({
        customer_id: customer.customer_id,
        customer_name: customer.customer_name,
        phone_masked: customer.phone_masked,
        customer_location: customer.customer_location,
        transaction_count: customer.transaction_count,
        outstanding_balance: customer.outstanding_balance,
      })),
    })),
  };
  return [
    {
      source_type: "customer_identity_matcher",
      source_ref: `spare_parts:duplicate-customers:branch:${output.branch_id}`,
      source_version: output.algorithm_version,
      label: "Spare Parts duplicate-customer suggestions",
      excerpt_text: JSON.stringify(excerpt).slice(0, 12000),
      as_of_at: output.generated_at,
      classification: "sensitive",
      workspace_code: "spare_parts",
      metadata: {
        branch_id: output.branch_id,
        suggestion_only: true,
        merge_executed: false,
        phones_masked: true,
      },
    },
  ];
}

function registerCustomerIdentityAiTools(
  registry = aiToolRegistry,
  { finder = findDuplicateCustomerSuggestions } = {}
) {
  if (registered && registry === aiToolRegistry) return registry.list();

  registry.register({
    key: "spare_parts.duplicate_customer_suggestions",
    version: "1",
    title: "Duplicate customer suggestions",
    description:
      "Suggests likely duplicate customer identities for the authorized Spare Parts branch using the existing CHALIN identity-matching algorithm. Phones are masked and no merge is performed.",
    risk_level: 2,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read_sensitive"],
    required_business_permissions: ["spare_parts.manage"],
    allowed_workspaces: ["spare_parts"],
    scope_requirements: { branch: true },
    evidence_required: true,
    max_input_bytes: 1500,
    max_output_bytes: 90000,
    timeout_ms: 15000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        minimum_score: {
          type: "integer",
          minimum: 58,
          maximum: 100,
          description: "Minimum confidence score for suggestions; defaults to 58.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description: "Maximum number of suggested pairs to return.",
        },
      },
    },
    handler: async ({ input, context }) => {
      const output = await finder({ context, input });
      return {
        ...output,
        evidence: buildEvidence(output),
        execution_authority: "suggestion_only",
        merge_executed: false,
      };
    },
  });

  registerCustomerCommercialAiTools(registry);

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  buildEvidence,
  registerCustomerIdentityAiTools,
};
