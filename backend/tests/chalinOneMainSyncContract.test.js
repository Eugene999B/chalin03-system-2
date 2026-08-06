"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const backendPackage = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "backend/package.json"), "utf8")
);
const systemRoutes = fs.readFileSync(
  path.join(repoRoot, "backend/routes/systemRoutes.js"),
  "utf8"
);
const frontendMain = fs.readFileSync(
  path.join(repoRoot, "frontend/src/main.jsx"),
  "utf8"
);

test("synchronized backend start retains every verified production recovery script", () => {
  const start = backendPackage.scripts.start;
  const requiredScripts = [
    "runCustomerMergeAuditDateSanitizer20260805.js",
    "runAutomaticCustomerMergeRollback20260805.js",
    "runExactNameReceiptOwnerRecovery20260805.js",
    "runMissingCreditDebtBackfill20260805.js",
    "runZeroPaymentCreditDebtVisibilityRepair20260805.js",
    "runMasterMickeyJuly31ExactDebtRepair20260805.js",
    "runUnpaidReceiptIdentityIsolation20260805.js",
    "exportWorkbookSafetyBootstrap.js",
  ];

  for (const script of requiredScripts) {
    assert.match(start, new RegExp(script.replaceAll(".", "\\.")));
  }
});

test("CHALIN ONE database migration remains explicit and outside normal startup", () => {
  assert.equal(
    backendPackage.scripts["migrate:chalin-one:public-content"],
    "node scripts/runChalinOnePublicContentFoundationMigration.js"
  );
  assert.doesNotMatch(
    backendPackage.scripts.start,
    /runChalinOnePublicContentFoundationMigration/
  );
});

test("system routes preserve customer merge emergency containment", () => {
  assert.match(systemRoutes, /customerMergeRecoveryRoutes/);
  assert.match(systemRoutes, /MERGE_FREEZE_MESSAGE/);
  assert.match(systemRoutes, /CUSTOMER_MERGE_EMERGENCY_FREEZE/);
  assert.match(
    systemRoutes,
    /router\.post\("\/debt-customers\/merge", requireAuth, sendMergeFreeze\)/
  );
  assert.match(
    systemRoutes,
    /router\.post\("\/debt-customers\/merge-preview", requireAuth, sendMergeFreeze\)/
  );
  assert.match(
    systemRoutes,
    /router\.use\("\/customer-merge-recovery", customerMergeRecoveryRoutes\)/
  );
});

test("system routes preserve fail-closed CHALIN ONE feature and content gates", () => {
  assert.match(systemRoutes, /getPublicFeatureSnapshot/);
  assert.match(systemRoutes, /getFeatureSnapshot/);
  assert.match(systemRoutes, /router\.get\("\/features\/public"/);
  assert.match(systemRoutes, /router\.get\("\/features\/staff", requireAuth/);
  assert.match(systemRoutes, /requireFeature\("publicWebsite"\)/);
  assert.match(systemRoutes, /requireFeature\("contentStudio"\)/);
  assert.match(systemRoutes, /publicContentRoutes/);
  assert.match(systemRoutes, /contentStudioRoutes/);
});

test("frontend boot retains cache recovery v35 and the feature flag provider", () => {
  assert.match(frontendMain, /browser-cache-integrity-v35/);
  assert.match(frontendMain, /FeatureFlagProvider/);
  assert.match(frontendMain, /<FeatureFlagProvider>/);
  assert.match(frontendMain, /<App \/>/);
  assert.match(frontendMain, /__chalin03MarkBootHealthy/);
  assert.match(frontendMain, /CHALIN03_ASSET_MISMATCH/);
});
