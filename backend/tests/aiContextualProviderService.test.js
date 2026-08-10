"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiContextualProviderError,
  ContextualAiProvider,
  createContextualAiProvider,
} = require("../services/aiContextualProviderService");

function profile(overrides = {}) {
  return {
    key: "spare_parts.inventory",
    title: "Spare Parts inventory",
    purpose: "Current stock health.",
    classification: "internal",
    preload_tool: "spare_parts.inventory_health",
    ...overrides,
  };
}

function selection(overrides = {}) {
  return {
    selected_provider: "local",
    selected_model: "chalin-local-governed-v1",
    effective_provider: "local",
    effective_model: "chalin-local-governed-v1",
    reason_code: "AI_PROVIDER_POLICY_SELECTED",
    ...overrides,
  };
}

function delegate() {
  return {
    key: "local",
    calls: [],
    async generate(input) {
      this.calls.push(input);
      return {
        text: "Synthesized governed answer [E1].",
        model_key: "chalin-local-governed-v1",
        input_tokens: 10,
        output_tokens: 6,
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    },
  };
}

test("contextual provider forces exactly one approved read-only preload before synthesis", async () => {
  const downstream = delegate();
  const provider = new ContextualAiProvider({
    profile: profile(),
    selection: selection(),
    delegate: downstream,
  });
  const tools = [
    {
      key: "spare_parts.inventory_health",
      risk_level: 1,
    },
  ];

  const first = await provider.generate({
    messages: [{ role: "user", content: "What is happening?" }],
    tools,
    provider_context: { persona: "copilot" },
  });
  assert.equal(first.tool_calls.length, 1);
  assert.equal(first.tool_calls[0].tool_key, "spare_parts.inventory_health");
  assert.deepEqual(first.tool_calls[0].input, {});
  assert.equal(downstream.calls.length, 0);

  const second = await provider.generate({
    messages: [{ role: "user", content: "[E1] stock snapshot\nApproved evidence" }],
    tools,
    provider_context: { persona: "copilot" },
  });
  assert.equal(second.text, "Synthesized governed answer [E1].");
  assert.equal(downstream.calls.length, 1);
  assert.equal(downstream.calls[0].provider_context.context_key, "spare_parts.inventory");
  assert.equal(downstream.calls[0].provider_context.data_classification, "internal");
});

test("contextual provider cannot force a tool that permission filtering did not offer", async () => {
  const downstream = delegate();
  const provider = new ContextualAiProvider({
    profile: profile(),
    selection: selection(),
    delegate: downstream,
  });

  const result = await provider.generate({
    messages: [{ role: "user", content: "What is happening?" }],
    tools: [{ key: "knowledge.search", risk_level: 1 }],
    provider_context: { persona: "copilot" },
  });
  assert.equal(result.text, "Synthesized governed answer [E1].");
  assert.equal(downstream.calls.length, 1);
});

test("contextual provider rejects any accidental write-risk preload even if offered", async () => {
  const provider = new ContextualAiProvider({
    profile: profile(),
    selection: selection(),
    delegate: delegate(),
  });

  await assert.rejects(
    () =>
      provider.generate({
        messages: [],
        tools: [
          {
            key: "spare_parts.inventory_health",
            risk_level: 2,
          },
        ],
      }),
    (error) =>
      error instanceof AiContextualProviderError &&
      error.code === "AI_CONTEXT_PRELOAD_WRITE_TOOL_BLOCKED"
  );
});

test("Finance contextual provider sends confidential classification into provider policy before model selection", async () => {
  let selectionInput = null;
  let registryInput = null;
  const fakeRegistry = {
    create(input) {
      registryInput = input;
      return delegate();
    },
  };
  const fakeSelectionResolver = async (input) => {
    selectionInput = input;
    return selection({
      selected_provider: "gemini",
      selected_model: "gemini-2.5-flash",
      effective_provider: "local",
      effective_model: "chalin-local-governed-v1",
      reason_code: "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK",
    });
  };
  const req = {
    user: {
      id: 9,
      role: "manager",
      workspace_code: "equipment_hire",
      workspace_role: "finance_manager",
      effective_permissions: ["ai.use", "ai.read", "ai.conversations.manage"],
    },
    headers: {},
  };

  const result = await createContextualAiProvider({
    contextKey: "equipment_finance.portfolio",
    req,
    persona: "copilot",
    env: { GEMINI_SERVICE_TIER: "free" },
    registry: fakeRegistry,
    selectionResolver: fakeSelectionResolver,
  });

  assert.equal(selectionInput.providerContext.data_classification, "confidential");
  assert.equal(registryInput.providerKey, "local");
  assert.equal(result.selection.selected_provider, "gemini");
  assert.equal(result.selection.effective_provider, "local");
});
