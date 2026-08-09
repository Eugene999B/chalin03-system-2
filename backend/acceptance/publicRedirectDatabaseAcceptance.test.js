"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  RELEASE_CONFIRMATION,
  MIGRATION_RECORD,
  runChalinOnePublicRedirectMigration,
} = require("../scripts/runChalinOnePublicRedirectMigration");

function migrationEnv() {
  return {
    ...process.env,
    CHALIN_ONE_ALLOW_PUBLIC_REDIRECT_MIGRATION: "true",
    CHALIN_ONE_PUBLIC_REDIRECT_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
  };
}

async function scalar(sql, values = []) {
  const [[row]] = await pool.query(sql, values);
  return Number(Object.values(row || {})[0] || 0);
}

test("public redirect migration is additive, empty by default and idempotent", async () => {
  const beforeUsers = await scalar("SELECT COUNT(*) AS total FROM users");
  const beforePages = await scalar("SELECT COUNT(*) AS total FROM public_pages");

  const first = await runChalinOnePublicRedirectMigration({ env: migrationEnv() });
  const second = await runChalinOnePublicRedirectMigration({ env: migrationEnv() });

  assert.equal(first.migration, MIGRATION_RECORD);
  assert.equal(second.migration, MIGRATION_RECORD);

  assert.equal(
    await scalar(
      `SELECT COUNT(*) AS total
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'public_redirect_rules'`
    ),
    1
  );
  assert.equal(await scalar("SELECT COUNT(*) AS total FROM public_redirect_rules"), 0);
  assert.equal(
    await scalar(
      "SELECT COUNT(*) AS total FROM schema_migrations WHERE migration_name = ?",
      [MIGRATION_RECORD]
    ),
    1
  );
  assert.equal(await scalar("SELECT COUNT(*) AS total FROM users"), beforeUsers);
  assert.equal(await scalar("SELECT COUNT(*) AS total FROM public_pages"), beforePages);
});

test.after(async () => {
  await pool.end();
});
