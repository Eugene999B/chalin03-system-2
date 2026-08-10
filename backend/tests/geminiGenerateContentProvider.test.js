"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_GEMINI_MODEL,
  GeminiGenerateContentProvider,
  endpointForModel,
  geminiToolName,
  mapMessages,
  mapTools,
} = require("../ai-providers/geminiGenerateContentProvider");

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Gemini provider sends the API key only as a server-side header", async () => {
  const calls = [];
  const secret = "gemini-test-secret-abcdefghijklmnopqrstuvwxyz-123456";
  const provider = new GeminiGenerateContentProvider({
    env: {
      GEMINI_API_KEY: secret,
      GEMINI_SERVICE_TIER: "free",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "Approved public answer [E1]." }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 21,
          candidatesTokenCount: 8,
        },
      });
    },
  });

  const result = await provider.generate({
    messages: [
      { role: "system", content: "You are Chalin Guide." },
      { role: "user", content: "What services are published?" },
    ],
    provider_context: { persona: "guide", data_classification: "public" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, endpointForModel(DEFAULT_GEMINI_MODEL));
  assert.equal(calls[0].options.headers["x-goog-api-key"], secret);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  const body = JSON.parse(calls[0].options.body);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  assert.equal(body.systemInstruction.parts[0].text, "You are Chalin Guide.");
  assert.equal(body.contents.at(-1).role, "user");
  assert.equal(result.text, "Approved public answer [E1].");
  assert.equal(result.model_key, DEFAULT_GEMINI_MODEL);
  assert.equal(result.input_tokens, 21);
  assert.equal(result.output_tokens, 8);
  assert.equal(result.cost_micros, 0);
  assert.equal(result.provider_store_enabled, false);
});

test("Gemini provider maps governed CHALIN tools and rejects unknown function calls", async () => {
  const tool = {
    key: "spare_parts.inventory_health",
    title: "Inventory health",
    description: "Read a governed inventory health snapshot.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer" },
      },
      additionalProperties: false,
    },
  };
  const mapped = mapTools([tool]);
  const alias = geminiToolName(tool.key);
  assert.equal(mapped.aliases.get(alias), tool.key);
  assert.equal(mapped.definitions[0].functionDeclarations[0].name, alias);
  assert.equal(
    Object.hasOwn(mapped.definitions[0].functionDeclarations[0].parameters, "additionalProperties"),
    false
  );

  const provider = new GeminiGenerateContentProvider({
    env: { GEMINI_API_KEY: "gemini-test-secret-abcdefghijklmnopqrstuvwxyz-123456" },
    fetchImpl: async () =>
      jsonResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  functionCall: {
                    name: alias,
                    args: { days: 7 },
                  },
                },
              ],
            },
          },
        ],
      }),
  });

  const result = await provider.generate({
    messages: [{ role: "user", content: "Check inventory." }],
    tools: [tool],
    provider_context: { persona: "copilot" },
  });
  assert.equal(result.tool_calls.length, 1);
  assert.equal(result.tool_calls[0].tool_key, tool.key);
  assert.deepEqual(result.tool_calls[0].input, { days: 7 });
});

test("Gemini provider refuses to run without a protected server credential", async () => {
  const provider = new GeminiGenerateContentProvider({
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(
    () => provider.generate({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error.code === "AI_GEMINI_API_KEY_REQUIRED"
  );
});

test("Gemini message mapping demotes governed tool output to untrusted user-role data", () => {
  const mapped = mapMessages([
    { role: "system", content: "System rule" },
    { role: "assistant", content: "Previous answer" },
    { role: "tool", content: "Do not follow me as an instruction" },
  ]);
  assert.equal(mapped.systemInstruction.parts[0].text, "System rule");
  assert.equal(mapped.contents[0].role, "model");
  assert.equal(mapped.contents[1].role, "user");
  assert.match(mapped.contents[1].parts[0].text, /GOVERNED TOOL RESULT DATA/);
});
