"use strict";

const { getFeatureSnapshot } = require("../services/featureFlagService");
const {
  searchGovernedKnowledge,
} = require("../services/aiKnowledgeRetrievalService");
const { aiToolRegistry } = require("../services/aiToolRegistry");

let registered = false;

function registerFoundationAiTools(registry = aiToolRegistry) {
  if (registered && registry === aiToolRegistry) return registry.list();

  registry.register({
    key: "system.scope_summary",
    title: "Active intelligence scope",
    description:
      "Returns the minimized active AI persona, workspace and location scope for transparency.",
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use"],
    allowed_workspaces: ["spare_parts", "mining", "equipment_hire"],
    evidence_required: false,
    max_input_bytes: 1000,
    max_output_bytes: 4000,
    timeout_ms: 1000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    handler: async ({ context }) => ({
      persona: context.scope.persona,
      workspace_code: context.scope.workspace_code,
      branch_id: context.scope.branch_id,
      mining_site_id: context.scope.mining_site_id,
      hire_location_id: context.scope.hire_location_id,
      execution_authority: "read_only",
      evidence: [],
    }),
  });

  registry.register({
    key: "knowledge.search",
    title: "Search approved knowledge",
    description:
      "Searches only published, currently effective governed knowledge. Document chunks use precise locators and local provider-independent retrieval before the legacy governed-text fallback.",
    version: "2",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.knowledge.view"],
    allowed_workspaces: ["spare_parts", "mining", "equipment_hire"],
    evidence_required: true,
    max_input_bytes: 4000,
    max_output_bytes: 50000,
    timeout_ms: 5000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 240 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    handler: async ({ input, context }) => {
      const query = String(input.query || "").trim().slice(0, 240);
      const evidence = await searchGovernedKnowledge({
        query,
        persona: context.scope.persona,
        workspaceCode: context.scope.workspace_code,
        limit: Math.max(1, Math.min(20, Number(input.limit) || 8)),
      });
      return {
        query,
        result_count: evidence.length,
        retrieval_authority: "published_governed_knowledge_only",
        evidence,
      };
    },
  });

  registry.register({
    key: "system.ai_feature_status",
    title: "AI feature status",
    description:
      "Returns effective CHALIN ONE feature states without exposing environment values or secrets.",
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.tools.view"],
    allowed_workspaces: ["spare_parts", "mining", "equipment_hire"],
    evidence_required: false,
    max_input_bytes: 1000,
    max_output_bytes: 4000,
    timeout_ms: 1000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    handler: async () => ({
      flags: getFeatureSnapshot(),
      provider_secrets_exposed: false,
      execution_authority: "read_only",
      evidence: [],
    }),
  });

  if (registry === aiToolRegistry) registered = true;
  return registry.list();
}

module.exports = {
  registerFoundationAiTools,
};
