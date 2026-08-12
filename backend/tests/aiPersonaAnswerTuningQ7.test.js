"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERSONA_PRESENTATION_PROFILES,
  buildPersonaPresentationPlan,
  normalizePersona,
  personaPresentationPromptLines,
} = require("../services/aiPersonaPresentationService");
const {
  answerComposerPromptBlock,
  buildAnswerCompositionPlan,
} = require("../services/aiAnswerComposerService");
const {
  understandConversationTask,
} = require("../services/aiConversationTaskUnderstandingService");
const {
  buildCrossDomainReasoningGraph,
} = require("../services/aiCrossDomainReasoningGraphService");
const {
  buildReasoningPlan,
} = require("../services/aiReasoningService");
const {
  generateProviderResponse,
} = require("../services/aiProviderService");

function compositionForPersona(persona, prompt = "Things don't look good today. What's wrong?") {
  const reasoning = buildReasoningPlan({ prompt, persona });
  return buildAnswerCompositionPlan({
    prompt,
    taskUnderstanding: reasoning.task_understanding,
    reasoningGraph: reasoning.reasoning_graph,
    providerContext: {
      persona,
      intent: reasoning.intent,
      live_data_required: reasoning.live_data_required,
    },
  });
}

test("Q7 recognizes only Guide, Copilot and Executive presentation personas", () => {
  assert.equal(normalizePersona("guide"), "guide");
  assert.equal(normalizePersona("copilot"), "copilot");
  assert.equal(normalizePersona("executive"), "executive");
  assert.equal(normalizePersona("EXECUTIVE"), "executive");
  assert.equal(normalizePersona("unknown"), "copilot");
  assert.deepEqual(Object.keys(PERSONA_PRESENTATION_PROFILES).sort(), ["copilot", "executive", "guide"]);
});

test("Q7 personas share the same facts, objectives, live requirement and cross-domain reasoning", () => {
  const copilot = compositionForPersona("copilot");
  const executive = compositionForPersona("executive");
  const guide = compositionForPersona("guide");
  const plans = [copilot, executive, guide];

  for (const plan of plans) {
    assert.equal(plan.source_of_truth, false);
    assert.equal(plan.permission_authority, false);
    assert.equal(plan.execution_authority, false);
    assert.equal(plan.live_data_required, true);
    assert.equal(plan.cross_domain, true);
    assert.equal(plan.answer_first, true);
    assert.equal(plan.plain_language, true);
    assert.equal(plan.persona_presentation.source_of_truth, false);
    assert.equal(plan.persona_presentation.permission_authority, false);
    assert.equal(plan.persona_presentation.execution_authority, false);
    assert.equal(plan.persona_presentation.evidence_authority, false);
  }

  for (const plan of [executive, guide]) {
    assert.equal(plan.mode, copilot.mode);
    assert.deepEqual(plan.objectives, copilot.objectives);
    assert.deepEqual(plan.structure, copilot.structure);
    assert.deepEqual(plan.domains, copilot.domains);
    assert.deepEqual(plan.relationship_keys, copilot.relationship_keys);
    assert.equal(plan.live_data_required, copilot.live_data_required);
    assert.equal(plan.cross_domain, copilot.cross_domain);
  }

  assert.equal(copilot.persona, "copilot");
  assert.equal(executive.persona, "executive");
  assert.equal(guide.persona, "guide");
  assert.notEqual(copilot.persona_presentation.style_key, executive.persona_presentation.style_key);
  assert.notEqual(copilot.persona_presentation.style_key, guide.persona_presentation.style_key);
  assert.notEqual(executive.persona_presentation.style_key, guide.persona_presentation.style_key);
});

test("Q7 Copilot presentation is practical, conversational and concise", () => {
  const plan = compositionForPersona("copilot", "Explain how CHALIN payroll approval works.");
  const block = answerComposerPromptBlock(plan);

  assert.match(block, /CHALIN Copilot \(practical_conversation\)/i);
  assert.match(block, /natural, capable and practical/i);
  assert.match(block, /Prefer concise paragraphs/i);
  assert.match(block, /next move only when it is genuinely useful/i);
  assert.match(block, /Persona affects presentation only/i);
});

test("Q7 Executive presentation prioritizes business impact, risk and decisions", () => {
  const plan = compositionForPersona("executive");
  const block = answerComposerPromptBlock(plan);

  assert.match(block, /CHALIN Executive \(business_decision_brief\)/i);
  assert.match(block, /business bottom line and material impact/i);
  assert.match(block, /drivers, risks and opportunities/i);
  assert.match(block, /priority next move/i);
  assert.match(block, /main trade-off or risk/i);
  assert.match(block, /Persona affects presentation only/i);
});

test("Q7 Guide presentation teaches clearly without weakening evidence or safety", () => {
  const prompt = "Explain how CHALIN payroll approval works.";
  const task = understandConversationTask({ prompt });
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });
  const plan = buildAnswerCompositionPlan({
    prompt,
    taskUnderstanding: task,
    reasoningGraph: graph,
    providerContext: { persona: "guide", live_data_required: false },
  });
  const block = answerComposerPromptBlock(plan);

  assert.match(block, /CHALIN Guide \(clear_teaching\)/i);
  assert.match(block, /plain language without talking down/i);
  assert.match(block, /what it is, how it works/i);
  assert.match(block, /short example or numbered steps/i);
  assert.match(block, /avoid unexplained internal vocabulary/i);
  assert.match(block, /must not change facts, evidence requirements, conclusions, privacy, permissions, tool scope, action status or live-verification requirements/i);
  assert.doesNotMatch(block, /chain[-_ ]?of[-_ ]?thought/i);
});

test("Q7 persona prompt profiles remain bounded and non-authoritative", () => {
  for (const persona of ["copilot", "executive", "guide"]) {
    const profile = buildPersonaPresentationPlan(persona);
    const lines = personaPresentationPromptLines(profile);

    assert.equal(profile.persona, persona);
    assert.equal(profile.source_of_truth, false);
    assert.equal(profile.permission_authority, false);
    assert.equal(profile.execution_authority, false);
    assert.equal(profile.evidence_authority, false);
    assert.ok(lines.length <= 8);
    assert.ok(lines.every((line) => line.length <= 400));
    assert.ok(lines.some((line) => /presentation only/i.test(line)));
  }
});

test("Q7 provider boundary sends the selected persona composer contract without changing tool authority", async () => {
  for (const persona of ["copilot", "executive", "guide"]) {
    const captured = [];
    const provider = {
      key: `capture-${persona}`,
      async generate(input) {
        captured.push(input);
        return {
          text: "Payroll approval follows the governed CHALIN process.",
          model_key: "capture-v1",
          input_tokens: 2,
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
      messages: [{ role: "user", content: "Explain how CHALIN payroll approval works." }],
      tools: [],
      providerContext: {
        persona,
        data_classification: persona === "guide" ? "public" : "internal",
        live_data_required: false,
        intent: "explain",
      },
    });

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].tools, []);
    const composer = captured[0].messages.find(
      (message) => message.role === "system" && /universal answer-composer contract/i.test(message.content)
    );
    assert.ok(composer);
    assert.match(composer.content, new RegExp(`Persona presentation: CHALIN ${persona[0].toUpperCase()}${persona.slice(1)}`, "i"));
    assert.match(composer.content, /Persona affects presentation only/i);
    assert.equal(result.answer_composition.persona, persona);
    assert.equal(result.answer_composition.permission_authority, false);
    assert.equal(result.answer_composition.execution_authority, false);
  }
});

test("Q7 action answers keep the same governed status structure across every persona", () => {
  const task = {
    answer_mode: "action",
    objectives: ["Deactivate this user"],
    live_data_required: false,
    continuity_required: false,
    working_state: {},
  };
  const graph = { domains: ["audit_controls_security"], cross_domain: false, live_data_required: false };
  const structures = [];

  for (const persona of ["copilot", "executive", "guide"]) {
    const plan = buildAnswerCompositionPlan({
      prompt: "Deactivate this user",
      taskUnderstanding: task,
      reasoningGraph: graph,
      providerContext: { persona },
    });
    const block = answerComposerPromptBlock(plan);
    structures.push(plan.structure);
    assert.equal(plan.mode, "action");
    assert.match(block, /state truthfully whether the action is only proposed, awaiting review\/confirmation, blocked, or actually executed/i);
    assert.match(block, /Never imply execution from conversation alone/i);
  }

  assert.deepEqual(structures[1], structures[0]);
  assert.deepEqual(structures[2], structures[0]);
});
