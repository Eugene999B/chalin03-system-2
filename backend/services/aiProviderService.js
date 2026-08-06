"use strict";

const {
  AiSafetyError,
  sanitizeProviderMessages,
  validateProviderOutput,
} = require("./aiSafetyService");

const DEFAULT_PROVIDER_TIMEOUT_MS = 20000;
const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,79}$/;

class AiProviderError extends Error {
  constructor(message, { code = "AI_PROVIDER_ERROR", statusCode = 503, details = [] } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function cleanProviderKey(value) {
  const key = String(value || "disabled").trim().toLowerCase();
  return PROVIDER_KEY_PATTERN.test(key) ? key : null;
}

function safePositiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function withProviderTimeout(promise, timeoutMs, providerKey) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AiProviderError(`AI provider ${providerKey} timed out.`, {
          code: "AI_PROVIDER_TIMEOUT",
          statusCode: 504,
        })
      );
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeProviderResult(result, providerKey) {
  if (!result || typeof result !== "object") {
    throw new AiProviderError("AI provider returned an invalid response.", {
      code: "AI_PROVIDER_RESPONSE_INVALID",
      statusCode: 502,
    });
  }

  const validated = validateProviderOutput(result.text);
  const inputTokens = Math.max(0, Number(result.input_tokens || 0));
  const outputTokens = Math.max(0, Number(result.output_tokens || 0));
  const toolCalls = Array.isArray(result.tool_calls)
    ? result.tool_calls.slice(0, 10).map((call) => ({
        id: String(call?.id || "").slice(0, 120) || null,
        tool_key: String(call?.tool_key || call?.name || "").slice(0, 150),
        input: call?.input && typeof call.input === "object" ? call.input : {},
      }))
    : [];

  return Object.freeze({
    text: validated.text,
    output_sha256: validated.output_sha256,
    redaction_count: validated.redaction_count,
    provider_key: providerKey,
    model_key: String(result.model_key || result.model || "unknown").slice(0, 160),
    input_tokens: Number.isFinite(inputTokens) ? Math.floor(inputTokens) : 0,
    output_tokens: Number.isFinite(outputTokens) ? Math.floor(outputTokens) : 0,
    finish_reason: String(result.finish_reason || "stop").slice(0, 80),
    tool_calls: Object.freeze(toolCalls),
  });
}

class DisabledAiProvider {
  constructor() {
    this.key = "disabled";
  }

  async generate() {
    throw new AiProviderError(
      "No CHALIN ONE AI provider is enabled in this environment.",
      { code: "AI_PROVIDER_DISABLED", statusCode: 503 }
    );
  }
}

class MockAiProvider {
  constructor({ responseText = "CHALIN ONE test provider response.", modelKey = "mock-v1" } = {}) {
    this.key = "mock";
    this.responseText = String(responseText);
    this.modelKey = String(modelKey);
  }

  async generate({ messages }) {
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user")?.content;
    return {
      text: this.responseText.replace("{{message}}", lastUser || ""),
      model_key: this.modelKey,
      input_tokens: Math.ceil(JSON.stringify(messages).length / 4),
      output_tokens: Math.ceil(this.responseText.length / 4),
      finish_reason: "stop",
      tool_calls: [],
    };
  }
}

class AiProviderRegistry {
  constructor() {
    this.factories = new Map();
  }

  register(providerKey, factory) {
    const key = cleanProviderKey(providerKey);
    if (!key || ["disabled", "mock"].includes(key) || typeof factory !== "function") {
      throw new AiProviderError("Invalid AI provider adapter registration.", {
        code: "AI_PROVIDER_ADAPTER_INVALID",
        statusCode: 400,
      });
    }
    if (this.factories.has(key)) {
      throw new AiProviderError(`AI provider ${key} is already registered.`, {
        code: "AI_PROVIDER_ADAPTER_DUPLICATE",
        statusCode: 409,
      });
    }
    this.factories.set(key, factory);
  }

  create({ env = process.env, providerKey = env.AI_PROVIDER } = {}) {
    const key = cleanProviderKey(providerKey || "disabled");
    if (!key || key === "disabled") return new DisabledAiProvider();

    if (key === "mock") {
      const environment = String(env.NODE_ENV || "development").toLowerCase();
      const explicitMock = ["1", "true", "yes", "on"].includes(
        String(env.AI_ALLOW_MOCK_PROVIDER || "").toLowerCase()
      );
      if (environment === "production" || (environment !== "test" && !explicitMock)) {
        throw new AiProviderError(
          "The deterministic mock AI provider is allowed only in tests or explicitly isolated non-production environments.",
          { code: "AI_MOCK_PROVIDER_BLOCKED", statusCode: 503 }
        );
      }
      return new MockAiProvider({
        responseText: env.AI_MOCK_RESPONSE || undefined,
        modelKey: env.AI_MOCK_MODEL || undefined,
      });
    }

    const factory = this.factories.get(key);
    if (!factory) {
      throw new AiProviderError(`AI provider ${key} is not registered.`, {
        code: "AI_PROVIDER_NOT_REGISTERED",
        statusCode: 503,
      });
    }
    const provider = factory({ env });
    if (!provider || typeof provider.generate !== "function") {
      throw new AiProviderError(`AI provider ${key} adapter is invalid.`, {
        code: "AI_PROVIDER_ADAPTER_INVALID",
        statusCode: 503,
      });
    }
    provider.key = key;
    return provider;
  }
}

const aiProviderRegistry = new AiProviderRegistry();

async function generateProviderResponse({
  provider = null,
  providerKey = null,
  messages,
  tools = [],
  maxOutputTokens = 1200,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const selected =
    provider || aiProviderRegistry.create({ env, providerKey: providerKey || env.AI_PROVIDER });
  const key = cleanProviderKey(selected.key || providerKey || "disabled") || "disabled";
  const safeMessages = sanitizeProviderMessages(messages);
  const safeTools = Array.isArray(tools) ? tools.slice(0, 50) : [];
  const started = Date.now();

  try {
    const raw = await withProviderTimeout(
      Promise.resolve(
        selected.generate({
          messages: safeMessages,
          tools: safeTools,
          max_output_tokens: safePositiveInteger(maxOutputTokens, 1200, 8000),
        })
      ),
      safePositiveInteger(timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS, 60000),
      key
    );
    return Object.freeze({
      ...normalizeProviderResult(raw, key),
      latency_ms: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof AiProviderError || error instanceof AiSafetyError) {
      throw error;
    }
    throw new AiProviderError("The AI provider request failed safely.", {
      code: "AI_PROVIDER_REQUEST_FAILED",
      statusCode: 502,
      details: [String(error?.code || error?.name || "provider_error")],
    });
  }
}

module.exports = {
  AiProviderError,
  AiProviderRegistry,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DisabledAiProvider,
  MockAiProvider,
  PROVIDER_KEY_PATTERN,
  aiProviderRegistry,
  cleanProviderKey,
  generateProviderResponse,
  normalizeProviderResult,
  safePositiveInteger,
  withProviderTimeout,
};
