const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "../..");
const {
  resolveMaintenanceClearAvailability,
} = require("../services/maintenanceResetService");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("production business-data clearing is permanently blocked", () => {
  const availability = resolveMaintenanceClearAvailability({
    NODE_ENV: "production",
    ALLOW_CLEAR_BUSINESS_DATA: "true",
  });

  assert.equal(availability.enabled, false);
  assert.equal(availability.production_permanently_blocked, true);
  assert.equal(
    availability.code,
    "PRODUCTION_BUSINESS_DATA_CLEAR_PERMANENTLY_BLOCKED"
  );
});

test("non-production reset requires explicit opt-in", () => {
  assert.equal(
    resolveMaintenanceClearAvailability({ NODE_ENV: "development" }).enabled,
    false
  );
  assert.equal(
    resolveMaintenanceClearAvailability({
      NODE_ENV: "development",
      ALLOW_CLEAR_BUSINESS_DATA: "true",
    }).enabled,
    true
  );
});

test("maintenance reset contains no implicit-commit clearing operations", () => {
  const route = read("backend/routes/maintenanceRoutes.js");
  const service = read("backend/services/maintenanceResetService.js");
  const frontend = read("frontend/src/pages/MaintenancePage.jsx");

  assert.doesNotMatch(route, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
  assert.doesNotMatch(service, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(service, /ALTER\s+TABLE/i);
  assert.match(service, /DELETE FROM/);
  assert.match(service, /beginTransaction/);
  assert.match(service, /rollback/);
  assert.match(service, /SET FOREIGN_KEY_CHECKS = 1/);
  assert.match(service, /PRODUCTION_BUSINESS_DATA_CLEAR_PERMANENTLY_BLOCKED/);
  assert.match(route, /clearTablesTransactionally/);
  assert.match(frontend, /Production reset is permanently blocked/);
  assert.match(frontend, /Reset Non-Production Test Data/);
  assert.doesNotMatch(
    frontend,
    /Railway[\s\S]{0,120}ALLOW_CLEAR_BUSINESS_DATA must be set to true/i
  );
});
