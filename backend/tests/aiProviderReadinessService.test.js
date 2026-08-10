"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAiProviderReadiness,
  isConfiguredProviderSecret,
} = require("../services/aiProviderReadinessService");

test("CHALIN Local is ready without a credential or external billing", () => {
  const local = getAiProviderReadiness({ AI_PROVIDER: "local" });
  assert.equal(local.key, "local");
  assert.equal(local.ready, true);
  assert.equal(local.credential_required, false);
  assert.equal(local.external_network_required, false);
  assert.equal(local.billing_required, false);
  assert.equal(local.service_tier, "local");
  assert.equal(local.reason_code, "AI_LOCAL_GOVERNED_PROVIDER_READY");
});

test("Gemini free readiness requires a protected server credential and stays public-only", () => {
  const missing = getAiProviderReadiness({
    AI_PROVIDER: "gemini",
    GEMINI_SERVICE_TIER: "free",
  });
  assert.equal(missing.ready, false);
  assert.equal(missing.reason_code, "AI_GEMINI_API_KEY_REQUIRED");

  const ready = getAiProviderReadiness({
    AI_PROVIDER: "gemini",
    GEMINI_SERVICE_TIER: "free",
    GEMINI_API_KEY: "staging-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
  });
  assert.equal(ready.key, "gemini");
  assert.equal(ready.ready, true);
  assert.equal(ready.secret_configured, true);
  assert.equal(ready.external_network_required, true);
  assert.equal(ready.billing_required, false);
  assert.equal(ready.service_tier, "free");
  assert.equal(ready.public_only_when_unpaid, true);
  assert.equal(ready.secret_values_exposed, false);
  assert.equal(Object.hasOwn(ready, "api_key"), false);
});

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
