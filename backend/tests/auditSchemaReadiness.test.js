const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("audit routes use read-only schema readiness instead of request-time DDL", () => {
  const route = read("backend/routes/auditSignoffRoutes.js");

  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
  assert.doesNotMatch(route, /async function ensureColumn/);
  assert.doesNotMatch(route, /async function ensureIndex/);
  assert.match(route, /AUDIT_SCHEMA_NOT_READY/);
  assert.match(route, /information_schema\.COLUMNS/);
  assert.match(route, /information_schema\.STATISTICS/);
  assert.match(route, /assertAuditSchemaReady/);
  assert.match(route, /readAuditSchemaState/);
  assert.match(route, /resetAuditSchemaReadinessCache/);

  for (const column of [
    "purchases_checked",
    "returns_checked",
    "transfers_checked",
    "sms_checked",
    "stock_ledger_checked",
    "backup_checked",
    "maintenance_checked",
  ]) {
    assert.match(route, new RegExp(column));
  }
});

test("audit readiness migration is additive and has read-only verification", () => {
  const migration = read(
    "database/migrations/20260725_post_phase1_audit_signoff_readiness.sql"
  );
  const verification = read(
    "database/migrations/20260725_post_phase1_audit_signoff_readiness_verify.sql"
  );
  const schema = read("database/schema.sql");

  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.match(migration, /INSERT INTO schema_migrations/);
  assert.match(
    migration,
    /20260725_post_phase1_audit_signoff_readiness/
  );
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /TRUNCATE/i);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|INDEX|KEY|CONSTRAINT)/i);

  assert.match(verification, /missing_audit_readiness_columns/);
  assert.match(verification, /missing_audit_readiness_indexes/);
  assert.doesNotMatch(
    verification.replace(/^--.*$/gm, ""),
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|EXECUTE|PREPARE|DEALLOCATE|SET)\b/i
  );

  for (const column of [
    "purchases_checked",
    "returns_checked",
    "transfers_checked",
    "sms_checked",
    "stock_ledger_checked",
    "backup_checked",
    "maintenance_checked",
  ]) {
    assert.match(migration, new RegExp(column));
    assert.match(schema, new RegExp(column));
  }
});
