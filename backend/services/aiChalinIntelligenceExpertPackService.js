"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CHALIN_INTELLIGENCE_SOURCE_BASE_COMMIT =
  "3ea2366d1d01db77b8f5c577e04948f4bcbe6f7b";

const CHALIN_INTELLIGENCE_RUNTIME_FILES = Object.freeze([
  "services/aiConversationTaskUnderstandingService.js",
  "services/aiConversationWorkingStateService.js",
  "services/aiCrossDomainReasoningGraphService.js",
  "services/aiAnswerComposerService.js",
  "services/aiResponseCriticService.js",
  "services/aiIntelligenceExamService.js",
  "services/aiPersonaPresentationService.js",
  "services/aiProviderPolicyService.js",
  "services/aiSystemKnowledgeManifestService.js",
  "services/aiKnowledgeCurriculumService.js",
  "services/aiActionProposalService.js",
]);

const CHALIN_INTELLIGENCE_EXPERT_PACK = Object.freeze({
  key: "chalin_intelligence",
  title: "CHALIN Intelligence & System Knowledge",
  version: "2026-08-12-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage:
    "chalin-one intelligence foundation, governed knowledge, provider privacy, Q1-Q7 quality stack and governed actions",
  verified_release_commit: CHALIN_INTELLIGENCE_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "backend/services/aiProductKnowledgeService.js",
    "backend/services/aiSystemKnowledgeManifestService.js",
    "backend/services/aiConversationTaskUnderstandingService.js",
    "backend/services/aiConversationWorkingStateService.js",
    "backend/services/aiCrossDomainReasoningGraphService.js",
    "backend/services/aiAnswerComposerService.js",
    "backend/services/aiResponseCriticService.js",
    "backend/services/aiIntelligenceExamService.js",
    "backend/services/aiPersonaPresentationService.js",
    "backend/services/aiProviderPolicyService.js",
    "backend/services/aiKnowledgeHealthService.js",
    "backend/services/aiKnowledgeCurriculumService.js",
    "backend/services/aiActionProposalService.js",
    "backend/ai-tools/foundationTools.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "system_product_knowledge_vs_live_truth",
      statement:
        "CHALIN keeps source-derived system/product knowledge separate from live operational truth. Static product context, the source-synchronized manifest and expert packs explain verified capabilities and workflows, but current sales, balances, payroll, customer, Mining, Hire, Finance, audit or other live business facts still require authorized governed evidence.",
      source_basis: Object.freeze([
        "aiProductKnowledgeService.productKnowledgeInstruction",
        "aiSystemKnowledgeManifestService.buildSystemKnowledgeManifest",
        "aiExpertPackService.renderExpertPack",
      ]),
    }),
    Object.freeze({
      key: "q1_task_understanding",
      statement:
        "Q1 creates a bounded structured task representation before routing, including answer mode, domains, objectives, evidence families, live-data need and continuity need. It is task metadata, not hidden chain-of-thought, evidence or permission authority.",
      source_basis: Object.freeze([
        "aiConversationTaskUnderstandingService.understandConversationTask",
      ]),
    }),
    Object.freeze({
      key: "q2_working_state",
      statement:
        "Q2 maintains bounded active conversation state for subject, domains, entities, periods, comparison periods, metrics, objectives, corrections, evidence references, last tool and pending-action status. The state explicitly declares itself not to be a source of truth; live facts must be verified again through governed reads when required.",
      source_basis: Object.freeze([
        "aiConversationWorkingStateService.buildConversationWorkingState",
        "aiConversationWorkingStateService.sanitizeConversationWorkingState",
      ]),
    }),
    Object.freeze({
      key: "q3_cross_domain_graph",
      statement:
        "Q3 builds an advisory cross-domain coverage graph that connects relevant business domains and evidence families for multi-domain questions. The graph can widen an investigation when semantic bridges justify it, but it is not source-of-truth, permission authority or execution authority.",
      source_basis: Object.freeze([
        "aiCrossDomainReasoningGraphService.buildCrossDomainReasoningGraph",
      ]),
    }),
    Object.freeze({
      key: "q4_answer_composer",
      statement:
        "Q4 applies one universal answer-composer contract after task/evidence routing so answers start with the conclusion, use plain business language, cover material objectives, preserve continuity and avoid exposing raw JSON, internal routing fields or transport-budget wording. The composer controls presentation only and cannot create evidence or authority.",
      source_basis: Object.freeze([
        "aiAnswerComposerService.buildAnswerCompositionPlan",
        "aiAnswerComposerService.answerComposerPromptBlock",
        "aiAnswerComposerService.userFacingAiFailureMessage",
      ]),
    }),
    Object.freeze({
      key: "q5_response_critic",
      statement:
        "Q5 deterministically reviews final textual answers for important quality failures such as internal implementation leakage, raw data dumps, missing compound objectives, undisclosed live-verification gaps and unsafe action-status wording. Tool-seeking rounds are not repaired; a final answer can receive at most one bounded zero-tool presentation repair, and scoring does not itself grant evidence or action authority.",
      source_basis: Object.freeze([
        "aiResponseCriticService.critiqueResponse",
        "aiProviderService.generateProviderResponse response-quality boundary",
      ]),
    }),
    Object.freeze({
      key: "q6_intelligence_exam",
      statement:
        "Q6 provides a permanent deterministic real-chat Intelligence Exam over the actual intelligence stack. It scores correctness, completeness, context retention, grounding, clarity, directness, routing, cross-domain reasoning, hallucination resistance, privacy and action safety, while privacy/authority/live-verification/action invariants are hard gates that cannot be averaged away.",
      source_basis: Object.freeze([
        "aiIntelligenceExamService.buildIntelligenceExamReport",
        "aiIntelligenceExamQ6.test permanent real-chat scenarios",
      ]),
    }),
    Object.freeze({
      key: "q7_persona_presentation",
      statement:
        "Q7 keeps one intelligence/evidence pipeline while tuning presentation for three personas: Copilot is practical and conversational, Executive emphasizes bottom line, impact, risk and priority, and Guide explains how things work clearly. Persona presentation is explicitly not source-of-truth, evidence authority, permission authority or execution authority.",
      source_basis: Object.freeze([
        "aiPersonaPresentationService.buildPersonaPresentationPlan",
        "aiAnswerComposerService.buildAnswerCompositionPlan",
      ]),
    }),
    Object.freeze({
      key: "provider_privacy_boundary",
      statement:
        "Provider policy separates public-safe reasoning from private CHALIN intelligence. Public-safe product/general turns may use eligible external providers without private records or business tools; private or live business requests stay on governed/private paths and external-provider selection cannot override the data-classification boundary.",
      source_basis: Object.freeze([
        "aiProviderPolicyService.resolveAiProviderSelection",
        "aiProviderService public-safe routing",
        "aiProductKnowledgeService.safePublicContinuityMessages",
      ]),
    }),
    Object.freeze({
      key: "governed_knowledge_learning",
      statement:
        "Knowledge health and curriculum can identify retrieval gaps, stale/unpublished sources and unresolved answer corrections, but gap detection cannot create or publish organizational truth automatically. Corrections require review before teaching and governed publication remains authoritative.",
      source_basis: Object.freeze([
        "aiKnowledgeHealthService.getKnowledgeHealthSnapshot",
        "aiKnowledgeCurriculumService.buildKnowledgeCurriculum",
      ]),
    }),
    Object.freeze({
      key: "governed_tools_and_actions",
      statement:
        "CHALIN distinguishes read tools from governed operational actions. Tools are registered with personas, permissions, workspace scope, risk and input/output limits; actions use registered definitions, payload integrity, evidence, risk ceilings, review and exact confirmation where required. The AI model does not receive direct database-write authority.",
      source_basis: Object.freeze([
        "aiToolRegistry.register",
        "aiActionProposalService.createActionProposal",
        "aiActionProposalService.assertDefinitionAuthority",
      ]),
    }),
    Object.freeze({
      key: "existing_system_status_surfaces",
      statement:
        "Current system/intelligence status should reuse the existing governed Risk-1 reads instead of a static expert pack: system.scope_summary explains active scope, system.ai_feature_status reports effective feature states without secrets, knowledge.health reports knowledge coverage/gaps, and knowledge.curriculum reports the governed teaching plan.",
      source_basis: Object.freeze([
        "foundationTools system.scope_summary",
        "foundationTools system.ai_feature_status",
        "foundationTools knowledge.health",
        "foundationTools knowledge.curriculum",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "reasoning_pipeline",
      path: "Understand Task -> Maintain Bounded Working State -> Plan/Cover Domains -> Retrieve Governed Evidence -> Reason -> Verify -> Compose -> Critique",
      interpretation:
        "Each layer has a separate responsibility. Structured task/state/graph/composer/critic metadata can guide reasoning and presentation but cannot replace governed evidence or authorization.",
    }),
    Object.freeze({
      key: "static_vs_live",
      path: "System/Product Question -> Source-Derived Manifest/Expert Pack -> Explanation | Current Business/Status Question -> Permission/Scope Check -> Governed Read Tool -> Evidence-Backed Answer",
      interpretation:
        "Static system knowledge explains verified design. Current figures or effective runtime status must come from the appropriate governed read when available.",
    }),
    Object.freeze({
      key: "public_safe_provider_routing",
      path: "Classify Data/Intent -> Public-Safe Context Minimization -> Eligible External/Local Reasoning | Private/Live Context -> Governed Private Path",
      interpretation:
        "External/free reasoning never receives private CHALIN business records merely because the user asks conversationally.",
    }),
    Object.freeze({
      key: "governed_learning",
      path: "Search/Answer Feedback -> Knowledge Health Gap -> Curriculum/Review -> Governed Source Draft/Review/Publication -> Approved Retrieval",
      interpretation:
        "Conversation feedback can reveal a learning need, but it does not silently become organizational truth.",
    }),
    Object.freeze({
      key: "governed_action",
      path: "User Intent -> Proposal -> Risk/Permission/Evidence Check -> Review -> Exact Confirmation when required -> Named Server Executor -> Receipt/Audit",
      interpretation:
        "Conversational fluency never bypasses action governance or turns a proposed action into an executed one.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Is the user asking how CHALIN is designed, or asking for current/live system or business status?",
    "Does the answer need current governed evidence rather than static source-derived system knowledge?",
    "Is short follow-up wording preserving the active subject/entity/period/metric without treating memory as fresh evidence?",
    "Does a cross-domain question need multiple evidence families while keeping permissions and objective-specific evidence isolated?",
    "Is a public/external provider path receiving only public-safe minimized context with no private business records?",
    "Is an answer exposing raw JSON, routing/transport terminology, unsupported live facts or incomplete compound objectives?",
    "Is persona presentation changing only style/emphasis rather than facts, permissions, evidence, tool scope or action status?",
    "Is a user correction being reviewed through governed learning rather than automatically promoted as truth?",
    "Is an operational action still in its actual proposal/review/confirmation/execution state?",
  ]),
  reasoning_rules: Object.freeze([
    "Use the source-derived system manifest and this pack for verified architecture/capability explanations, not as live operational evidence.",
    "For current feature state, active scope, knowledge health or curriculum, reuse the existing governed Risk-1 status tools instead of inventing a new status source.",
    "Working memory, task understanding, reasoning graphs, answer-composer plans, critic scores and exam scores are advisory metadata, not current business truth.",
    "Never send private/live CHALIN business evidence to a public/free external provider path.",
    "Do not expose hidden chain-of-thought; CHALIN stores bounded task/evidence state instead.",
    "Do not allow persona style to alter evidence requirements, permissions, conclusions, live-verification needs or action status.",
    "Do not treat a correction or knowledge gap as approved organizational truth before governed review/publication.",
    "Do not imply an action executed unless the governed server-side action lifecycle says it executed.",
    "When a technical transport/provider failure occurs, keep the user-facing response conversational and preserve the task rather than presenting internal budget/routing details as the answer.",
  ]),
  boundaries: Object.freeze({
    static_system_knowledge_is_not_live_business_truth: true,
    working_state_is_not_source_of_truth: true,
    reasoning_graph_is_not_permission_or_execution_authority: true,
    answer_composer_is_presentation_only: true,
    response_critic_does_not_create_evidence: true,
    intelligence_exam_is_not_operational_authority: true,
    persona_presentation_does_not_change_facts_or_permissions: true,
    external_public_safe_path_excludes_private_live_business_records: true,
    corrections_require_governed_review_before_teaching: true,
    ai_model_has_no_direct_database_write_authority: true,
    existing_status_tools_remain_runtime_authority: true,
    expert_pack_is_product_system_knowledge_not_live_status: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function chalinIntelligenceRuntimeAvailability() {
  const files = CHALIN_INTELLIGENCE_RUNTIME_FILES.map((relative) =>
    Object.freeze({
      path: `backend/${relative}`,
      present: fs.existsSync(runtimePath(relative)),
    })
  );
  const presentCount = files.filter((item) => item.present).length;
  const total = files.length;
  return Object.freeze({
    status:
      presentCount === total
        ? "available_in_current_source_tree"
        : presentCount === 0
          ? "not_present_in_current_source_tree"
          : "partially_present_in_current_source_tree",
    present_file_count: presentCount,
    expected_file_count: total,
    files: Object.freeze(files),
    warning:
      presentCount === total
        ? null
        : "The verified CHALIN Intelligence/System Knowledge contract is not fully present in this source tree. Explain only the source-verified components and do not claim a missing runtime component is active.",
  });
}

function isChalinIntelligenceExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  const explicit = /\b(?:chalin intelligence|chalin ai|chalin copilot|chalin executive|chalin guide|chalin system knowledge|chalin knowledge|chalin memory|chalin conversation|chalin provider|chalin tools?|chalin actions?|chalin document studio|intelligence exam|answer composer|response critic|working conversation state|cross-domain reasoning)\b/i;
  if (explicit.test(text)) return true;
  const chalinAnchor = /\bchalin(?:\s*03|\s*one)?\b/i.test(text);
  const intelligenceTopic = /\b(?:ai|intelligence|copilot|executive|guide|memory|conversation|knowledge|provider|privacy|tool|tools|action|actions|risk[- ]?[1-5]|document|pdf|excel|word|reasoning|answer|system architecture|how (?:does|do|is|are))\b/i.test(text);
  return chalinAnchor && intelligenceTopic;
}

function getChalinIntelligenceExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...CHALIN_INTELLIGENCE_EXPERT_PACK,
    deployment_availability: includeAvailability
      ? chalinIntelligenceRuntimeAvailability()
      : null,
  });
}

module.exports = {
  CHALIN_INTELLIGENCE_EXPERT_PACK,
  CHALIN_INTELLIGENCE_RUNTIME_FILES,
  CHALIN_INTELLIGENCE_SOURCE_BASE_COMMIT,
  chalinIntelligenceRuntimeAvailability,
  getChalinIntelligenceExpertPack,
  isChalinIntelligenceExpertPrompt,
  runtimePath,
};
