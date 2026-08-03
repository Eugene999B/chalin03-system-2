const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, "package.json"), "utf8"));
const startupSource = fs.readFileSync(path.join(backendDir, "scripts", "runEquipmentFinanceOperationalPolishStartup.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(backendDir, "scripts", "runEquipmentFinanceOperationalPolishMigration.js"), "utf8");
const EXPECTED_START = "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js && node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && node scripts/runEquipmentFinanceOperationalPolishStartup.js && node scripts/runEquipmentFinancePhaseFourStartup.js && node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && node scripts/runEquipmentFinancePhaseSixStartup.js && node scripts/runBossApprovedProductQuantityCorrection20260802.js && node -r ./services/exportWorkbookSafetyBootstrap.js server.js";

test("Railway runs every reviewed startup gate before API traffic", () => {
  assert.equal(packageJson.scripts.start, EXPECTED_START);
  const phases = [
    "runEquipmentFinancePhaseOneEmergencyRepair.js",
    "runEquipmentFinancePhaseOneSchemaStartup.js",
    "runEquipmentFinanceOperationalPolishStartup.js",
    "runEquipmentFinancePhaseFourStartup.js",
    "runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js",
    "runEquipmentFinancePhaseFiveBDocumentReviewStartup.js",
    "runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js",
    "runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js",
    "runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js",
    "runEquipmentFinancePhaseSixStartup.js",
    "runBossApprovedProductQuantityCorrection20260802.js",
    "server.js",
  ];
  let previous = -1;
  for (const phase of phases) {
    const current = packageJson.scripts.start.indexOf(phase);
    assert.ok(current > previous, `${phase} must run in reviewed order.`);
    previous = current;
  }
});

test("first Phase 3 startup uses the controlled migration runner", () => {
  assert.match(startupSource, /migrationRecordExists/);
  assert.match(startupSource, /runEquipmentFinanceOperationalPolishMigration/);
  assert.match(startupSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(migrationSource, /20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH/);
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
  assert.match(startupSource, /does not match CHALIN03_EXPECTED_DATABASE/);
  assert.match(startupSource, /Equipment Finance Phase 3 Railway startup gate failed/);
  assert.match(startupSource, /process\.exit\(1\)/);
});

