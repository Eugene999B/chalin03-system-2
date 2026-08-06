"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const workflow = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/chalin-one-ci.yml"),
  "utf8"
);
const order = fs.readFileSync(
  path.join(repoRoot, "database/chalin_one_local_migrations_order.txt"),
  "utf8"
);
const backendPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "backend/package.json"), "utf8")
);
const frontendPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "frontend/package.json"), "utf8")
);

test("AI migration follows public-content migration in isolated order", () => {
  const publicIndex = order.indexOf(
    "20260805_chalin_one_public_content_foundation.sql"
  );
  const aiIndex = order.indexOf("20260806_chalin_one_ai_foundation.sql");
  assert.equal(publicIndex >= 0, true);
  assert.equal(aiIndex > publicIndex, true);
  assert.match(order, /20260806_chalin_one_ai_foundation_verify\.sql/);
});

test("package scripts expose AI migration and serial database acceptance", () => {
  assert.equal(
    backendPackage.scripts["migrate:chalin-one:ai-foundation"],
    "node scripts/runChalinOneAiFoundationMigration.js"
  );
  assert.equal(
    backendPackage.scripts["test:chalin-one:ai-db"],
    "node --test --test-concurrency=1 acceptance/aiFoundationDatabaseAcceptance.test.js"
  );
  assert.match(
    backendPackage.scripts["test:chalin-one:db"],
    /--test-concurrency=1/
  );
});

test("MySQL CI rehearses AI migration twice before acceptance", () => {
  const first = workflow.indexOf("Rehearse approved AI foundation migration");
  const second = workflow.indexOf("Verify AI foundation migration idempotency");
  const acceptance = workflow.indexOf(
    "Run database-backed Content Studio and AI acceptance"
  );
  assert.equal(first >= 0, true);
  assert.equal(second > first, true);
  assert.equal(acceptance > second, true);
  assert.equal(
    (workflow.match(/npm run migrate:chalin-one:ai-foundation/g) || []).length,
    2
  );
});

test("CI keeps every AI capability and provider disabled during acceptance", () => {
  for (const marker of [
    'FEATURE_AI_ENABLED: "false"',
    'FEATURE_CHALIN_COPILOT: "false"',
    'FEATURE_CHALIN_EXECUTIVE: "false"',
    'FEATURE_CHALIN_GUIDE: "false"',
    'FEATURE_AI_ACTIONS: "false"',
    'FEATURE_AI_SCHEDULED_JOBS: "false"',
    "AI_PROVIDER: disabled",
    'AI_ALLOW_MOCK_PROVIDER: "false"',
  ]) {
    assert.match(workflow, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("frontend normal test command includes intelligence contracts", () => {
  assert.match(
    frontendPackage.scripts.test,
    /chalinOneAiFoundationTests\.mjs/
  );
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /contentStudioJsxSyntaxTests\.mjs/);
});
