"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AiActionRegistry,
  AiActionRegistryError,
  normalizeDefinition,
} = require("../services/aiActionRegistry");
const {
  AiActionProposalError,
  canonicalJson,
  canonicalValue,
  normalizeExpiry,
  normalizeScope,
  sha256,
} = require("../services/aiActionProposalService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/aiActionProposalService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/aiActionRoutes.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260806_chalin_one_ai_action_governance.sql"
  ),
  "utf8"
);

function definition(overrides = {}) {
  return {
    key: "inventory.adjustment_proposal",
    version: "1",
    title: "Inventory adjustment proposal",
    description: "Prepare an evidence-backed adjustment for human review.",
    risk_level: 4,
    personas: ["copilot"],
    allowed_workspaces: ["spare_parts"],
    required_permissions: ["ai.actions.propose"],
    evidence_required: true,
    maximum_expiry_hours: 12,
    input_schema: { type: "object" },
    ...overrides,
  };
}

test("action definitions are proposal-only and reject executor functions", () => {
  const item = normalizeDefinition(definition());
  assert.equal(item.execution_available, false);
  assert.equal(item.output_authority, "proposal_only");
  assert.equal(item.risk_level, 4);

  for (const field of ["execute", "handler", "run"]) {
    assert.throws(
      () => normalizeDefinition(definition({ [field]: async () => true })),
      (error) =>
        error instanceof AiActionRegistryError &&
        error.code === "AI_ACTION_EXECUTOR_PROHIBITED"
    );
  }
});

test("action registry controls duplicates, persona and workspace filters", () => {
  const registry = new AiActionRegistry();
  registry.register(definition());
  assert.equal(
    registry.list({ persona: "copilot", workspace: "spare_parts" }).length,
    1
  );
  assert.equal(
    registry.list({ persona: "executive", workspace: "spare_parts" }).length,
    0
  );
  assert.equal(
    registry.list({ persona: "copilot", workspace: "mining" }).length,
    0
  );
  assert.throws(
    () => registry.register(definition()),
    (error) =>
      error instanceof AiActionRegistryError &&
      error.code === "AI_ACTION_DEFINITION_DUPLICATE"
  );
});

test("canonical action payloads have deterministic checksums", () => {
  const first = canonicalJson({ quantity: 2, product: "EXC-01", reason: "audit" });
  const second = canonicalJson({ reason: "audit", product: "EXC-01", quantity: 2 });
  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
  assert.match(sha256(first), /^[a-f0-9]{64}$/);
});

test("canonical payload rejects unsafe values, invalid keys and excessive depth", () => {
  assert.throws(
    () => canonicalJson({ value: Number.POSITIVE_INFINITY }),
    (error) =>
      error instanceof AiActionProposalError &&
      error.code === "AI_ACTION_PAYLOAD_INVALID"
  );
  assert.throws(
    () => canonicalJson({ "invalid key": 1 }),
    (error) =>
      error instanceof AiActionProposalError &&
      error.code === "AI_ACTION_PAYLOAD_INVALID"
  );
  let deep = {};
  let cursor = deep;
  for (let index = 0; index < 35; index += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(
    () => canonicalValue(deep),
    (error) =>
      error instanceof AiActionProposalError &&
      error.code === "AI_ACTION_PAYLOAD_TOO_DEEP"
  );
});

test("proposal scope and expiry are explicit and bounded", () => {
  const scope = normalizeScope({
    workspace_code: "equipment_hire",
    hire_location_id: 7,
  });
  assert.equal(scope.workspace_code, "equipment_hire");
  assert.equal(scope.hire_location_id, 7);
  assert.throws(
    () => normalizeScope({ workspace_code: "" }),
    (error) => error.code === "AI_ACTION_WORKSPACE_REQUIRED"
  );
  assert.throws(
    () => normalizeExpiry(new Date(Date.now() - 1000).toISOString(), 24),
    (error) => error.code === "AI_ACTION_EXPIRY_INVALID"
  );
  assert.throws(
    () => normalizeExpiry(new Date(Date.now() + 48 * 60 * 60 * 1000), 24),
    (error) => error.code === "AI_ACTION_EXPIRY_TOO_LONG"
  );
});

test("proposal lifecycle requires evidence, independent review and checksum verification", () => {
  assert.match(serviceSource, /AI_ACTION_EVIDENCE_REQUIRED/);
  assert.match(serviceSource, /AI_ACTION_INDEPENDENT_REVIEW_REQUIRED/);
  assert.match(serviceSource, /AI_ACTION_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /AI_ACTION_REVIEW_ASSIGNED_ELSEWHERE/);
  assert.match(serviceSource, /AI_ACTION_PAYLOAD_INTEGRITY_FAILED/);
  assert.match(serviceSource, /expireOverdueProposals/);
  assert.match(serviceSource, /proposal_status = 'cancelled'/);
  assert.match(serviceSource, /execution_available: false/);
});

test("action routes expose reviewed execution only behind explicit feature, permission and execution guards", () => {
  assert.match(routeSource, /router\.use\(requireFeature\("aiActions"\)\)/);
  assert.match(routeSource, /ai\.actions\.propose/);
  assert.match(routeSource, /ai\.actions\.review/);
  assert.match(routeSource, /ai\.actions\.execute/);
  assert.match(routeSource, /\/decision/);
  assert.match(routeSource, /\/cancel/);
  assert.match(routeSource, /\/proposals\/:proposalKey\/execute/);
  assert.match(routeSource, /executeActionProposal/);

  assert.match(serviceSource, /EXECUTABLE_STATUSES/);
  assert.match(serviceSource, /AI_ACTION_PROPOSAL_NOT_EXECUTABLE/);
  assert.match(serviceSource, /assertPayloadIntegrity\(row\)/);
  assert.match(serviceSource, /assertAiRiskAuthorized/);
  assert.match(serviceSource, /hasEveryPermission/);
  assert.match(serviceSource, /expectedActionConfirmation/);
  assert.match(serviceSource, /SELECT GET_LOCK\(\?, 10\) AS acquired/);
  assert.match(serviceSource, /AI_ACTION_CONFIRMATION_REQUIRED/);
  assert.match(serviceSource, /AI_ACTION_EXECUTED/);
  assert.match(serviceSource, /proposal_status = 'executed'/);
});

test("action governance migration is additive and executor-free", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_action_proposals/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ai_action_reviews/);
  assert.match(migrationSource, /payload_sha256 CHAR\(64\)/);
  assert.match(migrationSource, /evidence_json JSON/);
  assert.doesNotMatch(
    migrationSource,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE/i
  );
  assert.doesNotMatch(migrationSource, /command_text|sql_text|shell_command/i);
});
