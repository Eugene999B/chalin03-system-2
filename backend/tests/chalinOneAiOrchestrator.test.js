"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERSONA_INSTRUCTIONS,
  providerContextForTurn,
  providerMessages,
  sumProviderUsage,
} = require("../services/aiOrchestratorService");

test("persona instructions require deep synthesis while preserving evidence and execution boundaries", () => {
  for (const persona of ["copilot", "executive", "guide"]) {
    assert.match(PERSONA_INSTRUCTIONS[persona], /evidence/i);
    assert.match(PERSONA_INSTRUCTIONS[persona], /never claim/i);
  }
  assert.match(PERSONA_INSTRUCTIONS.copilot, /business intelligence partner/i);
  assert.match(PERSONA_INSTRUCTIONS.copilot, /raw operational snapshots into meaning/i);
  assert.match(PERSONA_INSTRUCTIONS.executive, /challenge the first explanation/i);
  assert.match(PERSONA_INSTRUCTIONS.executive, /risks, opportunities/i);
  assert.match(PERSONA_INSTRUCTIONS.guide, /published public evidence/i);
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

test("continuity memory is injected separately and explicitly has no evidence authority", () => {
  const messages = providerMessages({
    persona: "copilot",
    history: [],
    prompt: "Continue our inventory plan.",
    evidence: [],
    continuityMemory: [
      {
        memory_id: "M1",
        memory_role: "assistant",
        conversation_title: "Inventory Plan",
        created_at: "2026-08-09T10:00:00Z",
        content: "We discussed aging stock and reorder policy.",
      },
    ],
  });
  const continuity = messages.find(
    (message) => message.role === "system" && /continuity context/i.test(message.content)
  );
  assert.ok(continuity);
  assert.match(continuity.content, /never governed evidence/i);
  assert.match(continuity.content, /may be wrong/i);
  assert.match(continuity.content, /Inventory Plan/);
});

test("tool result messages remain bounded while governed evidence stays in the evidence block", () => {
  const messages = providerMessages({
    persona: "copilot",
    history: [],
    prompt: "Search the knowledge base.",
    evidence: [
      {
        source_type: "knowledge.policy",
        source_ref: "policy",
        source_version: "1",
        label: "Policy",
        excerpt_text: "Governed policy evidence.",
        classification: "internal",
      },
    ],
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
  const evidenceMessage = messages.find(
    (message) => message.role === "system" && /Approved evidence/.test(message.content)
  );
  assert.ok(evidenceMessage);
  assert.match(evidenceMessage.content, /\[E1\]/);
  assert.match(evidenceMessage.content, /Governed policy evidence/);

  const toolMessage = messages.find((message) => message.role === "tool");
  assert.ok(toolMessage);
  const parsed = JSON.parse(toolMessage.content);
  assert.match(parsed.note, /Detailed source excerpts are in the approved evidence block/i);
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0].tool_key, "knowledge.search");
  assert.equal(parsed.results[0].output.result_count, 1);
  assert.equal(parsed.results[0].evidence_count, 1);
  assert.equal("evidence" in parsed.results[0], false);
  assert.equal("req" in parsed, false);
  assert.equal("pool" in parsed, false);
});

test("provider context exposes only hashed user reference plus governed persona and intent", () => {
  const context = providerContextForTurn({
    req: { user: { id: 42 } },
    persona: "executive",
    scope: { workspace_code: "spare_parts" },
    reasoningPlan: { intent: "diagnose", live_data_required: true },
  });
  assert.equal(context.persona, "executive");
  assert.equal(context.intent, "diagnose");
  assert.equal(context.live_data_required, true);
  assert.equal(context.workspace_code, "spare_parts");
  assert.match(context.safety_identifier, /^[a-f0-9]{64}$/);
  assert.notEqual(context.safety_identifier, "42");
  assert.notEqual(context.safety_identifier, String(42));
});

test("provider usage sums every round including metered cost", () => {
  const usage = sumProviderUsage([
    { input_tokens: 120, output_tokens: 40, latency_ms: 300, cost_micros: 95 },
    { input_tokens: 180, output_tokens: 70, latency_ms: 450, cost_micros: 155 },
  ]);
  assert.deepEqual(usage, {
    input_tokens: 300,
    output_tokens: 110,
    latency_ms: 750,
    cost_micros: 250,
  });
});
