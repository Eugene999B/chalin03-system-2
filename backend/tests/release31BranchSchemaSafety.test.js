const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

test("branch routes never perform runtime schema migration or default-store seeding", () => {
  const source = read("routes/branchRoutes.js");

  assert.match(source, /assertBranchSchemaReady/);
  assert.doesNotMatch(source, /ensureBranchesTable/);
  assert.doesNotMatch(source, /CREATE\s+TABLE/i);
  assert.doesNotMatch(source, /ALTER\s+TABLE/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+branches[\s\S]*SELECT\s+'MAIN'/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+branches[\s\S]*SELECT\s+'AJAKAA'/i);
});

test("branch schema readiness is read-only and checks the full route contract", () => {
  const source = read("services/branchSchemaReadinessService.js");

  for (const column of [
    "id",
    "code",
    "branch_code",
    "name",
    "location",
    "phone",
    "is_active",
    "created_at",
    "updated_at",
  ]) {
    assert.match(source, new RegExp(`\\"${column}\\"`));
  }

  assert.match(source, /information_schema\.TABLES/);
  assert.match(source, /information_schema\.COLUMNS/);
  assert.match(source, /BRANCH_SCHEMA_NOT_READY/);
  assert.doesNotMatch(source, /CREATE\s+TABLE/i);
  assert.doesNotMatch(source, /ALTER\s+TABLE/i);
  assert.doesNotMatch(source, /INSERT\s+INTO/i);
  assert.doesNotMatch(source, /UPDATE\s+branches/i);
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
});
