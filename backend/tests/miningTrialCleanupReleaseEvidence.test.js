const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "backend", "package.json"), "utf8"));
const releaseEvidence = fs.readFileSync(path.join(root, "docs", "MINING_TRIAL_DATA_CLEANUP_RELEASE.md"), "utf8");
const NORMAL = "node -r ./services/exportWorkbookSafetyBootstrap.js server.js";
const PROFESSIONAL = "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js && ";
const P1 = "node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && ";
const P3 = "node scripts/runEquipmentFinanceOperationalPolishStartup.js && ";
const P4 = "node scripts/runEquipmentFinancePhaseFourStartup.js && ";
const P5A = "node scripts/runEquipmentFinancePhaseFiveAPrivateDocumentsStartup.js && ";
const P5B = "node scripts/runEquipmentFinancePhaseFiveBDocumentReviewStartup.js && ";
const P5C = "node scripts/runEquipmentFinancePhaseFiveCDeliveryAuthorizationStartup.js && ";
const P5D = "node scripts/runEquipmentFinancePhaseFiveDDeliveryConfirmationStartup.js && ";
const STOCK_COUNT = "node scripts/runBossApprovedProductQuantityCorrection20260802.js && ";

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
    `${P1}${P3}${P4}${P5A}${P5B}${P5C}${P5D}${STOCK_COUNT}${NORMAL}`,
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
