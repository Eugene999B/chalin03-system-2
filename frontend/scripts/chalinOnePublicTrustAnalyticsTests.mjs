import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const readFrontend = (relativePath) =>
  fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
const readRepo = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const runtime = readFrontend("src/chalin-one/public-site/PublicAnalyticsRuntime.jsx");
const runtimeCss = readFrontend("src/chalin-one/public-site/publicAnalyticsRuntime.css");
const publicApi = readFrontend("src/chalin-one/public-site/publicAnalyticsApi.js");
const standalone = readFrontend("src/chalin-one/ChalinOneStandaloneEntry.jsx");
const studio = readFrontend("src/chalin-one/content-studio/ContentStudioPublicAnalytics.jsx");
const studioCss = readFrontend("src/chalin-one/content-studio/contentStudioPublicAnalytics.css");
const studioWorkspace = readFrontend("src/chalin-one/content-studio/ContentStudioWorkspace.jsx");
const studioModel = readFrontend("src/chalin-one/content-studio/contentStudioModel.js");
const analyticsService = readRepo("backend/services/publicAnalyticsService.js");
const publicRoutes = readRepo("backend/routes/publicAnalyticsRoutes.js");
const studioRoutes = readRepo("backend/routes/contentStudioAnalyticsRoutes.js");
const systemRoutes = readRepo("backend/routes/systemRoutes.js");
const contentStudioRoutes = readRepo("backend/routes/contentStudioRoutes.js");
const migration = readRepo("database/migrations/20260810_chalin_one_public_analytics.sql");
const railway = readRepo("deploy/chalin-one/railway.staging.json");

assert.match(runtime, /recordPublicPageView\(location\.pathname/);
assert.doesNotMatch(runtime, /location\.search|location\.hash|localStorage|sessionStorage|document\.cookie/);
assert.match(runtime, /MutationObserver/);
assert.match(runtime, /\.c1-footer-bottom/);
assert.match(runtime, /Data use/);
assert.match(runtime, /role="dialog"/);
assert.match(runtime, /aria-modal="true"/);
assert.match(runtime, /event\.key === "Escape"/);
assert.match(publicApi, /\/public\/analytics\/page-view/);
assert.match(publicApi, /\/public\/analytics\/disclosure/);
assert.match(standalone, /PublicAnalyticsRuntime/);
assert.match(standalone, /<PublicAnalyticsRuntime \/>/);

assert.match(runtimeCss, /:focus-visible/);
assert.match(runtimeCss, /@media \(max-width: 760px\)/);
assert.match(runtimeCss, /safe-area-inset-bottom/);
assert.match(runtimeCss, /prefers-reduced-motion/);

for (const privateRoot of [
  "/api",
  "/login",
  "/staff",
  "/content-studio",
  "/intelligence",
  "/mining",
  "/equipment-hire-operations",
  "/equipment-installment-finance",
  "/group-executive-control",
]) {
  assert.match(analyticsService, new RegExp(privateRoot.replaceAll("/", "\\/")));
}
assert.match(analyticsService, /INSERT INTO public_analytics_daily/);
assert.match(analyticsService, /page_views = page_views \+ 1/);
assert.match(analyticsService, /stores_raw_ip: false/);
assert.match(analyticsService, /stores_user_agent: false/);
assert.match(analyticsService, /stores_cookie_id: false/);
assert.match(analyticsService, /stores_visitor_id: false/);
assert.match(analyticsService, /stores_form_content: false/);
assert.match(analyticsService, /stores_staff_activity: false/);

assert.match(publicRoutes, /PUBLIC_ANALYTICS_RATE_LIMIT_MAX/);
assert.match(publicRoutes, /router\.post\("\/page-view"/);
assert.match(publicRoutes, /router\.get\("\/disclosure"/);
assert.match(publicRoutes, /raw IP addresses/);
assert.match(publicRoutes, /persistent visitor identifiers/);
assert.match(publicRoutes, /Staff and Content Studio activity/);
assert.match(publicRoutes, /status\(202\)/);
assert.match(studioRoutes, /requirePermission\("public_content\.view"\)/);
assert.match(studioRoutes, /getPublicAnalyticsSummary/);
assert.match(systemRoutes, /"\/public\/analytics"/);
assert.match(contentStudioRoutes, /"\/dashboard\/analytics"/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS public_analytics_daily/);
for (const forbiddenColumn of [
  "ip_address",
  "ip_hash",
  "user_agent",
  "cookie_id",
  "visitor_id",
  "user_id",
  "email",
  "phone",
  "response_json",
]) {
  assert.doesNotMatch(migration, new RegExp(`\\b${forbiddenColumn}\\b`, "i"));
}
assert.match(migration, /metric_date DATE NOT NULL/);
assert.match(migration, /route_path VARCHAR\(220\) NOT NULL/);
assert.match(migration, /page_views BIGINT UNSIGNED NOT NULL DEFAULT 0/);

assert.match(studio, /PUBLIC TRUST \/ AGGREGATE ANALYTICS/);
assert.match(studio, /7, 30, 90/);
assert.match(studio, /Raw IP stored/);
assert.match(studio, /User agent stored/);
assert.match(studio, /Cookie ID stored/);
assert.match(studio, /Visitor ID stored/);
assert.match(studio, /Form content stored/);
assert.match(studio, /Staff activity stored/);
assert.match(studioWorkspace, /ContentStudioPublicAnalytics/);
assert.match(studioWorkspace, /"public-analytics": "dashboard"/);
assert.match(studioWorkspace, /"public-analytics": ContentStudioPublicAnalytics/);
assert.match(studioModel, /key: "public-analytics"/);
assert.match(studioModel, /label: "Public Analytics"/);
assert.match(studioCss, /@media \(max-width: 700px\)/);
assert.match(studioCss, /@media \(max-width: 390px\)/);
assert.match(studioCss, /prefers-reduced-motion/);

assert.match(railway, /bootstrapChalinOnePublicAnalyticsStaging\.js/);
assert.match(railway, /bootstrapChalinOnePublicRedirectStaging\.js/);
assert.match(railway, /node -r \.\/services\/exportWorkbookSafetyBootstrap\.js server\.js/);

console.log(
  "✅ CHALIN ONE Phase 2I Public Trust & Analytics contracts passed: aggregate-only public page views, private-route exclusion, transparent data-use disclosure, Studio aggregate reporting, responsive accessibility and isolated Railway bootstrap remain protected."
);
