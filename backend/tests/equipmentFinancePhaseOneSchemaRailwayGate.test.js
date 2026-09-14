const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  EXPECTED_PROBLEMS,
  MIGRATION_FILE,
  MIGRATION_RECORD,
  RELEASE_CONFIRMATION,
  VERIFIER_FILE,
  assertMigrationReleaseGates,
  splitSqlScript,
  validateVerifierResults,
} = require("../scripts/runEquipmentFinancePhaseOneSchemaStartup");

const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "..");
const migrationRoot = path.join(repositoryRoot, "database", "migrations");

function readMigration(filename) {
  return fs.readFileSync(path.join(migrationRoot, filename), "utf8");
}

test("Phase 1 schema runner targets the approved migration and verifier", () => {
  assert.equal(MIGRATION_FILE, "20260801_equipment_finance_phase1_schema_foundation.sql");
  assert.equal(
    VERIFIER_FILE,
    "20260801_equipment_finance_phase1_schema_foundation_verify.sql"
  );
  assert.equal(MIGRATION_RECORD, "20260801_equipment_finance_phase1_schema_foundation");
  assert.equal(RELEASE_CONFIRMATION, "20260801_EQUIPMENT_FINANCE_PHASE1_SCHEMA");

  const migrationStatements = splitSqlScript(readMigration(MIGRATION_FILE));
  const verifierStatements = splitSqlScript(readMigration(VERIFIER_FILE));
  assert.ok(migrationStatements.length > 1);
  assert.equal(verifierStatements.length, EXPECTED_PROBLEMS.length);
});

test("Phase 1 release gates require production, backup confirmation and exact release", () => {
  assert.throws(
    () => assertMigrationReleaseGates({ NODE_ENV: "development" }),
    /NODE_ENV=production/
  );
  assert.throws(
    () =>
      assertMigrationReleaseGates({
        NODE_ENV: "production",
        CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
      }),
    /Professional Backup/
  );
  assert.throws(
    () =>
      assertMigrationReleaseGates({
        NODE_ENV: "production",
        CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
        CHALIN03_MIGRATION_RELEASE: "wrong-release",
      }),
    new RegExp(RELEASE_CONFIRMATION)
  );
  assert.doesNotThrow(() =>
    assertMigrationReleaseGates({
      NODE_ENV: "production",
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
    })
  );
});

test("Phase 1 verifier rejects any non-zero database problem", () => {
  const passing = EXPECTED_PROBLEMS.map((key) => [{ [key]: 0 }]);
  assert.doesNotThrow(() => validateVerifierResults(passing));

  const failing = EXPECTED_PROBLEMS.map((key) => [{ [key]: 0 }]);
  failing[2][0][EXPECTED_PROBLEMS[2]] = 1;
  assert.throws(
    () => validateVerifierResults(failing),
    new RegExp(`${EXPECTED_PROBLEMS[2]}=1`)
  );
});

test("controlled maintenance checks Phase 1 before the existing Finance gate", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
  );
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const phaseOneIndex = maintenance.indexOf("runEquipmentFinancePhaseOneSchemaStartup.js");
  const operationalIndex = maintenance.indexOf("runEquipmentFinanceOperationalPolishStartup.js");

  assert.ok(phaseOneIndex >= 0);
  assert.ok(operationalIndex > phaseOneIndex);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase1-schema:production"],
    "node scripts/runEquipmentFinancePhaseOneSchemaStartup.js"
  );
});
