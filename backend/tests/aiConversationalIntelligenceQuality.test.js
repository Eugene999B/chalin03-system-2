"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  answerComposerPromptBlock,
  buildAnswerCompositionPlan,
  inferTemporalGuidance,
  isSocialConversationPrompt,
  userFacingAiFailureMessage,
} = require("../services/aiAnswerComposerService");
const {
  recentUtcWindow,
  withOperationsDefaultWindow,
} = require("../ai-tools/sparePartsTools");

const FIXED_NOW = new Date("2026-08-13T14:39:00.000Z");

test("Copilot social small talk is explicitly classified for concise natural answers", () => {
  assert.equal(isSocialConversationPrompt("hi"), true);
  assert.equal(isSocialConversationPrompt("how are you doing"), true);
  assert.equal(isSocialConversationPrompt("how is sales performance lately"), false);

  const plan = buildAnswerCompositionPlan({
    prompt: "how are you doing",
    providerContext: { persona: "copilot", live_data_required: false },
  });
  const block = answerComposerPromptBlock(plan);

  assert.equal(plan.social_conversation, true);
  assert.equal(plan.live_data_required, false);
  assert.match(block, /one or two short sentences/i);
  assert.match(block, /As an AI assistant/i);
  assert.match(block, /I do not get tired/i);
});

test("sales performance lately resolves to a live recent 30-day window with equal comparison", () => {
  const temporal = inferTemporalGuidance("how is sales performance lately", {
    now: FIXED_NOW,
  });

  assert.equal(temporal.requires_live_data, true);
  assert.deepEqual(temporal.period, {
    label: "recent 30 days",
    start_date: "2026-07-15",
    end_date: "2026-08-13",
    source: "explicit_relative",
    defaulted: false,
    comparison_start_date: "2026-06-15",
    comparison_end_date: "2026-07-14",
  });
});

test("sales PDF request without a period uses bounded recent live data instead of another clarification", () => {
  const prompt = "generate sales document for me in pdf";
  const temporal = inferTemporalGuidance(prompt, { now: FIXED_NOW });
  const plan = buildAnswerCompositionPlan({
    prompt,
    providerContext: { persona: "copilot" },
  });
  const block = answerComposerPromptBlock({
    ...plan,
    temporal,
    live_data_required: temporal.requires_live_data,
  });

  assert.equal(temporal.requires_live_data, true);
  assert.equal(temporal.operational_document_default, true);
  assert.equal(temporal.period.start_date, "2026-07-15");
  assert.equal(temporal.period.end_date, "2026-08-13");
  assert.match(block, /Do not stop to ask for one/i);
  assert.match(block, /2026-07-15 through 2026-08-13/);
  assert.match(block, /already-authorized workspace\/store/i);
});

test("Spare Parts performance defaults to recent 30 days while operations remains today", () => {
  assert.deepEqual(recentUtcWindow(FIXED_NOW), {
    start_date: "2026-07-15",
    end_date: "2026-08-13",
  });
  assert.deepEqual(withOperationsDefaultWindow("performance", {}, FIXED_NOW), {
    start_date: "2026-07-15",
    end_date: "2026-08-13",
  });
  assert.deepEqual(withOperationsDefaultWindow("operations", {}, FIXED_NOW), {
    start_date: "2026-08-13",
    end_date: "2026-08-13",
  });
  assert.deepEqual(
    withOperationsDefaultWindow(
      "performance",
      { start_date: "2026-08-01", end_date: "2026-08-05" },
      FIXED_NOW
    ),
    { start_date: "2026-08-01", end_date: "2026-08-05" }
  );
});

test("user-facing provider failures no longer expose the old one-pass phrasing", () => {
  const tokenMessage = userFacingAiFailureMessage({
    code: "AI_REQUEST_TOKEN_LIMIT_EXCEEDED",
  });
  const timeoutMessage = userFacingAiFailureMessage({ code: "AI_PROVIDER_TIMEOUT" });

  assert.doesNotMatch(tokenMessage, /one pass/i);
  assert.doesNotMatch(timeoutMessage, /one pass/i);
  assert.match(tokenMessage, /conversation/i);
  assert.match(timeoutMessage, /conversation/i);
});
