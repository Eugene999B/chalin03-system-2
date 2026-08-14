"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AiActionRegistry,
  normalizeDefinition,
} = require("../services/aiActionRegistry");
const {
  aiActionExecutorRegistry,
  executeActionDefinition,
  validateConversationRename,
  validateUserDeactivation,
} = require("../services/aiActionExecutorService");
const {
  registerBuiltInAiActions,
} = require("../ai-actions/registerAiActions");
const {
  expectedActionConfirmation,
  assertDefinitionAuthority,
} = require("../services/aiActionProposalService");
const {
  filterReadOnlyInvestigationTools,
} = require("../services/aiInvestigationLoopService");
const {
  getFeatureState,
} = require("../services/featureFlagService");

function originalAdmin(overrides = {}) {
  return {
    id: Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
    username: String(process.env.SYSTEM_ADMIN_USERNAME || "admin"),
    role: "admin",
    workspace_code: "spare_parts",
    // Do not inject an artificial empty effective_permissions array here.
    // The authenticated runtime resolves the protected owner to the complete
    // immutable business-permission catalogue before guarded routes run.
    ...overrides,
  };
}

function normalActionManager(overrides = {}) {
  return {
    id: 25,
    username: "manager",
    role: "manager",
    workspace_role: "manager",
    workspace_code: "spare_parts",
    effective_permissions: [
      "ai.actions.propose",
      "ai.actions.review",
      "ai.actions.execute",
      "ai.conversations.manage",
    ],
    ...overrides,
  };
}

test("action registry still rejects embedded executor functions", () => {
  assert.throws(
    () =>
      normalizeDefinition({
        key: "unsafe.inline.execute",
        version: "1",
        risk_level: 3,
        personas: ["copilot"],
        allowed_workspaces: ["spare_parts"],
        required_permissions: ["ai.actions.propose"],
        execute() {},
      }),
    (error) => error?.code === "AI_ACTION_EXECUTOR_PROHIBITED"
  );
});

test("governed action and executor namespaces allow controlled underscore workspace segments", () => {
  const definition = normalizeDefinition({
    key: "spare_parts.debt_reminder.send",
    version: "1",
    risk_level: 4,
    personas: ["copilot"],
    allowed_workspaces: ["spare_parts"],
    required_permissions: ["ai.read_sensitive"],
    review_mode: "independent",
    confirmation_mode: "explicit",
    executor_key: "spare_parts.debt_reminder.send",
  });

  assert.equal(definition.key, "spare_parts.debt_reminder.send");
  assert.equal(definition.executor_key, "spare_parts.debt_reminder.send");
});

test("Phase 2D registers one Risk-3 action and one protected Risk-5 executor-backed action", () => {
  const definitions = registerBuiltInAiActions();
  const rename = definitions.find((item) => item.key === "intelligence.conversation.rename");
  const deactivate = definitions.find((item) => item.key === "system.user.deactivate");

  assert.ok(rename);
  assert.equal(rename.risk_level, 3);
  assert.equal(rename.review_mode, "auto");
  assert.equal(rename.confirmation_mode, "none");
  assert.equal(rename.executor_key, "intelligence.conversation.rename");
  assert.equal(rename.execution_available, true);

  assert.ok(deactivate);
  assert.equal(deactivate.risk_level, 5);
  assert.equal(deactivate.system_admin_only, true);
  assert.equal(deactivate.review_mode, "system_admin");
  assert.equal(deactivate.confirmation_mode, "risk5_exact");
  assert.deepEqual(deactivate.required_business_permissions, ["users.manage", "security.admin"]);
  assert.equal(deactivate.executor_key, "system.user.deactivate");
  assert.equal(deactivate.execution_available, true);
});

test("Risk-5 metadata cannot be weakened away from System Administrator only", () => {
  assert.throws(
    () =>
      normalizeDefinition({
        key: "system.unsafe.risk5",
        version: "1",
        risk_level: 5,
        personas: ["copilot"],
        allowed_workspaces: ["spare_parts"],
        required_permissions: ["ai.read_sensitive"],
        system_admin_only: false,
        executor_key: "system.user.deactivate",
      }),
    (error) => error?.code === "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED"
  );
});

test("approved executor registry exposes only named governed adapters", () => {
  assert.deepEqual(aiActionExecutorRegistry.list(), [
    "communications.sms.send",
    "intelligence.conversation.rename",
    "spare_parts.debt_reminder.send",
    "system.user.deactivate",
  ]);
  assert.deepEqual(validateConversationRename({ conversation_key: "conv_123", title: "New title" }), {
    conversation_key: "conv_123",
    title: "New title",
  });
  assert.deepEqual(validateUserDeactivation({ target_user_id: 44, reason: "Employment ended" }), {
    target_user_id: 44,
    reason: "Employment ended",
  });
});

test("Risk-5 executor blocks non-System-Administrator and self-deactivation before database access", async () => {
  const definitions = registerBuiltInAiActions();
  const deactivate = definitions.find((item) => item.key === "system.user.deactivate");

  await assert.rejects(
    executeActionDefinition({
      definition: deactivate,
      payload: { target_user_id: 44, reason: "Offboarding" },
      user: normalActionManager(),
      proposal: {},
    }),
    (error) => error?.code === "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED"
  );

  const admin = originalAdmin();
  await assert.rejects(
    executeActionDefinition({
      definition: deactivate,
      payload: { target_user_id: admin.id, reason: "Unsafe self action" },
      user: admin,
      proposal: {},
    }),
    (error) => error?.code === "AI_ACTION_SELF_DEACTIVATION_BLOCKED"
  );
});

test("Risk ceiling is rechecked at proposal/review/execute authority boundaries", () => {
  const definitions = registerBuiltInAiActions();
  const rename = definitions.find((item) => item.key === "intelligence.conversation.rename");
  const deactivate = definitions.find((item) => item.key === "system.user.deactivate");

  assert.equal(
    assertDefinitionAuthority({
      definition: rename,
      user: normalActionManager(),
      persona: "copilot",
      workspaceCode: "spare_parts",
      phase: "execute",
    }),
    true
  );

  assert.throws(
    () =>
      assertDefinitionAuthority({
        definition: deactivate,
        user: normalActionManager(),
        persona: "copilot",
        workspaceCode: "spare_parts",
        phase: "execute",
      }),
    (error) => ["AI_RISK5_SYSTEM_ADMIN_REQUIRED", "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED"].includes(error?.code)
  );

  assert.equal(
    assertDefinitionAuthority({
      definition: deactivate,
      user: originalAdmin(),
      persona: "copilot",
      workspaceCode: "spare_parts",
      phase: "execute",
    }),
    true
  );
});

test("Risk-4 and Risk-5 confirmations are proposal-specific and exact", () => {
  assert.equal(
    expectedActionConfirmation(
      { proposal_key: "ap_abc" },
      { confirmation_mode: "explicit" }
    ),
    "CONFIRM ap_abc"
  );
  assert.equal(
    expectedActionConfirmation(
      { proposal_key: "ap_xyz" },
      { confirmation_mode: "risk5_exact" }
    ),
    "EXECUTE ap_xyz"
  );
  assert.equal(
    expectedActionConfirmation(
      { proposal_key: "ap_low" },
      { confirmation_mode: "none" }
    ),
    null
  );
});

test("action feature remains disabled by default and execution requires explicit environment activation", () => {
  const state = getFeatureState("aiActions", {});
  assert.equal(state.configured, false);
  assert.equal(state.enabled, false);
});

test("autonomous provider investigation remains read-only even after action execution is introduced", () => {
  const filtered = filterReadOnlyInvestigationTools([
    { key: "read.snapshot", risk_level: 1, title: "Read", description: "read snapshot" },
    { key: "write.controlled", risk_level: 4, title: "Write", description: "controlled write" },
    { key: "write.critical", risk_level: 5, title: "Critical", description: "critical enterprise write" },
  ]);
  assert.deepEqual(filtered.map((item) => item.key), ["read.snapshot"]);
});

test("active AI router mounts the governed action route and route exposes reviewed execution", () => {
  const aiRoutes = fs.readFileSync(path.resolve(__dirname, "../routes/aiRoutes.js"), "utf8");
  const actionRoutes = fs.readFileSync(path.resolve(__dirname, "../routes/aiActionRoutes.js"), "utf8");
  const proposalService = fs.readFileSync(
    path.resolve(__dirname, "../services/aiActionProposalService.js"),
    "utf8"
  );

  assert.match(aiRoutes, /const aiActionRoutes = require\("\.\/aiActionRoutes"\)/);
  assert.match(aiRoutes, /router\.use\("\/actions", aiActionRoutes\)/);
  assert.match(actionRoutes, /router\.use\(requireFeature\("aiActions"\)\)/);
  assert.match(actionRoutes, /\/proposals\/:proposalKey\/execute/);
  assert.match(actionRoutes, /requireAiPermission\("ai\.actions\.execute"\)/);
  assert.match(proposalService, /SELECT GET_LOCK\(\?, 10\) AS acquired/);
  assert.match(proposalService, /assertPayloadIntegrity\(row\)/);
  assert.match(proposalService, /assertAiRiskAuthorized/);
  assert.match(proposalService, /hasEveryPermission/);
  assert.match(proposalService, /AI_ACTION_EXECUTED/);
  assert.match(proposalService, /proposal_status = 'executed'/);
});

test("action governance migration already includes execution receipt fields", () => {
  const migration = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../database/migrations/20260806_chalin_one_ai_action_governance.sql"
    ),
    "utf8"
  );
  assert.match(migration, /'executed','failed'/);
  assert.match(migration, /executed_at DATETIME NULL/);
  assert.match(migration, /result_summary TEXT NULL/);
  assert.match(migration, /error_code VARCHAR\(120\) NULL/);
});