const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "backend", "package.json"), "utf8")
);
const releaseEvidence = fs.readFileSync(
  path.join(root, "docs", "MINING_TRIAL_DATA_CLEANUP_RELEASE.md"),
  "utf8"
);
const EXPECTED_START = "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js && node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && node scripts/runEquipmentFinanceOperationalPolishStartup.js && node scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js && node scripts/runEquipmentFinancePhaseFourStartup.js && node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js && node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && node scripts/runEquipmentFinancePhaseSixStartup.js && node scripts/runEquipmentFinancePhaseSixPerformanceStartup.js && node scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805.js && node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js && node scripts/runBossApprovedProductQuantityCorrection20260802.js && node scripts/runBossApprovedProductQuantityCorrection20260804.js && node scripts/runKwabenaProductQuantityCorrection20260806.js && node scripts/runCustomerMergeAuditDateSanitizer20260805.js && node scripts/runAutomaticCustomerMergeRollback20260805.js && node scripts/runExactNameReceiptOwnerRecovery20260805.js && node scripts/runMissingCreditDebtBackfill20260805.js && node scripts/runZeroPaymentCreditDebtVisibilityRepair20260805.js && node scripts/runMasterMickeyJuly31ExactDebtRepair20260805.js && node scripts/runUnpaidReceiptIdentityIsolation20260805.js && node -r ./services/exportWorkbookSafetyBootstrap.js server.js";

test("completed Mining cleanup runner cannot execute again from application startup", () => {
  assert.equal(
    packageJson.scripts.start,
    EXPECTED_START,
    "Railway startup must use only the exact reviewed recurring gates."
  );
  assert.doesNotMatch(packageJson.scripts.start, /runMiningTrialCleanup/i);
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runPostRollbackDebtAccountReconciliation20260805\.js/
  );
  assert.equal(
    fs.existsSync(
      path.join(root, "backend", "scripts", "runMiningTrialCleanup.js")
    ),
    false
  );
});

test("Mining cleanup release evidence retains production commit and durable marker", () => {
  assert.match(releaseEvidence, /1165c031f62850f1de86b44ae3848217c9b99632/);
  assert.match(releaseEvidence, /20260726_mining_trial_data_cleanup/);
  assert.match(releaseEvidence, /Spare Parts/);
  assert.match(releaseEvidence, /Equipment Hire/);
  assert.match(releaseEvidence, /shared-fleet/);
});
