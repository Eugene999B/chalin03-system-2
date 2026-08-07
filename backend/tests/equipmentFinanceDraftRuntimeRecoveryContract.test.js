const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const runtimeRoute = read(
  "backend/routes/equipmentFinanceDraftRuntimeRoutes.js"
);
const parentRoute = read(
  "backend/routes/equipmentFinanceIndependentRoutes.js"
);
const immediateStart = read(
  "frontend/src/pages/EquipmentFinanceOperationalStartImmediatePage.jsx"
);
const startRedirect = read(
  "frontend/src/pages/EquipmentFinancePhaseThreeStartRedirectPage.jsx"
);
const workspace = read(
  "frontend/src/pages/EquipmentSalesWorkspacePage.jsx"
);

test("deadlock-safe draft runtime owns draft endpoints before operational polish", () => {
  assert.match(
    parentRoute,
    /require\("\.\/equipmentFinanceDraftRuntimeRoutes"\)/
  );
  const runtimeIndex = parentRoute.indexOf(
    "router.use(equipmentFinanceDraftRuntimeRoutes)"
  );
  const legacyIndex = parentRoute.indexOf(
    "router.use(equipmentFinanceOperationalPolishRoutes)"
  );
  assert.ok(runtimeIndex >= 0);
  assert.ok(legacyIndex > runtimeIndex);
  assert.match(
    runtimeRoute,
    /const ROUTE = "\/operational-polish\/drafts\/start-installment"/
  );
});

test("draft save rereads through the same connection and never reacquires the pool", () => {
  assert.match(runtimeRoute, /await connection\.commit\(\)/);
  assert.match(
    runtimeRoute,
    /const draft = await getDraftFrom\(connection, signedInUserId\)/
  );
  assert.doesNotMatch(runtimeRoute, /return getDraft\(/);
  assert.match(runtimeRoute, /CONNECTION_DEADLINE_MS = 7000/);
  assert.match(runtimeRoute, /pendingConnection[\s\S]*connection\.release\(\)/);
});

test("draft schema readiness checks every column used by recovery and autosave", () => {
  for (const column of [
    "payload_json",
    "progress_json",
    "version_no",
    "last_saved_at",
    "submitted_at",
    "archived_at",
    "updated_at",
  ]) {
    assert.match(runtimeRoute, new RegExp(`"${column}"`));
  }
  assert.match(runtimeRoute, /missing_columns: missingColumns/);
  assert.match(runtimeRoute, /FINANCE_DRAFT_SCHEMA_INCOMPLETE/);
  assert.match(runtimeRoute, /device_copy_protected: true/);
});

test("start installment renders immediately while server recovery runs in background", () => {
  assert.match(immediateStart, /RECOVERY_TIMEOUT_MS = 8000/);
  assert.match(immediateStart, /SAVE_TIMEOUT_MS = 12000/);
  assert.match(immediateStart, /recoverInBackground/);
  assert.match(immediateStart, /<EquipmentFinanceStartWizardPage \/>/);
  assert.doesNotMatch(immediateStart, /if \(!ready\)/);
  assert.doesNotMatch(immediateStart, /Preparing secure draft recovery/);
  assert.match(
    immediateStart,
    /Server recovery never blocks this screen/
  );
  assert.match(startRedirect, /EquipmentFinanceOperationalStartImmediatePage/);
  assert.match(startRedirect, /axiosClient\.interceptors\.response\.use/);
  assert.match(startRedirect, /replace: true/);
});

test("critical start stage is eager and outside Suspense", () => {
  assert.match(
    workspace,
    /^import EquipmentFinancePhaseThreeStartRedirectPage from "\.\/EquipmentFinancePhaseThreeStartRedirectPage";/m
  );
  assert.doesNotMatch(
    workspace,
    /const EquipmentFinancePhaseThreeStartRedirectPage = lazy/
  );
  assert.match(
    workspace,
    /if \(!stage \|\| stage === "applications" \|\| stage === "start"\)/
  );
});
