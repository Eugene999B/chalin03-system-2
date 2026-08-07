"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AiToolRegistry,
  AiToolRegistryError,
  aiToolRegistry,
} = require("../services/aiToolRegistry");
const { availableTools } = require("../services/aiOrchestratorService");

function toolDefinition(overrides = {}) {
  return {
    key: "test.provider_visibility",
    title: "Provider visibility test",
    description: "Verifies provider tool visibility follows both AI and business permissions.",
    version: "1",
    risk_level: 1,
    personas: ["copilot"],
    required_permissions: ["ai.use", "ai.read"],
    required_business_permissions: ["spare_parts.manage"],
    allowed_workspaces: ["spare_parts"],
    scope_requirements: { branch: true },
    evidence_required: false,
    handler: async () => ({ evidence: [] }),
    ...overrides,
  };
}

test("AI registry rejects unregistered AI permission names", () => {
  const registry = new AiToolRegistry();
  assert.throws(
    () =>
      registry.register(
        toolDefinition({
          key: "test.invalid_ai_permission",
          required_permissions: ["ai.use", "ai.not_registered"],
        })
      ),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_AI_PERMISSION_INVALID"
  );
});

test("provider tool menu hides tools without ordinary business permission", () => {
  const key = "test.provider_visibility";
  if (!aiToolRegistry.tools.has(key)) {
    aiToolRegistry.register(toolDefinition());
  }

  const scope = { workspace_code: "spare_parts" };
  const withoutBusinessPermission = {
    id: 501,
    role: "staff",
    workspace_code: "spare_parts",
    branch_id: 1,
    effective_permissions: ["ai.use", "ai.read", "spare_parts.read"],
  };
  const withBusinessPermission = {
    ...withoutBusinessPermission,
    effective_permissions: [
      "ai.use",
      "ai.read",
      "spare_parts.read",
      "spare_parts.manage",
    ],
  };

  assert.equal(
    availableTools({
      persona: "copilot",
      scope,
      user: withoutBusinessPermission,
    }).some((tool) => tool.key === key),
    false
  );
  assert.equal(
    availableTools({
      persona: "copilot",
      scope,
      user: withBusinessPermission,
    }).some((tool) => tool.key === key),
    true
  );
});