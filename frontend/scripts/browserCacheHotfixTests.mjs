import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const serviceWorker = read("public/sw.js");
const recovery = read("public/browser-cache-recovery.js");
const mainEntry = read("src/main.jsx");
const sessionGuard = read("src/security/sessionExpiryGuard.js");
const viteConfig = read("vite.config.js");
const indexHtml = read("index.html");
const headers = read("public/_headers");
const redirects = read("public/_redirects");
const notFound = read("public/404.html");

function executeRecoveryAt(href) {
  let currentUrl = new URL(href);
  const replaceCalls = [];
  const window = {
    location: {
      get href() {
        return currentUrl.href;
      },
      get origin() {
        return currentUrl.origin;
      },
      reload() {
        throw new Error("Recovery bootstrap must never reload the document automatically");
      },
    },
    history: {
      state: null,
      replaceState(state, title, next) {
        replaceCalls.push({ state, title, next });
        currentUrl = new URL(String(next), currentUrl.origin);
      },
    },
    addEventListener() {},
  };

  vm.runInNewContext(recovery, { window, URL, Object, Promise, String });
  return { url: currentUrl, replaceCalls };
}

// The retired service-worker file may remain deployable for browsers that still
// have an old registration, but the current app must never register, promote or
// let it take control of an already-open CHALIN session automatically again.
assert.match(serviceWorker, /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/);
assert.match(serviceWorker, /browser-cache-integrity-v36/);
assert.match(serviceWorker, /const BUILD_ASSET_PREFIX = "\/assets\/"/);
assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
assert.match(serviceWorker, /networkBuildAsset\(request\)/);
assert.doesNotMatch(serviceWorker, /client\.navigate\(/);
assert.doesNotMatch(serviceWorker, /self\.skipWaiting\(\)/);
assert.doesNotMatch(serviceWorker, /self\.clients\.claim\(\)/);
assert.doesNotMatch(serviceWorker, /CHALIN03_SKIP_WAITING/);

assert.match(recovery, /vite:preloadError/);
assert.match(recovery, /__chalin03RecoverFromAssetMismatch/);
assert.match(recovery, /navigator\.serviceWorker/);
assert.match(recovery, /registration\.unregister\(\)/);
assert.match(recovery, /caches\.delete\(name\)/);
assert.match(recovery, /CHALIN update available/);
assert.match(recovery, /Reload when ready/);
assert.match(recovery, /Keep working/);
assert.match(recovery, /const RECOVERY_PARAM = "__chalin03_recovery"/);
assert.match(recovery, /const RETURN_PARAM = "__chalin03_return"/);
assert.match(recovery, /restoreRequestedRouteFromStatic404\(\)/);
assert.match(recovery, /window\.history\.replaceState/);
assert.doesNotMatch(recovery, /window\.location\.replace\(/);
assert.doesNotMatch(recovery, /window\.setTimeout\([\s\S]*window\.location/);
assert.doesNotMatch(recovery, /MAX_ATTEMPTS/);

const screenshotRecovery = executeRecoveryAt(
  "https://chalin-one-staging-preview.pages.dev/?__chalin03_recovery=1786425667735&__chalin03_return=%2Flogin"
);
assert.equal(screenshotRecovery.url.pathname, "/login");
assert.equal(screenshotRecovery.url.search, "");
assert.equal(screenshotRecovery.replaceCalls.length, 1);

const staffRecovery = executeRecoveryAt(
  "https://chalin-one-staging-preview.pages.dev/?__chalin03_recovery=1&__chalin03_return=%2Fstaff%3Ffrom%3Dwebsite%23secure"
);
assert.equal(staffRecovery.url.pathname, "/staff");
assert.equal(staffRecovery.url.search, "?from=website");
assert.equal(staffRecovery.url.hash, "#secure");

const rejectedExternalRecovery = executeRecoveryAt(
  "https://chalin-one-staging-preview.pages.dev/?__chalin03_recovery=1&__chalin03_return=https%3A%2F%2Fevil.example%2Fsteal"
);
assert.equal(rejectedExternalRecovery.url.origin, "https://chalin-one-staging-preview.pages.dev");
assert.equal(rejectedExternalRecovery.url.pathname, "/");
assert.equal(rejectedExternalRecovery.url.search, "");

assert.match(mainEntry, /VITE_CHALIN03_BUILD_ID/);
assert.match(mainEntry, /browser-cache-integrity-v36/);
assert.match(mainEntry, /isPublicWebsitePath/);
assert.match(mainEntry, /isChalinOneStandalonePath/);
assert.match(mainEntry, /installNoAutomaticRefreshPolicy/);
assert.match(mainEntry, /removeChalinServiceWorkerCaches/);
assert.match(
  mainEntry,
  /CHALIN automatic service-worker refreshes are disabled system-wide/
);
assert.doesNotMatch(mainEntry, /serviceWorker\.register\(/);
assert.doesNotMatch(mainEntry, /controllerchange/);
assert.doesNotMatch(mainEntry, /CHALIN03_SKIP_WAITING/);
assert.doesNotMatch(mainEntry, /window\.location\.reload\(/);
assert.doesNotMatch(mainEntry, /requestAssetRecovery/);

// A token/session change is adopted by application state instead of reloading
// the document. Real expiry may still navigate to /login because the secure
// session has ended.
assert.match(sessionGuard, /onSessionChanged/);
assert.doesNotMatch(sessionGuard, /window\.location\.reload\(/);
assert.match(sessionGuard, /window\.location\.replace\("\/login"\)/);

// Secure/public app boundaries are deliberate user navigation, not background
// refreshes. They still perform a real document handoff when the user clicks a
// protected application link from the public site.
assert.match(mainEntry, /PUBLIC_APP_HANDOFF_PATHS/);
assert.match(mainEntry, /"\/login"/);
assert.match(mainEntry, /"\/content-studio"/);
assert.match(mainEntry, /"\/intelligence"/);
assert.match(mainEntry, /installPublicApplicationBoundaryHandoffs/);
assert.match(mainEntry, /event\.target\?\.closest\?\.\("a\[href\]"\)/);
assert.match(mainEntry, /event\.preventDefault\(\)/);
assert.match(mainEntry, /event\.stopPropagation\(\)/);
assert.match(mainEntry, /event\.stopImmediatePropagation\?\.\(\)/);
assert.match(mainEntry, /window\.location\.href\s*=/);

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
assert.match(notFound, /isRetiredBuildAsset/);
assert.match(notFound, /__chalin03_return/);
assert.match(notFound, /window\.location\.replace\(recovery\.toString\(\)\)/);

console.log(
  "✅ Browser refresh + deep-route recovery contracts passed: CHALIN does not auto-refresh active workspaces, Cloudflare 404 recovery restores the requested same-origin route before React boot, external return targets are rejected, and update reload remains explicitly user-controlled."
);
