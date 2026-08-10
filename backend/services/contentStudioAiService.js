"use strict";

const {
  getContentStudioDashboard,
} = require("./contentStudioPageService");
const {
  getWebsiteControlIntelligence,
} = require("./contentStudioWebsiteControlService");
const {
  evidenceCitationMap,
  evidencePromptBlock,
  normalizeEvidenceList,
} = require("./aiEvidenceService");
const { generateProviderResponse } = require("./aiProviderService");
const {
  resolveAiProviderSelection,
} = require("./aiProviderPolicyService");
const { inspectPrompt } = require("./aiSafetyService");
const { citationIntegrity } = require("./aiReasoningService");

const CONTENT_STUDIO_AI_CLASSIFICATION = "internal";
const CONTENT_STUDIO_AI_MODEL_SCOPE = "content_studio";
const MAX_STUDIO_AI_QUESTION_LENGTH = 1800;
const STUDIO_AI_SYSTEM_INSTRUCTION =
  "You are CHALIN Content Studio Intelligence, a read-only governed publishing assistant. Use only the supplied Content Studio evidence. Cite factual claims as [E1], [E2]. Focus on editorial readiness, review backlog, publishing governance, website health, SEO and navigation issues that are present in the evidence. Do not invent page content, submission details, staff identities or approval actions. Never claim to approve, publish, archive, edit or otherwise change Content Studio state.";

class ContentStudioAiError extends Error {
  constructor(message, { code = "CONTENT_STUDIO_AI_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "ContentStudioAiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maximum = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function hasStudioScope(user = {}, scope) {
  return new Set(Array.isArray(user.content_studio_scopes) ? user.content_studio_scopes : []).has(scope);
}

function hasStudioPermission(user = {}, permission) {
  return new Set(Array.isArray(user.effective_permissions) ? user.effective_permissions : []).has(permission);
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dashboardEvidence(dashboard = {}) {
  const pages = dashboard.pages || {};
  const approvals = dashboard.approvals || {};
  const submissions = dashboard.submissions || {};
  const media = dashboard.media || {};
  const summary = Object.freeze({
    pages: Object.freeze({
      total: numberValue(pages.total_pages),
      draft: numberValue(pages.draft_pages),
      in_review: numberValue(pages.pages_in_review),
      approved: numberValue(pages.approved_pages),
      scheduled: numberValue(pages.scheduled_pages),
      published: numberValue(pages.published_pages),
      archived: numberValue(pages.archived_pages),
    }),
    approvals: Object.freeze({
      total: numberValue(approvals.total_approvals),
      pending: numberValue(approvals.pending_approvals),
      approved: numberValue(approvals.approved_requests),
      rejected: numberValue(approvals.rejected_requests),
    }),
    submissions: Object.freeze({
      total: numberValue(submissions.total_submissions),
      new: numberValue(submissions.new_submissions),
      in_review: numberValue(submissions.submissions_in_review),
      resolved: numberValue(submissions.resolved_submissions),
    }),
    media: Object.freeze({
      total: numberValue(media.total_media),
      pending: numberValue(media.pending_media),
      ready: numberValue(media.ready_media),
      quarantined: numberValue(media.quarantined_media),
    }),
  });
  return Object.freeze({
    source_type: "content_studio_snapshot",
    source_ref: "content_studio:dashboard:aggregate",
    source_version: "live-read-only-v1",
    label: "Content Studio lifecycle health",
    excerpt_text: JSON.stringify(summary),
    as_of_at: new Date().toISOString(),
    classification: CONTENT_STUDIO_AI_CLASSIFICATION,
    workspace_code: CONTENT_STUDIO_AI_MODEL_SCOPE,
    metadata: Object.freeze({ aggregate_only: true, execution_authority: "read_only" }),
  });
}

function websiteControlEvidence(control = {}) {
  const summary = control.summary || {};
  const pageIssues = summary.page_issues || {};
  const navigationIssues = summary.navigation_issues || {};
  const snapshot = Object.freeze({
    health_score: numberValue(summary.health_score),
    total_pages: numberValue(summary.total_pages),
    published_pages: numberValue(summary.published_pages),
    healthy_pages: numberValue(summary.healthy_pages),
    attention_pages: numberValue(summary.attention_pages),
    indexable_published_pages: numberValue(summary.indexable_published_pages),
    navigation_items: numberValue(summary.navigation_items),
    orphan_page_count: numberValue(summary.orphan_pages),
    canonical_conflict_count: numberValue(summary.canonical_conflicts),
    redirect_candidate_count: numberValue(summary.redirect_candidates),
    page_issues: Object.freeze({
      critical: numberValue(pageIssues.critical),
      warning: numberValue(pageIssues.warning),
      info: numberValue(pageIssues.info),
      total: numberValue(pageIssues.total),
    }),
    navigation_issues: Object.freeze({
      critical: numberValue(navigationIssues.critical),
      warning: numberValue(navigationIssues.warning),
      info: numberValue(navigationIssues.info),
      total: numberValue(navigationIssues.total),
    }),
  });
  return Object.freeze({
    source_type: "content_studio_snapshot",
    source_ref: "content_studio:website_control:aggregate",
    source_version: "live-read-only-v1",
    label: "Website Control publishing and SEO health",
    excerpt_text: JSON.stringify(snapshot),
    as_of_at: control.generated_at || new Date().toISOString(),
    classification: CONTENT_STUDIO_AI_CLASSIFICATION,
    workspace_code: CONTENT_STUDIO_AI_MODEL_SCOPE,
    metadata: Object.freeze({ aggregate_only: true, execution_authority: "read_only" }),
  });
}

async function buildContentStudioAiEvidence({ user } = {}) {
  if (!user?.id || String(user.workspace_code || "").toLowerCase() !== "content_studio") {
    throw new ContentStudioAiError("A Content Studio session is required for Studio intelligence.", {
      code: "CONTENT_STUDIO_AI_SESSION_REQUIRED",
      statusCode: 403,
    });
  }
  if (!hasStudioPermission(user, "public_content.view") || !hasStudioScope(user, "dashboard")) {
    throw new ContentStudioAiError("This Content Studio role cannot use dashboard intelligence.", {
      code: "CONTENT_STUDIO_AI_DASHBOARD_DENIED",
      statusCode: 403,
    });
  }

  const dashboard = await getContentStudioDashboard();
  const evidence = [dashboardEvidence(dashboard)];
  if (hasStudioScope(user, "pages")) {
    evidence.push(websiteControlEvidence(await getWebsiteControlIntelligence()));
  }
  return normalizeEvidenceList(evidence, { maximum: 4 });
}

function studioAiMessages({ question, evidence }) {
  return Object.freeze([
    Object.freeze({ role: "system", content: STUDIO_AI_SYSTEM_INSTRUCTION }),
    Object.freeze({
      role: "system",
      content: `Approved Content Studio evidence:\n${evidencePromptBlock(evidence)}`,
    }),
    Object.freeze({ role: "user", content: question }),
  ]);
}

function studioProviderContext(intent = "decision_support") {
  return Object.freeze({
    persona: "copilot",
    workspace_code: CONTENT_STUDIO_AI_MODEL_SCOPE,
    data_classification: CONTENT_STUDIO_AI_CLASSIFICATION,
    intent,
    live_data_required: true,
  });
}

function safeProviderSummary(result = {}) {
  const selection = result.provider_selection ||
    (result.selected_provider ? result : {});
  return Object.freeze({
    selected: selection.selected_provider || result.provider_key || "local",
    effective: selection.effective_provider || result.provider_key || "local",
    model: selection.effective_model || result.model_key || null,
    reason_code: selection.reason_code || null,
    external_network_used: selection.external_network_used === true,
    data_classification:
      selection.data_classification || CONTENT_STUDIO_AI_CLASSIFICATION,
  });
}

async function answerContentStudioAi({ user, question, env = process.env } = {}) {
  const rawQuestion = clean(question, MAX_STUDIO_AI_QUESTION_LENGTH);
  if (!rawQuestion) {
    throw new ContentStudioAiError("Enter a Content Studio intelligence question.", {
      code: "CONTENT_STUDIO_AI_QUESTION_REQUIRED",
    });
  }

  const inspection = inspectPrompt(rawQuestion, { allowHighRiskDiscussion: true });
  const evidence = await buildContentStudioAiEvidence({ user });
  const result = await generateProviderResponse({
    messages: studioAiMessages({ question: inspection.text, evidence }),
    tools: [],
    maxOutputTokens: 1000,
    providerContext: studioProviderContext("decision_support"),
    env,
  });

  const citations = citationIntegrity(result.text, evidence);
  if (!citations.valid) {
    throw new ContentStudioAiError(
      "CHALIN Content Studio Intelligence returned an unsupported evidence citation.",
      {
        code: "CONTENT_STUDIO_AI_CITATION_INVALID",
        statusCode: 502,
        details: citations.unsupported || [],
      }
    );
  }

  return Object.freeze({
    answer: result.text,
    evidence,
    citations: evidenceCitationMap(evidence),
    provider: safeProviderSummary(result),
    privacy: Object.freeze({
      classification: CONTENT_STUDIO_AI_CLASSIFICATION,
      aggregate_only: true,
      draft_body_content_shared: false,
      form_submission_content_shared: false,
      autonomous_write_authority: false,
    }),
  });
}

async function getContentStudioAiStatus({ user, env = process.env } = {}) {
  const evidence = await buildContentStudioAiEvidence({ user });
  const selection = await resolveAiProviderSelection({
    providerContext: studioProviderContext("status"),
    messages: [],
    env,
  });
  return Object.freeze({
    ready: true,
    evidence_count: evidence.length,
    pages_scope: hasStudioScope(user, "pages"),
    provider: safeProviderSummary(selection),
    execution_authority: "read_only",
    provider_call_performed: false,
  });
}

module.exports = {
  CONTENT_STUDIO_AI_CLASSIFICATION,
  CONTENT_STUDIO_AI_MODEL_SCOPE,
  ContentStudioAiError,
  MAX_STUDIO_AI_QUESTION_LENGTH,
  STUDIO_AI_SYSTEM_INSTRUCTION,
  answerContentStudioAi,
  buildContentStudioAiEvidence,
  dashboardEvidence,
  getContentStudioAiStatus,
  hasStudioPermission,
  hasStudioScope,
  safeProviderSummary,
  studioAiMessages,
  studioProviderContext,
  websiteControlEvidence,
};
