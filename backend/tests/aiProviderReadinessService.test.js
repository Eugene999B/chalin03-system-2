"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAiProviderReadiness,
  isConfiguredProviderSecret,
} = require("../services/aiProviderReadinessService");

test("provider readiness is false when OpenAI is selected without a real credential", () => {
  const missing = getAiProviderReadiness({ AI_PROVIDER: "openai" });
  assert.equal(missing.key, "openai");
  assert.equal(missing.selected, true);
  assert.equal(missing.configured, false);
  assert.equal(missing.ready, false);
  assert.equal(missing.secret_configured, false);
  assert.equal(missing.reason_code, "AI_OPENAI_API_KEY_REQUIRED");
});

test("provider readiness becomes true only with a non-placeholder credential", () => {
  assert.equal(isConfiguredProviderSecret("replace_with_openai_key_1234567890"), false);
  assert.equal(isConfiguredProviderSecret("your_openai_key_12345678901234567890"), false);
  assert.equal(
    isConfiguredProviderSecret("staging-provider-secret-abcdefghijklmnopqrstuvwxyz-123456"),
    true
  );

  const ready = getAiProviderReadiness({
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "staging-provider-secret-abcdefghijklmnopqrstuvwxyz-123456",
  });
  assert.equal(ready.key, "openai");
  assert.equal(ready.configured, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.secret_configured, true);
  assert.equal(ready.provider_side_storage_enabled, false);
  assert.equal(ready.secret_values_exposed, false);
  assert.equal(ready.reason_code, "AI_PROVIDER_READY");
  assert.equal(Object.hasOwn(ready, "secret"), false);
  assert.equal(Object.hasOwn(ready, "api_key"), false);
});

test("disabled and mock providers are never marked live-ready", () => {
  const disabled = getAiProviderReadiness({ AI_PROVIDER: "disabled" });
  assert.equal(disabled.ready, false);
  assert.equal(disabled.reason_code, "AI_PROVIDER_DISABLED");

  const mock = getAiProviderReadiness({ AI_PROVIDER: "mock" });
  assert.equal(mock.ready, false);
  assert.equal(mock.reason_code, "AI_MOCK_PROVIDER_NOT_LIVE_READY");
});
