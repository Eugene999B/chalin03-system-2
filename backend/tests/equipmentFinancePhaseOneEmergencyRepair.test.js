const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  EXPECTED_PROBLEMS,
  REPAIR_NAME,
  phaseOneSchemaNeedsRepair,
} = require("../scripts/runEquipmentFinancePhaseOneEmergencyRepair");

const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "..");

function verifierRows(overrides = {}) {
  return EXPECTED_PROBLEMS.map((key) => [{ [key]: overrides[key] || 0 }]);
}

function verifierConnection(results) {
  let index = 0;
  return {
    async query() {
      const rows = results[index];
      index += 1;
      return [rows];
    },
  };
}

test("Phase 1 emergency repair accepts a healthy schema", async () => {
  const connection = verifierConnection(verifierRows());
  assert.equal(await phaseOneSchemaNeedsRepair(connection), false);
});

test("Phase 1 emergency repair detects any missing installment schema part", async () => {
  const problem = EXPECTED_PROBLEMS[2];
  const connection = verifierConnection(verifierRows({ [problem]: 1 }));
  assert.equal(await phaseOneSchemaNeedsRepair(connection), true);
});

test("controlled maintenance repairs Phase 1 before the strict verifier while API startup stays independent", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
  );
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const repairIndex = maintenance.indexOf("runEquipmentFinancePhaseOneEmergencyRepair.js");
  const verifierIndex = maintenance.indexOf("runEquipmentFinancePhaseOneSchemaStartup.js");
  const operationalIndex = maintenance.indexOf("runEquipmentFinanceOperationalPolishStartup.js");

  assert.ok(repairIndex >= 0);
  assert.ok(verifierIndex > repairIndex);
  assert.ok(operationalIndex > verifierIndex);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase1-repair:production"],
    "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js"
  );
});

test("Emergency repair only reuses the approved additive migration", () => {
  const script = fs.readFileSync(
    path.join(backendRoot, "scripts", "runEquipmentFinancePhaseOneEmergencyRepair.js"),
    "utf8"
  );
  const migration = fs.readFileSync(
    path.join(
      repositoryRoot,
      "database",
      "migrations",
      "20260801_equipment_finance_phase1_schema_foundation.sql"
    ),
    "utf8"
  );

  assert.match(REPAIR_NAME, /Phase 1 emergency compatibility repair/);
  assert.match(script, /MIGRATION_FILE/);
  assert.match(script, /MIGRATION_LOCK_NAME/);
  assert.match(script, /verifyPhaseOneSchema/);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
});
