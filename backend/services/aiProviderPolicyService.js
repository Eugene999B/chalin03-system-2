"use strict";

const { pool } = require("../config/db");

const AI_PROVIDER_PERSONAS = Object.freeze(["guide", "copilot", "executive"]);
const AI_PROVIDER_KEYS = Object.freeze(["local", "gemini", "openai"]);
const PROFILE_KEYS = Object.freeze({
  guide: "chalin-guide",
  copilot: "chalin-copilot",
  executive: "chalin-executive",
});
const DEFAULT_MODELS = Object.freeze({
  local: "chalin-local-governed-v1",
  gemini: "gemini-3.6-flash",
  openai: "gpt-5.6",
});
const CACHE_TTL_MS = 15_000;

const profileCache = new Map();

class AiProviderPolicyError extends Error {
  constructor(message, { code = "AI_PROVIDER_POLICY_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiProviderPolicyError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function booleanValue(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(
    clean(value, 20).toLowerCase()
  );
}

function parseConfiguration(value) {
  if (!value) return Object.freeze({});
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({ ...value });
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.freeze(parsed)
      : Object.freeze({});
  } catch {
    return Object.freeze({});
  }
}

function strictPersona(value) {
  const persona = clean(value, 30).toLowerCase();
  if (!AI_PROVIDER_PERSONAS.includes(persona)) {
    throw new AiProviderPolicyError("Unsupported CHALIN AI provider persona.", {
      code: "AI_PROVIDER_PERSONA_INVALID",
    });
  }
  return persona;
}

function normalizePersona(value, messages = []) {
  const direct = clean(value, 30).toLowerCase();
  if (AI_PROVIDER_PERSONAS.includes(direct)) return direct;

  const systemText = (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.role || "").toLowerCase() === "system")
    .map((message) => clean(message?.content, 4000).toLowerCase())
    .join("\n");
  if (systemText.includes("you are chalin guide")) return "guide";
  if (systemText.includes("you are chalin executive")) return "executive";
  return "copilot";
}

function normalizeProviderKey(value, fallback = "local") {
  const provider = clean(value, 80).toLowerCase();
  if (AI_PROVIDER_KEYS.includes(provider)) return provider;
  return fallback;
}

function normalizeModelKey(value, providerKey) {
  const model = clean(value, 160);
  if (model && /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(model)) return model;
  return DEFAULT_MODELS[providerKey] || DEFAULT_MODELS.local;
}

function credentialConfigured(providerKey, env = process.env) {
  if (providerKey === "local") return true;
  const secret = providerKey === "gemini"
    ? clean(env.GOOGLE_API_KEY || env.GEMINI_API_KEY, 1000)
    : clean(env.OPENAI_API_KEY, 1000);
  if (secret.length < 20) return false;
  return !/(replace[_-]?with|replace[_-]?me|your[_-]|example|placeholder)/i.test(secret);
}

function dataClassification({ persona, providerContext = {} } = {}) {
  const explicit = clean(providerContext.data_classification, 30).toLowerCase();
  if (["public", "internal", "confidential", "sensitive", "immutable"].includes(explicit)) {
    return explicit;
  }
  return persona === "guide" ? "public" : "internal";
}

function geminiPaidTier(env = process.env) {
  return ["paid", "billing", "billing_enabled", "tier1", "tier2", "tier3"].includes(
    clean(env.GEMINI_SERVICE_TIER || "free", 30).toLowerCase()
  );
}

function profileRequestsFullContext(profile = {}) {
  return profile?.configuration?.system_admin_full_context === true;
}

function fullContextActive(profile, { persona, providerContext = {}, env = process.env } = {}) {
  if (!["copilot", "executive"].includes(persona)) return false;
  if (normalizeProviderKey(profile?.provider_key, "local") !== "gemini") return false;
  if (!profileRequestsFullContext(profile)) return false;
  if (providerContext?.original_system_administrator !== true) return false;
  return geminiPaidTier(env);
}

function externalPrivateDataAllowed(
  providerKey,
  env = process.env,
  { profile = null, persona = "copilot", providerContext = {} } = {}
) {
  if (
    providerKey === "gemini" &&
    fullContextActive(profile, { persona, providerContext, env })
  ) {
    return true;
  }

  // Preserve the existing explicit server override for controlled paid/private
  // provider deployments. It never overrides Gemini's paid-tier requirement.
  if (!booleanValue(env.AI_ALLOW_EXTERNAL_PRIVATE_DATA)) return false;
  if (providerKey === "gemini") return geminiPaidTier(env);
  return providerKey === "openai";
}

function fallbackProfile(persona, env = process.env) {
  const configured = normalizeProviderKey(
    env.AI_PROVIDER_POLICY_DEFAULT || "local",
    "local"
  );
  const providerKey = configured === "openai" && !credentialConfigured("openai", env)
    ? "local"
    : configured === "gemini" && !credentialConfigured("gemini", env)
      ? "local"
      : configured;
  return Object.freeze({
    profile_key: PROFILE_KEYS[persona],
    provider_key: providerKey,
    model_key: normalizeModelKey(null, providerKey),
    profile_status: "fallback",
    configuration: Object.freeze({ system_admin_full_context: false }),
    source: "governed_local_default",
  });
}

function cachedProfile(persona) {
  const cached = profileCache.get(persona);
  if (!cached || cached.expiresAt <= Date.now()) {
    profileCache.delete(persona);
    return null;
  }
  return cached.value;
}

function cacheProfile(persona, value) {
  profileCache.set(persona, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function clearProviderPolicyCache(persona = null) {
  if (persona) profileCache.delete(strictPersona(persona));
  else profileCache.clear();
}

async function loadProviderProfile(persona, { connection = pool, env = process.env, useCache = true } = {}) {
  const normalizedPersona = normalizePersona(persona);
  if (useCache) {
    const cached = cachedProfile(normalizedPersona);
    if (cached) return cached;
  }

  try {
    const [rows] = await connection.query(
      `SELECT profile_key, provider_key, model_key, profile_status, is_default,
              configuration_json, per_request_token_limit, daily_token_limit,
              monthly_cost_limit_micros, updated_at
         FROM ai_provider_profiles
        WHERE profile_key = ?
          AND profile_status IN ('test', 'staging', 'active')
        ORDER BY FIELD(profile_status, 'active', 'staging', 'test'), updated_at DESC
        LIMIT 1`,
      [PROFILE_KEYS[normalizedPersona]]
    );
    const row = rows[0];
    if (!row) return cacheProfile(normalizedPersona, fallbackProfile(normalizedPersona, env));
    const providerKey = normalizeProviderKey(row.provider_key, "local");
    return cacheProfile(
      normalizedPersona,
      Object.freeze({
        profile_key: PROFILE_KEYS[normalizedPersona],
        provider_key: providerKey,
        model_key: normalizeModelKey(row.model_key, providerKey),
        profile_status: row.profile_status,
        is_default: Boolean(Number(row.is_default || 0)),
        configuration: parseConfiguration(row.configuration_json),
        per_request_token_limit: Number(row.per_request_token_limit || 0),
        daily_token_limit: Number(row.daily_token_limit || 0),
        monthly_cost_limit_micros: Number(row.monthly_cost_limit_micros || 0),
        updated_at: row.updated_at || null,
        source: "database",
      })
    );
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "PROTOCOL_CONNECTION_LOST", "ECONNREFUSED"].includes(error?.code)) {
      return fallbackProfile(normalizedPersona, env);
    }
    throw error;
  }
}

function effectiveSelection(profile, { persona, providerContext = {}, env = process.env } = {}) {
  const classification = dataClassification({ persona, providerContext });
  const selectedProvider = normalizeProviderKey(profile?.provider_key, "local");
  const selectedModel = normalizeModelKey(profile?.model_key, selectedProvider);
  const fullContextRequested = profileRequestsFullContext(profile);
  const fullContextEnabled = fullContextActive(profile, {
    persona,
    providerContext,
    env,
  });
  let effectiveProvider = selectedProvider;
  let effectiveModel = selectedModel;
  let reasonCode = fullContextEnabled
    ? "AI_GEMINI_SYSTEM_ADMIN_FULL_CONTEXT"
    : "AI_PROVIDER_POLICY_SELECTED";

  if (selectedProvider !== "local" && !credentialConfigured(selectedProvider, env)) {
    effectiveProvider = "local";
    effectiveModel = DEFAULT_MODELS.local;
    reasonCode = "AI_PROVIDER_CREDENTIAL_MISSING_LOCAL_FALLBACK";
  } else if (
    selectedProvider !== "local" &&
    classification !== "public" &&
    !externalPrivateDataAllowed(selectedProvider, env, {
      profile,
      persona,
      providerContext,
    })
  ) {
    effectiveProvider = "local";
    effectiveModel = DEFAULT_MODELS.local;
    reasonCode = selectedProvider === "gemini"
      ? fullContextRequested && !geminiPaidTier(env)
        ? "AI_GEMINI_FULL_CONTEXT_REQUIRES_PAID_TIER"
        : "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK"
      : "AI_EXTERNAL_PRIVATE_DATA_LOCAL_FALLBACK";
  }

  return Object.freeze({
    persona,
    profile_key: profile?.profile_key || PROFILE_KEYS[persona],
    profile_source: profile?.source || "unknown",
    selected_provider: selectedProvider,
    selected_model: selectedModel,
    effective_provider: effectiveProvider,
    effective_model: effectiveModel,
    data_classification: classification,
    reason_code: reasonCode,
    external_network_used: effectiveProvider !== "local",
    zero_cost_local_available: true,
    gemini_service_tier: clean(env.GEMINI_SERVICE_TIER || "free", 30).toLowerCase(),
    external_private_data_allowed:
      effectiveProvider !== "local" &&
      externalPrivateDataAllowed(effectiveProvider, env, {
        profile,
        persona,
        providerContext,
      }),
    full_context_requested: fullContextRequested,
    full_context_active: fullContextEnabled && effectiveProvider === "gemini",
    full_context_requires_paid_tier:
      selectedProvider === "gemini" && fullContextRequested && !geminiPaidTier(env),
  });
}

async function resolveAiProviderSelection({
  providerContext = {},
  messages = [],
  env = process.env,
  connection = pool,
} = {}) {
  const persona = normalizePersona(providerContext.persona, messages);
  const profile = await loadProviderProfile(persona, { connection, env });
  return effectiveSelection(profile, { persona, providerContext, env });
}

async function getProviderControlSnapshot({ env = process.env, connection = pool } = {}) {
  const profiles = {};
  for (const persona of AI_PROVIDER_PERSONAS) {
    const profile = await loadProviderProfile(persona, { connection, env, useCache: false });
    const adminPreviewContext = {
      original_system_administrator: true,
      data_classification: persona === "guide" ? "public" : "internal",
    };
    profiles[persona] = Object.freeze({
      ...profile,
      selection: effectiveSelection(profile, {
        persona,
        providerContext: adminPreviewContext,
        env,
      }),
    });
  }
  return Object.freeze({
    providers: Object.freeze({
      local: Object.freeze({
        key: "local",
        label: "CHALIN Local",
        credential_required: false,
        credential_configured: true,
        external_network: false,
        zero_cost: true,
        private_data_supported: true,
      }),
      gemini: Object.freeze({
        key: "gemini",
        label: "Gemini",
        credential_required: true,
        credential_configured: credentialConfigured("gemini", env),
        external_network: true,
        zero_cost: !geminiPaidTier(env),
        service_tier: clean(env.GEMINI_SERVICE_TIER || "free", 30).toLowerCase(),
        private_data_supported: geminiPaidTier(env),
        full_context_capable: geminiPaidTier(env),
      }),
      openai: Object.freeze({
        key: "openai",
        label: "OpenAI",
        credential_required: true,
        credential_configured: credentialConfigured("openai", env),
        external_network: true,
        zero_cost: false,
        private_data_supported: booleanValue(env.AI_ALLOW_EXTERNAL_PRIVATE_DATA),
      }),
    }),
    profiles: Object.freeze(profiles),
    privacy: Object.freeze({
      unpaid_gemini_public_only: true,
      confidential_external_default: "blocked_to_local",
      system_admin_full_context_available_on_paid_gemini: true,
      provider_secrets_stored_in_database: false,
      secrets_exposed: false,
    }),
  });
}

async function updateProviderProfile({
  persona,
  providerKey,
  modelKey = null,
  fullContextAccess = false,
  userId,
  env = process.env,
  connection = pool,
} = {}) {
  const normalizedPersona = strictPersona(persona);
  const normalizedProvider = normalizeProviderKey(providerKey, "");
  if (!AI_PROVIDER_KEYS.includes(normalizedProvider)) {
    throw new AiProviderPolicyError("Unsupported CHALIN AI provider.", {
      code: "AI_PROVIDER_POLICY_PROVIDER_INVALID",
    });
  }
  const actorId = Number(userId);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new AiProviderPolicyError("A valid System Administrator is required.", {
      code: "AI_PROVIDER_POLICY_ACTOR_INVALID",
      statusCode: 403,
    });
  }

  const selectedModel = normalizeModelKey(modelKey, normalizedProvider);
  const profileStatus = clean(env.NODE_ENV, 20).toLowerCase() === "staging" ? "staging" : "active";
  const wantsFullContext =
    normalizedProvider === "gemini" &&
    ["copilot", "executive"].includes(normalizedPersona) &&
    fullContextAccess === true;
  const config = JSON.stringify({
    managed_by: "system_administrator",
    secret_storage: "environment_only",
    privacy_fallback: "local",
    system_admin_full_context: wantsFullContext,
  });

  await connection.query(
    `INSERT INTO ai_provider_profiles (
       profile_key, provider_key, model_key, profile_status, is_default,
       configuration_json, per_request_token_limit, daily_token_limit,
       monthly_cost_limit_micros, created_by, updated_by
     ) VALUES (?, ?, ?, ?, 0, ?, 262144, 10000000, 0, ?, ?)
     ON DUPLICATE KEY UPDATE
       provider_key = VALUES(provider_key),
       model_key = VALUES(model_key),
       profile_status = VALUES(profile_status),
       configuration_json = VALUES(configuration_json),
       per_request_token_limit = VALUES(per_request_token_limit),
       daily_token_limit = VALUES(daily_token_limit),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [
      PROFILE_KEYS[normalizedPersona],
      normalizedProvider,
      selectedModel,
      profileStatus,
      config,
      actorId,
      actorId,
    ]
  );
  clearProviderPolicyCache(normalizedPersona);
  return loadProviderProfile(normalizedPersona, { connection, env, useCache: false });
}

module.exports = {
  AI_PROVIDER_KEYS,
  AI_PROVIDER_PERSONAS,
  AiProviderPolicyError,
  CACHE_TTL_MS,
  DEFAULT_MODELS,
  PROFILE_KEYS,
  booleanValue,
  clearProviderPolicyCache,
  credentialConfigured,
  dataClassification,
  effectiveSelection,
  externalPrivateDataAllowed,
  fallbackProfile,
  fullContextActive,
  geminiPaidTier,
  getProviderControlSnapshot,
  loadProviderProfile,
  normalizeModelKey,
  normalizePersona,
  normalizeProviderKey,
  parseConfiguration,
  profileRequestsFullContext,
  resolveAiProviderSelection,
  strictPersona,
  updateProviderProfile,
};
