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
} = require("../scripts/runChalinOneAiActionGovernanceMigration");

const migration = readMigrationFile(
  "20260806_chalin_one_ai_action_governance.sql"
);
const verifier = readMigrationFile(
  "20260806_chalin_one_ai_action_governance_verify.sql"
);

test("action governance adds proposal and review tables only", () => {
  assert.deepEqual(EXPECTED_TABLES, [
    "ai_action_proposals",
    "ai_action_reviews",
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

test("action governance stores checksums and evidence but no credentials or commands", () => {
  assert.match(migration, /payload_json JSON NOT NULL/);
  assert.match(migration, /payload_sha256 CHAR\(64\) NOT NULL/);
  assert.match(migration, /evidence_json JSON NULL/);
  assert.match(migration, /evidence_count INT UNSIGNED/);
  assert.doesNotMatch(
    migration,
    /sql_text|command_text|shell_command|access_token|refresh_token|api_key|password_hash/i
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

test("action migration remains limited to isolated CHALIN ONE databases", () => {
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin_one_acceptance"), true);
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin_one_staging_actions"), true);
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin03_db"), false);
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin_one_acceptance",
      CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION: "false",
      CHALIN_ONE_AI_ACTION_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin03_db",
      CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_AI_ACTION_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
});

test("production action migration requires both backup confirmations", () => {
  const base = {
    NODE_ENV: "production",
    DB_NAME: "chalin03_db",
    CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION: "true",
    CHALIN_ONE_AI_ACTION_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
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

test("action runner verifies zero executed proposals", () => {
  assert.match(verifier, /executed_proposal_count/);
  assert.match(verifier, /proposal_status = 'executed'/);
  const runner = fs.readFileSync(
    path.resolve(
      __dirname,
      "../scripts/runChalinOneAiActionGovernanceMigration.js"
    ),
    "utf8"
  );
  assert.match(runner, /executed_proposal_count: 0/);
  assert.match(runner, /requires zero executed proposals/i);
});

test("action migration is not part of ordinary backend startup", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOneAiActionGovernanceMigration|ai-action-governance/
  );
});

test("connection options are constructed from the supplied isolated environment", () => {
  const options = connectionOptions({
    DB_HOST: "127.0.0.1",
    DB_PORT: "3308",
    DB_USER: "action_acceptance",
    DB_PASSWORD: "action-only",
    DB_NAME: "chalin_one_acceptance_actions",
    DB_SSL: "false",
  });
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 3308);
  assert.equal(options.database, "chalin_one_acceptance_actions");
  assert.equal(options.multipleStatements, false);
});
