const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  transformAuditRouteSource,
} = require("../routes/auditRouteReadinessLoader");

const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("audit readiness contract is read-only and complete", () => {
  const source = read("backend/services/auditSchemaReadinessService.js");
  assert.match(source, /AUDIT_SCHEMA_NOT_READY/);
  assert.match(source, /information_schema\.TABLES/);
  assert.match(source, /information_schema\.COLUMNS/);
  assert.match(source, /information_schema\.STATISTICS/);
  assert.match(source, /audit_signoffs/);
  assert.match(source, /audit_unlock_requests/);
  assert.match(source, /audit_reapproval_log/);
  assert.doesNotMatch(source, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
});

test("audit compatibility sources transform to readiness-only runtime routes", () => {
  const forbidden = [
    /CREATE\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW)/i,
    /ALTER\s+TABLE/i,
    /DROP\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|DATABASE|SCHEMA)/i,
    /TRUNCATE\s+TABLE/i,
    /RENAME\s+TABLE/i,
  ];

  for (const [kind, relativePath] of [
    ["signoff", "backend/routes/auditSignoffRoutes.legacy-source"],
    ["unlock", "backend/routes/auditUnlockRequestRoutes.legacy-source"],
  ]) {
    const transformed = transformAuditRouteSource(kind, read(relativePath));
    assert.match(transformed, /assertAuditSchemaReady/);
    assert.match(transformed, /sendAuditSchemaReadinessError/);
    for (const pattern of forbidden) {
      assert.doesNotMatch(transformed, pattern, `${kind} transformed route contains runtime DDL`);
    }
  }
});

test("controlled manifest applies and records the audit schema contract", () => {
  const manifest = JSON.parse(read("database/migrations/controlled-manifest.json"));
  const names = manifest.migrations.map((entry) => entry.name);
  const auditIndex = names.indexOf("20260723_release31_audit_schema_safety");
  const baselineIndex = names.indexOf("20260723_release31_audit_schema_baseline");
  assert.ok(auditIndex >= 0, "audit migration missing from controlled manifest");
  assert.ok(baselineIndex > auditIndex, "audit baseline must follow audit migration");
  const entry = manifest.migrations[auditIndex];
  assert.equal(entry.backup_required, true);
  assert.equal(entry.migration_file, "20260723_release31_audit_schema_safety.sql");
  assert.equal(entry.verify_file, "20260723_release31_audit_schema_safety_verify.sql");
});

test("audit migration and verification cover tables columns indexes and enum values", () => {
  const migration = read("database/migrations/20260723_release31_audit_schema_safety.sql");
  const verification = read(
    "database/migrations/20260723_release31_audit_schema_safety_verify.sql"
  );

  for (const table of [
    "audit_signoffs",
    "audit_unlock_requests",
    "audit_reapproval_log",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(verification, new RegExp(table));
  }

  assert.match(migration, /stock_adjustment/);
  assert.match(migration, /audit_reapproval/);
  assert.match(verification, /information_schema\.STATISTICS/);
  assert.match(verification, /COLUMN_TYPE/);
  assert.match(verification, /missing_indexes/);
  assert.match(verification, /missing_request_areas/);
  assert.doesNotMatch(
    read("database/migrations/20260723_release31_runtime_schema_baseline_verify.sql"),
    /audit_signoffs|audit_unlock_requests|audit_reapproval_log/
  );
});
