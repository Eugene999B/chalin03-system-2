"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MODELS,
  credentialConfigured,
  effectiveSelection,
  externalPrivateDataAllowed,
} = require("../services/aiProviderPolicyService");

function profile(providerKey, modelKey = null) {
  return {
    profile_key: `test-${providerKey}`,
    provider_key: providerKey,
    model_key: modelKey || DEFAULT_MODELS[providerKey],
    source: "test",
  };
}

test("CHALIN Local remains zero-network for private Copilot and Executive context", () => {
  for (const persona of ["copilot", "executive"]) {
    const selection = effectiveSelection(profile("local"), {
      persona,
      providerContext: {},
      env: {},
    });
    assert.equal(selection.selected_provider, "local");
    assert.equal(selection.effective_provider, "local");
    assert.equal(selection.data_classification, "internal");
    assert.equal(selection.external_network_used, false);
  }
});

test("Gemini Free may serve public Guide when its protected key is configured", () => {
  const env = {
    GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
    GEMINI_SERVICE_TIER: "free",
  };
  const selection = effectiveSelection(profile("gemini"), {
    persona: "guide",
    providerContext: {},
    env,
  });
  assert.equal(selection.data_classification, "public");
  assert.equal(selection.selected_provider, "gemini");
  assert.equal(selection.effective_provider, "gemini");
  assert.equal(selection.external_network_used, true);
  assert.equal(selection.gemini_service_tier, "free");
});

test("Gemini Free can be selected for staff but private evidence is forced to Local", () => {
  const env = {
    GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
    GEMINI_SERVICE_TIER: "free",
    AI_ALLOW_EXTERNAL_PRIVATE_DATA: "true",
  };
  for (const persona of ["copilot", "executive"]) {
    const selection = effectiveSelection(profile("gemini"), {
      persona,
      providerContext: {},
      env,
    });
    assert.equal(selection.selected_provider, "gemini");
    assert.equal(selection.effective_provider, "local");
    assert.equal(selection.effective_model, DEFAULT_MODELS.local);
    assert.equal(
      selection.reason_code,
      "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK"
    );
    assert.equal(selection.external_network_used, false);
  }
});

test("paid Gemini still requires an explicit private external-data policy", () => {
  const base = {
    GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
    GEMINI_SERVICE_TIER: "paid",
  };
  const blocked = effectiveSelection(profile("gemini"), {
    persona: "executive",
    providerContext: { data_classification: "confidential" },
    env: base,
  });
  assert.equal(blocked.effective_provider, "local");

  const allowed = effectiveSelection(profile("gemini"), {
    persona: "executive",
    providerContext: { data_classification: "confidential" },
    env: { ...base, AI_ALLOW_EXTERNAL_PRIVATE_DATA: "true" },
  });
  assert.equal(allowed.effective_provider, "gemini");
  assert.equal(allowed.external_private_data_allowed, true);
});

test("missing external credentials always fail closed to Local", () => {
  for (const providerKey of ["gemini", "openai"]) {
    const selection = effectiveSelection(profile(providerKey), {
      persona: "guide",
      providerContext: { data_classification: "public" },
      env: {},
    });
    assert.equal(selection.effective_provider, "local");
    assert.equal(
      selection.reason_code,
      "AI_PROVIDER_CREDENTIAL_MISSING_LOCAL_FALLBACK"
    );
  }
});

test("provider credential and private-data helpers never require storing a key in policy data", () => {
  const env = {
    GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
    GEMINI_SERVICE_TIER: "free",
    AI_ALLOW_EXTERNAL_PRIVATE_DATA: "true",
  };
  assert.equal(credentialConfigured("gemini", env), true);
  assert.equal(externalPrivateDataAllowed("gemini", env), false);
  assert.equal(externalPrivateDataAllowed("local", env), false);
});
