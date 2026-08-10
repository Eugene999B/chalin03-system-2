"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiInvestigationLoopError,
  DEFAULT_MAX_TOOL_ROUNDS,
  HARD_MAX_TOOL_ROUNDS,
  assertReadOnlyInvestigationTools,
  assertToolRound,
  canonicalJson,
  filterReadOnlyInvestigationTools,
  getInvestigationConfig,
  investigationPromptBlock,
  investigationSummary,
  toolCallIdentity,
} = require("../services/aiInvestigationLoopService");

function budget(maximumToolCalls = 8) {
  return {
    maximum_tool_calls: maximumToolCalls,
  };
}

test("investigation rounds default to three and are hard capped", () => {
  assert.deepEqual(getInvestigationConfig({}), {
    max_tool_rounds: DEFAULT_MAX_TOOL_ROUNDS,
    max_provider_rounds: DEFAULT_MAX_TOOL_ROUNDS + 1,
  });
  assert.deepEqual(
    getInvestigationConfig({ AI_MAX_TOOL_ROUNDS_PER_REQUEST: "99" }),
    {
      max_tool_rounds: HARD_MAX_TOOL_ROUNDS,
      max_provider_rounds: HARD_MAX_TOOL_ROUNDS + 1,
    }
  );
  assert.deepEqual(
    getInvestigationConfig({ AI_MAX_TOOL_ROUNDS_PER_REQUEST: "2" }),
    {
      max_tool_rounds: 2,
      max_provider_rounds: 3,
    }
  );
});

test("tool call identity is stable across object key ordering", () => {
  const left = toolCallIdentity({
    tool_key: "spare_parts.operations_snapshot",
    input: { end_date: "2026-08-10", start_date: "2026-08-01" },
  });
  const right = toolCallIdentity({
    tool_key: "spare_parts.operations_snapshot",
    input: { start_date: "2026-08-01", end_date: "2026-08-10" },
  });
  assert.equal(left, right);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("cumulative tool budget is enforced across rounds", () => {
  const first = assertToolRound({
    toolCalls: [
      { tool_key: "tool.one", input: { period: "current" } },
      { tool_key: "tool.two", input: {} },
    ],
    totalToolCalls: 0,
    toolRound: 1,
    budget: budget(3),
    config: getInvestigationConfig({}),
  });
  assert.equal(first.projected_total_tool_calls, 2);

  assert.throws(
    () =>
      assertToolRound({
        toolCalls: [
          { tool_key: "tool.three", input: {} },
          { tool_key: "tool.four", input: {} },
        ],
        totalToolCalls: 2,
        toolRound: 2,
        budget: budget(3),
        config: getInvestigationConfig({}),
      }),
    (error) => error.code === "AI_TOOL_CALL_LIMIT_EXCEEDED"
  );
});

test("identical tool calls are blocked across rounds but distinct periods are allowed", () => {
  const current = {
    tool_key: "spare_parts.operations_snapshot",
    input: { start_date: "2026-08-01", end_date: "2026-08-10" },
  };
  const prior = {
    tool_key: "spare_parts.operations_snapshot",
    input: { start_date: "2026-07-01", end_date: "2026-07-10" },
  };
  const first = assertToolRound({
    toolCalls: [current],
    totalToolCalls: 0,
    toolRound: 1,
    budget: budget(),
    config: getInvestigationConfig({}),
  });
  const seen = new Set(first.new_call_ids);

  assert.throws(
    () =>
      assertToolRound({
        toolCalls: [current],
        seenCallIds: seen,
        totalToolCalls: 1,
        toolRound: 2,
        budget: budget(),
        config: getInvestigationConfig({}),
      }),
    (error) => {
      assert.ok(error instanceof AiInvestigationLoopError);
      assert.equal(error.code, "AI_TOOL_CALL_LOOP_BLOCKED");
      return true;
    }
  );

  const second = assertToolRound({
    toolCalls: [prior],
    seenCallIds: seen,
    totalToolCalls: 1,
    toolRound: 2,
    budget: budget(),
    config: getInvestigationConfig({}),
  });
  assert.equal(second.projected_total_tool_calls, 2);
});

test("tool round limit is independent from total tool budget", () => {
  assert.throws(
    () =>
      assertToolRound({
        toolCalls: [{ tool_key: "tool.one", input: {} }],
        totalToolCalls: 1,
        toolRound: 4,
        budget: budget(8),
        config: getInvestigationConfig({ AI_MAX_TOOL_ROUNDS_PER_REQUEST: "3" }),
      }),
    (error) => error.code === "AI_TOOL_ROUND_LIMIT_EXCEEDED"
  );
});

test("autonomous investigation exposes only risk-one read tools", () => {
  const tools = [
    { key: "read.one", risk_level: 1 },
    { key: "read.zero", risk_level: 0 },
    { key: "prepare.two", risk_level: 2 },
    { key: "write.four", risk_level: 4 },
  ];
  const safe = filterReadOnlyInvestigationTools(tools);
  assert.deepEqual(
    safe.map((tool) => tool.key),
    ["read.one", "read.zero"]
  );
  assert.equal(assertReadOnlyInvestigationTools(safe), true);
  assert.throws(
    () => assertReadOnlyInvestigationTools(tools),
    (error) => error.code === "AI_INVESTIGATION_WRITE_TOOL_BLOCKED"
  );
});

test("investigation prompt tells the model to stop, avoid repeats and never write", () => {
  const prompt = investigationPromptBlock({
    config: getInvestigationConfig({}),
    toolRound: 1,
    totalToolCalls: 2,
  });
  assert.match(prompt, /at most 3 investigation rounds/i);
  assert.match(prompt, /Never repeat an identical tool call/i);
  assert.match(prompt, /Stop investigating once the evidence is sufficient/i);
  assert.match(prompt, /no autonomous write authority/i);
  assert.match(prompt, /final synthesis round no tools will be available/i);
});

test("investigation summary never grants autonomous write authority", () => {
  assert.deepEqual(
    investigationSummary({
      toolRounds: 2,
      totalToolCalls: 4,
      providerRounds: 3,
    }),
    {
      tool_rounds: 2,
      total_tool_calls: 4,
      provider_rounds: 3,
      duplicate_loop_blocked: false,
      autonomous_write_authority: false,
      bounded: true,
    }
  );
});
