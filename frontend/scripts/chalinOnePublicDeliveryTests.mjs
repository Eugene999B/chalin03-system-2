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
const publicApp = read("frontend/src/chalin-one/public-site/PublicWebsiteApp.jsx");
const homepageApp = read("frontend/src/chalin-one/public-site/PublicWebsiteStandaloneApp.jsx");
const publicCss = read("frontend/src/chalin-one/public-site/publicWebsite.css");
const standalone = read("frontend/src/chalin-one/ChalinOneStandaloneEntry.jsx");
const main = read("frontend/src/main.jsx");
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
  assert.doesNotMatch(publicApi, /axiosClient|localStorage|sessionStorage|Bearer|Authorization/);
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
  ]) assert.match(publicApi, new RegExp(`"${resource}"`));
  assert.match(publicApi, /getPublicHomepage/);
  assert.match(publicApi, /getPublicPage/);
  assert.match(publicApi, /getPublicForm/);
  assert.match(publicApi, /submitPublicForm/);
});

check("public website routes cover the complete anonymous experience", () => {
  for (const route of [
    "pages/:slug",
    "news/:slug",
    "divisions/:slug",
    "projects/:slug",
    "equipment/:slug",
    "vacancies/:slug",
    "tenders/:slug",
    "forms/:slug",
  ]) assert.match(publicApp, new RegExp(route.replace("/", "\\/")));
  assert.match(publicApp, /PublicHomePage/);
  assert.match(publicApp, /PublicFaqPage/);
  assert.match(publicApp, /PublicNotFound/);
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

check("website root hands off safely to the governed page renderer", () => {
  assert.match(homepageApp, /getPublicHomepage/);
  assert.match(homepageApp, /controller\.abort\(\)/);
  assert.match(homepageApp, /<Navigate/);
  assert.match(homepageApp, /replace/);
  assert.match(homepageApp, /encodeURIComponent\(state\.page\.slug\)/);
  assert.match(homepageApp, /return <PublicWebsiteApp \/>/);
  assert.match(homepageApp, /role="status"/);
  assert.match(homepageApp, /role="alert"/);
  assert.match(standalone, /public-site\/PublicWebsiteStandaloneApp/);
  assert.doesNotMatch(homepageApp, /dangerouslySetInnerHTML|localStorage|sessionStorage|Bearer|Authorization/);
});

check("published content rendering blocks raw HTML and unsafe embedded video", () => {
  assert.doesNotMatch(publicApp, /dangerouslySetInnerHTML|contentEditable|eval\(|<iframe/);
  assert.match(publicApp, /StructuredContent/);
  assert.match(publicApp, /safeExternalUrl/);
  assert.match(publicApp, /Open published video/);
  assert.match(publicApp, /Open published document/);
  assert.match(publicApp, /media\.media_type === "document"/);
});

check("public collection and detail fields match the backend serializers", () => {
  assert.match(publicApp, /\[item\.address, item\.city, item\.region, item\.country\]/);
  assert.match(publicApp, /item\.customer_name \|\| item\.name/);
  assert.match(publicApp, /item\?\.status \|\| item\?\.operational_status/);
  assert.match(publicApp, /item\?\.availability \|\| item\?\.availability_status/);
  assert.match(publicApp, /item\?\.category\?\.name/);
  assert.match(publicApp, /typeof item\?\.category === "string"/);
  assert.match(publicApp, /formatPublicMoney\(item\?\.price\)/);
  assert.match(publicApp, /formatPublicDate\(item\.published_at, true\)/);
  assert.match(publicApp, /<PublicDetailContent item=\{item\} \/>/);
  assert.match(publicApp, /<StructuredContent value=\{item\.specifications\} \/>/);
  assert.match(publicApp, /<StructuredContent value=\{item\.features\} \/>/);
  assert.match(publicApp, /item\.hire_available/);
  assert.match(publicApp, /item\.finance_available/);
  assert.match(publicApp, /target=\{`tel:\$\{item\.contact\.phone\}`\}/);
  assert.match(publicApp, /target=\{`mailto:\$\{item\.contact\.email\}`\}/);
  assert.match(publicApp, /target=\{item\.application_url\}/);
  assert.doesNotMatch(
    publicApp,
    /item\.body \|\| item\.details \|\| item\.description \|\| item\.specifications \|\| item\.features/
  );
});

check("dynamic forms implement contact, honeypot, consent and supported field controls", () => {
  for (const marker of [
    "full_name",
    "company_name",
    "consent_given",
    "consent_text_version",
    "source_url",
    "responses",
    "pw-honeypot",
    "multiselect",
    "checkbox_group",
  ]) assert.match(publicApp, new RegExp(marker));
  assert.match(publicApp, /submitPublicForm/);
  assert.match(publicApp, /reference_code/);
});

check("relative navigation stays inside the separate website renderer", () => {
  assert.match(publicApp, /PUBLIC_ROOT = "\/website"/);
  assert.match(publicApp, /directResources/);
  assert.match(publicApp, /`\$\{PUBLIC_ROOT\}\/pages\/\$\{clean\}`/);
  assert.match(publicApp, /mailto:\|tel:/);
});

check("standalone entry applies fail-closed feature and staff access gates", () => {
  assert.match(standalone, /feature="publicWebsite"/);
  assert.match(standalone, /feature="contentStudio"/);
  assert.match(standalone, /ProtectedRoute/);
  assert.match(standalone, /PermissionRoute permissions=\{\[permission\]\}/);
  assert.match(standalone, /permission="public_content\.view"/);
  assert.match(standalone, /permission="workspace\.view"/);
  assert.match(standalone, /AuthProvider/);
  assert.match(standalone, /WorkspaceContextProvider/);
});

check("standalone routes preserve website context and hand non-CHALIN paths to the full app", () => {
  assert.match(standalone, /path="\/website\/\*"/);
  assert.match(standalone, /path="\/content-studio\/\*"/);
  assert.match(standalone, /FullApplicationHandoff/);
  assert.match(standalone, /window\.location\.replace\(destination\)/);
  assert.equal((standalone.match(/<Route path="\*"/g) || []).length, 2);
});

check("main entry isolates CHALIN ONE surfaces from operational overlays", () => {
  assert.match(main, /isChalinOneStandalonePath/);
  assert.match(main, /standaloneChalinOne \?/);
  assert.match(main, /<ChalinOneStandaloneEntry \/>/);
  assert.match(main, /<App \/>/);
  assert.match(main, /browser-cache-integrity-v35/);
});

check("public renderer is responsive across desktop tablet and phone", () => {
  assert.match(publicCss, /@media \(max-width: 1050px\)/);
  assert.match(publicCss, /@media \(max-width: 820px\)/);
  assert.match(publicCss, /@media \(max-width: 620px\)/);
  assert.match(publicCss, /@media \(max-width: 390px\)/);
  assert.match(publicCss, /pw-navigation\[data-open="true"\]/);
  assert.match(publicCss, /pw-detail-grid > div > section/);
  assert.match(publicCss, /pw-not-found h1/);
});

check("acceptance database preparation refuses production and non-isolated names", () => {
  assert.match(acceptanceFixture, /NODE_ENV=production/);
  assert.match(acceptanceFixture, /ACCEPTANCE_DATABASE_PATTERN/);
  assert.match(acceptanceFixture, /chalin_one_acceptance/);
  assert.match(acceptanceFixture, /legacy-row-must-survive/);
  assert.doesNotMatch(acceptanceFixture, /DROP DATABASE|railway|production[^\n]*database/i);
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
  ]) assert.match(acceptanceTest, new RegExp(marker));
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

console.log(`\nCHALIN ONE public delivery: ${passed}/16 checks passed.`);
