"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EXPECTED_TABLES,
  MIGRATION_FILE,
  MIGRATION_LOCK_NAME,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  VERIFIER_FILE,
  assertExecutionGates,
  compareCriticalCounts,
  truthy,
} = require("../scripts/runChalinOnePublicContentFoundationMigration");

const repoRoot = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "backend/package.json"), "utf8")
);
const runnerSource = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/scripts/runChalinOnePublicContentFoundationMigration.js"
  ),
  "utf8"
);

test("runner constants point only to the approved Phase 2 migration", () => {
  assert.equal(
    MIGRATION_FILE,
    "20260805_chalin_one_public_content_foundation.sql"
  );
  assert.equal(
    VERIFIER_FILE,
    "20260805_chalin_one_public_content_foundation_verify.sql"
  );
  assert.equal(
    MIGRATION_RECORD,
    "20260805_chalin_one_public_content_foundation"
  );
  assert.equal(
    RELEASE_CONFIRMATION,
    "20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION"
  );
  assert.match(MIGRATION_LOCK_NAME, /chalin03:chalin-one:public-content/i);
  assert.equal(EXPECTED_TABLES.length, 28);
});

test("truthy parser accepts only explicit enable values", () => {
  for (const value of ["1", "true", "yes", "on", "enabled", true]) {
    assert.equal(truthy(value), true);
  }

  for (const value of ["0", "false", "no", "off", "", undefined]) {
    assert.equal(truthy(value), false);
  }
});

test("all migration runs require both an enable switch and exact release phrase", () => {
  assert.throws(
    () =>
      assertExecutionGates({
        NODE_ENV: "development",
        DB_NAME: "chalin03_test",
      }),
    /CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=true/
  );

  assert.throws(
    () =>
      assertExecutionGates({
        NODE_ENV: "development",
        DB_NAME: "chalin03_test",
        CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true",
      }),
    /CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM/
  );

  assert.doesNotThrow(() =>
    assertExecutionGates({
      NODE_ENV: "development",
      DB_NAME: "chalin03_test",
      CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
});

test("production execution requires both verified backup confirmations", () => {
  const base = {
    NODE_ENV: "production",
    DB_NAME: "railway",
    CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true",
    CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
  };

  assert.throws(
    () => assertExecutionGates(base),
    /Professional Backup/
  );

  assert.throws(
    () =>
      assertExecutionGates({
        ...base,
        CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      }),
    /SQL backup/
  );

  assert.doesNotThrow(() =>
    assertExecutionGates({
      ...base,
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      CHALIN03_SQL_BACKUP_CONFIRMED: "true",
    })
  );
});

test("non-production execution refuses obvious production database names", () => {
  for (const databaseName of ["railway", "production", "prod"]) {
    assert.throws(
      () =>
        assertExecutionGates({
          NODE_ENV: "development",
          DB_NAME: databaseName,
          CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "true",
          CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
        }),
      /may not target a database named/i
    );
  }
});

test("critical business row-count comparison rejects any mutation", () => {
  assert.doesNotThrow(() =>
    compareCriticalCounts(
      { users: 10, sales: 25, debts: 4 },
      { users: 10, sales: 25, debts: 4 }
    )
  );

  assert.throws(
    () =>
      compareCriticalCounts(
        { users: 10, sales: 25, debts: 4 },
        { users: 10, sales: 26, debts: 4 }
      ),
    /sales: 25 -> 26/
  );
});

test("migration runner is manual and is never part of backend startup", () => {
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOnePublicContentFoundationMigration/
  );
  assert.equal(
    packageJson.scripts["migrate:chalin-one:public-content"],
    "node scripts/runChalinOnePublicContentFoundationMigration.js"
  );
  assert.match(runnerSource, /SELECT GET_LOCK\(\?, 30\)/);
  assert.match(runnerSource, /SELECT RELEASE_LOCK\(\?\)/);
  assert.match(runnerSource, /captureCriticalCounts/);
  assert.match(runnerSource, /compareCriticalCounts/);
});
