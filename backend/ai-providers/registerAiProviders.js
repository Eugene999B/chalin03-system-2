"use strict";

const { aiProviderRegistry } = require("../services/aiProviderService");
const { GeminiResilientPublicRouterProvider } = require("./geminiResilientPublicRouterProvider");
const {
  LocalCustomerAccountingGovernedProvider,
} = require("./localCustomerAccountingGovernedProvider");
const { OpenAiResponsesProvider } = require("./openAiResponsesProvider");

let registered = false;

function registerBuiltInAiProviders(registry = aiProviderRegistry) {
  if (registered && registry === aiProviderRegistry) return true;
  registry.register("local", () => new LocalCustomerAccountingGovernedProvider());
  registry.register("gemini", ({ env }) => new GeminiResilientPublicRouterProvider({ env }));
  registry.register("openai", ({ env }) => new OpenAiResponsesProvider({ env }));
  if (registry === aiProviderRegistry) registered = true;
  return true;
}

module.exports = {
  registerBuiltInAiProviders,
};
