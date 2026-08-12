"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHALIN_INTELLIGENCE_EXPERT_PACK,
  CHALIN_INTELLIGENCE_RUNTIME_FILES,
  chalinIntelligenceRuntimeAvailability,
  getChalinIntelligenceExpertPack,
  isChalinIntelligenceExpertPrompt,
} = require("../services/aiChalinIntelligenceExpertPackService");
const {
  EXPERT_PACKS,
  expertPacksForPrompt,
  getExpertPack,
  listExpertPacks,
  renderExpertPack,
} = require("../services/aiExpertPackService");
const {
  CHALIN_PRODUCT_CONTEXT,
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeInstruction,
} = require("../services/aiProductKnowledgeService");
const {
  understandConversationTask,
} = require("../services/aiConversationTaskUnderstandingService");
const {
  buildCrossDomainReasoningGraph,
} = require("../services/aiCrossDomainReasoningGraphService");
const {
  buildPersonaPresentationPlan,
} = require("../services/aiPersonaPresentationService");
const {
  buildIntelligenceExamReport,
  buildIntelligenceScenarioResult,
  CRITICAL_INVARIANT_KEYS,
  INTELLIGENCE_DIMENSIONS,
} = require("../services/aiIntelligenceExamService");

function hasFact(pack, key) {
  return (pack.facts || []).some((fact) => fact.key === key);
}

function allCritical(value = true) {
  return Object.fromEntries(CRITICAL_INVARIANT_KEYS.map((key) => [key, value]));
}

function allDimensions(value = 100) {
  return Object.fromEntries(INTELLIGENCE_DIMENSIONS.map((key) => [key, value]));
}

test("K9 completes the eighth K1 curriculum expert-pack foundation", () => {
  const packs = listExpertPacks({ includeAvailability: false });
  assert.equal(Object.keys(EXPERT_PACKS).length, 8);
  assert.equal(packs.length, 8);
  assert.ok(packs.some((pack) => pack.key === "chalin_intelligence"));
  assert.equal(getExpertPack("chalin_intelligence", { includeAvailability: false }).title, "CHALIN Intelligence & System Knowledge");
});

test("K9 source-derived pack explains Q1-Q7 and keeps every intelligence layer non-authoritative", () => {
  const pack = getChalinIntelligenceExpertPack({ includeAvailability: false });
  for (const key of [
    "system_product_knowledge_vs_live_truth",
    "q1_task_understanding",
    "q2_working_state",
    "q3_cross_domain_graph",
    "q4_answer_composer",
    "q5_response_critic",
    "q6_intelligence_exam",
    "q7_persona_presentation",
    "provider_privacy_boundary",
    "governed_knowledge_learning",
    "governed_tools_and_actions",
    "existing_system_status_surfaces",
  ]) {
    assert.equal(hasFact(pack, key), true, key);
  }

  assert.equal(pack.boundaries.static_system_knowledge_is_not_live_business_truth, true);
  assert.equal(pack.boundaries.working_state_is_not_source_of_truth, true);
  assert.equal(pack.boundaries.reasoning_graph_is_not_permission_or_execution_authority, true);
  assert.equal(pack.boundaries.answer_composer_is_presentation_only, true);
  assert.equal(pack.boundaries.response_critic_does_not_create_evidence, true);
  assert.equal(pack.boundaries.intelligence_exam_is_not_operational_authority, true);
  assert.equal(pack.boundaries.persona_presentation_does_not_change_facts_or_permissions, true);
  assert.equal(pack.boundaries.external_public_safe_path_excludes_private_live_business_records, true);
  assert.equal(pack.boundaries.corrections_require_governed_review_before_teaching, true);
  assert.equal(pack.boundaries.ai_model_has_no_direct_database_write_authority, true);
  assert.equal(pack.boundaries.existing_status_tools_remain_runtime_authority, true);
});

test("K9 current-source availability verifies the Q1-Q7 and governance runtime files", () => {
  const availability = chalinIntelligenceRuntimeAvailability();
  assert.equal(CHALIN_INTELLIGENCE_RUNTIME_FILES.length >= 11, true);
  assert.equal(availability.status, "available_in_current_source_tree");
  assert.equal(availability.present_file_count, availability.expected_file_count);
  assert.equal(availability.warning, null);
});

test("K9 selects CHALIN system/intelligence questions without leaking into unrelated domain prompts", () => {
  for (const prompt of [
    "How does CHALIN Intelligence work?",
    "Explain CHALIN Copilot memory and working state.",
    "What is the CHALIN Intelligence Exam?",
    "How do CHALIN AI actions and Risk-5 confirmation work?",
    "What is the difference between CHALIN Guide, Copilot and Executive?",
    "How does CHALIN keep private business data away from public AI providers?",
  ]) {
    assert.equal(isChalinIntelligenceExpertPrompt(prompt), true, prompt);
    assert.ok(expertPacksForPrompt(prompt).some((pack) => pack.key === "chalin_intelligence"), prompt);
  }

  for (const prompt of [
    "Why is Mining production low today?",
    "How much does Kwame owe us?",
    "Explain payroll salary changes.",
    "Why are Hire collections overdue?",
  ]) {
    assert.equal(isChalinIntelligenceExpertPrompt(prompt), false, prompt);
  }
});

test("K9 product lane injects the system pack for architecture questions", () => {
  const prompt = "Explain how CHALIN Intelligence remembers context, reasons across domains and keeps actions safe.";
  assert.equal(isChalinProductKnowledgeTurn(prompt), true);
  const instruction = productKnowledgeInstruction(prompt);
  assert.match(instruction, /CHALIN source-derived expert pack: CHALIN Intelligence & System Knowledge/i);
  assert.match(instruction, /Q1 creates a bounded structured task representation/i);
  assert.match(instruction, /Q2 maintains bounded active conversation state/i);
  assert.match(instruction, /Q3 builds an advisory cross-domain coverage graph/i);
  assert.match(instruction, /Q4 applies one universal answer-composer contract/i);
  assert.match(instruction, /Q5 deterministically reviews final textual answers/i);
  assert.match(instruction, /Q6 provides a permanent deterministic real-chat Intelligence Exam/i);
  assert.match(instruction, /Q7 keeps one intelligence\/evidence pipeline/i);
  assert.match(instruction, /not live runtime or business evidence/i);
});

test("K9 distinguishes static system design from current runtime status and live business facts", () => {
  const staticPrompt = "How does CHALIN's knowledge curriculum work?";
  const currentStatusPrompts = [
    "Which CHALIN AI features are enabled right now?",
    "What is my active CHALIN intelligence scope right now?",
    "What is CHALIN knowledge health currently?",
    "What should CHALIN learn next from the current knowledge gaps?",
  ];
  const liveBusinessPrompt = "How much did Main Store sell today?";

  assert.equal(isChalinProductKnowledgeTurn(staticPrompt), true);
  for (const prompt of currentStatusPrompts) {
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
  assert.equal(isLikelyLiveRecordRequest(liveBusinessPrompt), true);
  assert.equal(isChalinProductKnowledgeTurn(liveBusinessPrompt), false);
});

test("K9 keeps current system-status reads on existing governed tool families rather than creating status truth in the pack", () => {
  const pack = getChalinIntelligenceExpertPack({ includeAvailability: false });
  const fact = pack.facts.find((item) => item.key === "existing_system_status_surfaces");
  assert.match(fact.statement, /system\.scope_summary/i);
  assert.match(fact.statement, /system\.ai_feature_status/i);
  assert.match(fact.statement, /knowledge\.health/i);
  assert.match(fact.statement, /knowledge\.curriculum/i);
  assert.equal(pack.boundaries.existing_status_tools_remain_runtime_authority, true);
  assert.equal(pack.boundaries.expert_pack_is_product_system_knowledge_not_live_status, true);
});

test("K9 remains aligned with Q1 chalin_product classification and Q3 advisory authority separation", () => {
  const task = understandConversationTask({
    prompt: "Explain how CHALIN Intelligence works and why its memory is not live evidence.",
  });
  const graph = buildCrossDomainReasoningGraph({ taskUnderstanding: task });

  assert.ok(task.domains.includes("chalin_product"));
  assert.equal(task.live_data_required, false);
  assert.equal(graph.source_of_truth, false);
  assert.equal(graph.permission_authority, false);
  assert.equal(graph.execution_authority, false);
});

test("K9 persona explanation matches Q7 presentation-only contracts", () => {
  const copilot = buildPersonaPresentationPlan("copilot");
  const executive = buildPersonaPresentationPlan("executive");
  const guide = buildPersonaPresentationPlan("guide");
  for (const profile of [copilot, executive, guide]) {
    assert.equal(profile.source_of_truth, false);
    assert.equal(profile.permission_authority, false);
    assert.equal(profile.execution_authority, false);
    assert.equal(profile.evidence_authority, false);
  }
  assert.equal(copilot.style_key, "practical_conversation");
  assert.equal(executive.style_key, "business_decision_brief");
  assert.equal(guide.style_key, "clear_teaching");
});

test("K9 system knowledge can join the Q6 exam without weakening catastrophic invariants", () => {
  const scenario = buildIntelligenceScenarioResult({
    key: "k9_static_vs_live_system_truth",
    dimensions: allDimensions(100),
    criticalInvariants: allCritical(true),
  });
  const report = buildIntelligenceExamReport([scenario]);
  assert.equal(report.total_score, 100);
  assert.equal(report.critical_invariants_passed, true);
  assert.equal(report.pass, true);
});

test("K9 rendered pack never embeds secrets, live rows or hidden reasoning claims", () => {
  const rendered = renderExpertPack(getChalinIntelligenceExpertPack());
  assert.match(rendered, /source-derived CHALIN system\/intelligence knowledge only/i);
  assert.doesNotMatch(rendered, /api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=]|provider_response_id|raw_estimated_input_tokens/i);
  assert.doesNotMatch(rendered, /hidden chain-of-thought is stored|database rows included/i);
  assert.equal(CHALIN_PRODUCT_CONTEXT.includes("live company data"), true);
  assert.equal(CHALIN_INTELLIGENCE_EXPERT_PACK.verified_release_commit, "3ea2366d1d01db77b8f5c577e04948f4bcbe6f7b");
});
