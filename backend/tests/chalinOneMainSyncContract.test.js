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
const financeDocumentRoutes = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/routes/equipmentFinanceDocumentCompletionRoutes.js"
  ),
  "utf8"
);
const financeDocumentRenderer = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/services/equipmentFinanceDocumentRendererV2Service.js"
  ),
  "utf8"
);
const financePdfGuard = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/services/equipmentFinancePdfBlankPageGuardService.js"
  ),
  "utf8"
);
const kwabenaCorrection = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/scripts/runKwabenaProductQuantityCorrection20260806.js"
  ),
  "utf8"
);
const frontendMain = fs.readFileSync(
  path.join(repoRoot, "frontend/src/main.jsx"),
  "utf8"
);
const publicRoot = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/PublicChalinOneEntry.jsx"),
  "utf8"
);
const protectedRoot = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ProtectedChalinOneEntry.jsx"),
  "utf8"
);
const operationalRoot = fs.readFileSync(
  path.join(repoRoot, "frontend/src/OperationalAppRoot.jsx"),
  "utf8"
);

test("synchronized backend starts independently while verified legacy repairs remain explicit", () => {
  const start = backendPackage.scripts.start;
  const maintenance =
    backendPackage.scripts["maintenance:legacy-startup-repairs"];
  const requiredMaintenanceScripts = [
    "runEquipmentFinanceTermsApprovalRepair20260806.js",
    "runKwabenaProductQuantityCorrection20260806.js",
    "runCustomerMergeAuditDateSanitizer20260805.js",
    "runAutomaticCustomerMergeRollback20260805.js",
    "runExactNameReceiptOwnerRecovery20260805.js",
    "runMissingCreditDebtBackfill20260805.js",
    "runZeroPaymentCreditDebtVisibilityRepair20260805.js",
    "runMasterMickeyJuly31ExactDebtRepair20260805.js",
    "runUnpaidReceiptIdentityIsolation20260805.js",
  ];

  assert.equal(
    start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.ok(maintenance, "legacy recovery chain must remain explicitly available");

  for (const script of requiredMaintenanceScripts) {
    const pattern = new RegExp(script.replaceAll(".", "\\."));
    assert.doesNotMatch(
      start,
      pattern,
      `${script} must not run automatically during normal API startup`
    );
    assert.match(
      maintenance,
      pattern,
      `${script} must remain available in the controlled maintenance chain`
    );
  }

  assert.match(start, /exportWorkbookSafetyBootstrap\.js/);
  assert.doesNotMatch(maintenance, /exportWorkbookSafetyBootstrap\.js/);
  assert.equal(
    backendPackage.scripts[
      "repair:kwabena-main-store-quantities:20260806:production"
    ],
    "node scripts/runKwabenaProductQuantityCorrection20260806.js"
  );
});

test("one-time Kwabena correction remains production-only, locked and audited", () => {
  assert.match(kwabenaCorrection, /NODE_ENV/);
  assert.match(kwabenaCorrection, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(kwabenaCorrection, /SELECT GET_LOCK/);
  assert.match(kwabenaCorrection, /beginTransaction\(\)/);
  assert.match(kwabenaCorrection, /rollback\(\)/);
  assert.match(
    kwabenaCorrection,
    /20260806_kwabena_main_store_quantity_correction/
  );
  assert.match(kwabenaCorrection, /INSERT INTO stock_adjustments/);
  assert.match(kwabenaCorrection, /INSERT INTO activity_log/);
  assert.match(kwabenaCorrection, /INSERT INTO schema_migrations/);
  assert.doesNotMatch(
    kwabenaCorrection,
    /DROP\s+(?:TABLE|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM/i
  );
});

test("Finance generated-document blank-page guard stays narrow and ordered", () => {
  const guardIndex = financeDocumentRoutes.indexOf(
    'require("../services/equipmentFinancePdfBlankPageGuardService")'
  );
  const rendererIndex = financeDocumentRoutes.indexOf(
    'require("../services/equipmentFinanceDocumentRendererV2Service")'
  );
  assert.ok(guardIndex >= 0);
  assert.ok(rendererIndex > guardIndex);
  assert.match(
    financeDocumentRenderer,
    /equipmentFinanceCustomerPhotoRendererService/
  );
  assert.match(financePdfGuard, /FINANCE_FOOTER_PREFIX/);
  assert.match(financePdfGuard, /page\.margins\.bottom = 0/);
  assert.match(
    financePdfGuard,
    /page\.margins\.bottom = originalBottomMargin/
  );
  assert.doesNotMatch(financePdfGuard, /addPage\s*\(/);
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

test("frontend boot uses cache recovery v36 without automatic refresh and isolates feature gates by audience", () => {
  assert.match(frontendMain, /browser-cache-integrity-v36/);
  assert.match(frontendMain, /__chalin03MarkBootHealthy/);
  assert.match(frontendMain, /installNoAutomaticRefreshPolicy/);
  assert.match(frontendMain, /removeChalinServiceWorkerCaches/);
  assert.doesNotMatch(frontendMain, /serviceWorker\.register\(/);
  assert.doesNotMatch(frontendMain, /controllerchange/);
  assert.doesNotMatch(frontendMain, /window\.location\.reload\(/);
  assert.match(frontendMain, /import\("\.\/chalin-one\/PublicChalinOneEntry\.jsx"\)/);
  assert.match(frontendMain, /import\("\.\/chalin-one\/ProtectedChalinOneEntry\.jsx"\)/);
  assert.match(frontendMain, /import\("\.\/OperationalAppRoot\.jsx"\)/);
  assert.doesNotMatch(frontendMain, /FeatureFlagProvider|<App \/>/);

  for (const source of [protectedRoot, operationalRoot]) {
    assert.match(source, /FeatureFlagProvider/);
    assert.match(source, /<FeatureFlagProvider>/);
  }
  assert.doesNotMatch(publicRoot, /FeatureFlagProvider|FeatureFlagRoute/);
  assert.match(publicRoot, /PublicWebsiteFeatureGate/);
  assert.match(operationalRoot, /<App \/>/);
});
