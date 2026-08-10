const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, "package.json"), "utf8"));
const startupSource = fs.readFileSync(path.join(backendDir, "scripts", "runEquipmentFinanceOperationalPolishStartup.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(backendDir, "scripts", "runEquipmentFinanceOperationalPolishMigration.js"), "utf8");
const cleanupStartupSource = fs.readFileSync(path.join(backendDir, "scripts", "runInstallmentExcavatorCleanupBestEffortStartup20260805.js"), "utf8");
const API_START = "node -r ./services/exportWorkbookSafetyBootstrap.js server.js";
const EXPECTED_MAINTENANCE = "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js && node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && node scripts/runEquipmentFinanceOperationalPolishStartup.js && node scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js && node scripts/runEquipmentFinancePhaseFourStartup.js && node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && node scripts/runEquipmentFinancePhaseSixStartup.js && node scripts/runEquipmentFinancePhaseSixPerformanceStartup.js && node scripts/runEquipmentFinanceTermsApprovalRepair20260806.js && node scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805.js && node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js && node scripts/runBossApprovedProductQuantityCorrection20260802.js && node scripts/runBossApprovedProductQuantityCorrection20260804.js && node scripts/runKwabenaProductQuantityCorrection20260806.js && node scripts/runCustomerMergeAuditDateSanitizer20260805.js && node scripts/runAutomaticCustomerMergeRollback20260805.js && node scripts/runExactNameReceiptOwnerRecovery20260805.js && node scripts/runMissingCreditDebtBackfill20260805.js && node scripts/runZeroPaymentCreditDebtVisibilityRepair20260805.js && node scripts/runMasterMickeyJuly31ExactDebtRepair20260805.js && node scripts/runUnpaidReceiptIdentityIsolation20260805.js";

test("controlled maintenance keeps every reviewed recurring gate while API startup stays independent", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  assert.equal(packageJson.scripts.start, API_START);
  assert.equal(maintenance, EXPECTED_MAINTENANCE);
  assert.doesNotMatch(
    maintenance,
    /node scripts\/runUserAuthorizedInstallmentExcavatorCleanup20260805\.js/,
    "the fail-closed one-time cleanup must not block the controlled maintenance plan"
  );
  assert.doesNotMatch(
    maintenance,
    /runPostRollbackDebtAccountReconciliation20260805\.js/,
    "the unsafe broad customer regrouping must never run again"
  );
  assert.match(
    cleanupStartupSource,
    /API startup will continue with the operational-reset visibility cutoff/
  );
  assert.match(cleanupStartupSource, /process\.exitCode = 0/);
  const phases = [
    "runEquipmentFinancePhaseOneEmergencyRepair.js",
    "runEquipmentFinancePhaseOneSchemaStartup.js",
    "runEquipmentFinanceOperationalPolishStartup.js",
    "runEquipmentFinanceOpeningDepositFoundationRepair.js",
    "runEquipmentFinancePhaseFourStartup.js",
    "runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js",
    "runEquipmentFinancePhaseFiveBDocumentReviewStartup.js",
    "runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js",
    "runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js",
    "runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js",
    "runEquipmentFinancePhaseSixStartup.js",
    "runEquipmentFinancePhaseSixPerformanceStartup.js",
    "runEquipmentFinanceTermsApprovalRepair20260806.js",
    "runUserAuthorizedInstallmentRestartResetLockFix20260805.js",
    "runInstallmentExcavatorCleanupBestEffortStartup20260805.js",
    "runBossApprovedProductQuantityCorrection20260802.js",
    "runBossApprovedProductQuantityCorrection20260804.js",
    "runKwabenaProductQuantityCorrection20260806.js",
    "runCustomerMergeAuditDateSanitizer20260805.js",
    "runAutomaticCustomerMergeRollback20260805.js",
    "runExactNameReceiptOwnerRecovery20260805.js",
    "runMissingCreditDebtBackfill20260805.js",
    "runZeroPaymentCreditDebtVisibilityRepair20260805.js",
    "runMasterMickeyJuly31ExactDebtRepair20260805.js",
    "runUnpaidReceiptIdentityIsolation20260805.js",
  ];
  let previous = -1;
  for (const phase of phases) {
    const current = maintenance.indexOf(phase);
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
