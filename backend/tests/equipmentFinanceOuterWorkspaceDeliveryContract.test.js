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

test("Finance app-shell rollout cannot reuse the retired cache", () => {
  assert.match(main, /finance-outer-workspace-unlock-v33/);
  assert.match(
    main,
    /register\(`\/sw\.js\?release=\$\{APP_SHELL_RELEASE\}`/
  );
  assert.match(main, /updateViaCache: "none"/);
  assert.match(
    serviceWorker,
    /CACHE_NAME = "chalin03-finance-outer-workspace-unlock-v33"/
  );
  assert.doesNotMatch(
    serviceWorker,
    /CACHE_NAME = "chalin03-credit-return-debt-reconciliation-v32"/
  );
  assert.match(
    serviceWorker,
    /fetch\(new Request\("\/", \{ cache: "no-store" \}\)\)/
  );
  assert.match(
    serviceWorker,
    /fetch\(request, \{ cache: "no-store" \}\)/
  );
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
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
});
