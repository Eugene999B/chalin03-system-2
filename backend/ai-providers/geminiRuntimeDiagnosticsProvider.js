"use strict";

const crypto = require("crypto");
const {
  GeminiGenerateContentProvider,
  modelForContext,
} = require("./geminiGenerateContentProvider");

function clean(value, maximum = 160) {
  return String(value ?? "").trim().slice(0, maximum);
}

function boundedDetails(details) {
  return (Array.isArray(details) ? details : [])
    .slice(0, 3)
    .map((value) => clean(value, 120))
    .filter(Boolean);
}

function safeDiagnosticContext({ providerContext = {}, model = null, messages = [], tools = [] } = {}) {
  return Object.freeze({
    persona: clean(providerContext?.persona, 30) || null,
    data_classification: clean(providerContext?.data_classification, 30) || null,
    public_safe_social_turn: providerContext?.public_safe_social_turn === true,
    model: clean(model, 160) || null,
    message_count: Array.isArray(messages) ? messages.length : 0,
    tool_count: Array.isArray(tools) ? tools.length : 0,
  });
}

class GeminiRuntimeDiagnosticsProvider {
  constructor({ env = process.env, provider = null, logger = console } = {}) {
    this.key = "gemini";
    this.env = env;
    this.provider = provider || new GeminiGenerateContentProvider({ env });
    this.logger = logger || console;
  }

  async generate(input = {}) {
    const traceId = crypto.randomUUID();
    const startedAt = Date.now();
    let model = null;
    try {
      model = modelForContext(this.env, input?.provider_context || {});
    } catch {
      model = null;
    }
    const diagnostic = safeDiagnosticContext({
      providerContext: input?.provider_context,
      model,
      messages: input?.messages,
      tools: input?.tools,
    });

    this.logger.info?.("CHALIN AI Gemini provider request started", {
      trace_id: traceId,
      ...diagnostic,
    });

    try {
      const result = await this.provider.generate(input);
      this.logger.info?.("CHALIN AI Gemini provider request completed", {
        trace_id: traceId,
        ...diagnostic,
        model: clean(result?.model_key || model, 160) || null,
        latency_ms: Date.now() - startedAt,
        finish_reason: clean(result?.finish_reason, 80) || null,
        input_tokens: Math.max(0, Number(result?.input_tokens || 0)),
        output_tokens: Math.max(0, Number(result?.output_tokens || 0)),
        tool_call_count: Array.isArray(result?.tool_calls) ? result.tool_calls.length : 0,
      });
      return result;
    } catch (error) {
      this.logger.warn?.("CHALIN AI Gemini provider request failed", {
        trace_id: traceId,
        ...diagnostic,
        latency_ms: Date.now() - startedAt,
        error_code: clean(error?.code || error?.name || "AI_GEMINI_UNKNOWN_FAILURE", 120),
        status_code: Number(error?.statusCode || 0) || null,
        details: boundedDetails(error?.details),
      });
      throw error;
    }
  }
}

module.exports = {
  GeminiRuntimeDiagnosticsProvider,
  boundedDetails,
  safeDiagnosticContext,
};
