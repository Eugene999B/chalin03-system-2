"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTENT_STUDIO_AI_CLASSIFICATION,
  CONTENT_STUDIO_AI_MODEL_SCOPE,
  dashboardEvidence,
  hasStudioPermission,
  hasStudioScope,
  safeProviderSummary,
  studioAiMessages,
  studioProviderContext,
  websiteControlEvidence,
} = require("../services/contentStudioAiService");

function parseExcerpt(item) {
  return JSON.parse(item.excerpt_text);
}

test("Content Studio dashboard evidence is aggregate, internal and read-only", () => {
  const evidence = dashboardEvidence({
    pages: {
      total_pages: 12,
      draft_pages: 2,
      pages_in_review: 1,
      approved_pages: 1,
      scheduled_pages: 0,
      published_pages: 8,
      archived_pages: 0,
    },
    approvals: {
      total_approvals: 5,
      pending_approvals: 2,
      approved_requests: 2,
      rejected_requests: 1,
    },
    submissions: {
      total_submissions: 40,
      new_submissions: 4,
      submissions_in_review: 3,
      resolved_submissions: 33,
    },
    media: {
      total_media: 20,
      pending_media: 1,
      ready_media: 18,
      quarantined_media: 1,
    },
  });

  assert.equal(evidence.classification, "internal");
  assert.equal(evidence.workspace_code, "content_studio");
  assert.equal(evidence.metadata.aggregate_only, true);
  assert.equal(evidence.metadata.execution_authority, "read_only");
  const snapshot = parseExcerpt(evidence);
  assert.equal(snapshot.pages.draft, 2);
  assert.equal(snapshot.approvals.pending, 2);
  assert.equal(snapshot.submissions.new, 4);
  assert.equal(snapshot.media.quarantined, 1);
  assert.equal(JSON.stringify(snapshot).includes("email"), false);
  assert.equal(JSON.stringify(snapshot).includes("body_text"), false);
});

test("Website Control evidence exposes the real aggregate summary shape only", () => {
  const evidence = websiteControlEvidence({
    generated_at: "2026-08-10T10:00:00.000Z",
    summary: {
      health_score: 82,
      total_pages: 10,
      published_pages: 8,
      healthy_pages: 7,
      attention_pages: 3,
      indexable_published_pages: 7,
      navigation_items: 14,
      orphan_pages: 1,
      canonical_conflicts: 1,
      redirect_candidates: 2,
      page_issues: { critical: 1, warning: 2, info: 1, total: 4 },
      navigation_issues: { critical: 0, warning: 1, info: 2, total: 3 },
    },
    pages: [{ title: "PRIVATE DRAFT BODY MUST NOT LEAK" }],
  });

  const snapshot = parseExcerpt(evidence);
  assert.equal(snapshot.health_score, 82);
  assert.equal(snapshot.attention_pages, 3);
  assert.equal(snapshot.navigation_items, 14);
  assert.equal(snapshot.orphan_page_count, 1);
  assert.equal(snapshot.canonical_conflict_count, 1);
  assert.equal(snapshot.redirect_candidate_count, 2);
  assert.equal(snapshot.page_issues.critical, 1);
  assert.equal(snapshot.navigation_issues.warning, 1);
  assert.equal(JSON.stringify(snapshot).includes("PRIVATE DRAFT BODY"), false);
});

test("Content Studio scope and permission helpers fail closed", () => {
  const user = {
    content_studio_scopes: ["dashboard"],
    effective_permissions: ["public_content.view"],
  };
  assert.equal(hasStudioScope(user, "dashboard"), true);
  assert.equal(hasStudioScope(user, "pages"), false);
  assert.equal(hasStudioPermission(user, "public_content.view"), true);
  assert.equal(hasStudioPermission(user, "public_content.publish"), false);
});

test("Studio provider context is internal Copilot and requires live data", () => {
  const context = studioProviderContext("decision_support");
  assert.equal(context.persona, "copilot");
  assert.equal(context.workspace_code, CONTENT_STUDIO_AI_MODEL_SCOPE);
  assert.equal(context.data_classification, CONTENT_STUDIO_AI_CLASSIFICATION);
  assert.equal(context.live_data_required, true);
  assert.equal(context.intent, "decision_support");
});

test("Studio messages prohibit write authority and require citations", () => {
  const evidence = [dashboardEvidence({})];
  const messages = studioAiMessages({
    question: "What needs attention?",
    evidence,
  });
  assert.equal(messages.at(-1).role, "user");
  assert.equal(messages.at(-1).content, "What needs attention?");
  assert.match(messages[0].content, /read-only governed publishing assistant/i);
  assert.match(messages[0].content, /Cite factual claims as \[E1\], \[E2\]/i);
  assert.match(messages[0].content, /Never claim to approve, publish, archive, edit/i);
  assert.match(messages[1].content, /Content Studio lifecycle health/);
});

test("Provider summary makes privacy fallback visible without secrets", () => {
  const summary = safeProviderSummary({
    selected_provider: "gemini",
    selected_model: "gemini-2.5-flash",
    effective_provider: "local",
    effective_model: "chalin-local-governed-v1",
    data_classification: "internal",
    reason_code: "AI_GEMINI_FREE_PRIVATE_DATA_LOCAL_FALLBACK",
    external_network_used: false,
  });
  assert.equal(summary.selected, "gemini");
  assert.equal(summary.effective, "local");
  assert.equal(summary.external_network_used, false);
  assert.equal(summary.data_classification, "internal");
  assert.equal(JSON.stringify(summary).includes("API_KEY"), false);
});
