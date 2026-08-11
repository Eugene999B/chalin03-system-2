"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PAYROLL_EXPERT_PACK,
  PAYROLL_RELEASE_COMMIT,
  expertPackForPrompt,
  getExpertPack,
  isPayrollExpertPrompt,
  payrollRuntimeAvailability,
  renderExpertPack,
} = require("../services/aiExpertPackService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeInstruction,
  productKnowledgeMessages,
} = require("../services/aiProductKnowledgeService");
const {
  buildRequestBudget,
} = require("../services/aiCostControlService");

test("Payroll expert pack captures the reviewed salary source-of-truth contract", () => {
  const pack = getExpertPack("people_employment_payroll", {
    includeAvailability: false,
  });
  assert.ok(pack);
  assert.equal(pack.verified_release_commit, PAYROLL_RELEASE_COMMIT);
  assert.equal(pack.authority, "verified_product_source_contract");
  assert.ok(pack.source_paths.includes("backend/services/payrollFoundationService.js"));
  assert.ok(pack.source_paths.includes("backend/services/payrollProcessingService.js"));

  const sourceFact = pack.facts.find(
    (fact) => fact.key === "salary_source_of_truth"
  );
  assert.ok(sourceFact);
  assert.match(sourceFact.statement, /payroll_compensation_profiles/i);
  assert.match(sourceFact.statement, /not stored.*worker_profiles/i);

  const onboarding = pack.facts.find(
    (fact) => fact.key === "atomic_initial_activation"
  );
  assert.ok(onboarding);
  assert.match(onboarding.statement, /one database transaction/i);

  const laterChanges = pack.facts.find(
    (fact) => fact.key === "later_salary_changes"
  );
  assert.ok(laterChanges);
  assert.match(laterChanges.statement, /cannot approve their own salary change/i);

  assert.equal(pack.boundaries.salary_is_not_worker_profile_column, true);
  assert.equal(pack.boundaries.later_salary_changes_require_independent_approval, true);
  assert.equal(pack.boundaries.expert_pack_is_product_knowledge_not_live_worker_data, true);
});

test("Payroll expert pack is selected only for Payroll/compensation product questions", () => {
  assert.equal(isPayrollExpertPrompt("How does CHALIN payroll work?"), true);
  assert.equal(isPayrollExpertPrompt("Explain salary changes in CHALIN"), true);
  assert.equal(isPayrollExpertPrompt("What does Audit Intelligence do?"), false);
  assert.equal(expertPackForPrompt("How does payroll work?")?.key, "people_employment_payroll");
  assert.equal(expertPackForPrompt("Explain Equipment Hire"), null);
});

test("deployment availability distinguishes verified design from this source tree", () => {
  const availability = payrollRuntimeAvailability();
  assert.ok([
    "available_in_current_source_tree",
    "partially_present_in_current_source_tree",
    "not_present_in_current_source_tree",
  ].includes(availability.status));
  assert.equal(availability.files.length, availability.expected_file_count);
  assert.equal(
    availability.present_file_count,
    availability.files.filter((item) => item.present).length
  );
  if (availability.status !== "available_in_current_source_tree") {
    assert.match(availability.warning || "", /do not claim.*executable here/i);
  }
});

test("Payroll product instruction injects the expert pack without affecting unrelated product questions", () => {
  const payrollInstruction = productKnowledgeInstruction(
    "Tell me how Payroll and worker salary work in CHALIN"
  );
  assert.match(payrollInstruction, /CHALIN source-derived expert pack: People, Employment & Payroll/);
  assert.match(payrollInstruction, /authoritative salary source/i);
  assert.match(payrollInstruction, /Verified operating (?:workflow|relationships\/workflow)/i);

  const auditInstruction = productKnowledgeInstruction(
    "Tell me about Audit Intelligence in CHALIN"
  );
  assert.doesNotMatch(auditInstruction, /source-derived expert pack: People, Employment & Payroll/i);
});

test("live worker salary questions stay out of the public product lane", () => {
  const liveQuestion = "Tell me the current salary of this worker";
  assert.equal(isLikelyLiveRecordRequest(liveQuestion), true);
  assert.equal(isChalinProductKnowledgeTurn(liveQuestion), false);

  const productQuestion = "Explain how CHALIN payroll salary changes work";
  assert.equal(isLikelyLiveRecordRequest(productQuestion), false);
  assert.equal(isChalinProductKnowledgeTurn(productQuestion), true);
});

test("public Payroll product transport remains bounded and carries no operational tools", () => {
  const messages = [
    { role: "user", content: "Explain the full CHALIN payroll workflow" },
  ];
  const transportMessages = productKnowledgeMessages(messages);
  assert.equal(transportMessages[0].role, "system");
  assert.match(transportMessages[0].content, /source-derived expert pack/i);

  const budget = buildRequestBudget({
    messages,
    tools: Array.from({ length: 50 }, (_, index) => ({
      key: `private.tool.${index}`,
      description: "x".repeat(4000),
      input_schema: { type: "object", properties: {} },
    })),
    env: { AI_REQUEST_TOKEN_LIMIT: "50000" },
  });
  assert.equal(budget.transport_profile, "product_knowledge");
  assert.ok(budget.estimated_input_tokens < 50000);
});

test("rendered Payroll pack never contains live employee records", () => {
  const rendered = renderExpertPack(PAYROLL_EXPERT_PACK);
  assert.match(rendered, /product\/workflow knowledge only/i);
  assert.match(rendered, /Never infer a live worker salary/i);
  assert.doesNotMatch(rendered, /phone number|employee@example|account number/i);
});
