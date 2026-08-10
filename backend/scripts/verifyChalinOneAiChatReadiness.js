"use strict";

const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");
const {
  getAiProviderReadiness,
} = require("../services/aiProviderReadinessService");
const { LOCAL_MODEL_KEY } = require("../ai-providers/localGovernedProvider");
const {
  DEFAULT_GEMINI_MODEL,
  modelForContext: geminiModelForContext,
} = require("../ai-providers/geminiGenerateContentProvider");
const {
  DEFAULT_OPENAI_MODEL,
  modelForContext,
  reasoningEffortForContext,
} = require("../ai-providers/openAiResponsesProvider");

class ChalinOneAiChatReadinessError extends Error {
  constructor(message, code = "CHALIN_ONE_AI_CHAT_NOT_READY") {
    super(message);
    this.name = "ChalinOneAiChatReadinessError";
    this.code = code;
  }
}

function unsafe(message, code) {
  throw new ChalinOneAiChatReadinessError(message, code);
}

function verifyChalinOneAiChatReadiness(env = process.env) {
  const staging = validateFullStagingEnvironment(env, { mode: "provider" });
  const provider = getAiProviderReadiness(env);

  if (!provider.ready || !["local", "gemini", "openai"].includes(provider.key)) {
    unsafe(
      "CHALIN ONE staging chat requires CHALIN Local or a safely configured reviewed external provider.",
      provider.reason_code || "CHALIN_ONE_AI_CHAT_PROVIDER_NOT_READY"
    );
  }

  const localMode = provider.key === "local";
  const geminiMode = provider.key === "gemini";
  const copilotModel = localMode
    ? LOCAL_MODEL_KEY
    : geminiMode
      ? geminiModelForContext(env, { persona: "copilot" })
      : modelForContext(env, { persona: "copilot" });
  const executiveModel = localMode
    ? LOCAL_MODEL_KEY
    : geminiMode
      ? geminiModelForContext(env, { persona: "executive" })
      : modelForContext(env, { persona: "executive" });

  return Object.freeze({
    safe: true,
    staging_mode: staging.mode,
    database_name: staging.database_name,
    frontend_host: staging.frontend_host,
    api_host: staging.api_host,
    provider: provider.key,
    provider_ready: provider.ready,
    zero_cost_mode:
      localMode ||
      (geminiMode && provider.service_tier === "free"),
    billing_required: provider.billing_required === true,
    service_tier: provider.service_tier || null,
    public_only_when_unpaid: provider.public_only_when_unpaid === true,
    external_network_required: provider.external_network_required === true,
    provider_secret_configured: provider.secret_configured,
    provider_secret_exposed: false,
    provider_side_storage_enabled: false,
    copilot_model: copilotModel || (geminiMode ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL),
    executive_model: executiveModel || (geminiMode ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL),
    copilot_reasoning_effort: localMode
      ? "governed_evidence_synthesis"
      : geminiMode
        ? "provider_managed"
        : reasoningEffortForContext(
            env,
            { persona: "copilot", intent: "decision_support" },
            copilotModel
          ),
    executive_reasoning_effort: localMode
      ? "governed_evidence_synthesis"
      : geminiMode
        ? "provider_managed"
        : reasoningEffortForContext(
            env,
            { persona: "executive", intent: "decision_support" },
            executiveModel
          ),
    enabled_features: staging.enabled_features,
    disabled_features: staging.disabled_features,
    execution_authority: "read_recommend_prepare_only",
  });
}

if (require.main === module) {
  try {
    const result = verifyChalinOneAiChatReadiness(process.env);
    console.log("CHALIN ONE staging AI chat is ready for a live conversation.");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`CHALIN ONE staging AI chat readiness failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ChalinOneAiChatReadinessError,
  verifyChalinOneAiChatReadiness,
};
