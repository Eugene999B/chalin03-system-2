const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, "package.json"), "utf8"));
const runnerSource = fs.readFileSync(path.join(backendDir, "scripts", "runEquipmentFinanceProfessionalRebuildMigration.js"), "utf8");
const EXPECTED_START = "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js && node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && node scripts/runEquipmentFinanceOperationalPolishStartup.js && node scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js && node scripts/runEquipmentFinancePhaseFourStartup.js && node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && node scripts/runEquipmentFinancePhaseSixStartup.js && node scripts/runEquipmentFinancePhaseSixPerformanceStartup.js && node scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805.js && node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js && node scripts/runBossApprovedProductQuantityCorrection20260802.js && node scripts/runBossApprovedProductQuantityCorrection20260804.js && node scripts/runCustomerMergeAuditDateSanitizer20260805.js && node scripts/runAutomaticCustomerMergeRollback20260805.js && node -r ./services/exportWorkbookSafetyBootstrap.js server.js";

test("completed professional Finance migration is not rerun during Railway startup", () => {
  assert.equal(packageJson.scripts.start, EXPECTED_START);
  assert.doesNotMatch(packageJson.scripts.start, /runEquipmentFinanceProfessionalRebuildMigration\.js/);
  assert.doesNotMatch(
    packageJson.scripts.start,
    /node scripts\/runUserAuthorizedInstallmentExcavatorCleanup20260805\.js/
  );
  for (const gate of [
    /runEquipmentFinancePhaseOneEmergencyRepair\.js/,
    /runEquipmentFinanceOpeningDepositFoundationRepair\.js/,
    /runEquipmentFinancePhaseFourStartup\.js/,
    /runEquipmentFinancePhaseFiveAPrivateDocumentsStartup\.js/,
    /runEquipmentFinancePhaseFiveBDocumentReviewStartup\.js/,
    /runEquipmentFinancePhaseFiveUnifiedDocumentsStartup\.js/,
    /runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup\.js/,
    /runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup\.js/,
    /runEquipmentFinancePhaseSixStartup\.js/,
    /runEquipmentFinancePhaseSixPerformanceStartup\.js/,
    /runUserAuthorizedInstallmentRestartResetLockFix20260805\.js/,
    /runInstallmentExcavatorCleanupBestEffortStartup20260805\.js/,
    /runBossApprovedProductQuantityCorrection20260802\.js/,
    /runBossApprovedProductQuantityCorrection20260804\.js/,
    /runCustomerMergeAuditDateSanitizer20260805\.js/,
    /runAutomaticCustomerMergeRollback20260805\.js/,
  ]) assert.match(packageJson.scripts.start, gate);
  assert.equal(packageJson.scripts["migrate:equipment-finance:professional:production"], "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js");
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:production"],
    "node scripts/runUserAuthorizedInstallmentExcavatorCleanup20260805.js"
  );
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:startup-safe"],
    "node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:customer-merge-audit-dates:20260805:production"],
    "node scripts/runCustomerMergeAuditDateSanitizer20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:customer-merges:20260805:production"],
    "node scripts/runAutomaticCustomerMergeRollback20260805.js"
  );
});

test("professional Finance manual gate retains backup, safety snapshot and exact release controls", () => {
  assert.match(runnerSource, /CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED/);
  assert.match(runnerSource, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(runnerSource, /chalin03_migration_safety_snapshots/);
  assert.match(runnerSource, /createOrVerifySafetySnapshot/);
  assert.doesNotMatch(runnerSource, /Confirm the separate verified SQL backup first/);
  assert.match(runnerSource, /20260731_EQUIPMENT_FINANCE_PROFESSIONAL/);
  assert.match(runnerSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /GET_LOCK/);
  assert.match(runnerSource, /Professional Equipment Installment Finance migration verified successfully/);
});

test("professional Finance manual gate cannot run destructive production reset operations", () => {
  assert.doesNotMatch(runnerSource, /database\/schema\.sql/);
  assert.doesNotMatch(runnerSource, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(runnerSource, /DROP\s+DATABASE/i);
  assert.doesNotMatch(runnerSource, /DELETE\s+FROM/i);
  assert.match(runnerSource, /INSERT IGNORE INTO/);
});
