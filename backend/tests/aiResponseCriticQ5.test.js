"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  critiqueResponse,
  objectiveCoverage,
  responseCriticRepairPrompt,
  shouldAutoRepairResponse,
} = require("../services/aiResponseCriticService");
const {
  generateProviderResponse,
  hasApprovedEvidence,
  hasGovernedToolResult,
} = require("../services/aiProviderService");

function composition(overrides = {}) {
  return {
    mode: "diagnosis",
    objectives: [
      "Why is Main Store profit lower today?",
      "Compare it with yesterday",
    ],
    live_data_required: false,
    cross_domain: false,
    anchors: {},
    ...overrides,
  };
}

test("Q5 critic passes a complete answer that covers compound objectives", () => {
  const answer = "Main Store profit is lower today because margin pressure increased. Compared with yesterday, profit is lower even though sales are higher.";
  const review = critiqueResponse({ answer, composition: composition() });

  assert.equal(review.needs_repair, false);
  assert.equal(review.passed, true);
  assert.equal(review.uncovered_objective_count, 0);
  assert.ok(review.score >= 90);
});

test("Q5 flags internal implementation wording and raw JSON as critical presentation failures", () => {
  const transport = critiqueResponse({
    answer: "This AI request is too large for the configured transport budget.",
    composition: composition({ objectives: ["Tell me more about CHALIN"] }),
  });
  const raw = critiqueResponse({
    answer: '{"tool_key":"spare_parts.snapshot","source_ref":"db:123"}',
    composition: composition({ objectives: ["What happened today?"] }),
  });

  assert.equal(transport.needs_repair, true);
  assert.ok(transport.issues.some((item) => item.key === "internal_implementation_leak"));
  assert.equal(raw.needs_repair, true);
  assert.ok(raw.issues.some((item) => item.key === "raw_internal_data_dump"));
});

test("Q5 requires an explicit limitation when live facts were not verified", () => {
  const review = critiqueResponse({
    answer: "Main Store profit is down because costs are higher.",
    composition: composition({
      objectives: ["Why is Main Store profit down today?"],
      live_data_required: true,
    }),
    liveToolsUsed: false,
  });

  assert.equal(review.needs_repair, true);
  assert.ok(review.issues.some((item) => item.key === "live_verification_not_disclosed"));

  const honest = critiqueResponse({
    answer: "I couldn't verify today's live profit data, so I can't confirm the cause yet. The useful next check is sales, margin and inventory cost movement.",
    composition: composition({
      objectives: ["Why is Main Store profit down today?"],
      live_data_required: true,
    }),
    liveToolsUsed: false,
  });
  assert.equal(honest.issues.some((item) => item.key === "live_verification_not_disclosed"), false);
});

test("Q5 keeps live-verification failure visible but does not waste a repair while read tools remain", async () => {
  const review = critiqueResponse({
    answer: "Captured routed tools.",
    composition: composition({
      objectives: ["Tell me today's sales and current customer debt at Main Store"],
      live_data_required: true,
    }),
    liveToolsUsed: false,
  });
  assert.equal(review.needs_repair, true);
  assert.equal(
    shouldAutoRepairResponse(review, { toolsAvailable: true, liveToolsUsed: false }),
    false
  );

  let calls = 0;
  const provider = {
    key: "liveroutingcapture",
    async generate() {
      calls += 1;
      return {
        text: "Captured routed tools.",
        model_key: "live-routing-v1",
        input_tokens: 3,
        output_tokens: 2,
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    },
  };

  const result = await generateProviderResponse({
    provider,
    messages: [{ role: "user", content: "Tell me today's sales and current customer debt at Main Store" }],
    tools: [
      {
        key: "spare_parts.operations_snapshot",
        title: "Spare Parts operations snapshot",
        description: "Read current sales profit inventory and operations evidence",
        risk_level: 1,
      },
    ],
    providerContext: {
      persona: "copilot",
      data_classification: "internal",
      live_data_required: true,
      workspace_code: "spare_parts",
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.quality_repair_rounds, 0);
  assert.equal(result.response_quality.needs_repair, true);
  assert.ok(
    result.response_quality.issues.some((item) => item.key === "live_verification_not_disclosed")
  );
});

test("Q5 action critic blocks conversational wording that implies ungoverned execution", () => {
  const review = critiqueResponse({
    answer: "I have deactivated the user.",
    composition: composition({
      mode: "action",
      objectives: ["Deactivate this user"],
      live_data_required: false,
    }),
  });

  assert.equal(review.needs_repair, true);
  assert.ok(review.issues.some((item) => item.key === "action_status_unclear"));
});

test("Q5 repair prompt preserves evidence and forbids new facts or action outcomes", () => {
  const critique = critiqueResponse({
    answer: '{"tool_key":"x"}',
    composition: composition({ objectives: ["Explain the result"] }),
  });
  const prompt = responseCriticRepairPrompt({
    answer: "Profit is down [E1].",
    critique,
    composition: composition({ objectives: ["Explain the result"] }),
  });

  assert.match(prompt, /Preserve supported meaning and existing valid \[E#\] citations/i);
  assert.match(prompt, /Do not add new business facts/i);
  assert.match(prompt, /never upgrade a proposal/i);
  assert.match(prompt, /Return only the repaired answer/i);
});

test("Q5 provider performs at most one tool-free repair for a bad final answer", async () => {
  const calls = [];
  const provider = {
    key: "criticcapture",
    async generate(input) {
      calls.push(input);
      if (calls.length === 1) {
        return {
          text: '{"tool_key":"internal.snapshot","source_ref":"db:secret"}',
          model_key: "critic-v1",
          input_tokens: 10,
          output_tokens: 5,
          cost_micros: 0,
          finish_reason: "stop",
          tool_calls: [],
          provider_store_enabled: false,
        };
      }
      return {
        text: "The result needs a business-level review before drawing a conclusion.",
        model_key: "critic-v1",
        input_tokens: 8,
        output_tokens: 6,
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    },
  };

  const result = await generateProviderResponse({
    provider,
    messages: [{ role: "user", content: "Explain the result" }],
    tools: [{ key: "knowledge.search", risk_level: 1 }],
    providerContext: { persona: "copilot", data_classification: "internal", live_data_required: false },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].tools, []);
  assert.equal(result.quality_repair_rounds, 1);
  assert.equal(result.response_quality.needs_repair, false);
  assert.doesNotMatch(result.text, /tool_key|source_ref/i);
  assert.equal(result.input_tokens, 18);
  assert.equal(result.output_tokens, 11);
});

test("Q5 never repairs a provider round that is still requesting governed tools", async () => {
  let calls = 0;
  const provider = {
    key: "toolcapture",
    async generate() {
      calls += 1;
      return {
        text: "Consulting governed CHALIN tools.",
        model_key: "tool-v1",
        input_tokens: 1,
        output_tokens: 1,
        cost_micros: 0,
        finish_reason: "tool_call",
        tool_calls: [{ id: "call-1", tool_key: "knowledge.search", input: { query: "test" } }],
        provider_store_enabled: false,
      };
    },
  };

  const result = await generateProviderResponse({
    provider,
    messages: [{ role: "user", content: "Investigate this" }],
    tools: [{ key: "knowledge.search", risk_level: 1 }],
    providerContext: { persona: "copilot", data_classification: "internal", live_data_required: false },
  });

  assert.equal(calls, 1);
  assert.equal(result.quality_repair_rounds, 0);
  assert.equal(result.response_quality.skipped, true);
  assert.equal(result.tool_calls.length, 1);
});

test("Q5 evidence and tool-result detection is server-message based", () => {
  const messages = [
    { role: "system", content: "Approved evidence: [E1] governed fact" },
    { role: "tool", content: "governed result" },
  ];
  assert.equal(hasApprovedEvidence(messages), true);
  assert.equal(hasGovernedToolResult(messages), true);

  const coverage = objectiveCoverage("sales today and profit yesterday", ["sales today", "profit yesterday"]);
  assert.equal(coverage.every((item) => item.covered), true);
});
