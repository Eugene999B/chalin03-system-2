"use strict";

const { aiProviderRegistry } = require("./aiProviderService");
const {
  resolveAiProviderSelection,
} = require("./aiProviderPolicyService");
const {
  resolveContextProfile,
} = require("./aiContextProfileService");

class AiContextualProviderError extends Error {
  constructor(message, { code = "AI_CONTEXTUAL_PROVIDER_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiContextualProviderError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function offeredTool(tools = [], toolKey) {
  return (Array.isArray(tools) ? tools : []).find(
    (tool) => String(tool?.key || "").trim() === toolKey
  );
}

function contextProviderBrief(profile) {
  return Object.freeze({
    context_key: profile.key,
    context_title: profile.title,
    context_purpose: profile.purpose,
    data_classification: profile.classification,
  });
}

class ContextualAiProvider {
  constructor({ profile, selection, delegate }) {
    this.profile = profile;
    this.selection = selection;
    this.delegate = delegate;
    this.key = selection.effective_provider;
    this.preloadIssued = false;
  }

  async generate({
    messages = [],
    tools = [],
    max_output_tokens = 1200,
    provider_context = {},
    signal = undefined,
  } = {}) {
    const preload = offeredTool(tools, this.profile.preload_tool);
    if (!this.preloadIssued && preload) {
      this.preloadIssued = true;
      if (Number(preload.risk_level || 0) > 1) {
        throw new AiContextualProviderError(
          "Contextual CHALIN intelligence may preload read-only tools only.",
          {
            code: "AI_CONTEXT_PRELOAD_WRITE_TOOL_BLOCKED",
            statusCode: 403,
            details: [this.profile.preload_tool],
          }
        );
      }
      return {
        text: `Checking the governed ${this.profile.title} context before answering.`,
        model_key: this.selection.effective_model,
        input_tokens: 0,
        output_tokens: 0,
        cost_micros: 0,
        finish_reason: "context_preload",
        tool_calls: [
          {
            id: `context_${this.profile.key.replace(/[^a-z0-9]+/gi, "_").slice(0, 80)}`,
            tool_key: this.profile.preload_tool,
            input: {},
          },
        ],
        provider_store_enabled: false,
      };
    }

    return this.delegate.generate({
      messages,
      tools,
      max_output_tokens,
      provider_context: Object.freeze({
        ...provider_context,
        ...contextProviderBrief(this.profile),
        provider_model_override: this.selection.effective_model,
        provider_selection_reason: this.selection.reason_code,
      }),
      signal,
    });
  }
}

async function createContextualAiProvider({
  contextKey,
  req,
  persona = "copilot",
  env = process.env,
  registry = aiProviderRegistry,
  selectionResolver = resolveAiProviderSelection,
} = {}) {
  const profile = resolveContextProfile({ contextKey, req, persona });
  const selection = await selectionResolver({
    providerContext: {
      persona: profile.persona,
      data_classification: profile.classification,
      context_key: profile.key,
    },
    messages: [],
    env,
  });
  const delegate = registry.create({
    env,
    providerKey: selection.effective_provider,
  });
  return Object.freeze({
    provider: new ContextualAiProvider({ profile, selection, delegate }),
    profile,
    selection,
  });
}

module.exports = {
  AiContextualProviderError,
  ContextualAiProvider,
  contextProviderBrief,
  createContextualAiProvider,
  offeredTool,
};
