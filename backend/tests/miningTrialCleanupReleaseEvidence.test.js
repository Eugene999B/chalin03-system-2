const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "backend", "package.json"), "utf8"));
const releaseEvidence = fs.readFileSync(path.join(root, "docs", "MINING_TRIAL_DATA_CLEANUP_RELEASE.md"), "utf8");
const NORMAL = "node -r ./services/exportWorkbookSafetyBootstrap.js server.js";
const PROFESSIONAL = "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js && ";
const P1_REPAIR = "node scripts/runEquipmentFinancePhaseOneEmergencyRepair.js && ";
const P1 = "node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && ";
const P3 = "node scripts/runEquipmentFinanceOperationalPolishStartup.js && ";
const OPENING_DEPOSIT_REPAIR = "node scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js && ";
const P4 = "node scripts/runEquipmentFinancePhaseFourStartup.js && ";
const P5A = "node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && ";
const P5B = "node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && ";
const P5_UNIFIED = "node scripts/runEquipmentFinancePhaseFiveUnifiedDocumentsStartup.js && ";
const P5C = "node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && ";
const P5D = "node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && ";
const P6 = "node scripts/runEquipmentFinancePhaseSixStartup.js && ";
const P6_PERFORMANCE = "node scripts/runEquipmentFinancePhaseSixPerformanceStartup.js && ";
const INSTALLMENT_RESTART_RESET = "node scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805.js && ";
const INSTALLMENT_EXCAVATOR_CLEANUP = "node scripts/runUserAuthorizedInstallmentExcavatorCleanup20260805.js && ";
const INSTALLMENT_EXCAVATOR_SAFE_RECOVERY = "node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js && ";
const STOCK_COUNT_20260802 = "node scripts/runBossApprovedProductQuantityCorrection20260802.js && ";
const STOCK_COUNT_20260804 = "node scripts/runBossApprovedProductQuantityCorrection20260804.js && ";
const CUSTOMER_MERGE_AUDIT_DATE_SANITIZER = "node scripts/runCustomerMergeAuditDateSanitizer20260805.js && ";
const CUSTOMER_MERGE_ROLLBACK = "node scripts/runAutomaticCustomerMergeRollback20260805.js && ";
const CUSTOMER_DEBT_ACCOUNT_RECONCILIATION = "node scripts/runPostRollbackDebtAccountReconciliation20260805.js && ";

test("completed Mining cleanup runner cannot execute again from application startup", () => {
  assert.doesNotMatch(packageJson.scripts.start, /runMiningTrialCleanup/i);
  const approvedStarts = new Set([
    NORMAL,
    `${PROFESSIONAL}${NORMAL}`,
    `${P3}${NORMAL}`,
    `${P1}${P3}${NORMAL}`,
    `${P1}${P3}${P4}${NORMAL}`,
    `${P1}${P3}${P4}${P5A}${NORMAL}`,
    `${P1}${P3}${P4}${P5A}${P5B}${NORMAL}`,
    `${P1}${P3}${P4}${P5A}${P5B}${P5C}${NORMAL}`,
    `${P1}${P3}${P4}${P5A}${P5B}${P5C}${P5D}${NORMAL}`,
    `${P1}${P3}${P4}${P5A}${P5B}${P5C}${P5D}${STOCK_COUNT_20260802}${NORMAL}`,
    `${P1}${P3}${P4}${P5A}${P5B}${P5C}${P5D}${P6}${STOCK_COUNT_20260802}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${P4}${P5A}${P5B}${P5C}${P5D}${P6}${STOCK_COUNT_20260802}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${STOCK_COUNT_20260802}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${STOCK_COUNT_20260802}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${INSTALLMENT_RESTART_RESET}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${INSTALLMENT_RESTART_RESET}${INSTALLMENT_EXCAVATOR_CLEANUP}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${INSTALLMENT_RESTART_RESET}${INSTALLMENT_EXCAVATOR_SAFE_RECOVERY}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${INSTALLMENT_RESTART_RESET}${INSTALLMENT_EXCAVATOR_SAFE_RECOVERY}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${CUSTOMER_MERGE_ROLLBACK}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${INSTALLMENT_RESTART_RESET}${INSTALLMENT_EXCAVATOR_SAFE_RECOVERY}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${CUSTOMER_MERGE_AUDIT_DATE_SANITIZER}${CUSTOMER_MERGE_ROLLBACK}${NORMAL}`,
    `${P1_REPAIR}${P1}${P3}${OPENING_DEPOSIT_REPAIR}${P4}${P5A}${P5B}${P5_UNIFIED}${P5C}${P5D}${P6}${P6_PERFORMANCE}${INSTALLMENT_RESTART_RESET}${INSTALLMENT_EXCAVATOR_SAFE_RECOVERY}${STOCK_COUNT_20260802}${STOCK_COUNT_20260804}${CUSTOMER_MERGE_AUDIT_DATE_SANITIZER}${CUSTOMER_MERGE_ROLLBACK}${CUSTOMER_DEBT_ACCOUNT_RECONCILIATION}${NORMAL}`,
  ]);
  assert.equal(approvedStarts.has(packageJson.scripts.start), true, "Startup may be normal or use only reviewed startup gates.");
  assert.equal(fs.existsSync(path.join(root, "backend", "scripts", "runMiningTrialCleanup.js")), false);
});

test("Mining cleanup release evidence retains production commit and durable marker", () => {
  assert.match(releaseEvidence, /1165c031f62850f1de86b44ae3848217c9b99632/);
  assert.match(releaseEvidence, /20260726_mining_trial_data_cleanup/);
  assert.match(releaseEvidence, /Spare Parts/);
  assert.match(releaseEvidence, /Equipment Hire/);
  assert.match(releaseEvidence, /shared-fleet/);
});
