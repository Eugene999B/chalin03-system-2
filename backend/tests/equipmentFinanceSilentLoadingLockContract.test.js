const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const axiosClient = read("frontend", "src", "api", "axiosClient.js");
const financeWorkspace = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesWorkspacePage.jsx"
);
const applicationsPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceApplicationsPage.jsx"
);

test("stale authenticated requests settle through one controlled retry", () => {
  assert.match(axiosClient, /STALE_SESSION_RETRY_KEY/);
  assert.match(axiosClient, /isStaleSessionResponse/);
  assert.match(axiosClient, /return axiosClient\.request\(\{/);
  assert.match(axiosClient, /new axios\.CanceledError/);
  assert.doesNotMatch(axiosClient, /new Promise\(\(\) => \{\}\)/);
  assert.doesNotMatch(axiosClient, /return new Promise\(/);
});

test("Finance application reads have strict deadlines instead of infinite loading", () => {
  assert.match(axiosClient, /FINANCE_READINESS_TIMEOUT_MS = 5000/);
  assert.match(axiosClient, /FINANCE_APPLICATION_TIMEOUT_MS = 12000/);
  assert.match(axiosClient, /applyFinanceApplicationDeadline/);
  assert.match(axiosClient, /isFinanceApplicationRead/);
  assert.match(axiosClient, /config\.timeout =/);
  assert.match(axiosClient, /readiness_timeout/);
  assert.match(axiosClient, /buildFinanceReadinessFallback/);
});

test("a slow readiness probe cannot block the actual application register", () => {
  assert.match(applicationsPage, /Promise\.all/);
  assert.match(applicationsPage, /\$\{API\}\/readiness/);
  assert.match(axiosClient, /requestPath === FINANCE_READINESS_PATH/);
  assert.match(axiosClient, /return Promise\.resolve\(buildFinanceReadinessFallback\(error\)\)/);
  assert.match(axiosClient, /ready: true/);
  assert.match(axiosClient, /check_skipped: true/);
});

test("Applications and Approvals loads eagerly outside the Finance Suspense boundary", () => {
  assert.match(
    financeWorkspace,
    /import EquipmentFinanceApplicationsPage from "\.\/EquipmentFinanceApplicationsPage";/
  );
  assert.doesNotMatch(
    financeWorkspace,
    /const EquipmentFinanceApplicationsPage = lazy/
  );
  assert.match(
    financeWorkspace,
    /if \(!stage \|\| stage === "applications"\) \{\s*return page;\s*\}/
  );
  assert.match(
    financeWorkspace,
    /return <Suspense fallback=\{<FinanceStageFallback \/>\}>\{page\}<\/Suspense>;/
  );
});
