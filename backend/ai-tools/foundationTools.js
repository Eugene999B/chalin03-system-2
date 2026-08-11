"use strict";

const { getFeatureSnapshot } = require("../services/featureFlagService");
const {
  loadScopedUserMemory,
  memoryPolicyPrompt,
  memorySummary,
} = require("../services/aiConversationMemoryService");
const {
  searchGovernedKnowledge,
} = require("../services/aiKnowledgeRetrievalService");
const {
  getKnowledgeHealthSnapshot,
} = require("../services/aiKnowledgeHealthService");
const {
  getKnowledgeCurriculum,
} = require("../services/aiKnowledgeCurriculumService");
const {
  loadGroupIntelligence,
} = require("../services/aiGroupIntelligenceService");
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
    key: "system.group_intelligence",
    title: "Whole-system group intelligence",
    description:
      "Original-System-Administrator-only aggregate intelligence across all active Spare Parts stores, Mining sites, Equipment Hire locations and the company-wide Installment Finance portfolio. Returns operational health without customer, worker or applicant identities.",
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.read", "ai.executive.use"],
    allowed_workspaces: [],
    evidence_required: true,
    max_input_bytes: 2000,
    max_output_bytes: 240000,
    timeout_ms: 30000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
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
      },
    },
    handler: async ({ input, context }) => {
      const snapshot = await loadGroupIntelligence({ context, input });
      return {
        ...snapshot,
        evidence: [
          {
            source_type: "system_snapshot",
            source_ref: "chalin:group-intelligence:system-administrator",
            source_version: "live-read-only-v1",
            label: "CHALIN whole-system aggregate intelligence",
            excerpt_text: JSON.stringify(snapshot).slice(0, 30000),
            as_of_at: snapshot.generated_at,
            classification: "confidential",
            workspace_code: null,
            metadata: {
              aggregate_only: true,
              system_administrator_only: true,
              customer_rows_exposed: false,
              worker_rows_exposed: false,
              applicant_rows_exposed: false,
              execution_authority: "read_only",
            },
          },
        ],
      };
    },
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
    key: "knowledge.health",
    title: "Knowledge health and gap diagnostics",
    description:
      "Returns read-only CHALIN knowledge coverage, freshness, approval backlog, retrieval hit-rate, zero-result search gaps and unresolved correction-review signals. Use it when asked what CHALIN knows, what knowledge is missing, where answers are weak or what should be taught next.",
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.knowledge.view"],
    allowed_workspaces: [],
    evidence_required: true,
    max_input_bytes: 1000,
    max_output_bytes: 120000,
    timeout_ms: 5000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        window_days: {
          type: "integer",
          minimum: 1,
          maximum: 180,
          description: "Optional lookback window for retrieval gaps and correction feedback.",
        },
      },
    },
    handler: async ({ input, context }) => {
      const workspaceCode = context.authority?.cross_workspace
        ? null
        : context.scope.workspace_code;
      const snapshot = await getKnowledgeHealthSnapshot({
        workspaceCode,
        windowDays: input.window_days,
      });
      return {
        ...snapshot,
        evidence: [
          {
            source_type: "system_snapshot",
            source_ref: `chalin:knowledge-health:${workspaceCode || "enterprise"}`,
            source_version: "knowledge-health-v1",
            label: "CHALIN governed knowledge health snapshot",
            excerpt_text: JSON.stringify(snapshot).slice(0, 30000),
            as_of_at: snapshot.generated_at,
            classification: "internal",
            workspace_code: workspaceCode,
            metadata: {
              read_only: true,
              correction_text_exposed: false,
              conversation_text_exposed: false,
              knowledge_gap_detection: true,
            },
          },
        ],
      };
    },
  });

  registry.register({
    key: "knowledge.curriculum",
    title: "Knowledge curriculum and expert-pack plan",
    description:
      "Turns governed knowledge-health gaps into a prioritized read-only teaching curriculum across CHALIN expert domains. Use it when asked what CHALIN should learn next, which expert packs are weak, or how to improve organizational knowledge. Curriculum targets never auto-create or publish knowledge.",
    version: "1",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.knowledge.view"],
    allowed_workspaces: [],
    evidence_required: true,
    max_input_bytes: 1000,
    max_output_bytes: 160000,
    timeout_ms: 6000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        window_days: {
          type: "integer",
          minimum: 1,
          maximum: 180,
          description: "Optional lookback window for knowledge gaps and correction signals.",
        },
      },
    },
    handler: async ({ input, context }) => {
      const workspaceCode = context.authority?.cross_workspace
        ? null
        : context.scope.workspace_code;
      const curriculum = await getKnowledgeCurriculum({
        workspaceCode,
        windowDays: input.window_days,
      });
      return {
        ...curriculum,
        evidence: [
          {
            source_type: "system_snapshot",
            source_ref: `chalin:knowledge-curriculum:${workspaceCode || "enterprise"}`,
            source_version: "knowledge-curriculum-v1",
            label: "CHALIN governed knowledge curriculum",
            excerpt_text: JSON.stringify(curriculum).slice(0, 30000),
            as_of_at: curriculum.generated_at,
            classification: "internal",
            workspace_code: workspaceCode,
            metadata: {
              read_only: true,
              curriculum_targets_are_not_facts: true,
              auto_create_disabled: true,
              auto_publish_disabled: true,
              correction_text_exposed: false,
            },
          },
        ],
      };
    },
  });

  registry.register({
    key: "conversation.memory",
    title: "Recall prior conversation context",
    description:
      "Searches this same user's prior active conversations in the exact current persona/workspace/location scope. Use it aggressively when a question relates to earlier goals, cases, decisions, preferences, plans, people or ongoing work. Returns both user and assistant history as continuity context only; it is never governed evidence or current operational truth.",
    version: "2",
    risk_level: 1,
    personas: ["copilot", "executive"],
    required_permissions: ["ai.use", "ai.conversations.view"],
    allowed_workspaces: ["spare_parts", "mining", "equipment_hire"],
    evidence_required: false,
    max_input_bytes: 4000,
    max_output_bytes: 50000,
    timeout_ms: 5000,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 1000 },
        limit: { type: "integer", minimum: 1, maximum: 24 },
      },
    },
    handler: async ({ input, context }) => {
      const query = String(input.query || "").trim().slice(0, 1000);
      const memories = await loadScopedUserMemory({
        userId: context.actor.id,
        persona: context.scope.persona,
        scope: context.scope,
        query,
        limit: Math.max(1, Math.min(24, Number(input.limit) || 12)),
      });
      return {
        query,
        memory_policy: memoryPolicyPrompt(),
        summary: memorySummary(memories),
        memories,
        evidence: [],
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
