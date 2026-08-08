import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "..");
function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

const publicApi = read("frontend/src/chalin-one/public-site/publicWebsiteApi.js");
const corporateApp = read("frontend/src/chalin-one/public-site/PublicCorporateWebsiteApp.jsx");
const corporateCss = read("frontend/src/chalin-one/public-site/publicCorporateWebsite.css");
const legacyPublicApp = read("frontend/src/chalin-one/public-site/PublicWebsiteApp.jsx");
const standalone = read("frontend/src/chalin-one/ChalinOneStandaloneEntry.jsx");
const main = read("frontend/src/main.jsx");
const operationalApp = read("frontend/src/App.jsx");
const loginPage = read("frontend/src/pages/LoginPageGroupOperations.jsx");
const businessWorkspaces = read("frontend/src/data/businessWorkspaces.js");
const commandGate = read("frontend/src/utils/commandGate.js");
const publicRoutes = read("backend/routes/publicContentRoutes.js");
const homepageService = read("backend/services/publicHomepageService.js");
const workflow = read(".github/workflows/chalin-one-ci.yml");
const acceptanceFixture = read("backend/scripts/prepareChalinOneAcceptanceDatabase.js");
const acceptanceTest = read("backend/acceptance/contentStudioDatabaseAcceptance.test.js");
const backendPackage = read("backend/package.json");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("public renderer uses a separate anonymous Axios client", () => {
  assert.match(publicApi, /axios\.create/);
  assert.match(publicApi, /\/public\/content\/bootstrap/);
  assert.doesNotMatch(
    publicApi,
    /axiosClient|localStorage|sessionStorage|Bearer|Authorization/
  );
});

check("public API supports every published collection, detail and form route", () => {
  for (const resource of [
    "news",
    "divisions",
    "leadership",
    "projects",
    "equipment",
    "locations",
    "faqs",
    "vacancies",
    "tenders",
    "testimonials",
  ]) {
    assert.match(publicApi, new RegExp(`"${resource}"`));
  }
  assert.match(publicApi, /getPublicHomepage/);
  assert.match(publicApi, /getPublicPage/);
  assert.match(publicApi, /getPublicForm/);
  assert.match(publicApi, /submitPublicForm/);
});

check("corporate website owns a complete root-level public route tree", () => {
  for (const route of [
    "about",
    "businesses",
    "businesses/:slug",
    "projects",
    "projects/:slug",
    "equipment",
    "equipment/:slug",
    "news",
    "news/:slug",
    "leadership",
    "media",
    "careers",
    "careers/:slug",
    "locations",
    "contact",
    "faqs",
    "tenders",
    "tenders/:slug",
    "testimonials",
    "pages/:slug",
    "website/*",
  ]) {
    assert.ok(
      corporateApp.includes(`path="${route}"`),
      `Expected corporate route ${route}`
    );
  }
  assert.match(corporateApp, /<Route index element=\{<HomePage \/>\}/);
  assert.match(corporateApp, /LegacyWebsiteRedirect/);
  assert.match(corporateApp, /NotFoundPage/);
});

check("governed homepage discovery exposes only a currently published homepage", () => {
  assert.match(homepageService, /p\.is_homepage = 1/);
  assert.match(homepageService, /publicationPredicate\("p"\)/);
  assert.match(homepageService, /ORDER BY p\.published_at DESC, p\.id DESC/);
  assert.match(homepageService, /LIMIT 1/);
  assert.match(homepageService, /getPublicPageBySlug\(slug\)/);
  assert.match(publicRoutes, /router\.get\("\/homepage"/);
  assert.match(publicRoutes, /getPublicHomepage\(\)/);
  assert.match(publicRoutes, /notFound\(res, req, "Homepage"\)/);
});

check("root homepage combines governed page content with published business collections", () => {
  assert.match(corporateApp, /getPublicHomepage/);
  assert.match(corporateApp, /getPublicBootstrap/);
  assert.match(corporateApp, /listPublicResource/);
  for (const resource of ["news", "leadership", "projects", "equipment", "locations"]) {
    assert.match(corporateApp, new RegExp(`listPublicResource\\("${resource}"`));
  }
  assert.match(corporateApp, /statistics/);
  assert.match(corporateApp, /divisions/);
  assert.match(corporateApp, /page\?\.sections/);
  assert.match(corporateApp, /CHALIN 03 COMPANY LIMITED/);
  assert.match(corporateApp, /Staff portal/);
  assert.match(corporateApp, /Content Studio/);
});

check("corporate experience exposes real business newsroom media careers and contact surfaces", () => {
  for (const marker of [
    "BusinessesPage",
    "BusinessDetailPage",
    "CollectionPage",
    "DetailPage",
    "MediaPage",
    "ContactPage",
    "FaqPage",
    "PublishedPage",
  ]) {
    assert.match(corporateApp, new RegExp(marker));
  }
  assert.match(corporateApp, /Spare Parts/);
  assert.match(corporateApp, /Mining Operations/);
  assert.match(corporateApp, /Equipment Business/);
});

check("public root is permanent and Spare Parts uses an explicit staff dashboard", () => {
  assert.match(standalone, /isPublicWebsitePath/);
  assert.match(standalone, /if \(path === "\/"\) return true/);
  assert.doesNotMatch(standalone, /hasOperationalBrowserSession/);
  assert.match(standalone, /PUBLIC_TOP_LEVEL_PATHS/);
  for (const pathName of [
    "about",
    "businesses",
    "projects",
    "equipment",
    "news",
    "leadership",
    "media",
    "careers",
    "contact",
  ]) {
    assert.match(standalone, new RegExp(`"${pathName}"`));
  }

  assert.match(operationalApp, /path="staff" element=\{<SparePartsHomePage \/>\}/);
  assert.match(loginPage, /spare_parts: "\/staff"/);
  assert.match(businessWorkspaces, /openRoute: "\/staff"/);
  assert.match(commandGate, /return "\/staff"/);
  assert.match(commandGate, /cleanPath === "\/"\) return false/);
  assert.match(commandGate, /PUBLIC_TOP_LEVEL_PATHS/);
});

check("standalone entry renders the corporate root behind the public feature flag", () => {
  assert.match(standalone, /public-site\/PublicCorporateWebsiteApp/);
  assert.match(standalone, /PublicCorporateWebsiteUnavailable/);
  assert.match(standalone, /path="\/\*"/);
  assert.match(standalone, /feature="publicWebsite"/);
  assert.match(standalone, /<PublicCorporateWebsiteApp \/>/);
});

check("Content Studio and Intelligence remain protected standalone surfaces", () => {
  assert.match(standalone, /feature="contentStudio"/);
  assert.match(standalone, /feature="aiEnabled"/);
  assert.match(standalone, /ProtectedRoute/);
  assert.match(standalone, /PermissionRoute permissions=\{\[permission\]\}/);
  assert.match(standalone, /permission="public_content\.view"/);
  assert.match(standalone, /permission="workspace\.view"/);
  assert.match(standalone, /AuthProvider/);
  assert.match(standalone, /WorkspaceContextProvider/);
  assert.match(standalone, /routePath="\/content-studio\/\*"/);
  assert.match(standalone, /routePath="\/intelligence\/\*"/);
});

check("published content rendering blocks raw HTML and unsafe embedded execution", () => {
  assert.doesNotMatch(
    corporateApp,
    /dangerouslySetInnerHTML|contentEditable|eval\(|<iframe/
  );
  assert.match(corporateApp, /StructuredContent/);
  assert.match(corporateApp, /CorporateMedia/);
  assert.doesNotMatch(corporateApp, /Bearer|Authorization/);
  assert.doesNotMatch(corporateApp, /localStorage|sessionStorage/);
});

check("public collections and detail pages use governed serializer fields", () => {
  assert.match(corporateApp, /item\.division\?\.name/);
  assert.match(corporateApp, /item\.location\?\.name/);
  assert.match(corporateApp, /item\.status/);
  assert.match(corporateApp, /item\.availability/);
  assert.match(corporateApp, /item\.manufacturer/);
  assert.match(corporateApp, /item\.model/);
  assert.match(corporateApp, /item\.reference_number/);
  assert.match(corporateApp, /formatMoney\(item\.price\)/);
  assert.match(corporateApp, /formatDate\(item\.published_at\)/);
  assert.match(corporateApp, /item\.specifications/);
  assert.match(corporateApp, /item\.features/);
});

check("contact experience uses governed form honeypot consent and public submission API", () => {
  for (const marker of [
    "full_name",
    "company_name",
    "consent_given",
    "consent_text_version",
    "source_url",
    "responses",
    "c1-honeypot",
    "reference_code",
  ]) {
    assert.match(corporateApp, new RegExp(marker));
  }
  assert.match(corporateApp, /getPublicForm/);
  assert.match(corporateApp, /submitPublicForm/);
  assert.match(corporateApp, /getPublicForm\(formSlug/);
});

check("legacy /website route remains a compatibility bridge instead of a second homepage", () => {
  assert.match(corporateApp, /function LegacyWebsiteRedirect/);
  assert.ok(corporateApp.includes('path="website/*"'));
  assert.match(corporateApp, /<Navigate replace to=/);
  assert.match(legacyPublicApp, /PUBLIC_ROOT = "\/website"/);
});

check("main entry isolates public Content Studio and intelligence surfaces from operational overlays", () => {
  assert.match(main, /isChalinOneStandalonePath/);
  assert.match(main, /standaloneChalinOne \?/);
  assert.match(main, /<ChalinOneStandaloneEntry \/>/);
  assert.match(main, /<App \/>/);
  assert.match(main, /browser-cache-integrity-v35/);
});

check("corporate renderer is responsive and reduced-motion safe", () => {
  assert.match(corporateCss, /@media \(max-width: 1180px\)/);
  assert.match(corporateCss, /@media \(max-width: 900px\)/);
  assert.match(corporateCss, /@media \(max-width: 620px\)/);
  assert.match(corporateCss, /prefers-reduced-motion: reduce/);
  assert.match(corporateCss, /c1-business-grid/);
  assert.match(corporateCss, /c1-project-showcase/);
  assert.match(corporateCss, /c1-equipment-band/);
  assert.match(corporateCss, /c1-media-mosaic/);
  assert.match(corporateCss, /c1-contact-layout/);
});

check("acceptance database preparation refuses production and non-isolated names", () => {
  assert.match(acceptanceFixture, /NODE_ENV=production/);
  assert.match(acceptanceFixture, /ACCEPTANCE_DATABASE_PATTERN/);
  assert.match(acceptanceFixture, /chalin_one_acceptance/);
  assert.match(acceptanceFixture, /legacy-row-must-survive/);
  assert.doesNotMatch(
    acceptanceFixture,
    /DROP DATABASE|railway|production[^\n]*database/i
  );
});

check("database acceptance proves governance public delivery and privacy", () => {
  for (const marker of [
    "createPageDraft",
    "CONTENT_SELF_APPROVAL_BLOCKED",
    "publishPageVersion",
    "createFormDraft",
    "createPublicFormSubmission",
    "ip_hash",
    "createNavigationDraft",
    "upsertSiteSetting",
    "getPublicBootstrap",
    "legacy rows must survive",
  ]) {
    assert.match(acceptanceTest, new RegExp(marker));
  }
});

check("CI runs real MySQL migration twice before database acceptance", () => {
  assert.match(workflow, /chalin-one-database-acceptance/);
  assert.match(workflow, /image: mysql:8\.4/);
  assert.match(workflow, /MYSQL_DATABASE: chalin_one_acceptance/);
  assert.equal(
    (workflow.match(/npm run migrate:chalin-one:public-content/g) || []).length,
    2
  );
  assert.match(workflow, /npm run test:chalin-one:db/);
  assert.match(backendPackage, /prepare:chalin-one:acceptance-db/);
  assert.match(backendPackage, /test:chalin-one:db/);
});

console.log(`\nCHALIN ONE public delivery: ${passed}/18 checks passed.`);