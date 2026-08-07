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
const governedAcceptance = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/acceptance/chalinOneGovernedFoundationsDatabaseAcceptance.test.js"
  ),
  "utf8"
);
const documentAcceptance = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/acceptance/chalinOneDocumentIntelligenceDatabaseAcceptance.test.js"
  ),
  "utf8"
);
const backendPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "backend/package.json"), "utf8")
);
const frontendPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "frontend/package.json"), "utf8")
);

test("governed CHALIN ONE migrations follow the isolated release order", () => {
  const migrationFiles = [
    "20260805_chalin_one_public_content_foundation.sql",
    "20260806_chalin_one_ai_foundation.sql",
    "20260806_chalin_one_ai_action_governance.sql",
    "20260806_chalin_one_ai_scheduled_governance.sql",
    "20260806_chalin_one_public_guide_foundation.sql",
    "20260806_chalin_one_portal_security_foundation.sql",
    "20260807_chalin_one_document_intelligence.sql",
  ];

  let previousIndex = -1;
  for (const migrationFile of migrationFiles) {
    const index = order.indexOf(migrationFile);
    assert.equal(index > previousIndex, true, `${migrationFile} is out of order`);
    previousIndex = index;
    assert.match(
      order,
      new RegExp(migrationFile.replace(/\.sql$/, "_verify\\.sql"))
    );
  }
});

test("package scripts expose every governed migration and serial database acceptance", () => {
  const expectedScripts = {
    "migrate:chalin-one:ai-foundation":
      "node scripts/runChalinOneAiFoundationMigration.js",
    "migrate:chalin-one:ai-actions":
      "node scripts/runChalinOneAiActionGovernanceMigration.js",
    "migrate:chalin-one:ai-scheduled":
      "node scripts/runChalinOneAiScheduledGovernanceMigration.js",
    "migrate:chalin-one:public-guide":
      "node scripts/runChalinOnePublicGuideFoundationMigration.js",
    "migrate:chalin-one:portal-security":
      "node scripts/runChalinOnePortalSecurityFoundationMigration.js",
    "migrate:chalin-one:document-intelligence":
      "node scripts/runChalinOneDocumentIntelligenceMigration.js",
  };

  for (const [scriptName, command] of Object.entries(expectedScripts)) {
    assert.equal(backendPackage.scripts[scriptName], command);
  }

  assert.equal(
    backendPackage.scripts["test:chalin-one:ai-db"],
    "node --test --test-concurrency=1 acceptance/aiFoundationDatabaseAcceptance.test.js"
  );
  assert.match(
    backendPackage.scripts["test:chalin-one:db"],
    /--test-concurrency=1/
  );
  assert.match(
    backendPackage.scripts["test:chalin-one:db"],
    /acceptance\/\*\.test\.js/
  );
});

test("MySQL CI rehearses AI foundation twice before serial acceptance", () => {
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

test("serial MySQL acceptance runs every newer governed foundation twice", () => {
  for (const functionName of [
    "runChalinOneAiActionGovernanceMigration",
    "runChalinOneAiScheduledGovernanceMigration",
    "runChalinOnePublicGuideFoundationMigration",
    "runChalinOnePortalSecurityFoundationMigration",
  ]) {
    const invocations = governedAcceptance.match(new RegExp(`${functionName}\\(`, "g")) || [];
    assert.equal(invocations.length, 2, `${functionName} must run twice`);
  }

  const documentInvocations =
    documentAcceptance.match(/runChalinOneDocumentIntelligenceMigration\(/g) || [];
  assert.equal(
    documentInvocations.length,
    2,
    "runChalinOneDocumentIntelligenceMigration must run twice"
  );
  assert.match(documentAcceptance, /searchGovernedKnowledge/);
  assert.match(documentAcceptance, /searchPublishedDocumentChunks/);
  assert.match(documentAcceptance, /raw_binary_stored/);
});

test("CI keeps every future AI and portal capability disabled during acceptance", () => {
  for (const marker of [
    'FEATURE_AI_ENABLED: "false"',
    'FEATURE_CHALIN_COPILOT: "false"',
    'FEATURE_CHALIN_EXECUTIVE: "false"',
    'FEATURE_CHALIN_GUIDE: "false"',
    'FEATURE_CUSTOMER_PORTAL: "false"',
    'FEATURE_SUPPLIER_PORTAL: "false"',
    'FEATURE_APPLICANT_PORTAL: "false"',
    'FEATURE_AI_ACTIONS: "false"',
    'FEATURE_AI_SCHEDULED_JOBS: "false"',
    "AI_PROVIDER: disabled",
    'AI_ALLOW_MOCK_PROVIDER: "false"',
  ]) {
    assert.match(workflow, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("frontend normal test command includes intelligence contracts", () => {
  assert.match(frontendPackage.scripts.test, /chalinOneAiFoundationTests\.mjs/);
  assert.match(frontendPackage.scripts.test, /chalinOneDocumentIntelligenceTests\.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /contentStudioJsxSyntaxTests\.mjs/);
});
