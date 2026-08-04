const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const hotfixRoute = read(
  "backend/routes/equipmentFinanceRuntimeHotfixRoutes.js"
);
const parentRoute = read(
  "backend/routes/equipmentFinanceIndependentRoutes.js"
);
const workspace = read(
  "frontend/src/pages/EquipmentSalesWorkspacePage.jsx"
);
const startRedirect = read(
  "frontend/src/pages/EquipmentFinancePhaseThreeStartRedirectPage.jsx"
);

test("runtime hotfix owns the lightweight routes before legacy Finance handlers", () => {
  assert.match(
    parentRoute,
    /require\("\.\/equipmentFinanceRuntimeHotfixRoutes"\)/
  );
  const hotfixIndex = parentRoute.indexOf(
    "router.use(equipmentFinanceRuntimeHotfixRoutes)"
  );
  assert.ok(hotfixIndex >= 0);
  for (const laterMount of [
    'router.use("/professional/machine-register", equipmentFinanceMachineRegisterRoutes)',
    'router.use("/credit-applications", equipmentFinanceDraftRecoveryRoutes)',
    "router.use(equipmentFinancePhaseOneRoutes)",
  ]) {
    assert.ok(
      hotfixIndex < parentRoute.indexOf(laterMount),
      `${laterMount} must execute after the runtime hotfix`
    );
  }
});

test("application detail is lightweight and excludes protected evidence bytes", () => {
  assert.match(hotfixRoute, /"\/credit-applications\/:id"/);
  assert.match(hotfixRoute, /detail_contains_image_bytes: false/);
  assert.match(hotfixRoute, /decision_history_limit: 20/);
  assert.match(
    hotfixRoute,
    /ORDER BY decision\.decision_version DESC, decision\.id DESC\s+LIMIT 20/
  );
  assert.doesNotMatch(hotfixRoute, /SELECT\s+\*/i);
  assert.doesNotMatch(hotfixRoute, /decision\.snapshot_json/);
  assert.doesNotMatch(hotfixRoute, /asset\.main_image_url,\s*origin/i);
});

test("excavator bootstrap no longer requires the full Professional Finance schema", () => {
  assert.match(hotfixRoute, /"\/phase-one\/bootstrap"/);
  assert.match(hotfixRoute, /professional_settings_are_non_blocking/);
  assert.match(hotfixRoute, /settings_readiness/);
  assert.match(hotfixRoute, /list_contains_image_bytes: false/);
  assert.doesNotMatch(hotfixRoute, /assertProfessionalSchema/);
});

test("machine register reads schema-compatible metadata without returning photo blobs", () => {
  assert.match(hotfixRoute, /"\/professional\/machine-register"/);
  assert.match(hotfixRoute, /async function tableColumns/);
  assert.match(hotfixRoute, /main_image_url: null/);
  assert.match(hotfixRoute, /media: \[\]/);
  assert.match(
    hotfixRoute,
    /photos_load_only_from_protected_detail: true/
  );
});

test("Finance keeps applications and installment start eager while secondary stages remain split", () => {
  assert.match(workspace, /import \{ lazy, Suspense \} from "react"/);
  assert.match(
    workspace,
    /^import EquipmentFinanceApplicationsPage from "\.\/EquipmentFinanceApplicationsPage";/m
  );
  assert.match(
    workspace,
    /^import EquipmentFinancePhaseThreeStartRedirectPage from "\.\/EquipmentFinancePhaseThreeStartRedirectPage";/m
  );
  assert.doesNotMatch(
    workspace,
    /const EquipmentFinanceApplicationsPage = lazy\(\(\) =>/
  );
  assert.doesNotMatch(
    workspace,
    /const EquipmentFinancePhaseThreeStartRedirectPage = lazy\(\(\) =>/
  );
  assert.match(startRedirect, /EquipmentFinanceOperationalStartImmediatePage/);
  assert.match(startRedirect, /axiosClient\.interceptors\.response\.use/);
  assert.match(startRedirect, /navigate\(safeNextPath\(response\)/);
  assert.match(
    workspace,
    /const EquipmentFinanceExcavatorsPage = lazy\(\(\) =>/
  );
  assert.match(
    workspace,
    /if \(!stage \|\| stage === "applications" \|\| stage === "start"\) \{\s*return page;\s*\}/
  );
  assert.match(workspace, /<Suspense fallback=\{<FinanceStageFallback \/>}/);
  assert.doesNotMatch(
    workspace,
    /^import EquipmentFinanceExcavatorsPage/m
  );
});
