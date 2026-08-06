"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  EXPECTED_TABLES,
  FORBIDDEN_SECRET_COLUMN_PATTERN,
  RELEASE_CONFIRMATION,
  SAFE_NON_PRODUCTION_DATABASE,
  assertExecutionGates,
  connectionOptions,
  readMigrationFile,
} = require("../scripts/runChalinOneAiScheduledGovernanceMigration");

const migration = readMigrationFile(
  "20260806_chalin_one_ai_scheduled_governance.sql"
);
const verifier = readMigrationFile(
  "20260806_chalin_one_ai_scheduled_governance_verify.sql"
);

test("scheduled governance declares the complete additive table set", () => {
  assert.deepEqual(EXPECTED_TABLES, [
    "ai_scheduled_job_definitions",
    "ai_scheduled_job_reviews",
    "ai_scheduled_job_run_evidence",
  ]);
  for (const tableName of EXPECTED_TABLES) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\b`)
    );
  }
  assert.match(migration, /INSERT IGNORE INTO schema_migrations/);
  assert.doesNotMatch(
    migration,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE|DELETE\s+FROM|RENAME\s+TABLE/i
  );
});

test("scheduled schema stores hashes and evidence without credentials or delivery secrets", () => {
  assert.match(migration, /schedule_sha256 CHAR\(64\)/);
  assert.match(migration, /input_sha256 CHAR\(64\)/);
  assert.match(migration, /evidence_json JSON/);
  assert.doesNotMatch(
    migration,
    /password_hash|api_key|access_token|refresh_token|webhook_secret|recipient_token/i
  );
  const columnDefinitions = [
    ...migration.matchAll(
      /^\s*([a-z][a-z0-9_]*)\s+(?:VARCHAR|TEXT|MEDIUMTEXT|JSON|CHAR|INT|BIGINT|TINYINT|DATETIME|TIMESTAMP|ENUM)/gim
    ),
  ].map((match) => match[1]);
  assert.deepEqual(
    columnDefinitions.filter((column) =>
      FORBIDDEN_SECRET_COLUMN_PATTERN.test(column)
    ),
    []
  );
});

test("scheduled migration is restricted to isolated CHALIN ONE databases", () => {
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin_one_acceptance"), true);
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin_one_staging_jobs"), true);
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin03_db"), false);
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin_one_acceptance",
      CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION: "false",
      CHALIN_ONE_AI_SCHEDULED_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin03_db",
      CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_AI_SCHEDULED_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
});

test("production scheduled migration requires both verified backups", () => {
  const base = {
    NODE_ENV: "production",
    DB_NAME: "chalin03_db",
    CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION: "true",
    CHALIN_ONE_AI_SCHEDULED_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
  };
  assert.throws(() => assertExecutionGates(base));
  assert.throws(() =>
    assertExecutionGates({
      ...base,
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
    })
  );
  assert.equal(
    assertExecutionGates({
      ...base,
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      CHALIN03_SQL_BACKUP_CONFIRMED: "true",
    }).production,
    true
  );
});

test("scheduled migration verifier and runner require zero runs", () => {
  assert.match(verifier, /scheduled_run_count/);
  const runner = fs.readFileSync(
    path.resolve(
      __dirname,
      "../scripts/runChalinOneAiScheduledGovernanceMigration.js"
    ),
    "utf8"
  );
  assert.match(runner, /scheduled_run_count: 0/);
  assert.match(runner, /requires zero run records/i);
});

test("scheduled governance migration is absent from ordinary backend startup", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOneAiScheduledGovernanceMigration|ai-scheduled-governance/
  );
});

test("scheduled runner uses only the supplied isolated connection configuration", () => {
  const options = connectionOptions({
    DB_HOST: "127.0.0.1",
    DB_PORT: "3309",
    DB_USER: "scheduled_acceptance",
    DB_PASSWORD: "scheduled-only",
    DB_NAME: "chalin_one_acceptance_scheduled",
    DB_SSL: "false",
  });
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 3309);
  assert.equal(options.database, "chalin_one_acceptance_scheduled");
  assert.equal(options.multipleStatements, false);
});
