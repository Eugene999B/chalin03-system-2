"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MODELS,
  effectiveSelection,
  fallbackProfile,
  getProviderControlSnapshot,
  normalizePersona,
  safetyIdentifierForUser,
  strictPersona,
  updateProviderProfile,
} = require("../services/aiProviderPolicyService");

function profile(provider, model = null, configuration = {}) {
  return {
    profile_key: "chalin-copilot",
    provider_key: provider,
    model_key: model || DEFAULT_MODELS[provider],
    source: "test",
    configuration,
  };
}

test("provider policy defaults to CHALIN Local and ignores legacy AI_PROVIDER activation", () => {
  const fallback = fallbackProfile("copilot", {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "test-secret-that-must-not-activate-anything",
  });
  assert.equal(fallback.provider_key, "local");
  assert.equal(fallback.model_key, DEFAULT_MODELS.local);
  assert.equal(fallback.source, "governed_local_default");
});

test("provider persona inference remains strict and deterministic", () => {
  assert.equal(normalizePersona("guide"), "guide");
  assert.equal(normalizePersona("executive"), "executive");
  assert.equal(normalizePersona(null, [{ role: "system", content: "You are Chalin Guide." }]), "guide");
  assert.equal(normalizePersona(null, [{ role: "system", content: "You are Chalin Executive." }]), "executive");
  assert.equal(normalizePersona(null, []), "copilot");
  assert.throws(() => strictPersona("unknown"), (error) => error.code === "AI_PROVIDER_PERSONA_INVALID");
});

test("missing Gemini key safely falls back to Local", () => {
  const selection = effectiveSelection(profile("gemini"), {
    persona: "guide",
    providerContext: { data_classification: "public" },
    env: {},
  });
  assert.equal(selection.selected_provider, "gemini");
  assert.equal(selection.effective_provider, "local");
  assert.equal(selection.reason_code, "AI_PROVIDER_CREDENTIAL_MISSING_LOCAL_FALLBACK");
});

test("Gemini Free is allowed for public Guide content", () => {
  const selection = effectiveSelection(profile("gemini"), {
    persona: "guide",
    providerContext: { data_classification: "public" },
    env: {
      GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
      GEMINI_SERVICE_TIER: "free",
    },
  });
  assert.equal(selection.effective_provider, "gemini");
  assert.equal(selection.effective_model, "gemini-3.6-flash");
  assert.equal(selection.external_network_used, true);
  assert.equal(selection.external_private_data_allowed, false);
});

test("Gemini Free cannot receive staff private data and falls back to Local", () => {
  const selection = effectiveSelection(profile("gemini"), {
    persona: "copilot",
    providerContext: { data_classification: "internal" },
    env: {
      GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
      GEMINI_SERVICE_TIER: "free",
    },
  });
  assert.equal(selection.effective_provider, "local");
  assert.equal(selection.reason_code, "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK");
});

test("full Gemini context is paid-tier and enabling-account bound", () => {
  const ownerId = safetyIdentifierForUser(1);
  const fullProfile = profile("gemini", "gemini-3.6-flash", {
    system_admin_full_context: true,
    full_context_safety_identifier: ownerId,
  });
  const paid = effectiveSelection(fullProfile, {
    persona: "copilot",
    providerContext: {
      data_classification: "confidential",
      safety_identifier: ownerId,
    },
    env: {
      GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
      GEMINI_SERVICE_TIER: "paid",
    },
  });
  assert.equal(paid.effective_provider, "gemini");
  assert.equal(paid.full_context_active, true);

  const otherUser = effectiveSelection(fullProfile, {
    persona: "copilot",
    providerContext: {
      data_classification: "confidential",
      safety_identifier: safetyIdentifierForUser(2),
    },
    env: {
      GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
      GEMINI_SERVICE_TIER: "paid",
    },
  });
  assert.equal(otherUser.effective_provider, "local");
  assert.equal(otherUser.full_context_active, false);
});

test("invalid provider-control persona fails before database access", async () => {
  await assert.rejects(
    () =>
      updateProviderProfile({
        persona: "garbage",
        providerKey: "local",
        userId: 1,
        connection: {
          query: async () => {
            throw new Error("database must not be reached");
          },
        },
      }),
    (error) => error.code === "AI_PROVIDER_PERSONA_INVALID"
  );
});

test("provider-control persists provider/model policy without accepting or returning provider secrets", async () => {
  const statements = [];
  const connection = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (/^\s*SELECT\s/i.test(sql)) {
        return [[{
          profile_key: "chalin-guide",
          provider_key: "gemini",
          model_key: "gemini-3.6-flash",
          profile_status: "staging",
          is_default: 0,
          configuration_json: JSON.stringify({
            managed_by: "system_administrator",
            secret_storage: "environment_only",
            system_admin_full_context: false,
          }),
          per_request_token_limit: 262144,
          daily_token_limit: 10000000,
          monthly_cost_limit_micros: 0,
          updated_at: new Date("2026-08-10T00:00:00Z"),
        }]];
      }
      return [{ affectedRows: 1 }];
    },
  };

  const result = await updateProviderProfile({
    persona: "guide",
    providerKey: "gemini",
    userId: 1,
    env: { NODE_ENV: "staging" },
    connection,
  });
  assert.equal(result.provider_key, "gemini");
  assert.equal(result.model_key, "gemini-3.6-flash");
  assert.equal(result.configuration?.secret_storage, "environment_only");
  assert.equal(result.configuration?.system_admin_full_context, false);
  assert.equal(statements.some((item) => /ai_provider_profiles/i.test(item.sql)), true);
  assert.doesNotMatch(JSON.stringify(result), /GEMINI_API_KEY|GOOGLE_API_KEY|OPENAI_API_KEY/i);
  assert.doesNotMatch(JSON.stringify(statements), /test-gemini-secret|secret-[a-z0-9]/i);
});

test("provider-control snapshot exposes readiness booleans, not secret values", async () => {
  const connection = {
    async query() {
      return [[]];
    },
  };
  const snapshot = await getProviderControlSnapshot({
    env: {
      GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
      GEMINI_SERVICE_TIER: "free",
    },
    connection,
  });
  assert.equal(snapshot.providers.gemini.credential_configured, true);
  assert.equal(snapshot.providers.gemini.zero_cost, true);
  assert.equal(snapshot.providers.gemini.private_data_supported, false);
  assert.equal(snapshot.privacy.provider_secrets_stored_in_database, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /test-gemini-secret/);
});
