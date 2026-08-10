import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");

const pathModel = await import(
  pathToFileURL(path.join(frontendRoot, "src/chalin-one/chalinOnePathModel.js")).href
);
const budgets = await import(
  pathToFileURL(path.join(frontendRoot, "src/chalin-one/publicPerformanceBudgetModel.js")).href
);

const main = read("src/main.jsx");
const publicEntry = read("src/chalin-one/PublicChalinOneEntry.jsx");
const publicGate = read("src/chalin-one/public-site/PublicWebsiteFeatureGate.jsx");
const publicBootCss = read("src/chalin-one/public-site/publicBootPolish.css");
const protectedEntry = read("src/chalin-one/ProtectedChalinOneEntry.jsx");
const operationalRoot = read("src/OperationalAppRoot.jsx");
const standalone = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");
const corporateApp = read("src/chalin-one/public-site/PublicCorporateWebsiteApp.jsx");
const headers = read("public/_headers");
const viteConfig = read("vite.config.js");
const packageJson = read("package.json");
const postbuildFinalizer = read("scripts/applyChalinOneStagingHeaders.mjs");
const buildGate = read("scripts/verifyChalinOnePerformanceBudgets.mjs");
const launchDesk = read("src/chalin-one/content-studio/ContentStudioLaunchReadiness.jsx");
const launchApi = read("src/chalin-one/content-studio/contentStudioLaunchReadinessApi.js");
const launchCss = read("src/chalin-one/content-studio/contentStudioLaunchReadiness.css");
const studioModel = read("src/chalin-one/content-studio/contentStudioModel.js");
const studioWorkspace = read("src/chalin-one/content-studio/ContentStudioWorkspace.jsx");

assert.match(main, /import\("\.\/chalin-one\/PublicChalinOneEntry\.jsx"\)/);
assert.match(main, /import\("\.\/chalin-one\/ProtectedChalinOneEntry\.jsx"\)/);
assert.match(main, /import\("\.\/OperationalAppRoot\.jsx"\)/);
assert.doesNotMatch(main, /import App from|EmergencyCommandOverlay|ApprovalCentreLiveAttention|installCriticalFinanceWorkspacePreload|\.\/index\.css/);
assert.match(main, /loadApplicationRoot\(\)/);
assert.match(main, /publicWebsiteSurface/);
assert.match(main, /standaloneChalinOne/);
assert.match(main, /\.catch\(\(error\)/);
assert.match(main, /role="alert"/);

assert.match(operationalRoot, /import App from "\.\/App\.jsx"/);
assert.match(operationalRoot, /installCommandGateHistoryTracker/);
assert.match(operationalRoot, /installCriticalFinanceWorkspacePreload/);
assert.match(operationalRoot, /\.\/index\.css/);
assert.match(operationalRoot, /EmergencyCommandOverlay/);
assert.match(protectedEntry, /ChalinOneStandaloneEntry/);
assert.match(protectedEntry, /FeatureFlagProvider/);
assert.match(protectedEntry, /\.\.\/index\.css/);

assert.match(publicEntry, /PublicWebsiteFeatureGate/);
assert.doesNotMatch(publicEntry, /FeatureFlagProvider|FeatureFlagRoute/);
assert.match(publicGate, /fetch\(PUBLIC_FEATURE_ENDPOINT/);
assert.match(publicGate, /payload\?\.flags\?\.publicWebsite === true/);
assert.match(publicGate, /STATUS_REFRESH_INTERVAL_MS = 30000/);
assert.doesNotMatch(publicGate, /axios|axiosClient|localStorage|sessionStorage|Authorization|Bearer/);

assert.match(publicEntry, /PublicExperienceCompletion/);
assert.match(publicEntry, /PublicCorporateWebsiteApp/);
assert.match(publicEntry, /publicBootPolish\.css/);
assert.match(publicEntry, /lazy\(\(\) =>\s*import\("\.\/public-site\/PublicAnalyticsRuntime"\)/s);
assert.match(publicEntry, /function DeferredPublicAnalyticsRuntime/);
assert.match(publicEntry, /timeout: 900/);
assert.match(publicEntry, /setTimeout\(\(\) => setReady\(true\), 450\)/);
assert.match(publicEntry, /<DeferredPublicAnalyticsRuntime \/>/);
assert.doesNotMatch(publicEntry, /import PublicAnalyticsRuntime from/);
assert.match(publicEntry, /lazy\(\(\) =>\s*import\("\.\/public-site\/PublicTechnicalFinish"\)/s);
assert.match(publicEntry, /function DeferredPublicTechnicalFinish/);
assert.match(publicEntry, /timeout: 320/);
assert.match(publicEntry, /setTimeout\(\(\) => setReady\(true\), 140\)/);
assert.match(publicEntry, /<DeferredPublicTechnicalFinish \/>/);
assert.doesNotMatch(publicEntry, /import PublicTechnicalFinish from/);
assert.match(publicEntry, /lazy\(\(\) =>\s*import\("\.\/public-site\/PublicWorldEnhancements"\)/s);
assert.match(publicEntry, /function DeferredPublicWorldEnhancements/);
assert.match(publicEntry, /requestIdleCallback/);
assert.match(publicEntry, /timeout: 1800/);
assert.match(publicEntry, /<DeferredPublicWorldEnhancements \/>/);
assert.doesNotMatch(publicEntry, /import PublicWorldEnhancements from/);
assert.doesNotMatch(publicEntry, /AuthProvider|WorkspaceContextProvider|OperationalAppRoot|App\.jsx|index\.css|installCriticalFinanceWorkspacePreload/);
assert.match(publicBootCss, /html,\s*body,\s*#root\s*\{\s*min-height: 100%/s);
assert.match(publicBootCss, /body\s*\{\s*margin: 0;/s);
assert.match(standalone, /chalinOnePathModel\.js/);

for (const route of pathModel.PUBLIC_RELEASE_SMOKE_PATHS) {
  assert.equal(pathModel.isPublicWebsitePath(route), true, route);
}
assert.equal(pathModel.isPublicWebsitePath("/content-studio"), false);
assert.equal(pathModel.isPublicWebsitePath("/intelligence"), false);
assert.equal(pathModel.isChalinOneStandalonePath("/content-studio/pages"), true);
assert.equal(pathModel.isChalinOneStandalonePath("/intelligence/documents"), true);
assert.equal(pathModel.isChalinOneStandalonePath("/staff"), false);
assert.ok(pathModel.PUBLIC_RELEASE_SMOKE_PATHS.length >= 12);

assert.match(corporateApp, /loading=\{eager \? "eager" : "lazy"\}/);
assert.match(corporateApp, /fetchPriority=\{eager \? "high" : "auto"\}/);
assert.match(corporateApp, /decoding="async"/);
assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
assert.match(headers, /\/index\.html\s+Cache-Control: no-store, max-age=0, must-revalidate/);

assert.match(viteConfig, /manifest: true/);
assert.match(packageJson, /"postbuild": "node scripts\/applyChalinOneStagingHeaders\.mjs"/);
assert.match(packageJson, /chalinOneStructuredSeoLinkIntegrityTests\.mjs/);
assert.match(postbuildFinalizer, /runPostbuildGate\("chalinOnePublicPerformanceReadinessTests\.mjs"\)/);
assert.match(postbuildFinalizer, /runPostbuildGate\("verifyChalinOnePerformanceBudgets\.mjs"\)/);
assert.match(postbuildFinalizer, /spawnSync\(process\.execPath/);
assert.match(buildGate, /\.vite.*manifest\.json/s);
assert.match(buildGate, /findHtmlEntryKey/);
assert.match(buildGate, /OperationalAppRoot must remain outside the initial public entry graph/);
assert.match(buildGate, /ProtectedChalinOneEntry must remain outside the initial public entry graph/);
assert.match(buildGate, /entryReduction >= 60/);
assert.match(buildGate, /PUBLIC_PERFORMANCE_BUDGETS/);
assert.match(buildGate, /fs\.rmSync\(manifestPath/);
assert.equal(budgets.PUBLIC_PERFORMANCE_BASELINE.previous_entry_js_bytes, 1399460);
assert.ok(budgets.PUBLIC_PERFORMANCE_BUDGETS.entry_js_bytes <= 320 * 1024);
assert.ok(budgets.PUBLIC_PERFORMANCE_BUDGETS.public_entry_js_bytes <= 300 * 1024);
assert.ok(budgets.PUBLIC_PERFORMANCE_BUDGETS.public_critical_js_bytes <= 760 * 1024);
assert.ok(budgets.PUBLIC_PERFORMANCE_BUDGETS.public_critical_css_bytes <= 190 * 1024);

assert.match(studioModel, /key: "launch-readiness"/);
assert.match(studioModel, /label: "Launch Readiness"/);
assert.match(studioWorkspace, /"launch-readiness": "dashboard"/);
assert.match(studioWorkspace, /"launch-readiness": ContentStudioLaunchReadiness/);
assert.match(launchDesk, /PHASE 2J \/ PUBLIC RELEASE CONTROL/);
assert.match(launchDesk, /GitHub CI/);
assert.match(launchDesk, /protected Railway/);
assert.match(launchDesk, /PUBLIC_RELEASE_SMOKE_PATHS/);
assert.match(launchDesk, /PUBLIC_PERFORMANCE_BUDGETS/);
assert.match(launchDesk, /Protected Content Studio surface/);
assert.match(launchDesk, /signals\.studioDashboard\.ok/);
assert.doesNotMatch(launchDesk, /featureEnabled\(signals\.publicFeatures, "contentStudio"\)/);
assert.doesNotMatch(launchDesk, /publishPageVersion|submitPageVersion|decidePageApproval|axiosClient\.(?:post|put|patch|delete)/);
for (const route of [
  "/readiness",
  "/features/public",
  "/content-studio/dashboard",
  "/public/content/bootstrap",
  "/public/analytics/disclosure",
]) {
  assert.match(launchApi, new RegExp(route.replaceAll("/", "\\/")));
}
assert.doesNotMatch(launchApi, /axiosClient\.(?:post|put|patch|delete)/);
assert.match(launchCss, /@media \(max-width: 1100px\)/);
assert.match(launchCss, /@media \(max-width: 760px\)/);
assert.match(launchCss, /@media \(max-width: 390px\)/);
assert.match(launchCss, /prefers-reduced-motion: reduce/);

console.log("✅ CHALIN ONE Phase 2J Public Performance & Final Release Readiness contracts passed: public/operational boot isolation, lightweight fail-closed public feature gating, deferred analytics/technical finish/enhancements, route smoke inventory, immutable asset caching, media loading, enforceable postbuild byte budgets, failure states and read-only launch controls remain protected.");
