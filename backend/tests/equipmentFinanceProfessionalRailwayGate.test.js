const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, "package.json"), "utf8"));
const runnerSource = fs.readFileSync(path.join(backendDir, "scripts", "runEquipmentFinanceProfessionalRebuildMigration.js"), "utf8");
const EXPECTED_MAINTENANCE = "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js && node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && node scripts/runEquipmentFinanceOperationalPolishStartup.js && node scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js && node scripts/runEquipmentFinancePhaseFourStartup.js && node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && node scripts/runEquipmentFinancePhaseSixStartup.js && node scripts/runEquipmentFinancePhaseSixPerformanceStartup.js && node scripts/runEquipmentFinanceTermsApprovalRepair20260806.js && node scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805.js && node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js && node scripts/runBossApprovedProductQuantityCorrection20260802.js && node scripts/runBossApprovedProductQuantityCorrection20260804.js && node scripts/runKwabenaProductQuantityCorrection20260806.js && node scripts/runCustomerMergeAuditDateSanitizer20260805.js && node scripts/runAutomaticCustomerMergeRollback20260805.js && node scripts/runExactNameReceiptOwnerRecovery20260805.js && node scripts/runMissingCreditDebtBackfill20260805.js && node scripts/runZeroPaymentCreditDebtVisibilityRepair20260805.js && node scripts/runMasterMickeyJuly31ExactDebtRepair20260805.js && node scripts/runUnpaidReceiptIdentityIsolation20260805.js";

test("completed professional Finance migration is not rerun during API startup or controlled maintenance", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(maintenance, EXPECTED_MAINTENANCE);
  assert.doesNotMatch(maintenance, /runEquipmentFinanceProfessionalRebuildMigration\.js/);
  assert.doesNotMatch(packageJson.scripts.start, /runEquipmentFinanceProfessionalRebuildMigration\.js/);
  assert.doesNotMatch(
    maintenance,
    /node scripts\/runUserAuthorizedInstallmentExcavatorCleanup20260805\.js/
  );
  assert.doesNotMatch(
    maintenance,
    /runPostRollbackDebtAccountReconciliation20260805\.js/
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
    /runEquipmentFinanceTermsApprovalRepair20260806\.js/,
    /runUserAuthorizedInstallmentRestartResetLockFix20260805\.js/,
    /runInstallmentExcavatorCleanupBestEffortStartup20260805\.js/,
    /runBossApprovedProductQuantityCorrection20260802\.js/,
    /runBossApprovedProductQuantityCorrection20260804\.js/,
    /runKwabenaProductQuantityCorrection20260806\.js/,
    /runCustomerMergeAuditDateSanitizer20260805\.js/,
    /runAutomaticCustomerMergeRollback20260805\.js/,
    /runExactNameReceiptOwnerRecovery20260805\.js/,
    /runMissingCreditDebtBackfill20260805\.js/,
    /runZeroPaymentCreditDebtVisibilityRepair20260805\.js/,
    /runMasterMickeyJuly31ExactDebtRepair20260805\.js/,
    /runUnpaidReceiptIdentityIsolation20260805\.js/,
  ]) assert.match(maintenance, gate);
  assert.equal(packageJson.scripts["migrate:equipment-finance:professional:production"], "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js");
  assert.equal(
    packageJson.scripts["repair:equipment-finance-terms-approval:20260806:production"],
    "node scripts/runEquipmentFinanceTermsApprovalRepair20260806.js"
  );
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:production"],
    "node scripts/runUserAuthorizedInstallmentExcavatorCleanup20260805.js"
  );
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:startup-safe"],
    "node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:kwabena-main-store-quantities:20260806:production"],
    "node scripts/runKwabenaProductQuantityCorrection20260806.js"
  );
  assert.equal(
    packageJson.scripts["repair:customer-merge-audit-dates:20260805:production"],
    "node scripts/runCustomerMergeAuditDateSanitizer20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:customer-merges:20260805:production"],
    "node scripts/runAutomaticCustomerMergeRollback20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:exact-name-receipt-owners:20260805:production"],
    "node scripts/runExactNameReceiptOwnerRecovery20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:missing-credit-debts:20260805:production"],
    "node scripts/runMissingCreditDebtBackfill20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:zero-payment-credit-debt-visibility:20260805:production"],
    "node scripts/runZeroPaymentCreditDebtVisibilityRepair20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:master-mickey-july31-exact-debt:20260805:production"],
    "node scripts/runMasterMickeyJuly31ExactDebtRepair20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:unpaid-receipt-identity-isolation:20260805:production"],
    "node scripts/runUnpaidReceiptIdentityIsolation20260805.js"
  );
  assert.equal(
    packageJson.scripts["repair:post-rollback-debt-accounts:20260805:production"],
    undefined
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
