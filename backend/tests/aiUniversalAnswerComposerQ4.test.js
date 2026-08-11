"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_COMPOSER_BLOCK,
  answerComposerPromptBlock,
  appendAnswerComposerInstruction,
  buildAnswerCompositionPlan,
  normalizeMode,
  userFacingAiFailureMessage,
} = require("../services/aiAnswerComposerService");
const {
  understandConversationTask,
} = require("../services/aiConversationTaskUnderstandingService");
const {
  buildCrossDomainReasoningGraph,
} = require("../services/aiCrossDomainReasoningGraphService");
const {
  generateProviderResponse,
} = require("../services/aiProviderService");

test("Q4 normalizes Q1 and reasoning intents into universal answer modes", () => {
  assert.equal(normalizeMode("direct_fact"), "direct_answer");
  assert.equal(normalizeMode("explanation"), "explanation");
  assert.equal(normalizeMode("diagnose"), "diagnosis");
  assert.equal(normalizeMode("comparison"), "comparison");
  assert.equal(normalizeMode("decision_support"), "decision_support");
  assert.equal(normalizeMode("executive_brief"), "executive_brief");
  assert.equal(normalizeMode("unknown_future_mode"), "direct_answer");
});

test("Q4 composer preserves diagnosis plus comparison objectives in one answer contract", () => {
  const task = understandConversationTask({
    prompt: "Main Store sales are higher today but profit is lower. What happened, and compare it with yesterday?",
  });
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });
  const plan = buildAnswerCompositionPlan({
    prompt: task.current_prompt,
    taskUnderstanding: task,
    reasoningGraph: graph,
    providerContext: { intent: "diagnose", live_data_required: true },
  });

  assert.equal(plan.mode, "diagnosis");
  assert.equal(plan.answer_first, true);
  assert.equal(plan.live_data_required, true);
  assert.equal(plan.objective_count, 2);
  assert.match(plan.objectives[0], /Main Store sales are higher today/i);
  assert.match(plan.objectives[1], /compare it with yesterday/i);
  assert.ok(plan.structure.includes("bottom line"));
  assert.ok(plan.structure.includes("alternative explanation"));
});

test("Q4 composer carries bounded working-state anchors without making them evidence", () => {
  const plan = buildAnswerCompositionPlan({
    prompt: "Profit?",
    taskUnderstanding: {
      answer_mode: "direct_fact",
      continuity_required: true,
      objectives: ["Profit?"],
      live_data_required: true,
      working_state: {
        subject: "Main Store sales today",
        entities: [{ type: "location", label: "Main Store", id: null }],
        periods: { active: ["today"], comparison: ["yesterday"] },
        metrics: ["sales", "profit"],
      },
    },
    reasoningGraph: { domains: ["spare_parts"], cross_domain: false },
  });

  assert.equal(plan.source_of_truth, false);
  assert.equal(plan.permission_authority, false);
  assert.equal(plan.execution_authority, false);
  assert.equal(plan.anchors.subject, "Main Store sales today");
  assert.deepEqual(plan.anchors.entities, ["Main Store"]);
  assert.deepEqual(plan.anchors.periods, ["today", "yesterday"]);
  assert.deepEqual(plan.anchors.metrics, ["sales", "profit"]);
});

test("Q4 prompt requires answer-first plain language and forbids raw internal dumps", () => {
  const block = answerComposerPromptBlock({
    mode: "diagnosis",
    objectives: ["Why is profit down?"],
    structure: ["bottom line", "main drivers", "next step"],
    live_data_required: true,
    cross_domain: true,
    anchors: { subject: "Main Store", entities: [], periods: ["today"], metrics: ["profit"] },
  });

  assert.ok(block.length <= MAX_COMPOSER_BLOCK);
  assert.match(block, /Start with the answer/i);
  assert.match(block, /Never dump raw JSON/i);
  assert.match(block, /transport budgets/i);
  assert.match(block, /Cover every material objective/i);
  assert.match(block, /presentation only/i);
  assert.doesNotMatch(block, /chain[- ]of[- ]thought/i);
});

test("Q4 composer instruction is inserted before the newest user request", () => {
  const messages = [
    { role: "system", content: "base" },
    { role: "user", content: "old" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "current" },
  ];
  const output = appendAnswerComposerInstruction(messages, {
    mode: "direct_answer",
    objectives: ["current"],
    structure: ["answer"],
    anchors: {},
  });

  assert.equal(output.at(-1).role, "user");
  assert.equal(output.at(-1).content, "current");
  assert.equal(output.at(-2).role, "system");
  assert.match(output.at(-2).content, /universal answer-composer contract/i);
});

test("Q4 provider boundary applies the composer to a cross-domain business answer", async () => {
  let captured = null;
  const provider = {
    key: "capture",
    async generate(input) {
      captured = input;
      return {
        text: "Main Store needs a combined profit and receivables review.",
        model_key: "capture-v1",
        input_tokens: 1,
        output_tokens: 1,
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    },
  };

  const result = await generateProviderResponse({
    provider,
    messages: [
      {
        role: "user",
        content: "Main Store profit is down today and customer debt is rising. Why?",
      },
    ],
    tools: [],
    providerContext: {
      persona: "executive",
      data_classification: "confidential",
      live_data_required: true,
      workspace_code: "spare_parts",
      intent: "diagnose",
    },
  });

  assert.ok(captured);
  const composer = captured.messages.find(
    (item) => item.role === "system" && /universal answer-composer contract/i.test(item.content)
  );
  assert.ok(composer);
  assert.match(composer.content, /Cross-domain synthesis: yes/i);
  assert.match(composer.content, /Live verification required: yes/i);
  assert.equal(result.answer_composition.mode, "diagnosis");
  assert.equal(result.answer_composition.cross_domain, true);
  assert.ok(result.answer_composition.domains.includes("spare_parts"));
  assert.ok(result.answer_composition.domains.includes("customer_accounting"));
});

test("Q4 internal transport and provider failures have plain user-facing fallbacks", () => {
  const oversized = userFacingAiFailureMessage({ code: "AI_REQUEST_TOKEN_LIMIT_EXCEEDED" });
  const timeout = userFacingAiFailureMessage({ code: "AI_PROVIDER_TIMEOUT" });

  for (const message of [oversized, timeout]) {
    assert.match(message, /conversation/i);
    assert.doesNotMatch(message, /transport budget|token limit|configured transport|provider timeout/i);
  }
});

test("Q4 CHALIN product explanation stays simple and non-live", () => {
  const task = understandConversationTask({
    prompt: "Tell me more about CHALIN and its businesses",
  });
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });
  const plan = buildAnswerCompositionPlan({
    prompt: task.current_prompt,
    taskUnderstanding: task,
    reasoningGraph: graph,
    providerContext: { persona: "copilot", live_data_required: false },
  });

  assert.equal(plan.mode, "explanation");
  assert.equal(plan.live_data_required, false);
  assert.equal(plan.objective_count, 1);
  assert.equal(plan.cross_domain, false);
});
