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

const NORMAL_BACKEND_START =
  "node -r ./services/exportWorkbookSafetyBootstrap.js server.js";
const APPROVED_PROFESSIONAL_FINANCE_GATE =
  "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js && ";
const APPROVED_PHASE1_FINANCE_GATE =
  "node scripts/runEquipmentFinancePhaseOneSchemaStartup.js && ";
const APPROVED_PHASE3_FINANCE_GATE =
  "node scripts/runEquipmentFinanceOperationalPolishStartup.js && ";

test("completed Mining cleanup runner cannot execute again from application startup", () => {
  assert.doesNotMatch(packageJson.scripts.start, /runMiningTrialCleanup/i);
  const approvedStarts = new Set([
    NORMAL_BACKEND_START,
    `${APPROVED_PROFESSIONAL_FINANCE_GATE}${NORMAL_BACKEND_START}`,
    `${APPROVED_PHASE3_FINANCE_GATE}${NORMAL_BACKEND_START}`,
    `${APPROVED_PHASE1_FINANCE_GATE}${APPROVED_PHASE3_FINANCE_GATE}${NORMAL_BACKEND_START}`,
  ]);
  assert.equal(
    approvedStarts.has(packageJson.scripts.start),
    true,
    "Startup may be normal or use only reviewed Equipment Finance startup gates."
  );
  assert.equal(
    fs.existsSync(
      path.join(root, "backend", "scripts", "runMiningTrialCleanup.js")
    ),
    false
  );
});

test("Mining cleanup release evidence retains production commit and durable marker", () => {
  assert.match(
    releaseEvidence,
    /1165c031f62850f1de86b44ae3848217c9b99632/
  );
  assert.match(releaseEvidence, /20260726_mining_trial_data_cleanup/);
  assert.match(releaseEvidence, /Spare Parts/);
  assert.match(releaseEvidence, /Equipment Hire/);
  assert.match(releaseEvidence, /shared-fleet/);
});
