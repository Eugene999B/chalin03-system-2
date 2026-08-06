const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const main = read("frontend/src/main.jsx");
const preload = read("frontend/src/utils/criticalFinanceWorkspacePreload.js");
const app = read("frontend/src/App.jsx");
const applications = read(
  "frontend/src/pages/EquipmentFinanceApplicationsPage.jsx"
);
const serviceWorker = read("frontend/public/sw.js");
const headers = read("frontend/public/_headers");

test("critical Finance workspace is retained in the entry bundle", () => {
  assert.match(
    main,
    /import \{ installCriticalFinanceWorkspacePreload \} from "\.\/utils\/criticalFinanceWorkspacePreload\.js"/
  );
  assert.match(main, /installCriticalFinanceWorkspacePreload\(\)/);
  assert.match(
    preload,
    /import EquipmentSalesWorkspacePage from "\.\.\/pages\/EquipmentSalesWorkspacePage\.jsx"/
  );
  assert.match(
    preload,
    /globalThis\[GLOBAL_PRELOAD_KEY\] = EquipmentSalesWorkspacePage/
  );
  assert.match(
    app,
    /const EquipmentSalesWorkspacePage = lazy\(\(\) =>/
  );
});

test("Finance app-shell rollout uses a deployment-specific cache and rejects retired assets", () => {
  assert.match(main, /import\.meta\.env\.VITE_CHALIN03_BUILD_ID/);
  assert.match(main, /browser-cache-integrity-v35/);
  assert.match(
    main,
    /register\([\s\S]*`\/sw\.js\?release=\$\{encodeURIComponent\(APP_SHELL_RELEASE\)\}`/
  );
  assert.match(main, /updateViaCache: "none"/);
  assert.match(
    serviceWorker,
    /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
  );
  assert.match(
    serviceWorker,
    /CACHE_NAME = `\$\{CACHE_PREFIX\}app-shell-\$\{safeRelease\}`/
  );
  assert.doesNotMatch(
    serviceWorker,
    /CACHE_NAME = "chalin03-credit-return-debt-reconciliation-v32"/
  );
  assert.match(
    serviceWorker,
    /fetch\(url\.toString\(\), \{ cache: "no-store" \}\)/
  );
  assert.match(
    serviceWorker,
    /fetch\(request, \{ cache: "no-store" \}\)/
  );
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.match(serviceWorker, /addEventListener\("message"/);
  assert.match(serviceWorker, /CHALIN03_ASSET_MISMATCH/);
  assert.match(serviceWorker, /recoveryOwner: "page"/);
  assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);
  assert.doesNotMatch(serviceWorker, /client\.navigate\(/);
});

test("Cloudflare does not cache Finance navigation or the worker script", () => {
  assert.match(
    headers,
    /\/sw\.js\s+Cache-Control: no-store, max-age=0, must-revalidate/
  );
  assert.match(
    headers,
    /\/equipment-installment-finance\/\*\s+Cache-Control: no-store, max-age=0, must-revalidate/
  );
  assert.match(
    headers,
    /\/index\.html\s+Cache-Control: no-store, max-age=0, must-revalidate/
  );
  assert.match(
    headers,
    /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/
  );
});

test("application selection accepts only numeric IDs and has no redirect sink", () => {
  assert.match(applications, /function positiveApplicationId\(value\)/);
  assert.match(
    applications,
    /if \(!\/\^\[1-9\]\\d\*\$\/\.test\(normalized\)\) return null/
  );
  assert.match(
    applications,
    /const requestedApplicationId = positiveApplicationId\(query\.get\("application"\)\)/
  );
  assert.doesNotMatch(applications, /useNavigate/);
  assert.doesNotMatch(applications, /\bnavigate\s*\(/);
  assert.doesNotMatch(applications, /APPLICATIONS_ROUTE/);
  assert.doesNotMatch(applications, /search: `\?application=/);
  assert.doesNotMatch(applications, /pathname: location\.pathname/);
});