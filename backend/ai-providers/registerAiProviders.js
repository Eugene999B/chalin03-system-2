"use strict";

const { aiProviderRegistry } = require("../services/aiProviderService");
const { GeminiGenerateContentProvider } = require("./geminiGenerateContentProvider");
const { LocalGovernedProvider } = require("./localGovernedProvider");
const { OpenAiResponsesProvider } = require("./openAiResponsesProvider");

let registered = false;

function registerBuiltInAiProviders(registry = aiProviderRegistry) {
  if (registered && registry === aiProviderRegistry) return true;
  registry.register("local", () => new LocalGovernedProvider());
  registry.register("gemini", ({ env }) => new GeminiGenerateContentProvider({ env }));
  registry.register("openai", ({ env }) => new OpenAiResponsesProvider({ env }));
  if (registry === aiProviderRegistry) registered = true;
  return true;
}

module.exports = {
  registerBuiltInAiProviders,
};
