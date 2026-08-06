"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERSONA_INSTRUCTIONS,
  providerMessages,
  sumProviderUsage,
} = require("../services/aiOrchestratorService");

test("persona instructions prohibit operational execution and require evidence", () => {
  for (const persona of ["copilot", "executive", "guide"]) {
    assert.match(PERSONA_INSTRUCTIONS[persona], /evidence/i);
    assert.match(PERSONA_INSTRUCTIONS[persona], /never claim/i);
  }
  assert.match(PERSONA_INSTRUCTIONS.copilot, /active workspace/i);
  assert.match(PERSONA_INSTRUCTIONS.executive, /facts.*assumptions.*scenarios/i);
  assert.match(PERSONA_INSTRUCTIONS.guide, /public evidence/i);
});

test("provider message composition sends the current prompt exactly once", () => {
  const prompt = "Summarize the approved equipment hire policy.";
  const messages = providerMessages({
    persona: "copilot",
    history: [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ],
    prompt,
    evidence: [
      {
        source_type: "knowledge.policy",
        source_ref: "hire_policy",
        source_version: "1",
        label: "Hire Policy",
        excerpt_text: "Inspection is required before release.",
        classification: "internal",
      },
    ],
  });
  assert.equal(
    messages.filter((message) => message.content === prompt).length,
    1
  );
  assert.equal(messages.filter((message) => message.role === "system").length, 2);
  assert.match(messages[1].content, /\[E1\]/);
  assert.match(messages[1].content, /Inspection is required/);
});

test("tool result messages remain bounded to controlled output and evidence", () => {
  const messages = providerMessages({
    persona: "copilot",
    history: [],
    prompt: "Search the knowledge base.",
    evidence: [],
    toolResults: [
      {
        tool: { key: "knowledge.search" },
        output: { result_count: 1 },
        evidence: [
          {
            citation: "E1",
            source_type: "knowledge.policy",
            source_ref: "policy",
            label: "Policy",
          },
        ],
      },
    ],
  });
  const toolMessage = messages.find((message) => message.role === "tool");
  assert.ok(toolMessage);
  const parsed = JSON.parse(toolMessage.content);
  assert.equal(parsed.tool_key, "knowledge.search");
  assert.equal(parsed.output.result_count, 1);
  assert.equal(parsed.evidence[0].source_ref, "policy");
  assert.equal("req" in parsed, false);
  assert.equal("pool" in parsed, false);
});

test("provider usage sums every round instead of undercounting the final response", () => {
  const usage = sumProviderUsage([
    { input_tokens: 120, output_tokens: 40, latency_ms: 300 },
    { input_tokens: 180, output_tokens: 70, latency_ms: 450 },
  ]);
  assert.deepEqual(usage, {
    input_tokens: 300,
    output_tokens: 110,
    latency_ms: 750,
  });
});
