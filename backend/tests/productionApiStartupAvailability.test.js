const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);

test("production web server starts independently of one-time maintenance jobs", () => {
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );

  for (const forbidden of [
    "runUserAuthorizedInstallmentRestartResetLockFix20260805.js",
    "runBossApprovedProductQuantityCorrection20260802.js",
    "runAutomaticCustomerMergeRollback20260805.js",
    "runMissingCreditDebtBackfill20260805.js",
  ]) {
    assert.doesNotMatch(packageJson.scripts.start, new RegExp(forbidden));
  }
});

test("legacy repair chain remains explicit for controlled maintenance", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  assert.ok(maintenance);
  assert.match(maintenance, /runEquipmentFinancePhaseOneSchemaStartup\.js/);
  assert.match(maintenance, /runEquipmentFinancePhaseSixStartup\.js/);
  assert.match(maintenance, /runUserAuthorizedInstallmentRestartResetLockFix20260805\.js/);
  assert.match(maintenance, /runUnpaidReceiptIdentityIsolation20260805\.js/);
});
