"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiToolRegistry,
  AiToolRegistryError,
} = require("../services/aiToolRegistry");

function req(overrides = {}) {
  return {
    requestId: "ai-tool-test",
    headers: {},
    user: {
      id: 1,
      username: "admin",
      role: "admin",
      workspace_code: "spare_parts",
      branch_id: 2,
    },
    ...overrides,
  };
}

function safeTool(overrides = {}) {
  return {
    key: "test.safe_tool",
    title: "Safe test tool",
    description: "Returns a bounded read-only result.",
    version: "1",
    risk_level: 1,
    personas: ["copilot"],
    required_permissions: ["ai.use"],
    allowed_workspaces: ["spare_parts"],
    scope_requirements: { branch: true },
    evidence_required: false,
    max_input_bytes: 2000,
    max_output_bytes: 4000,
    timeout_ms: 100,
    input_schema: { type: "object" },
    handler: async ({ input, context }) => ({
      value: input.value || "ok",
      actor_id: context.actor.id,
      branch_id: context.scope.branch_id,
      received_request_object: "req" in context,
      evidence: [],
    }),
    ...overrides,
  };
}

test("safe read-only tools register and execute with minimized context", async () => {
  const registry = new AiToolRegistry();
  registry.register(safeTool());
  const result = await registry.execute({
    toolKey: "test.safe_tool",
    input: { value: "approved" },
    req: req(),
    persona: "copilot",
  });
  assert.equal(result.output.value, "approved");
  assert.equal(result.output.actor_id, 1);
  assert.equal(result.output.branch_id, 2);
  assert.equal(result.output.received_request_object, false);
  assert.match(result.input_sha256, /^[a-f0-9]{64}$/);
});

test("direct database and SQL handlers are rejected at registration", () => {
  const registry = new AiToolRegistry();
  assert.throws(
    () =>
      registry.register(
        safeTool({
          key: "test.unsafe_database",
          handler: async () => pool.query("SELECT * FROM customers"),
        })
      ),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_DIRECT_DATABASE_BLOCKED"
  );
});

test("duplicate, invalid risk and missing persona definitions fail closed", () => {
  const registry = new AiToolRegistry();
  registry.register(safeTool());
  assert.throws(
    () => registry.register(safeTool()),
    (error) =>
      error instanceof AiToolRegistryError && error.code === "AI_TOOL_DUPLICATE"
  );
  assert.throws(
    () => registry.register(safeTool({ key: "test.bad_risk", risk_level: 8 })),
    (error) =>
      error instanceof AiToolRegistryError && error.code === "AI_TOOL_RISK_INVALID"
  );
  assert.throws(
    () => registry.register(safeTool({ key: "test.no_persona", personas: [] })),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_PERSONA_REQUIRED"
  );
});

test("persona, workspace and input-size boundaries are enforced", async () => {
  const registry = new AiToolRegistry();
  registry.register(safeTool({ max_input_bytes: 100 }));

  await assert.rejects(
    () =>
      registry.execute({
        toolKey: "test.safe_tool",
        input: {},
        req: req(),
        persona: "executive",
      }),
    (error) => error.code === "AI_TOOL_PERSONA_DENIED"
  );

  await assert.rejects(
    () =>
      registry.execute({
        toolKey: "test.safe_tool",
        input: {},
        req: req({
          user: {
            id: 1,
            username: "admin",
            role: "admin",
            workspace_code: "mining",
          },
        }),
        persona: "copilot",
      }),
    (error) => error.code === "AI_TOOL_WORKSPACE_DENIED"
  );

  await assert.rejects(
    () =>
      registry.execute({
        toolKey: "test.safe_tool",
        input: { value: "x".repeat(500) },
        req: req(),
        persona: "copilot",
      }),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_INPUT_TOO_LARGE"
  );
});

test("tool timeout and output-size boundaries fail safely", async () => {
  const timeoutRegistry = new AiToolRegistry();
  timeoutRegistry.register(
    safeTool({
      key: "test.timeout",
      timeout_ms: 5,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { evidence: [] };
      },
    })
  );
  await assert.rejects(
    () =>
      timeoutRegistry.execute({
        toolKey: "test.timeout",
        input: {},
        req: req(),
        persona: "copilot",
      }),
    (error) =>
      error instanceof AiToolRegistryError && error.code === "AI_TOOL_TIMEOUT"
  );

  const outputRegistry = new AiToolRegistry();
  outputRegistry.register(
    safeTool({
      key: "test.large_output",
      max_output_bytes: 100,
      handler: async () => ({ value: "x".repeat(500), evidence: [] }),
    })
  );
  await assert.rejects(
    () =>
      outputRegistry.execute({
        toolKey: "test.large_output",
        input: {},
        req: req(),
        persona: "copilot",
      }),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_OUTPUT_TOO_LARGE"
  );
});

test("risk-four execution remains disabled while aiActions is false", async () => {
  const registry = new AiToolRegistry();
  registry.register(
    safeTool({
      key: "test.future_action",
      risk_level: 4,
      required_permissions: ["ai.actions.execute"],
    })
  );
  await assert.rejects(
    () =>
      registry.execute({
        toolKey: "test.future_action",
        input: {},
        req: req(),
        persona: "copilot",
      }),
    (error) => error.code === "AI_ACTIONS_DISABLED"
  );
});
