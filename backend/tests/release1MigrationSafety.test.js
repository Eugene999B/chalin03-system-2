const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const migrationPath = join(
  __dirname,
  "..",
  "..",
  "database",
  "20260715_sms_reliability_and_restock_migration.sql"
);
const verifyPath = join(
  __dirname,
  "..",
  "..",
  "database",
  "20260715_sms_reliability_and_restock_verify.sql"
);

const migration = readFileSync(migrationPath, "utf8");
const verification = readFileSync(verifyPath, "utf8");

test("Release 1 migration is additive and contains no destructive table reset", () => {
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.match(migration, /UPDATE\s+sms_log\s+SET\s+status\s*=\s*'accepted'/i);
  assert.match(migration, /provider_message_id/i);
  assert.match(migration, /delivery_confirmed_at/i);
  assert.match(migration, /movement_type/i);
  assert.match(migration, /source_name/i);
  assert.match(migration, /reference_number/i);
});

test("Release 1 stock backfill does not overwrite legitimate other movements on rerun", () => {
  assert.match(
    migration,
    /WHERE\s+movement_type\s+IS\s+NULL\s+OR\s+movement_type\s*=\s*''/i
  );
  assert.doesNotMatch(
    migration,
    /WHERE[\s\S]{0,120}movement_type\s*=\s*'other'/i
  );
});

test("Release 1 verification checks required columns and invalid statuses", () => {
  assert.match(verification, /sms_log/i);
  assert.match(verification, /stock_adjustments/i);
  assert.match(verification, /provider_message_id/i);
  assert.match(verification, /movement_type/i);
  assert.match(verification, /PROBLEM/i);
});
