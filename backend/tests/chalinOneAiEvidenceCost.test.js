"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiBudgetError,
  assertDailyUsage,
  assertMonthlyCost,
  assertToolCallBudget,
  buildRequestBudget,
  estimateTokens,
  getAiBudgetConfig,
} = require("../services/aiCostControlService");
const {
  AiEvidenceError,
  assertEvidenceRequired,
  evidenceCitationMap,
  evidencePromptBlock,
  normalizeEvidenceList,
} = require("../services/aiEvidenceService");

test("evidence is normalized, deduplicated and assigned stable citations", () => {
  const evidence = normalizeEvidenceList([
    {
      source_type: "knowledge.policy",
      source_ref: "hire_release",
      source_version: "2",
      label: "Hire Release Policy",
      excerpt_text: "Inspection must be completed.",
      classification: "internal",
    },
    {
      source_type: "knowledge.policy",
      source_ref: "hire_release",
      source_version: "2",
      label: "Duplicate",
      classification: "internal",
    },
    {
      source_type: "public_content.faq",
      source_ref: "public_hire_faq",
      label: "Public Hire FAQ",
      classification: "public",
    },
  ]);
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].citation, "E1");
  assert.equal(evidence[1].citation, "E2");
  assert.equal(evidenceCitationMap(evidence).E1.source_ref, "hire_release");
  assert.match(evidencePromptBlock(evidence), /\[E1\]/);
  assert.match(evidencePromptBlock(evidence), /\[E2\]/);
});

test("evidence redacts secret-looking excerpts", () => {
  const [item] = normalizeEvidenceList([
    {
      source_type: "knowledge.policy",
      source_ref: "redaction_test",
      label: "Redaction Test",
      excerpt_text: "password=should-never-leak",
      classification: "internal",
    },
  ]);
  assert.doesNotMatch(item.excerpt_text, /should-never-leak/);
  assert.equal(item.redaction_count, 1);
});

test("tools requiring evidence fail when none is returned", () => {
  assert.throws(
    () =>
      assertEvidenceRequired(
        { key: "knowledge.search", evidence_required: true },
        []
      ),
    (error) =>
      error instanceof AiEvidenceError &&
      error.code === "AI_TOOL_EVIDENCE_REQUIRED"
  );
  assert.deepEqual(
    assertEvidenceRequired(
      { key: "scope.summary", evidence_required: false },
      []
    ),
    []
  );
});

test("request budgets estimate tokens and preserve output allowance", () => {
  assert.equal(estimateTokens("12345678"), 2);
  const budget = buildRequestBudget({
    messages: [{ role: "user", content: "Small approved question" }],
    tools: [],
    env: {
      AI_REQUEST_TOKEN_LIMIT: "1000",
      AI_DAILY_USER_TOKEN_LIMIT: "2000",
      AI_DAILY_WORKSPACE_TOKEN_LIMIT: "5000",
      AI_MAX_TOOL_CALLS_PER_REQUEST: "4",
      AI_MONTHLY_COST_LIMIT_MICROS: "100000",
    },
  });
  assert.equal(budget.request_token_limit, 1000);
  assert.equal(budget.maximum_output_tokens > 0, true);
  assert.equal(budget.max_tool_calls, 4);
  assert.equal(budget.cost_enforcement_enabled, true);
});

test("oversized requests, tool loops, daily usage and monthly costs fail closed", () => {
  assert.throws(
    () =>
      buildRequestBudget({
        messages: [{ role: "user", content: "x".repeat(8000) }],
        env: { AI_REQUEST_TOKEN_LIMIT: "100" },
      }),
    (error) =>
      error instanceof AiBudgetError &&
      error.code === "AI_REQUEST_TOKEN_LIMIT_EXCEEDED"
  );

  const budget = getAiBudgetConfig({
    AI_REQUEST_TOKEN_LIMIT: "1000",
    AI_DAILY_USER_TOKEN_LIMIT: "100",
    AI_DAILY_WORKSPACE_TOKEN_LIMIT: "200",
    AI_MAX_TOOL_CALLS_PER_REQUEST: "2",
    AI_MONTHLY_COST_LIMIT_MICROS: "1000",
  });
  assert.throws(
    () => assertToolCallBudget(3, budget),
    (error) => error.code === "AI_TOOL_CALL_LIMIT_EXCEEDED"
  );
  assert.throws(
    () => assertDailyUsage({ userTokens: 100, workspaceTokens: 0, budget }),
    (error) => error.code === "AI_DAILY_USER_LIMIT_EXCEEDED"
  );
  assert.throws(
    () => assertDailyUsage({ userTokens: 0, workspaceTokens: 200, budget }),
    (error) => error.code === "AI_DAILY_WORKSPACE_LIMIT_EXCEEDED"
  );
  assert.throws(
    () => assertMonthlyCost({ usedMicros: 900, additionalMicros: 101, budget }),
    (error) => error.code === "AI_MONTHLY_COST_LIMIT_EXCEEDED"
  );
});

test("zero monthly cost limit keeps cost enforcement deliberately disabled", () => {
  const budget = getAiBudgetConfig({ AI_MONTHLY_COST_LIMIT_MICROS: "0" });
  assert.equal(budget.cost_enforcement_enabled, false);
  assert.doesNotThrow(() =>
    assertMonthlyCost({ usedMicros: 999999999, additionalMicros: 1, budget })
  );
});
