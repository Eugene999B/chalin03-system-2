"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  SCHEMA_MIGRATION_RECORD_PATTERN,
  hasGuardedBackupRunner,
  validateAdditiveMigration,
} = require("../scripts/verifyMigrationSafety");

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chalin-one-migration-safety-"));
  fs.mkdirSync(path.join(repoRoot, "database", "migrations"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "backend", "scripts"), { recursive: true });
  return repoRoot;
}

function cleanup(repoRoot) {
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

test("schema migration record detection accepts idempotent INSERT IGNORE", () => {
  assert.equal(
    SCHEMA_MIGRATION_RECORD_PATTERN.test(
      "INSERT IGNORE INTO schema_migrations (migration_name) VALUES ('demo');"
    ),
    true
  );
  assert.equal(
    SCHEMA_MIGRATION_RECORD_PATTERN.test(
      "INSERT INTO schema_migrations (migration_name) VALUES ('demo');"
    ),
    true
  );
});

test("guarded runner with both production backup gates satisfies backup evidence", () => {
  const repoRoot = makeRepo();
  try {
    const migrationPath = "database/migrations/20260806_guarded_demo.sql";
    const verifyPath = "database/migrations/20260806_guarded_demo_verify.sql";
    const content = [
      "-- ADDITIVE MIGRATION ONLY.",
      "CREATE TABLE IF NOT EXISTS guarded_demo (id INT PRIMARY KEY);",
      "INSERT IGNORE INTO schema_migrations (migration_name) VALUES ('20260806_guarded_demo');",
    ].join("\n");

    fs.writeFileSync(path.join(repoRoot, migrationPath), content);
    fs.writeFileSync(path.join(repoRoot, verifyPath), "SELECT 1;\n");
    fs.writeFileSync(
      path.join(repoRoot, "backend", "scripts", "runGuardedDemo.js"),
      [
        'const MIGRATION_FILE = "20260806_guarded_demo.sql";',
        'env.CHALIN03_SIGNED_BACKUP_CONFIRMED;',
        'env.CHALIN03_SQL_BACKUP_CONFIRMED;',
      ].join("\n")
    );

    assert.equal(hasGuardedBackupRunner({ repoRoot, filePath: migrationPath }), true);

    const errors = [];
    validateAdditiveMigration({ repoRoot, filePath: migrationPath, content, errors });
    assert.deepEqual(errors, []);
  } finally {
    cleanup(repoRoot);
  }
});

test("missing explicit backup marker and guarded runner still fails closed", () => {
  const repoRoot = makeRepo();
  try {
    const migrationPath = "database/migrations/20260806_unguarded_demo.sql";
    const verifyPath = "database/migrations/20260806_unguarded_demo_verify.sql";
    const content = [
      "-- ADDITIVE MIGRATION ONLY.",
      "CREATE TABLE IF NOT EXISTS unguarded_demo (id INT PRIMARY KEY);",
      "INSERT IGNORE INTO schema_migrations (migration_name) VALUES ('20260806_unguarded_demo');",
    ].join("\n");

    fs.writeFileSync(path.join(repoRoot, migrationPath), content);
    fs.writeFileSync(path.join(repoRoot, verifyPath), "SELECT 1;\n");

    const errors = [];
    validateAdditiveMigration({ repoRoot, filePath: migrationPath, content, errors });
    assert.equal(errors.some((error) => error.code === "MISSING_BACKUP_MARKER"), true);
  } finally {
    cleanup(repoRoot);
  }
});
