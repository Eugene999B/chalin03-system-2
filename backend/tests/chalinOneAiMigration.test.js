"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CRITICAL_EXISTING_TABLES,
  EXPECTED_TABLES,
  FORBIDDEN_SECRET_COLUMN_PATTERN,
  RELEASE_CONFIRMATION,
  SAFE_NON_PRODUCTION_DATABASE,
  assertExecutionGates,
  compareCriticalCounts,
  connectionOptions,
  readMigrationFile,
} = require("../scripts/runChalinOneAiFoundationMigration");

const migration = readMigrationFile("20260806_chalin_one_ai_foundation.sql");
const verifier = readMigrationFile(
  "20260806_chalin_one_ai_foundation_verify.sql"
);

test("AI foundation migration declares the complete additive table set", () => {
  assert.equal(EXPECTED_TABLES.length, 12);
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

test("AI schema and verifier prohibit secret-bearing columns", () => {
  const columnDefinitions = [...migration.matchAll(/^\s*([a-z][a-z0-9_]*)\s+(?:VARCHAR|TEXT|MEDIUMTEXT|JSON|CHAR|INT|BIGINT|TINYINT|DATETIME|TIMESTAMP|ENUM)/gim)]
    .map((match) => match[1]);
  const forbidden = columnDefinitions.filter((column) =>
    FORBIDDEN_SECRET_COLUMN_PATTERN.test(column)
  );
  assert.deepEqual(forbidden, []);
  assert.match(verifier, /forbidden_secret_column_count/);
  assert.match(verifier, /ai_table_count/);
});

test("non-production migration is restricted to isolated CHALIN ONE databases", () => {
  for (const name of [
    "chalin_one_acceptance",
    "chalin_one_acceptance_ai",
    "chalin_one_staging",
    "chalin_one_development_local",
  ]) {
    assert.equal(SAFE_NON_PRODUCTION_DATABASE.test(name), true);
  }
  for (const name of ["chalin03_db", "railway", "production", "test_db"]) {
    assert.equal(SAFE_NON_PRODUCTION_DATABASE.test(name), false);
  }

  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin_one_acceptance",
      CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION: "false",
      CHALIN_ONE_AI_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin03_db",
      CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_AI_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
});

test("production migration requires both independent backup confirmations", () => {
  const base = {
    NODE_ENV: "production",
    DB_NAME: "chalin03_db",
    CHALIN_ONE_ALLOW_AI_SCHEMA_MIGRATION: "true",
    CHALIN_ONE_AI_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
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

test("connection options use only the supplied isolated environment", () => {
  const options = connectionOptions({
    DB_HOST: "127.0.0.1",
    DB_PORT: "3307",
    DB_USER: "acceptance",
    DB_PASSWORD: "acceptance-only",
    DB_NAME: "chalin_one_acceptance_ai",
    DB_SSL: "false",
  });
  assert.deepEqual(
    {
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      database: options.database,
      multipleStatements: options.multipleStatements,
    },
    {
      host: "127.0.0.1",
      port: 3307,
      user: "acceptance",
      password: "acceptance-only",
      database: "chalin_one_acceptance_ai",
      multipleStatements: false,
    }
  );
});

test("critical business row counts must remain unchanged", () => {
  assert.equal(CRITICAL_EXISTING_TABLES.includes("sales"), true);
  assert.equal(CRITICAL_EXISTING_TABLES.includes("debts"), true);
  assert.equal(CRITICAL_EXISTING_TABLES.includes("hire_contracts"), true);
  assert.doesNotThrow(() =>
    compareCriticalCounts({ sales: 2, debts: 1 }, { sales: 2, debts: 1 })
  );
  assert.throws(() =>
    compareCriticalCounts({ sales: 2, debts: 1 }, { sales: 1, debts: 1 })
  );
});

test("AI migration is not present in application startup commands", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOneAiFoundationMigration|migrate:chalin-one:ai-foundation/
  );
});
