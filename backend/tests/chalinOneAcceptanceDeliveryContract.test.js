"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ACCEPTANCE_DATABASE_PATTERN,
  LEGACY_TABLES,
  assertSafeAcceptanceTarget,
} = require("../scripts/prepareChalinOneAcceptanceDatabase");
const {
  EXPECTED_TABLES,
  RELEASE_CONFIRMATION,
} = require("../scripts/runChalinOnePublicContentFoundationMigration");

const repositoryRoot = path.resolve(__dirname, "../..");
function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("acceptance database target fails closed outside an isolated test database", () => {
  assert.equal(ACCEPTANCE_DATABASE_PATTERN.test("chalin_one_acceptance"), true);
  assert.equal(ACCEPTANCE_DATABASE_PATTERN.test("chalin_one_acceptance_ci"), true);
  assert.equal(ACCEPTANCE_DATABASE_PATTERN.test("railway"), false);
  assert.equal(ACCEPTANCE_DATABASE_PATTERN.test("production"), false);

  assert.throws(
    () =>
      assertSafeAcceptanceTarget({
        NODE_ENV: "production",
        DB_NAME: "chalin_one_acceptance",
      }),
    /never run with NODE_ENV=production/
  );
  assert.throws(
    () =>
      assertSafeAcceptanceTarget({
        NODE_ENV: "test",
        DB_NAME: "railway",
      }),
    /dedicated database named chalin_one_acceptance/
  );
  assert.equal(
    assertSafeAcceptanceTarget({
      NODE_ENV: "test",
      DB_NAME: "chalin_one_acceptance_ci",
    }),
    "chalin_one_acceptance_ci"
  );
});

test("acceptance fixture represents every migration-protected legacy table", () => {
  const expectedLegacy = [
    "products",
    "customers",
    "sales",
    "sale_items",
    "debts",
    "debt_payments",
    "mining_sites",
    "fleet_assets",
    "hire_contracts",
    "equipment_sale_agreements",
  ];
  assert.deepEqual([...LEGACY_TABLES], expectedLegacy);
  assert.equal(EXPECTED_TABLES.length, 28);
  assert.equal(
    RELEASE_CONFIRMATION,
    "20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION"
  );
});

test("CI uses ephemeral MySQL and never production migration confirmations", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
  assert.match(workflow, /image: mysql:8\.4/);
  assert.match(workflow, /MYSQL_DATABASE: chalin_one_acceptance/);
  assert.match(workflow, /NODE_ENV: test/);
  assert.match(workflow, /DB_NAME: chalin_one_acceptance/);
  assert.equal(
    (workflow.match(/npm run migrate:chalin-one:public-content/g) || []).length,
    2
  );
  assert.match(workflow, /npm run test:chalin-one:db/);
  assert.doesNotMatch(workflow, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.doesNotMatch(workflow, /CHALIN03_SQL_BACKUP_CONFIRMED/);
});

test("database acceptance exercises governance, public reads and privacy", () => {
  const acceptance = read(
    "backend/acceptance/contentStudioDatabaseAcceptance.test.js"
  );
  for (const marker of [
    "CONTENT_SELF_APPROVAL_BLOCKED",
    "decidePageApproval",
    "publishPageVersion",
    "decideFormApproval",
    "publishFormVersion",
    "createPublicFormSubmission",
    "listNavigationApprovals",
    "publishNavigationVersion",
    "getPublicBootstrap",
    "ip_hash",
    "user_agent",
    "legacy rows must survive",
  ]) {
    assert.match(acceptance, new RegExp(marker));
  }
  assert.doesNotMatch(acceptance, /DROP TABLE|DROP DATABASE|TRUNCATE/);
});
