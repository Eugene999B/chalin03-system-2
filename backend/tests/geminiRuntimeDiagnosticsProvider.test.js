"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GeminiRuntimeDiagnosticsProvider,
  boundedDetails,
  safeDiagnosticContext,
} = require("../ai-providers/geminiRuntimeDiagnosticsProvider");

function captureLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      info(message, metadata) {
        entries.push({ level: "info", message, metadata });
      },
      warn(message, metadata) {
        entries.push({ level: "warn", message, metadata });
      },
    },
  };
}

test("Gemini runtime diagnostics record only bounded metadata on success", async () => {
  const secret = "trial-secret-that-must-never-appear-in-diagnostics";
  const prompt = "private prompt text that must not be logged";
  const evidence = "customer evidence that must not be logged";
  const captured = captureLogger();
  let received = null;
  const provider = {
    async generate(input) {
      received = input;
      return {
        text: "Hello from Gemini.",
        model_key: "gemini-2.5-flash",
        input_tokens: 12,
        output_tokens: 5,
        finish_reason: "STOP",
        tool_calls: [],
      };
    },
  };
  const wrapped = new GeminiRuntimeDiagnosticsProvider({
    env: { GEMINI_API_KEY: secret, GEMINI_AI_MODEL: "gemini-2.5-flash" },
    provider,
    logger: captured.logger,
  });

  const input = {
    messages: [
      { role: "system", content: evidence },
      { role: "user", content: prompt },
    ],
    tools: [{ key: "inventory.health" }],
    provider_context: {
      persona: "copilot",
      data_classification: "public",
      public_safe_social_turn: true,
    },
  };
  const result = await wrapped.generate(input);

  assert.equal(result.text, "Hello from Gemini.");
  assert.equal(received, input);
  assert.equal(captured.entries.length, 2);
  assert.equal(captured.entries[0].message, "CHALIN AI Gemini provider request started");
  assert.equal(captured.entries[1].message, "CHALIN AI Gemini provider request completed");
  assert.match(captured.entries[0].metadata.trace_id, /^[0-9a-f-]{36}$/i);
  assert.equal(captured.entries[0].metadata.message_count, 2);
  assert.equal(captured.entries[0].metadata.tool_count, 1);
  assert.equal(captured.entries[0].metadata.persona, "copilot");
  assert.equal(captured.entries[0].metadata.data_classification, "public");
  assert.equal(captured.entries[1].metadata.input_tokens, 12);
  assert.equal(captured.entries[1].metadata.output_tokens, 5);

  const serialized = JSON.stringify(captured.entries);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(prompt), false);
  assert.equal(serialized.includes(evidence), false);
  assert.equal(serialized.includes("x-goog-api-key"), false);
});

test("Gemini runtime diagnostics preserve safe provider failure while logging code and latency", async () => {
  const captured = captureLogger();
  const failure = Object.assign(new Error("provider detail must not be logged"), {
    code: "AI_GEMINI_RESPONSE_FAILED",
    statusCode: 502,
    details: ["PERMISSION_DENIED"],
  });
  const wrapped = new GeminiRuntimeDiagnosticsProvider({
    env: { GEMINI_API_KEY: "safe-test-key-123456789012345", GEMINI_AI_MODEL: "gemini-2.5-flash" },
    provider: {
      async generate() {
        throw failure;
      },
    },
    logger: captured.logger,
  });

  await assert.rejects(
    wrapped.generate({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      provider_context: { persona: "copilot", data_classification: "public" },
    }),
    (error) => error === failure
  );

  assert.equal(captured.entries.length, 2);
  const failed = captured.entries[1];
  assert.equal(failed.level, "warn");
  assert.equal(failed.message, "CHALIN AI Gemini provider request failed");
  assert.equal(failed.metadata.error_code, "AI_GEMINI_RESPONSE_FAILED");
  assert.equal(failed.metadata.status_code, 502);
  assert.deepEqual(failed.metadata.details, ["PERMISSION_DENIED"]);
  assert.ok(failed.metadata.latency_ms >= 0);
  assert.equal(JSON.stringify(failed).includes("provider detail must not be logged"), false);
});

test("diagnostic helpers cap context and error detail without message bodies", () => {
  const context = safeDiagnosticContext({
    providerContext: {
      persona: "executive",
      data_classification: "confidential",
      public_safe_social_turn: false,
    },
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "secret" }],
    tools: [{ key: "one" }, { key: "two" }],
  });
  assert.deepEqual(context, {
    persona: "executive",
    data_classification: "confidential",
    public_safe_social_turn: false,
    model: "gemini-2.5-flash",
    message_count: 1,
    tool_count: 2,
  });
  assert.deepEqual(boundedDetails(["A", "B", "C", "D"]), ["A", "B", "C"]);
});
