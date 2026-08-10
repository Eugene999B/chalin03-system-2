"use strict";

const {
  validateFullStagingEnvironment,
} = require("./verifyChalinOneFullStagingEnvironment");
const {
  getAiProviderReadiness,
} = require("../services/aiProviderReadinessService");
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

  if (provider.key !== "openai") {
    unsafe(
      "The first live CHALIN ONE staging conversation requires the governed OpenAI provider.",
      "CHALIN_ONE_AI_CHAT_OPENAI_REQUIRED"
    );
  }
  if (!provider.ready) {
    unsafe(
      "The OpenAI provider is selected but its staging credential is not configured safely.",
      provider.reason_code || "CHALIN_ONE_AI_CHAT_PROVIDER_NOT_READY"
    );
  }

  const copilotModel = modelForContext(env, { persona: "copilot" });
  const executiveModel = modelForContext(env, { persona: "executive" });

  return Object.freeze({
    safe: true,
    staging_mode: staging.mode,
    database_name: staging.database_name,
    frontend_host: staging.frontend_host,
    api_host: staging.api_host,
    provider: provider.key,
    provider_ready: provider.ready,
    provider_secret_configured: provider.secret_configured,
    provider_secret_exposed: false,
    provider_side_storage_enabled: false,
    copilot_model: copilotModel || DEFAULT_OPENAI_MODEL,
    executive_model: executiveModel || DEFAULT_OPENAI_MODEL,
    copilot_reasoning_effort: reasoningEffortForContext(
      env,
      { persona: "copilot", intent: "decision_support" },
      copilotModel
    ),
    executive_reasoning_effort: reasoningEffortForContext(
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
