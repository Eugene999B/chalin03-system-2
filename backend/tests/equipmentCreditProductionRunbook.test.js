const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const runbook = read("docs", "EQUIPMENT_CREDIT_APPLICATION_PRODUCTION_RUNBOOK.md");
const migrationReadme = read("database", "migrations", "README.md");
const migration = read(
  "database",
  "migrations",
  "20260729_equipment_credit_application_foundation.sql"
);
const verification = read(
  "database",
  "migrations",
  "20260729_equipment_credit_application_foundation_verify.sql"
);

test("Equipment credit production runbook requires two verified backups", () => {
  assert.match(runbook, /Professional Backup/);
  assert.match(runbook, /separate SQL backup/);
  assert.match(runbook, /Both backups are mandatory/);
  assert.match(runbook, /older than the approved migration window/);
  assert.match(runbook, /Africa\/Accra/);
});

test("runbook applies only the reviewed additive migration and verifier", () => {
  assert.match(runbook, /20260729_equipment_credit_application_foundation\.sql/);
  assert.match(runbook, /20260729_equipment_credit_application_foundation_verify\.sql/);
  assert.match(runbook, /must never run `database\/schema\.sql`/);
  assert.match(runbook, /--ssl-mode=REQUIRED/);
  assert.match(runbook, /Do not put the password directly in the command/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_credit_applications/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_credit_application_kyc/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_credit_application_decisions/);
  assert.match(migration, /20260729_equipment_credit_application_foundation/);
});

test("verification and smoke test preserve the agreement activation boundary", () => {
  for (const result of [
    "missing_credit_tables = 0",
    "missing_credit_columns = 0",
    "invalid_credit_application_rows = 0",
    "orphan_credit_evidence_rows = 0",
  ]) {
    assert.match(runbook, new RegExp(result.replace(" = ", " = ")));
    assert.match(migrationReadme, new RegExp(result.replace(" = ", " = ")));
  }
  assert.match(verification, /missing_credit_tables/);
  assert.match(verification, /missing_credit_columns/);
  assert.match(verification, /invalid_credit_application_rows/);
  assert.match(verification, /orphan_credit_evidence_rows/);
  assert.match(runbook, /does \*\*not\*\*:/);
  assert.match(runbook, /create a row in `equipment_sale_agreements`/);
  assert.match(runbook, /reserve or lock the fleet asset/);
  assert.match(runbook, /send SMS automatically/);
});

test("failure handling corrects forward without destructive rollback", () => {
  assert.match(runbook, /Do not perform a destructive automatic rollback/);
  assert.match(runbook, /new timestamped additive correction migration/);
  assert.match(runbook, /renewed backup and approval/);
  assert.doesNotMatch(runbook, /DROP TABLE|TRUNCATE|DELETE FROM/);
});
