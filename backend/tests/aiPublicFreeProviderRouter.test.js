"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
  GroqPublicFreeProvider,
  OpenRouterPublicFreeProvider,
} = require("../ai-providers/openAiCompatiblePublicFreeProvider");
const {
  GeminiResilientPublicRouterProvider,
  PUBLIC_FREE_FALLBACK_ORDER,
} = require("../ai-providers/geminiResilientPublicRouterProvider");

function publicInput(overrides = {}) {
  return {
    messages: [
      { role: "system", content: "Public CHALIN product knowledge only." },
      { role: "user", content: "Tell me more about CHALIN and its businesses" },
    ],
    tools: [],
    max_output_tokens: 1200,
    provider_context: {
      persona: "copilot",
      data_classification: "public",
      public_safe_system_turn: true,
    },
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function successResult(text, model = "stub-model") {
  return {
    text,
    model_key: model,
    input_tokens: 10,
    output_tokens: 20,
    cost_micros: 0,
    finish_reason: "stop",
    tool_calls: [],
    provider_response_id: null,
    provider_store_enabled: false,
  };
}

function stubProvider({ result = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    async generate(input) {
      calls.push(input);
      if (error) throw error;
      return result || successResult("ok");
    },
  };
}

function transientError(code, statusCode = 503) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

test("Groq public adapter uses official OpenAI-compatible chat endpoint and stays tool-free", async () => {
  const requests = [];
  const provider = new GroqPublicFreeProvider({
    env: {
      GROQ_API_KEY: "gsk_test_free_key_abcdefghijklmnopqrstuvwxyz",
      GROQ_AI_MODEL: "llama-3.3-70b-versatile",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        id: "groq-response",
        model: "llama-3.3-70b-versatile",
        choices: [{ message: { content: "Groq public answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 21, completion_tokens: 7 },
      });
    },
  });

  const result = await provider.generate(publicInput());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, GROQ_CHAT_COMPLETIONS_ENDPOINT);
  assert.match(requests[0].options.headers.Authorization, /^Bearer gsk_/);
  assert.equal(JSON.parse(requests[0].options.body).model, "llama-3.3-70b-versatile");
  assert.equal(result.text, "Groq public answer");
  assert.equal(result.model_key, "groq/llama-3.3-70b-versatile");
  assert.equal(result.cost_micros, 0);
  assert.deepEqual(result.tool_calls, []);
});

test("OpenRouter public adapter uses openrouter/free by default", async () => {
  const requests = [];
  const provider = new OpenRouterPublicFreeProvider({
    env: {
      OPENROUTER_API_KEY: "sk-or-v1-test-free-key-abcdefghijklmnopqrstuvwxyz",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        id: "openrouter-response",
        model: "some/free-model",
        choices: [{ message: { content: "OpenRouter public answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 30, completion_tokens: 9 },
      });
    },
  });

  const result = await provider.generate(publicInput());
  assert.equal(requests[0].url, OPENROUTER_CHAT_COMPLETIONS_ENDPOINT);
  assert.equal(JSON.parse(requests[0].options.body).model, "openrouter/free");
  assert.equal(requests[0].options.headers["X-OpenRouter-Title"], "CHALIN");
  assert.equal(result.text, "OpenRouter public answer");
  assert.equal(result.model_key, "openrouter/some/free-model");
});

test("free external adapters reject private or tool-bearing context before network access", async () => {
  let calls = 0;
  const provider = new GroqPublicFreeProvider({
    env: { GROQ_API_KEY: "gsk_test_free_key_abcdefghijklmnopqrstuvwxyz" },
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    () =>
      provider.generate(
        publicInput({
          provider_context: { persona: "copilot", data_classification: "internal" },
        })
      ),
    (error) => error.code === "AI_PUBLIC_FREE_PRIVATE_CONTEXT_BLOCKED"
  );
  await assert.rejects(
    () => provider.generate(publicInput({ tools: [{ key: "spare_parts.operations_snapshot" }] })),
    (error) => error.code === "AI_PUBLIC_FREE_PRIVATE_CONTEXT_BLOCKED"
  );
  assert.equal(calls, 0);
});

test("Gemini public router preserves Gemini when it succeeds", async () => {
  const gemini = stubProvider({ result: successResult("Gemini answer", "gemini-3.6-flash") });
  const groq = stubProvider({ result: successResult("Groq answer", "groq/model") });
  const local = stubProvider({ result: successResult("Local answer", "local") });
  const router = new GeminiResilientPublicRouterProvider({
    env: {},
    geminiProvider: gemini,
    groqProvider: groq,
    localProvider: local,
    logger: { info() {}, warn() {} },
  });

  const result = await router.generate(publicInput());
  assert.equal(result.text, "Gemini answer");
  assert.equal(gemini.calls.length, 1);
  assert.equal(groq.calls.length, 0);
  assert.equal(local.calls.length, 0);
});

test("Gemini quota failure falls through to Groq on public-safe turns", async () => {
  const gemini = stubProvider({ error: transientError("AI_GEMINI_REQUEST_FAILED", 429) });
  const groq = stubProvider({ result: successResult("Groq rescued answer", "llama-3.3-70b-versatile") });
  const openrouter = stubProvider({ result: successResult("OpenRouter answer", "openrouter/free") });
  const local = stubProvider({ result: successResult("Local answer", "local") });
  const router = new GeminiResilientPublicRouterProvider({
    env: {},
    geminiProvider: gemini,
    groqProvider: groq,
    openRouterProvider: openrouter,
    localProvider: local,
    logger: { info() {}, warn() {} },
  });

  const result = await router.generate(publicInput());
  assert.equal(result.text, "Groq rescued answer");
  assert.match(result.model_key, /^groq\//);
  assert.equal(gemini.calls.length, 1);
  assert.equal(groq.calls.length, 1);
  assert.equal(openrouter.calls.length, 0);
  assert.equal(local.calls.length, 0);
});

test("public router continues from Gemini to Groq to OpenRouter before Local", async () => {
  const gemini = stubProvider({ error: transientError("AI_GEMINI_NETWORK_FAILED", 502) });
  const groq = stubProvider({ error: transientError("AI_GROQ_REQUEST_FAILED", 429) });
  const openrouter = stubProvider({ result: successResult("OpenRouter rescued answer", "openrouter/free") });
  const local = stubProvider({ result: successResult("Local answer", "local") });
  const router = new GeminiResilientPublicRouterProvider({
    env: {},
    geminiProvider: gemini,
    groqProvider: groq,
    openRouterProvider: openrouter,
    localProvider: local,
    logger: { info() {}, warn() {} },
  });

  const result = await router.generate(publicInput());
  assert.equal(result.text, "OpenRouter rescued answer");
  assert.equal(gemini.calls.length, 1);
  assert.equal(groq.calls.length, 1);
  assert.equal(openrouter.calls.length, 1);
  assert.equal(local.calls.length, 0);
  assert.deepEqual(PUBLIC_FREE_FALLBACK_ORDER, ["gemini", "groq", "openrouter", "local"]);
});

test("Local is the final public-safe fallback when every external free provider is unavailable", async () => {
  const gemini = stubProvider({ error: transientError("AI_GEMINI_REQUEST_FAILED", 503) });
  const groq = stubProvider({ error: transientError("AI_GROQ_REQUEST_FAILED", 503) });
  const openrouter = stubProvider({ error: transientError("AI_OPENROUTER_REQUEST_FAILED", 503) });
  const local = stubProvider({ result: successResult("CHALIN Local answer", "chalin-local-governed-v1") });
  const router = new GeminiResilientPublicRouterProvider({
    env: {},
    geminiProvider: gemini,
    groqProvider: groq,
    openRouterProvider: openrouter,
    localProvider: local,
    logger: { info() {}, warn() {} },
  });

  const result = await router.generate(publicInput());
  assert.equal(result.text, "CHALIN Local answer");
  assert.match(result.model_key, /^local\//);
  assert.equal(local.calls.length, 1);
});

test("private Gemini traffic never falls through to Groq or OpenRouter", async () => {
  const gemini = stubProvider({ error: transientError("AI_GEMINI_REQUEST_FAILED", 429) });
  const groq = stubProvider({ result: successResult("must not run") });
  const openrouter = stubProvider({ result: successResult("must not run") });
  const local = stubProvider({ result: successResult("must not run") });
  const router = new GeminiResilientPublicRouterProvider({
    env: {},
    geminiProvider: gemini,
    groqProvider: groq,
    openRouterProvider: openrouter,
    localProvider: local,
    logger: { info() {}, warn() {} },
  });

  await assert.rejects(
    () =>
      router.generate(
        publicInput({
          provider_context: {
            persona: "copilot",
            data_classification: "internal",
            live_data_required: true,
          },
        })
      ),
    (error) => error.code === "AI_GEMINI_REQUEST_FAILED"
  );
  assert.equal(groq.calls.length, 0);
  assert.equal(openrouter.calls.length, 0);
  assert.equal(local.calls.length, 0);
});

test("tool-bearing Gemini traffic never uses external public fallbacks", async () => {
  const gemini = stubProvider({ error: transientError("AI_GEMINI_REQUEST_FAILED", 429) });
  const groq = stubProvider({ result: successResult("must not run") });
  const local = stubProvider({ result: successResult("must not run") });
  const router = new GeminiResilientPublicRouterProvider({
    env: {},
    geminiProvider: gemini,
    groqProvider: groq,
    localProvider: local,
    logger: { info() {}, warn() {} },
  });

  await assert.rejects(
    () =>
      router.generate(
        publicInput({
          tools: [{ key: "spare_parts.operations_snapshot", risk_level: 1 }],
        })
      ),
    (error) => error.code === "AI_GEMINI_REQUEST_FAILED"
  );
  assert.equal(groq.calls.length, 0);
  assert.equal(local.calls.length, 0);
});
