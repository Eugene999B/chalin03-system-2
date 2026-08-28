import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const serviceWorker = read("public/sw.js");
const recovery = read("public/browser-cache-recovery.js");
const mainEntry = read("src/main.jsx");
const viteConfig = read("vite.config.js");
const indexHtml = read("index.html");
const headers = read("public/_headers");
const redirects = read("public/_redirects");
const notFound = read("public/404.html");

assert.match(
  serviceWorker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(serviceWorker, /browser-cache-integrity-v36/);
assert.match(serviceWorker, /const BUILD_ASSET_PREFIX = "\/assets\/"/);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /networkBuildAsset\(request\)/);
assert.match(serviceWorker, /notifyClientsOfAssetMismatch/);
assert.match(serviceWorker, /CHALIN03_ASSET_MISMATCH/);
assert.match(serviceWorker, /recoveryOwner: "page"/);
assert.match(serviceWorker, /X-Chalin03-Recovery-Owner/);
assert.match(serviceWorker, /isHtml\(response\)/);
assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);
assert.match(serviceWorker, /cache: "no-store"/);
assert.match(serviceWorker, /return await fetchCurrentShell\(\)/);
assert.doesNotMatch(serviceWorker, /client\.navigate\(/);
assert.doesNotMatch(serviceWorker, /__chalin03_sw_recovery/);
assert.match(serviceWorker, /function isTrustedClientMessage\(event\)/);
assert.match(
  serviceWorker,
  /event\.origin !== self\.location\.origin/
);
assert.match(serviceWorker, /event\.source\?\.url/);
assert.match(
  serviceWorker,
  /new URL\(sourceUrl\)\.origin === self\.location\.origin/
);
assert.match(serviceWorker, /if \(!isTrustedClientMessage\(event\)\)/);
assert.doesNotMatch(
  serviceWorker,
  /cache\.put\(request,\s*responseClone\)/
);

assert.match(recovery, /vite:preloadError/);
assert.match(recovery, /__chalin03RecoverFromAssetMismatch/);
assert.match(recovery, /__chalin03MarkBootHealthy/);
assert.match(recovery, /navigator\.serviceWorker/);
assert.match(recovery, /registration\.unregister\(\)/);
assert.match(recovery, /caches\.delete\(name\)/);
assert.match(recovery, /const RETURN_PARAM = "__chalin03_return"/);
assert.match(recovery, /new URL\("\/", window\.location\.origin\)/);
assert.match(recovery, /url\.searchParams\.set\(RETURN_PARAM, requestedReturnTarget\(\)\)/);
assert.match(recovery, /window\.history\.replaceState/);
assert.match(recovery, /restoreReturnTarget\(\)/);
assert.match(recovery, /url\.pathname\.startsWith\("\/assets\/"\)/);
assert.match(recovery, /Updating Chalin 03/);

assert.match(mainEntry, /VITE_CHALIN03_BUILD_ID/);
assert.match(mainEntry, /browser-cache-integrity-v38/);
assert.match(mainEntry, /updateViaCache: "none"/);
assert.match(mainEntry, /CHALIN03_ASSET_MISMATCH/);
assert.match(mainEntry, /CHALIN03_SKIP_WAITING/);
assert.match(mainEntry, /encodeURIComponent\(APP_SHELL_RELEASE\)/);

assert.match(viteConfig, /RAILWAY_GIT_COMMIT_SHA/);
assert.match(viteConfig, /CF_PAGES_COMMIT_SHA/);
assert.match(viteConfig, /GITHUB_SHA/);
assert.match(viteConfig, /Date\.now\(\)\.toString\(36\)/);
assert.match(
  viteConfig,
  /"import\.meta\.env\.VITE_CHALIN03_BUILD_ID"/
);

assert.match(
  indexHtml,
  /<script src="\/browser-cache-recovery\.js"><\/script>/
);

const redirectRules = redirects
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

assert.equal(redirectRules[0], "/assets/* /404.html 404");
assert.equal(redirectRules.at(-1), "/* /index.html 200");

assert.match(
  headers,
  /\/sw\.js\s+Cache-Control: no-store, max-age=0, must-revalidate/
);
assert.match(
  headers,
  /\/browser-cache-recovery\.js\s+Cache-Control: no-store, max-age=0, must-revalidate/
);
assert.match(
  headers,
  /\/index\.html\s+Cache-Control: no-store, max-age=0, must-revalidate/
);
assert.match(
  headers,
  /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/
);
assert.match(headers, /\/404\.html/);
assert.match(notFound, /data-chalin03-static-404="true"/);
assert.match(notFound, /new URL\("\/", window\.location\.origin\)/);
assert.match(notFound, /__chalin03_return/);
assert.match(notFound, /window\.location\.replace\(recovery\.toString\(\)\)/);
assert.match(notFound, /isRetiredBuildAsset/);

console.log(
  "✅ Browser cache recovery contracts passed: one page-owned recovery flow loads the root shell, restores the staff's deep route without a second network request, and self-heals unexpected navigation 404 responses."
);
