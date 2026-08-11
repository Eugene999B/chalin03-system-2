"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EXPERT_PACKS,
  buildKnowledgeCurriculum,
  classifyExpertPack,
  expertPackCoverage,
  packsForWorkspace,
  suggestedSourceType,
} = require("../services/aiKnowledgeCurriculumService");
const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  registerFoundationAiTools,
} = require("../ai-tools/foundationTools");

function healthFixture() {
  return {
    generated_at: "2026-08-11T10:00:00.000Z",
    scope: { workspace_code: "spare_parts", mode: "workspace" },
    status: "needs_attention",
    gap_candidates: [
      {
        query: "Payroll termination procedure",
        miss_count: 3,
        workspace_code: "spare_parts",
        last_seen_at: "2026-08-11 09:00:00",
      },
      {
        query: "How should dead stock reorder quantities be decided?",
        miss_count: 1,
        workspace_code: "spare_parts",
        last_seen_at: "2026-08-10 09:00:00",
      },
    ],
    correction_review_queue: [
      {
        feedback_key: "feedback_123",
        rating: "incorrect",
        review_status: "new",
        workspace_code: "spare_parts",
        persona: "copilot",
        has_correction: true,
        created_at: "2026-08-11 08:00:00",
      },
    ],
    source_health: [
      {
        source_key: "spare_parts_sales_policy",
        title: "Spare Parts Sales Policy",
        source_type: "policy",
        owner_workspace_code: "spare_parts",
        health_state: "current",
      },
      {
        source_key: "old_returns_process",
        title: "Old Returns Process",
        source_type: "procedure",
        owner_workspace_code: "spare_parts",
        health_state: "expired",
      },
      {
        source_key: "customer_statement_guide",
        title: "Customer Statement Guide",
        source_type: "manual",
        owner_workspace_code: "spare_parts",
        health_state: "unpublished",
      },
    ],
  };
}

test("expert-pack classifier separates payroll and Spare Parts knowledge gaps", () => {
  assert.equal(
    classifyExpertPack("Payroll termination procedure", "spare_parts")?.key,
    "people_employment_payroll"
  );
  assert.equal(
    classifyExpertPack("dead stock and reorder quantity", "spare_parts")?.key,
    "spare_parts"
  );
  assert.equal(
    classifyExpertPack("fuel usage per mining shift", "mining")?.key,
    "mining"
  );
});

test("source-type suggestion is deterministic and does not publish anything", () => {
  assert.equal(suggestedSourceType("Payroll termination procedure"), "procedure");
  assert.equal(suggestedSourceType("User access policy"), "policy");
  assert.equal(suggestedSourceType("Equipment operating manual"), "manual");
  assert.equal(suggestedSourceType("Why do we do this?"), "faq");
});

test("curriculum prioritizes repeated gaps and keeps correction learning under review", () => {
  const curriculum = buildKnowledgeCurriculum(healthFixture());

  const payrollGap = curriculum.curriculum.find(
    (item) => item.kind === "knowledge_gap" && item.query === "Payroll termination procedure"
  );
  assert.ok(payrollGap);
  assert.equal(payrollGap.priority, "high");
  assert.equal(payrollGap.expert_pack, "people_employment_payroll");
  assert.equal(payrollGap.suggested_source_type, "procedure");
  assert.equal(payrollGap.auto_publish, false);

  const stockGap = curriculum.curriculum.find(
    (item) => /dead stock/i.test(item.query || "")
  );
  assert.ok(stockGap);
  assert.equal(stockGap.expert_pack, "spare_parts");

  const correction = curriculum.curriculum.find(
    (item) => item.kind === "correction_review"
  );
  assert.ok(correction);
  assert.equal(correction.priority, "high");
  assert.equal(correction.correction_text_included, false);
  assert.equal(correction.auto_publish, false);
  assert.equal(correction.recommended_action, "review_feedback_before_teaching");

  const expired = curriculum.curriculum.find(
    (item) => item.kind === "expired_source"
  );
  assert.ok(expired);
  assert.equal(expired.priority, "high");
  assert.equal(expired.recommended_action, "publish_replacement_or_archive_source");

  assert.equal(curriculum.governance.gap_detection_can_create_drafts, false);
  assert.equal(curriculum.governance.gap_detection_can_publish, false);
  assert.equal(curriculum.governance.correction_requires_review, true);
  assert.equal(
    curriculum.governance.organizational_truth_requires_governed_publication,
    true
  );
  assert.equal(
    curriculum.governance.expert_pack_topics_are_curriculum_targets_not_claimed_facts,
    true
  );

  const serialized = JSON.stringify(curriculum);
  assert.doesNotMatch(serialized, /actual correction text|secret correction/i);
});

test("expert-pack coverage claims only a source-key/title foundation, not topic completeness", () => {
  const pack = EXPERT_PACKS.find((item) => item.key === "spare_parts");
  const coverage = expertPackCoverage(pack, healthFixture().source_health);
  assert.equal(coverage.status, "foundation_present");
  assert.ok(coverage.current_source_count >= 1);
  assert.match(coverage.coverage_note, /Topic-level completeness still requires review/i);
});

test("workspace curriculum exposes only expert packs relevant to that workspace", () => {
  const mining = packsForWorkspace("mining").map((item) => item.key);
  assert.ok(mining.includes("mining"));
  assert.ok(mining.includes("people_employment_payroll"));
  assert.ok(mining.includes("audit_security"));
  assert.equal(mining.includes("spare_parts"), false);
  assert.equal(mining.includes("equipment_installment_finance"), false);
});

test("knowledge.curriculum is a Risk-1 governed read tool", () => {
  const registry = new AiToolRegistry();
  registerFoundationAiTools(registry);
  const tool = registry.list().find((item) => item.key === "knowledge.curriculum");
  assert.ok(tool);
  assert.equal(tool.risk_level, 1);
  assert.equal(tool.evidence_required, true);
  assert.deepEqual(tool.required_permissions, ["ai.use", "ai.knowledge.view"]);
  assert.deepEqual(tool.allowed_workspaces, []);
});

test("curriculum route is fixed before dynamic knowledge source route", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../routes/aiKnowledgeRoutes.js"),
    "utf8"
  );
  const curriculumIndex = source.indexOf('"/curriculum"');
  const sourceIndex = source.indexOf('"/:sourceId"');
  assert.ok(curriculumIndex >= 0);
  assert.ok(sourceIndex >= 0);
  assert.ok(curriculumIndex < sourceIndex);
  assert.match(source, /getKnowledgeCurriculum/);
});
