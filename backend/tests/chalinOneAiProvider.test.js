"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiProviderError,
  AiProviderRegistry,
  MockAiProvider,
  generateProviderResponse,
} = require("../services/aiProviderService");

const messages = [
  { role: "system", content: "Use approved evidence only." },
  { role: "user", content: "Summarize the approved policy." },
];

test("disabled provider fails only the AI request", async () => {
  await assert.rejects(
    () =>
      generateProviderResponse({
        providerKey: "disabled",
        messages,
        env: { NODE_ENV: "test", AI_PROVIDER: "disabled" },
      }),
    (error) =>
      error instanceof AiProviderError && error.code === "AI_PROVIDER_DISABLED"
  );
});

test("deterministic mock provider is allowed in tests and returns normalized usage", async () => {
  const result = await generateProviderResponse({
    providerKey: "mock",
    messages,
    env: {
      NODE_ENV: "test",
      AI_PROVIDER: "mock",
      AI_MOCK_RESPONSE: "Approved test response for {{message}}",
    },
  });
  assert.equal(result.provider_key, "mock");
  assert.match(result.text, /Summarize the approved policy/);
  assert.equal(result.input_tokens > 0, true);
  assert.equal(result.output_tokens > 0, true);
});

test("mock provider is blocked in production even when explicitly requested", async () => {
  await assert.rejects(
    () =>
      generateProviderResponse({
        providerKey: "mock",
        messages,
        env: {
          NODE_ENV: "production",
          AI_PROVIDER: "mock",
          AI_ALLOW_MOCK_PROVIDER: "true",
        },
      }),
    (error) =>
      error instanceof AiProviderError &&
      error.code === "AI_MOCK_PROVIDER_BLOCKED"
  );
});

test("unknown network providers are not available until a reviewed adapter is registered", async () => {
  await assert.rejects(
    () =>
      generateProviderResponse({
        providerKey: "unregistered-provider",
        messages,
        env: { NODE_ENV: "test" },
      }),
    (error) =>
      error instanceof AiProviderError &&
      error.code === "AI_PROVIDER_NOT_REGISTERED"
  );
});

test("provider timeouts are bounded", async () => {
  const slow = {
    key: "slow-test",
    async generate() {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { text: "late response", model_key: "slow" };
    },
  };
  await assert.rejects(
    () =>
      generateProviderResponse({
        provider: slow,
        messages,
        timeoutMs: 5,
        env: { NODE_ENV: "test" },
      }),
    (error) =>
      error instanceof AiProviderError && error.code === "AI_PROVIDER_TIMEOUT"
  );
});

test("provider registry rejects duplicate and invalid adapters", () => {
  const registry = new AiProviderRegistry();
  registry.register("reviewed", () => new MockAiProvider());
  assert.throws(
    () => registry.register("reviewed", () => new MockAiProvider()),
    (error) =>
      error instanceof AiProviderError &&
      error.code === "AI_PROVIDER_ADAPTER_DUPLICATE"
  );
  assert.throws(
    () => registry.register("mock", () => new MockAiProvider()),
    (error) =>
      error instanceof AiProviderError &&
      error.code === "AI_PROVIDER_ADAPTER_INVALID"
  );
});
