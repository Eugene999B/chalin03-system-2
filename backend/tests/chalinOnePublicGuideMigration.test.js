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
} = require("../scripts/runChalinOnePublicGuideFoundationMigration");

const migration = readMigrationFile(
  "20260806_chalin_one_public_guide_foundation.sql"
);
const verifier = readMigrationFile(
  "20260806_chalin_one_public_guide_foundation_verify.sql"
);

test("public Guide foundation contains exactly two additive isolated tables", () => {
  assert.deepEqual(EXPECTED_TABLES, [
    "ai_public_guide_sessions",
    "ai_public_guide_messages",
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

test("public Guide schema stores hashes instead of raw session and network identity", () => {
  assert.match(migration, /token_sha256 CHAR\(64\)/);
  assert.match(migration, /ip_hash CHAR\(64\)/);
  assert.doesNotMatch(migration, /\bsession_token\b|\bip_address\b|\buser_agent\b/);
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
  assert.match(verifier, /forbidden_secret_column_count/);
});

test("public Guide migration is limited to isolated CHALIN ONE databases", () => {
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin_one_acceptance"), true);
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin_one_staging_guide"), true);
  assert.equal(SAFE_NON_PRODUCTION_DATABASE.test("chalin03_db"), false);
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin_one_acceptance",
      CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION: "false",
      CHALIN_ONE_PUBLIC_GUIDE_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
  assert.throws(() =>
    assertExecutionGates({
      NODE_ENV: "test",
      DB_NAME: "chalin03_db",
      CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_PUBLIC_GUIDE_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    })
  );
});

test("production Guide migration requires signed and SQL backups", () => {
  const base = {
    NODE_ENV: "production",
    DB_NAME: "chalin03_db",
    CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION: "true",
    CHALIN_ONE_PUBLIC_GUIDE_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
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

test("Guide migration runner uses supplied isolated connection settings", () => {
  const options = connectionOptions({
    DB_HOST: "127.0.0.1",
    DB_PORT: "3307",
    DB_USER: "guide_acceptance",
    DB_PASSWORD: "guide-acceptance-only",
    DB_NAME: "chalin_one_acceptance_guide",
    DB_SSL: "false",
  });
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 3307);
  assert.equal(options.database, "chalin_one_acceptance_guide");
  assert.equal(options.multipleStatements, false);
});

test("public Guide migration is absent from ordinary backend startup", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOnePublicGuideFoundationMigration|public-guide-foundation/
  );
});
