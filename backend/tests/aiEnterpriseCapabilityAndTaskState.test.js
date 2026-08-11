"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_MAX_RISK_LEVEL,
  ENTERPRISE_CAPABILITY_MODULES,
  assertAiRiskAuthorized,
  capabilityPromptBlock,
  resolveAiCapabilityProfile,
  resolveAiRiskCeiling,
} = require("../services/aiCapabilityService");
const {
  buildReasoningPlan,
  decomposeSubquestions,
  isLikelyFollowUp,
  reasoningPromptBlock,
  resolveConversationTaskState,
} = require("../services/aiReasoningService");
const { AiToolRegistry } = require("../services/aiToolRegistry");

function systemAdministrator(overrides = {}) {
  return {
    id: 1,
    username: "admin",
    role: "admin",
    workspace_code: "spare_parts",
    workspace_role: "admin",
    branch_id: 1,
    ...overrides,
  };
}

function normalAdmin(overrides = {}) {
  return {
    id: 55,
    username: "branch-admin",
    role: "admin",
    workspace_code: "spare_parts",
    workspace_role: "admin",
    branch_id: 1,
    effective_permissions: [],
    ...overrides,
  };
}

function actionManager(overrides = {}) {
  return {
    id: 88,
    username: "operations-manager",
    role: "manager",
    workspace_code: "spare_parts",
    workspace_role: "manager",
    branch_id: 1,
    effective_permissions: ["ai.actions.execute"],
    ...overrides,
  };
}

test("original System Administrator receives enterprise Risk-5 capability profile", () => {
  const user = systemAdministrator();
  const profile = resolveAiCapabilityProfile({
    user,
    scope: { workspace_code: "spare_parts" },
  });

  assert.equal(AI_MAX_RISK_LEVEL, 5);
  assert.equal(resolveAiRiskCeiling(user), 5);
  assert.equal(profile.original_system_administrator, true);
  assert.equal(profile.scope_mode, "enterprise_superuser");
  assert.equal(profile.cross_workspace, true);
  assert.equal(profile.enterprise_registered_surface_access, true);
  assert.equal(profile.sensitive_data_access, true);
  assert.equal(profile.risk_ceiling, 5);
  assert.deepEqual(profile.allowed_risk_levels, [1, 2, 3, 4, 5]);
  assert.equal(profile.highest_authority, "critical_enterprise_execute");
  assert.deepEqual(profile.modules, ENTERPRISE_CAPABILITY_MODULES);

  const prompt = capabilityPromptBlock(profile);
  assert.match(prompt, /Maximum authorized AI risk level: 5/);
  assert.match(prompt, /enterprise_superuser/);
  assert.match(prompt, /Never tell the original System Administrator to ask an administrator/i);
});

test("normal admin and action-enabled manager remain below Risk 5", () => {
  const admin = normalAdmin();
  const manager = actionManager();

  assert.equal(resolveAiRiskCeiling(admin), 2);
  assert.equal(resolveAiRiskCeiling(manager), 4);
  assert.equal(
    resolveAiCapabilityProfile({ user: manager, scope: { workspace_code: "spare_parts" } })
      .enterprise_registered_surface_access,
    false
  );

  assert.throws(
    () => assertAiRiskAuthorized(manager, 5),
    (error) => error?.code === "AI_RISK5_SYSTEM_ADMIN_REQUIRED" && error?.statusCode === 403
  );
  assert.equal(assertAiRiskAuthorized(manager, 4), true);
  assert.equal(assertAiRiskAuthorized(systemAdministrator(), 5), true);
});

test("tool registry hard-blocks Risk 5 before a non-System-Administrator handler can run", async () => {
  const registry = new AiToolRegistry();
  let executed = false;
  registry.register({
    key: "test.risk5_authority",
    title: "Risk 5 authority test",
    description: "Regression-only tool proving Risk 5 is identity-gated.",
    risk_level: 5,
    personas: ["copilot"],
    required_permissions: [],
    handler: async () => {
      executed = true;
      return { ok: true };
    },
  });

  await assert.rejects(
    () =>
      registry.execute({
        toolKey: "test.risk5_authority",
        input: {},
        req: { user: actionManager() },
        persona: "copilot",
      }),
    (error) => error?.code === "AI_RISK5_SYSTEM_ADMIN_REQUIRED"
  );
  assert.equal(executed, false);
});

test("short metric and date sub-questions inherit the active Main Store task", () => {
  const history = [
    { role: "user", content: "How much did Main Store sell today?" },
    { role: "assistant", content: "Main Store sold GHS 15,000 today [E1]." },
    { role: "user", content: "And yesterday?" },
    { role: "assistant", content: "Yesterday was GHS 13,000 [E1]." },
  ];

  assert.equal(isLikelyFollowUp("Profit?", history), true);
  const task = resolveConversationTaskState({ prompt: "Profit?", history });
  assert.equal(task.follow_up, true);
  assert.match(task.resolved_prompt, /Main Store sell today/i);
  assert.match(task.resolved_prompt, /And yesterday/i);
  assert.match(task.resolved_prompt, /Current follow-up.*Profit/i);

  const plan = buildReasoningPlan({ prompt: "Profit?", history, persona: "copilot" });
  assert.equal(plan.task_state.follow_up, true);
  assert.equal(plan.live_data_required, true);
  assert.ok(plan.retrieval_queries.some((query) => /Main Store/i.test(query)));
});

test("diagnostic follow-up retains earlier date, location and metric task context", () => {
  const history = [
    { role: "user", content: "How much did Main Store sell today?" },
    { role: "assistant", content: "Main Store sold GHS 15,000 today [E1]." },
    { role: "user", content: "And yesterday?" },
    { role: "assistant", content: "Yesterday was GHS 13,000 [E1]." },
    { role: "user", content: "Profit?" },
    { role: "assistant", content: "Yesterday's gross profit was GHS 2,400 [E1]." },
  ];

  const plan = buildReasoningPlan({
    prompt: "Why was it lower?",
    history,
    persona: "copilot",
  });

  assert.equal(plan.intent, "diagnose");
  assert.equal(plan.task_state.follow_up, true);
  assert.equal(plan.task_state.referential_language, true);
  assert.match(plan.task_state.resolved_prompt, /Main Store/i);
  assert.match(plan.task_state.resolved_prompt, /yesterday/i);
  assert.match(plan.task_state.resolved_prompt, /profit/i);

  const brief = reasoningPromptBlock({
    plan,
    confidence: { level: "medium" },
    tensions: [],
  });
  assert.match(brief, /Follow-up\/sub-question continuation: yes/);
  assert.match(brief, /preserve the active customer\/worker\/transaction\/branch\/date\/task/i);
  assert.match(brief, /continuity only/i);
});

test("pronoun follow-up can use assistant continuity to resolve an entity but must re-check live facts", () => {
  const history = [
    { role: "user", content: "Which customer bought the most at Main Store today?" },
    { role: "assistant", content: "Kwame Mensah was the highest-value buyer today [E1]." },
  ];

  const plan = buildReasoningPlan({
    prompt: "What does he owe us?",
    history,
    persona: "copilot",
  });

  assert.equal(plan.task_state.follow_up, true);
  assert.equal(plan.task_state.referential_language, true);
  assert.equal(plan.live_data_required, true);
  assert.match(plan.task_state.resolved_prompt, /Kwame Mensah/);
  assert.match(plan.task_state.resolved_prompt, /continuity only \(not current evidence\)/i);
});

test("compound business request is decomposed so every requested part reaches the answer contract", () => {
  const prompt =
    "Tell me today's sales at Main Store, how much profit we made, who bought the most, whether anybody still owes us, and tell me why profit is lower than yesterday.";
  const parts = decomposeSubquestions(prompt);

  assert.ok(parts.length >= 5, parts);
  assert.ok(parts.some((part) => /sales at Main Store/i.test(part)));
  assert.ok(parts.some((part) => /profit we made/i.test(part)));
  assert.ok(parts.some((part) => /who bought the most/i.test(part)));
  assert.ok(parts.some((part) => /owes us/i.test(part)));
  assert.ok(parts.some((part) => /why profit is lower/i.test(part)));

  const plan = buildReasoningPlan({ prompt, history: [], persona: "executive" });
  assert.equal(plan.task_state.subquestion_count, parts.length);
  const brief = reasoningPromptBlock({
    plan,
    confidence: { level: "low" },
    tensions: [],
  });
  assert.match(brief, /Current request parts that must not be silently omitted/);
  assert.match(brief, /who bought the most/i);
  assert.match(brief, /why profit is lower/i);
});
