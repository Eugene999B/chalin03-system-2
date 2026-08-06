"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_PERMISSIONS,
  AI_PERSONAS,
  getEffectiveAiPermissions,
  hasAiPermission,
  normalizeAiPersona,
  normalizeAiWorkspace,
} = require("../security/aiPermissionCatalog");
const {
  AiPermissionError,
  assertRequiredLocationScope,
  assertWorkspaceAllowed,
  buildToolExecutionContext,
  resolveAiScope,
} = require("../services/aiPermissionService");

function originalAdmin(overrides = {}) {
  return {
    id: 1,
    username: "admin",
    role: "admin",
    workspace_code: "spare_parts",
    branch_id: 4,
    ...overrides,
  };
}

test("original protected administrator receives the complete AI foundation catalogue", () => {
  assert.deepEqual(getEffectiveAiPermissions(originalAdmin()), AI_PERMISSIONS);
  assert.equal(hasAiPermission(originalAdmin(), "ai.executive.use"), true);
  assert.equal(hasAiPermission(originalAdmin(), "ai.actions.execute"), true);
});

test("normal roles never infer executive or action permissions", () => {
  const manager = {
    id: 22,
    username: "manager",
    role: "manager",
    workspace_code: "mining",
    workspace_role: "manager",
  };
  const permissions = getEffectiveAiPermissions(manager);
  assert.equal(permissions.includes("ai.use"), true);
  assert.equal(permissions.includes("ai.knowledge.view"), true);
  assert.equal(permissions.includes("ai.executive.use"), false);
  assert.equal(permissions.includes("ai.actions.propose"), false);
  assert.equal(permissions.includes("ai.actions.execute"), false);
});

test("explicit executive or action grants remain explicit", () => {
  const executive = {
    id: 23,
    username: "executive",
    role: "manager",
    workspace_code: "spare_parts",
    effective_permissions: [
      "workspace.view",
      "ai.executive.use",
      "ai.actions.propose",
    ],
  };
  assert.equal(hasAiPermission(executive, "ai.executive.use"), true);
  assert.equal(hasAiPermission(executive, "ai.actions.propose"), true);
  assert.equal(hasAiPermission(executive, "ai.actions.execute"), false);
});

test("persona and workspace normalization is controlled", () => {
  assert.equal(normalizeAiPersona("COPILOT"), AI_PERSONAS.COPILOT);
  assert.equal(normalizeAiPersona("root"), null);
  assert.equal(
    normalizeAiWorkspace("equipment_hire"),
    "equipment_hire"
  );
  assert.equal(normalizeAiWorkspace("unknown"), null);
});

test("staff AI scope is derived from authenticated workspace and location", () => {
  const req = {
    user: originalAdmin(),
    headers: {},
    requestId: "ai-permission-test",
  };
  const scope = resolveAiScope({ req, persona: "copilot" });
  assert.equal(scope.user_id, 1);
  assert.equal(scope.workspace_code, "spare_parts");
  assert.equal(scope.branch_id, 4);
  assert.equal(scope.mining_site_id, null);
  assert.equal(scope.hire_location_id, null);
  assert.equal(scope.visibility, "private");
});

test("mining and hire location requirements fail closed", () => {
  assert.throws(
    () =>
      assertRequiredLocationScope(
        { workspace_code: "mining", mining_site_id: null },
        { mining_site: true }
      ),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_MINING_SITE_SCOPE_REQUIRED"
  );
  assert.throws(
    () =>
      assertRequiredLocationScope(
        { workspace_code: "equipment_hire", hire_location_id: null },
        { hire_location: true }
      ),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_HIRE_LOCATION_SCOPE_REQUIRED"
  );
});

test("workspace allowlists and minimized tool context are enforced", () => {
  assert.throws(
    () =>
      assertWorkspaceAllowed(
        { workspace_code: "mining" },
        ["spare_parts"]
      ),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_TOOL_WORKSPACE_DENIED"
  );

  const context = buildToolExecutionContext({
    req: {
      user: originalAdmin(),
      headers: {},
      requestId: "tool-context-test",
    },
    persona: "copilot",
    tool: {
      key: "system.scope_summary",
      version: "1",
      risk_level: 1,
      required_permissions: ["ai.use"],
      allowed_workspaces: ["spare_parts"],
      scope_requirements: { branch: true },
    },
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(context.request_id, "tool-context-test");
  assert.equal(context.scope.branch_id, 4);
  assert.equal("req" in context, false);
  assert.equal("pool" in context, false);
  assert.equal("connection" in context, false);
});
