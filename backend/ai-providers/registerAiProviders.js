"use strict";

const { aiProviderRegistry } = require("../services/aiProviderService");
const { GeminiResilientPublicRouterProvider } = require("./geminiResilientPublicRouterProvider");
const {
  LocalAuditSecurityGovernedProvider,
} = require("./localAuditSecurityGovernedProvider");
const { OpenAiResponsesProvider } = require("./openAiResponsesProvider");
const {
  wrapOperationalFastPath,
} = require("./operationalFastPathProvider");

let registered = false;

function registerBuiltInAiProviders(registry = aiProviderRegistry) {
  if (registered && registry === aiProviderRegistry) return true;
  registry.register("local", () =>
    wrapOperationalFastPath(new LocalAuditSecurityGovernedProvider())
  );
  registry.register("gemini", ({ env }) =>
    wrapOperationalFastPath(new GeminiResilientPublicRouterProvider({ env }))
  );
  registry.register("openai", ({ env }) =>
    wrapOperationalFastPath(new OpenAiResponsesProvider({ env }))
  );
  if (registry === aiProviderRegistry) registered = true;
  return true;
}

module.exports = {
  registerBuiltInAiProviders,
};
