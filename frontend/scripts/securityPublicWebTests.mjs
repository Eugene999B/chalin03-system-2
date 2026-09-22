import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const appIndex = read("index.html");
const headers = read("public/_headers");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const serviceWorker = read("public/sw.js");
const companyPage = read("public/company/index.html");
const publicHome = read("src/pages/PublicCompanyHomePage.jsx");
const miningPortal = read("src/pages/MiningPortalPage.jsx");
const equipmentPortal = read("src/pages/EquipmentHirePortalPage.jsx");
const loginPage = read("src/pages/LoginPage.jsx");
const workspaces = read("src/data/businessWorkspaces.js");

assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains; preload/);
assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /frame-ancestors 'none'/);
assert.match(headers, /X-Frame-Options: DENY/);
assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive/);
assert.match(headers, /\/\n  ! X-Robots-Tag[\s\S]*X-Robots-Tag: index, follow, max-image-preview:large/);
assert.match(headers, /\/company[\s\S]*! X-Robots-Tag[\s\S]*X-Robots-Tag: index, follow, max-image-preview:large/);
assert.match(headers, /\/login[\s\S]*Cache-Control: no-store/);
assert.match(headers, /\/company\/\*[\s\S]*Cache-Control: no-store/);
assert.match(headers, /\/mining-operations[\s\S]*Cache-Control: no-store/);
assert.match(headers, /\/equipment-hire[\s\S]*Cache-Control: no-store/);
assert.match(headers, /https:\/\/api\.chalin03\.com/);
assert.doesNotMatch(headers, /pages\.dev/);

assert.match(
  appIndex,
  /<meta\s+name="robots"\s+content="noindex, nofollow, noarchive"\s*\/>/s
);
assert.doesNotMatch(appIndex, /content="index, follow/i);
assert.match(appIndex, /Chalin 03 Secure Staff Login/);
assert.match(appIndex, /<link rel="icon" href="\/favicon\.ico" sizes="any"/);
assert.match(
  appIndex,
  /<link\s+rel="icon"\s+type="image\/png"\s+sizes="192x192"\s+href="\/favicon-192x192\.png"/s
);
assert.match(
  appIndex,
  /<link\s+rel="icon"\s+type="image\/png"\s+sizes="512x512"\s+href="\/favicon-512x512\.png"/s
);
assert.match(appIndex, /rel="apple-touch-icon"/);
assert.match(appIndex, /rel="shortcut icon" href="\/favicon\.ico"/);
assert.match(appIndex, /"logo": "\/favicon-512x512\.png"/);
assert.match(appIndex, /<link rel="manifest" href="\/site\.webmanifest"/);

assert.equal(fs.existsSync(path.join(frontendRoot, "public/favicon.ico")), true);
assert.equal(
  fs.existsSync(path.join(frontendRoot, "public/favicon-192x192.png")),
  true
);
assert.equal(
  fs.existsSync(path.join(frontendRoot, "public/favicon-512x512.png")),
  true
);
assert.equal(
  fs.existsSync(path.join(frontendRoot, "public/site.webmanifest")),
  true
);
assert.equal(
  fs.existsSync(path.join(frontendRoot, "public/manifest.webmanifest")),
  false
);

assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  serviceWorker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(
  serviceWorker,
  /const CACHE_NAME = `\$\{CACHE_PREFIX\}app-shell-\$\{safeRelease\}`/
);
assert.match(serviceWorker, /\/site\.webmanifest/);
assert.match(serviceWorker, /\/favicon-192x192\.png/);
assert.match(serviceWorker, /\/favicon-512x512\.png/);
assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api"\)/);
assert.match(serviceWorker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);
assert.doesNotMatch(serviceWorker, /manifest\.webmanifest/);
assert.doesNotMatch(serviceWorker, /chalin03-pwa-(192|512)\.png/);

assert.equal(robots.trim(), "User-agent: *\\nAllow: /\\n\\nSitemap: https://chalin03.com/sitemap.xml");
assert.match(robots, /Allow: \\/\\n/);
assert.match(robots, /Sitemap: https:\\/\\/chalin03\\.com\\/sitemap\\.xml/);
assert.match(sitemap, /<urlset[^>]*>[\\s\\S]*<url>[\\s\\S]*https:\\/\\/chalin03\\.com\\/company\\/[\\s\\S]*<\\/url>[\\s\\S]*<\\/urlset>/);
assert.doesNotMatch(sitemap, /mining-operations|equipment-hire/);

assert.match(companyPage, /name="robots" content="index, follow, max-image-preview:large"/);
assert.match(companyPage, /rel="canonical" href="https:\\/\\/chalin03\\.com\\/company\\//);
assert.doesNotMatch(companyPage, /window\\.location\\.replace\("\/login"\)/);
assert.doesNotMatch(companyPage, /http-equiv="refresh" content="0; url=\/login"/);
assert.match(companyPage, /Built to serve|Explore Our Divisions/);

assert.match(miningPortal, /Navigate to="\/login\?workspace=mining" replace/);
assert.doesNotMatch(miningPortal, /BusinessPortalShell/);
assert.match(equipmentPortal, /!isLoggedIn \|\| workspaceCode !== "equipment_hire"/);
assert.match(
  equipmentPortal,
  /Navigate to="\/login\?workspace=equipment_hire" replace/
);
assert.match(equipmentPortal, /<EquipmentDivisionGatewayPage \/>/);
assert.doesNotMatch(equipmentPortal, /EquipmentBusinessLandingPage/);

assert.match(loginPage, /const TOKEN_KEY = "chalin03_token"/);
assert.match(loginPage, /clearStoredSession\(\)/);
assert.match(loginPage, /void logout\(\)/);
assert.match(loginPage, /window\.location\.replace/);
assert.match(loginPage, /Closing the previous session and opening Login/);
assert.match(workspaces, /code: "mining"[\s\S]*route: "\/login\?workspace=mining"/);
assert.match(
  workspaces,
  /code: "equipment_hire"[\s\S]*route: "\/login\?workspace=equipment_hire"/
);

console.log(
  "Private login-first routing, logout recovery, service worker, favicon and Cloudflare security checks passed."
);

assert.match(publicHome, /PublicPageMeta/);
assert.match(publicHome, /canonicalPath="\\\/"?/);
assert.match(appIndex, /Chalin 03 Company Limited \\| Ghana/);
