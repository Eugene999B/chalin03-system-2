"use strict";

const { GeminiRuntimeDiagnosticsProvider } = require("./geminiRuntimeDiagnosticsProvider");
const { LocalGovernedProvider } = require("./localGovernedProvider");
const {
  GroqPublicFreeProvider,
  OpenRouterPublicFreeProvider,
  configuredPublicFreeProvider,
  publicSafeProviderContext,
} = require("./openAiCompatiblePublicFreeProvider");

const PUBLIC_FREE_FALLBACK_ORDER = Object.freeze(["gemini", "groq", "openrouter", "local"]);

function clean(value, maximum = 200) {
  return String(value ?? "").trim().slice(0, maximum);
}

function hasGeminiCredential(env = process.env) {
  const value = clean(env.GOOGLE_API_KEY || env.GEMINI_API_KEY, 1200);
  return value.length >= 20 && !/(replace[_-]?with|replace[_-]?me|your[_-]|example|placeholder)/i.test(value);
}

function publicFallbackEligible(error) {
  const status = Number(error?.statusCode || 0);
  const code = clean(error?.code || error?.name, 160).toUpperCase();
  if ([429, 502, 503, 504].includes(status)) return true;
  if ([401, 403].includes(status) && /(API_KEY|CREDENTIAL|AUTH)/.test(code)) return true;
  return /(RATE|QUOTA|RESOURCE_EXHAUSTED|OVERLOAD|UNAVAILABLE|NETWORK|TIMEOUT|API_KEY_REQUIRED|REQUEST_FAILED|FETCH_UNAVAILABLE)/.test(code);
}

function safeFailure(error, provider) {
  return Object.freeze({
    provider,
    code: clean(error?.code || error?.name || "provider_failure", 120),
    status_code: Number(error?.statusCode || 0) || null,
  });
}

function tagFallbackModel(result, provider) {
  if (!result || typeof result !== "object") return result;
  if (provider === "gemini") return result;
  const model = clean(result.model_key || "unknown", 220);
  return Object.freeze({
    ...result,
    model_key: model.startsWith(`${provider}/`) ? model : `${provider}/${model}`.slice(0, 240),
  });
}

class GeminiResilientPublicRouterProvider {
  constructor({
    env = process.env,
    geminiProvider = null,
    groqProvider = null,
    openRouterProvider = null,
    localProvider = null,
    logger = console,
  } = {}) {
    // The governed provider profile remains "gemini". On public-safe turns only,
    // this adapter may fail over to other zero-cost external providers and then
    // CHALIN Local. Private/tool-bearing Gemini traffic is never rerouted.
    this.key = "gemini";
    this.env = env;
    this.geminiProvider = geminiProvider || new GeminiRuntimeDiagnosticsProvider({ env, logger });
    this.groqProvider = groqProvider || null;
    this.openRouterProvider = openRouterProvider || null;
    this.localProvider = localProvider || new LocalGovernedProvider();
    this.logger = logger || console;
  }

  configuredGroqProvider() {
    if (this.groqProvider) return this.groqProvider;
    if (!configuredPublicFreeProvider("groq", this.env)) return null;
    return new GroqPublicFreeProvider({ env: this.env });
  }

  configuredOpenRouterProvider() {
    if (this.openRouterProvider) return this.openRouterProvider;
    if (!configuredPublicFreeProvider("openrouter", this.env)) return null;
    return new OpenRouterPublicFreeProvider({ env: this.env });
  }

  async generate(input = {}) {
    const publicSafe =
      publicSafeProviderContext(input?.provider_context || {}) &&
      (!Array.isArray(input?.tools) || input.tools.length === 0);

    if (!publicSafe) {
      return this.geminiProvider.generate(input);
    }

    const failures = [];
    const candidates = [];
    if (hasGeminiCredential(this.env) || this.geminiProvider) {
      candidates.push(["gemini", this.geminiProvider]);
    }
    const groq = this.configuredGroqProvider();
    if (groq) candidates.push(["groq", groq]);
    const openrouter = this.configuredOpenRouterProvider();
    if (openrouter) candidates.push(["openrouter", openrouter]);

    for (const [provider, candidate] of candidates) {
      if (input?.signal?.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      try {
        const result = await candidate.generate(input);
        if (provider !== "gemini") {
          this.logger.info?.("CHALIN AI public free fallback succeeded", {
            selected_profile: "gemini",
            fallback_provider: provider,
            prior_failures: failures,
          });
        }
        return tagFallbackModel(result, provider);
      } catch (error) {
        failures.push(safeFailure(error, provider));
        if (!publicFallbackEligible(error)) throw error;
      }
    }

    this.logger.warn?.("CHALIN AI external public free providers unavailable; using Local", {
      selected_profile: "gemini",
      fallback_provider: "local",
      prior_failures: failures,
    });
    const localResult = await this.localProvider.generate(input);
    return tagFallbackModel(localResult, "local");
  }
}

module.exports = {
  PUBLIC_FREE_FALLBACK_ORDER,
  GeminiResilientPublicRouterProvider,
  hasGeminiCredential,
  publicFallbackEligible,
  safeFailure,
  tagFallbackModel,
};
