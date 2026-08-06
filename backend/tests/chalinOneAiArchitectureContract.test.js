"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
}

const systemRoutes = read("backend/routes/systemRoutes.js");
const aiRoutes = read("backend/routes/aiRoutes.js");
const knowledgeRoutes = read("backend/routes/aiKnowledgeRoutes.js");
const featureFlags = read("backend/services/featureFlagService.js");
const registry = read("backend/services/aiToolRegistry.js");
const provider = read("backend/services/aiProviderService.js");
const orchestrator = read("backend/services/aiOrchestratorService.js");
const foundationTools = read("backend/ai-tools/foundationTools.js");
const aiMigration = read(
  "database/migrations/20260806_chalin_one_ai_foundation.sql"
);

test("master AI routes are hidden behind existing authentication and workspace permission", () => {
  assert.match(systemRoutes, /router\.use\(\s*"\/ai"/);
  assert.match(systemRoutes, /requireFeature\("aiEnabled"\)/);
  assert.match(systemRoutes, /requireAuth/);
  assert.match(systemRoutes, /requirePermission\("workspace\.view"\)/);
  assert.match(systemRoutes, /aiRoutes/);
});

test("Copilot and Executive have independent feature and persona gates", () => {
  assert.match(aiRoutes, /personaRouter\("copilot", "chalinCopilot"\)/);
  assert.match(aiRoutes, /personaRouter\("executive", "chalinExecutive"\)/);
  assert.match(aiRoutes, /requireAiPersona\(persona\)/);
  assert.match(aiRoutes, /requireAiPermission\("ai\.use"/);
  assert.match(aiRoutes, /no-store, private/);
});

test("all AI and future action flags remain disabled by default", () => {
  for (const envName of [
    "FEATURE_AI_ENABLED",
    "FEATURE_CHALIN_COPILOT",
    "FEATURE_CHALIN_EXECUTIVE",
    "FEATURE_CHALIN_GUIDE",
    "FEATURE_AI_ACTIONS",
    "FEATURE_AI_SCHEDULED_JOBS",
  ]) {
    assert.match(
      featureFlags,
      new RegExp(`${envName}.*defaultValue:\\s*false`, "s")
    );
  }
});

test("tool registry denies direct database access and hides risk-four execution", () => {
  assert.match(registry, /AI_TOOL_DIRECT_DATABASE_BLOCKED/);
  assert.match(registry, /FORBIDDEN_HANDLER_SOURCE/);
  assert.match(registry, /isFeatureEnabled\("aiActions"\)/);
  assert.match(registry, /risk_level >= 4/);
  assert.match(registry, /AI_ACTIONS_DISABLED/);
  assert.doesNotMatch(foundationTools, /config\/db|mysql2|pool\.query|connection\.query/);
});

test("provider layer has no active network adapter by default", () => {
  assert.match(provider, /class DisabledAiProvider/);
  assert.match(provider, /AI_PROVIDER_DISABLED/);
  assert.match(provider, /AI_PROVIDER_NOT_REGISTERED/);
  assert.match(provider, /AI_MOCK_PROVIDER_BLOCKED/);
  assert.doesNotMatch(provider, /\bfetch\s*\(|axios|https\.request|http\.request/);
});

test("orchestrator composes safety, budgets, approved knowledge, tools, evidence and audit", () => {
  for (const marker of [
    "inspectPrompt",
    "buildRequestBudget",
    "searchApprovedKnowledge",
    "availableTools",
    "generateProviderResponse",
    "executeRequestedTools",
    "persistEvidence",
    "recordUsage",
    "writeAiAuditEvent",
    "writePromptSafetyEvent",
  ]) {
    assert.match(orchestrator, new RegExp(marker));
  }
  assert.match(orchestrator, /sumProviderUsage/);
  assert.match(orchestrator, /AI_PROMPT_BLOCKED/);
  assert.match(orchestrator, /Ordinary system operations are unaffected/);
});

test("knowledge administration separates manage, review and publish permissions", () => {
  assert.match(knowledgeRoutes, /ai\.knowledge\.manage/);
  assert.match(knowledgeRoutes, /ai\.knowledge\.review/);
  assert.match(knowledgeRoutes, /ai\.knowledge\.publish/);
  assert.match(knowledgeRoutes, /scopedKnowledgeDetails/);
  assert.match(knowledgeRoutes, /owner_workspace_code/);
});

test("AI schema never stores provider or platform credentials", () => {
  assert.doesNotMatch(
    aiMigration,
    /^\s*(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)\s+/gim
  );
  assert.match(aiMigration, /input_sha256/);
  assert.match(aiMigration, /permission_snapshot_json/);
  assert.match(aiMigration, /checksum_sha256/);
});

test("ordinary public and business routes do not depend on AI", () => {
  assert.match(systemRoutes, /router\.get\("\/health"/);
  assert.match(systemRoutes, /router\.use\(\s*"\/public\/content"/);
  assert.match(systemRoutes, /router\.use\(\s*"\/content-studio"/);
  assert.doesNotMatch(systemRoutes, /router\.get\("\/health"[\s\S]{0,400}aiEnabled/);
});
