const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendDir, "package.json"), "utf8")
);
const startupSource = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceOperationalPolishStartup.js"
  ),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceOperationalPolishMigration.js"
  ),
  "utf8"
);

const EXPECTED_START =
  "node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && node scripts/runEquipmentFinanceOperationalPolishStartup.js && node -r ./services/exportWorkbookSafetyBootstrap.js server.js";

test("Railway runs the Phase 1 schema and Phase 3 gates before accepting API traffic", () => {
  assert.equal(packageJson.scripts.start, EXPECTED_START);
  const phaseOneIndex = packageJson.scripts.start.indexOf(
    "runEquipmentFinancePhaseOneSchemaStartup.js"
  );
  const phaseThreeIndex = packageJson.scripts.start.indexOf(
    "runEquipmentFinanceOperationalPolishStartup.js"
  );
  const serverIndex = packageJson.scripts.start.indexOf("server.js");
  assert.ok(phaseOneIndex >= 0);
  assert.ok(phaseThreeIndex > phaseOneIndex);
  assert.ok(serverIndex > phaseThreeIndex);
});

test("first Phase 3 startup uses the controlled migration runner", () => {
  assert.match(startupSource, /migrationRecordExists/);
  assert.match(startupSource, /runEquipmentFinanceOperationalPolishMigration/);
  assert.match(startupSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(
    migrationSource,
    /20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH/
  );
  assert.match(migrationSource, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(migrationSource, /CHALIN03_SQL_BACKUP_CONFIRMED/);
  assert.match(migrationSource, /GET_LOCK/);
  assert.match(migrationSource, /assertPreservedCounts/);
});

test("completed Phase 3 startup is read-only verification", () => {
  assert.match(startupSource, /readVerifierSql/);
  assert.match(startupSource, /validateVerifierResults/);
  assert.match(startupSource, /migration already applied and verified/);
  assert.doesNotMatch(startupSource, /database\/schema\.sql/);
  assert.doesNotMatch(startupSource, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(startupSource, /DROP\s+DATABASE/i);
  assert.doesNotMatch(startupSource, /DELETE\s+FROM/i);
  assert.doesNotMatch(startupSource, /UPDATE\s+/i);
  assert.doesNotMatch(startupSource, /INSERT\s+/i);
});

test("Phase 3 startup fails closed before the server on wrong database identity", () => {
  assert.match(startupSource, /SELECT DATABASE\(\) AS database_name/);
  assert.match(
    startupSource,
    /does not match CHALIN03_EXPECTED_DATABASE/
  );
  assert.match(
    startupSource,
    /Equipment Finance Phase 3 Railway startup gate failed/
  );
  assert.match(startupSource, /process\.exit\(1\)/);
});
