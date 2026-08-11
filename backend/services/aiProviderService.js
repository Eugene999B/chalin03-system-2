"use strict";

const {
  resolveAiProviderSelection,
} = require("./aiProviderPolicyService");
const {
  AiSafetyError,
  sanitizeProviderMessages,
  validateProviderOutput,
} = require("./aiSafetyService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeMessages,
  safePublicContinuityMessages,
} = require("./aiProductKnowledgeService");
const {
  selectRelevantProviderTools,
} = require("./aiProviderToolRoutingService");
const {
  enrichPublicSafeMessagesWithWeb,
} = require("./aiPublicWebSearchService");

const DEFAULT_PROVIDER_TIMEOUT_MS = 60000;
const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,79}$/;
const PUBLIC_SAFE_SOCIAL_MAX_LENGTH = 240;
const PUBLIC_SAFE_GENERAL_MAX_LENGTH = 12000;
const PUBLIC_SAFE_SOCIAL_PATTERN = /^(?:(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening)|greetings)\b|(?:how\s+(?:are|r)\s+you|how(?:'s|\s+is)\s+it\s+going|how\s+are\s+you\s+doing|what(?:'s|\s+is)\s+up)\b|(?:thanks|thank\s+you|thank\s+you\s+very\s+much|okay|ok|cool|great|nice|bye|goodbye|see\s+you)\b|(?:who\s+are\s+you|what\s+can\s+you\s+do|how\s+can\s+you\s+help(?:\s+me)?|can\s+you\s+help(?:\s+me)?)\b)[\s!.?,'-]*$/i;
const PUBLIC_SAFE_GREETING_PREFIX = /^(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening)|greetings)\b/i;
const PRIVATE_BUSINESS_MARKERS = /\b(?:account|applicant|approval|arrears|audit|balance|bank|branch|cash|collection|contract|credit|customer|database|debt|debtor|deduction|employee|equipment|expense|finance|hire|inventory|invoice|loan|mining|payment|payroll|profit|quotation|receipt|revenue|salary|sale|sales|security|site|staff|stock|store|supplier|transaction|worker|wage)\b/i;
const SENSITIVE_LITERAL_MARKERS = /(?:https?:\/\/|www\.|@|\b(?:ghs|gh¢|usd|eur|gbp)\b|\d{3,})/i;
const PUBLIC_SAFE_COPILOT_INSTRUCTION =
  "This is a public-safe social conversation turn. Respond naturally and briefly as CHALIN Copilot. Preserve the immediately relevant public-safe conversation thread when supplied. Do not introduce, infer, summarize, request, or expose any CHALIN business, customer, staff, payroll, financial, operational, security, or other private facts. No company evidence is supplied or required for this social turn.";
const PUBLIC_SAFE_GENERAL_INSTRUCTION =
  "This is a public-safe general reasoning turn. Respond as a highly capable CHALIN Copilot using general knowledge, clear reasoning, creativity and useful judgment. Preserve the immediately relevant public-safe conversation thread when supplied, answer the actual question directly, and do not restart the discussion just because the newest sentence is short. You have intentionally not been given private CHALIN evidence, private records or business tools for this turn. Do not imply access to private CHALIN facts and do not invent company-specific live data.";

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

function cleanMessageContent(value, maximum = 32000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function latestUserMessage(messages = []) {
  for (let index = (Array.isArray(messages) ? messages.length : 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    const content = cleanMessageContent(message?.content, 16000);
    if (content) return content;
  }
  return "";
}

function safeExternalClassification(providerContext = {}) {
  const explicitClassification = cleanMessageContent(
    providerContext?.data_classification,
    30
  ).toLowerCase();
  return !explicitClassification || explicitClassification === "public";
}

function hasPrivateBusinessSignal(prompt) {
  const text = cleanMessageContent(prompt, 16000);
  if (!text) return false;

  // Product/system explanations, IT/architecture questions, marketing work,
  // business advice and other advisory questions must not be classified as
  // private merely because they contain words such as audit, payroll, finance,
  // employee, database or security. They carry only static CHALIN product
  // context to the external reasoning model.
  if (isChalinProductKnowledgeTurn(text)) return false;

  if (isLikelyLiveRecordRequest(text)) return true;
  return PRIVATE_BUSINESS_MARKERS.test(text) || SENSITIVE_LITERAL_MARKERS.test(text);
}

function isPublicSafeSocialTurn({ messages = [], providerContext = {} } = {}) {
  const persona = cleanMessageContent(providerContext?.persona, 30).toLowerCase();
  if (persona !== "copilot") return false;
  if (providerContext?.live_data_required === true) return false;
  if (!safeExternalClassification(providerContext)) return false;

  const prompt = latestUserMessage(messages);
  if (!prompt || prompt.length > PUBLIC_SAFE_SOCIAL_MAX_LENGTH) return false;
  if (hasPrivateBusinessSignal(prompt)) return false;
  if (PUBLIC_SAFE_SOCIAL_PATTERN.test(prompt)) return true;

  return PUBLIC_SAFE_GREETING_PREFIX.test(prompt) && prompt.length <= 100;
}

function isPublicSafeSystemTurn({ messages = [], providerContext = {} } = {}) {
  const persona = cleanMessageContent(providerContext?.persona, 30).toLowerCase();
  if (persona !== "copilot") return false;
  if (providerContext?.live_data_required === true) return false;
  if (!safeExternalClassification(providerContext)) return false;
  const prompt = latestUserMessage(messages);
  return Boolean(prompt && isChalinProductKnowledgeTurn(prompt));
}

function isPublicSafeGeneralTurn({ messages = [], providerContext = {} } = {}) {
  const persona = cleanMessageContent(providerContext?.persona, 30).toLowerCase();
  if (persona !== "copilot") return false;
  if (providerContext?.live_data_required === true) return false;
  if (!safeExternalClassification(providerContext)) return false;
  const prompt = latestUserMessage(messages);
  if (!prompt || prompt.length > PUBLIC_SAFE_GENERAL_MAX_LENGTH) return false;
  if (hasPrivateBusinessSignal(prompt)) return false;
  return true;
}

function publicSafeMessages(messages = [], instruction = PUBLIC_SAFE_GENERAL_INSTRUCTION) {
  const prompt = latestUserMessage(messages);
  if (!prompt) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ role: "system", content: instruction }),
    ...safePublicContinuityMessages(messages),
    Object.freeze({ role: "user", content: prompt }),
  ]);
}

function publicSafeSocialMessages(messages = []) {
  return publicSafeMessages(messages, PUBLIC_SAFE_COPILOT_INSTRUCTION);
}

function publicSafeSystemMessages(messages = []) {
  return productKnowledgeMessages(messages);
}

function withProviderTimeout(promise, timeoutMs, providerKey, onTimeout = null) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Timeout cleanup is best-effort and must not replace the controlled error.
      }
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

  const toolCalls = Array.isArray(result.tool_calls)
    ? result.tool_calls.slice(0, 20).map((call) => ({
        id: String(call?.id || "").slice(0, 120) || null,
        tool_key: String(call?.tool_key || call?.name || "").slice(0, 150),
        input: call?.input && typeof call.input === "object" ? call.input : {},
      }))
    : [];
  const rawText =
    String(result.text || "").trim() ||
    (toolCalls.length ? "Consulting governed CHALIN ONE tools." : "");
  const validated = validateProviderOutput(rawText);
  const inputTokens = Math.max(0, Number(result.input_tokens || 0));
  const outputTokens = Math.max(0, Number(result.output_tokens || 0));
  const costMicros = Math.max(0, Number(result.cost_micros || 0));

  return Object.freeze({
    text: validated.text,
    output_sha256: validated.output_sha256,
    redaction_count: validated.redaction_count,
    provider_key: providerKey,
    model_key: String(result.model_key || result.model || "unknown").slice(0, 160),
    input_tokens: Number.isFinite(inputTokens) ? Math.floor(inputTokens) : 0,
    output_tokens: Number.isFinite(outputTokens) ? Math.floor(outputTokens) : 0,
    cost_micros: Number.isFinite(costMicros) ? Math.ceil(costMicros) : 0,
    finish_reason: String(result.finish_reason || "stop").slice(0, 80),
    tool_calls: Object.freeze(toolCalls),
    provider_response_id:
      String(result.provider_response_id || "").slice(0, 180) || null,
    reasoning_effort:
      String(result.reasoning_effort || "").slice(0, 20) || null,
    provider_store_enabled: result.provider_store_enabled === true,
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
      cost_micros: 0,
      finish_reason: "stop",
      tool_calls: [],
      provider_store_enabled: false,
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

function safeProviderSelection(selection) {
  if (!selection) return null;
  return Object.freeze({
    persona: selection.persona || null,
    profile_key: selection.profile_key || null,
    selected_provider: selection.selected_provider || null,
    selected_model: selection.selected_model || null,
    effective_provider: selection.effective_provider || null,
    effective_model: selection.effective_model || null,
    data_classification: selection.data_classification || null,
    reason_code: selection.reason_code || null,
    external_network_used: selection.external_network_used === true,
    full_context_requested: selection.full_context_requested === true,
    full_context_active: selection.full_context_active === true,
  });
}

async function generateProviderResponse({
  provider = null,
  providerKey = null,
  messages,
  tools = [],
  maxOutputTokens = 4000,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  providerContext = {},
  env = process.env,
} = {}) {
  let selection = null;
  let selected = provider;
  let effectiveProviderContext =
    providerContext && typeof providerContext === "object"
      ? { ...providerContext }
      : {};
  let effectiveMessages = Array.isArray(messages) ? messages : [];
  let effectiveTools = Array.isArray(tools) ? tools : [];

  const eligibleForPolicyRewrite = !selected && !providerKey;
  const publicSafeSocialTurn =
    eligibleForPolicyRewrite &&
    isPublicSafeSocialTurn({
      messages: effectiveMessages,
      providerContext: effectiveProviderContext,
    });
  const publicSafeSystemTurn =
    eligibleForPolicyRewrite &&
    !publicSafeSocialTurn &&
    isPublicSafeSystemTurn({
      messages: effectiveMessages,
      providerContext: effectiveProviderContext,
    });
  const publicSafeGeneralTurn =
    eligibleForPolicyRewrite &&
    !publicSafeSocialTurn &&
    !publicSafeSystemTurn &&
    isPublicSafeGeneralTurn({
      messages: effectiveMessages,
      providerContext: effectiveProviderContext,
    });

  if (publicSafeSocialTurn || publicSafeSystemTurn || publicSafeGeneralTurn) {
    effectiveMessages = publicSafeSocialTurn
      ? publicSafeSocialMessages(effectiveMessages)
      : publicSafeSystemTurn
        ? publicSafeSystemMessages(effectiveMessages)
        : publicSafeMessages(effectiveMessages);
    effectiveTools = [];
    effectiveProviderContext = {
      ...effectiveProviderContext,
      data_classification: "public",
      live_data_required: false,
      public_safe_social_turn: publicSafeSocialTurn,
      public_safe_system_turn: publicSafeSystemTurn,
      public_safe_general_turn: publicSafeGeneralTurn,
    };

    if (publicSafeGeneralTurn) {
      const enrichment = await enrichPublicSafeMessagesWithWeb({
        messages: effectiveMessages,
        env,
      });
      effectiveMessages = [...enrichment.messages];
      effectiveProviderContext = {
        ...effectiveProviderContext,
        public_web_search_attempted: enrichment.web_search.attempted === true,
        public_web_search_reason: enrichment.web_search.reason || null,
        public_web_search_result_count: Number(enrichment.web_search.result_count || 0),
        public_web_search_credits_used: enrichment.web_search.credits_used || null,
      };
    }
  }

  const toolRouting = selectRelevantProviderTools({
    messages: effectiveMessages,
    tools: effectiveTools,
  });
  effectiveTools = [...toolRouting.tools];
  effectiveProviderContext = {
    ...effectiveProviderContext,
    provider_tool_routing_mode: toolRouting.mode,
    provider_tool_original_count: toolRouting.original_count,
    provider_tool_selected_count: toolRouting.selected_count,
  };

  if (!selected && !providerKey) {
    selection = await resolveAiProviderSelection({
      providerContext: effectiveProviderContext,
      messages: effectiveMessages,
      env,
    });
    providerKey = selection.effective_provider;
    effectiveProviderContext = {
      ...effectiveProviderContext,
      persona: selection.persona,
      data_classification: selection.data_classification,
      provider_model_override: selection.effective_model,
      provider_selection_reason: selection.reason_code,
      full_context_active: selection.full_context_active === true,
    };
  }

  selected =
    selected ||
    aiProviderRegistry.create({ env, providerKey: providerKey || env.AI_PROVIDER });
  const key = cleanProviderKey(selected.key || providerKey || "disabled") || "disabled";
  const safeMessages = sanitizeProviderMessages(effectiveMessages);
  const safeTools = effectiveTools.slice(0, 80);
  const started = Date.now();
  const controller = new AbortController();

  try {
    const raw = await withProviderTimeout(
      Promise.resolve(
        selected.generate({
          messages: safeMessages,
          tools: safeTools,
          max_output_tokens: safePositiveInteger(maxOutputTokens, 4000, 32768),
          provider_context: Object.freeze(effectiveProviderContext),
          signal: controller.signal,
        })
      ),
      safePositiveInteger(timeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS, 90000),
      key,
      () => controller.abort()
    );
    return Object.freeze({
      ...normalizeProviderResult(raw, key),
      latency_ms: Date.now() - started,
      provider_selection: safeProviderSelection(selection),
    });
  } catch (error) {
    if (error instanceof AiProviderError || error instanceof AiSafetyError) {
      throw error;
    }
    if (String(error?.code || "").startsWith("AI_")) {
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
  PRIVATE_BUSINESS_MARKERS,
  PROVIDER_KEY_PATTERN,
  PUBLIC_SAFE_COPILOT_INSTRUCTION,
  PUBLIC_SAFE_GENERAL_INSTRUCTION,
  PUBLIC_SAFE_GENERAL_MAX_LENGTH,
  PUBLIC_SAFE_GREETING_PREFIX,
  PUBLIC_SAFE_SOCIAL_MAX_LENGTH,
  PUBLIC_SAFE_SOCIAL_PATTERN,
  SENSITIVE_LITERAL_MARKERS,
  aiProviderRegistry,
  cleanProviderKey,
  generateProviderResponse,
  hasPrivateBusinessSignal,
  isPublicSafeGeneralTurn,
  isPublicSafeSocialTurn,
  isPublicSafeSystemTurn,
  latestUserMessage,
  normalizeProviderResult,
  publicSafeMessages,
  publicSafeSocialMessages,
  publicSafeSystemMessages,
  safeExternalClassification,
  safePositiveInteger,
  safeProviderSelection,
  withProviderTimeout,
};
