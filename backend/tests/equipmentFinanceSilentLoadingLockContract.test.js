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
const startRedirectPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinancePhaseThreeStartRedirectPage.jsx"
);
const immediateStartPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceOperationalStartImmediatePage.jsx"
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
  assert.match(axiosClient, /FINANCE_READINESS_TIMEOUT_MS = 8000/);
  assert.match(axiosClient, /FINANCE_APPLICATION_TIMEOUT_MS = 12000/);
  assert.match(axiosClient, /applyFinanceApplicationDeadline/);
  assert.match(axiosClient, /isFinanceApplicationRead/);
  assert.match(axiosClient, /config\.timeout =/);
});

test("a slow readiness probe cannot block or falsely approve the actual register", () => {
  assert.match(applicationsPage, /void axiosClient\s*\.get\(`\$\{API\}\/readiness`/);
  assert.match(applicationsPage, /const response = await axiosClient\.get\(API/);
  assert.match(applicationsPage, /FINANCE_READINESS_TIMEOUT/);
  assert.doesNotMatch(applicationsPage, /Promise\.all\(\[/);
  assert.doesNotMatch(axiosClient, /buildFinanceReadinessFallback/);
  assert.doesNotMatch(axiosClient, /reason: "readiness_timeout"/);
  assert.doesNotMatch(
    axiosClient,
    /requestPath === FINANCE_READINESS_PATH[\s\S]*Promise\.resolve/
  );
});

test("Applications and Start New Installment load eagerly outside the Finance Suspense boundary", () => {
  assert.match(
    financeWorkspace,
    /import EquipmentFinanceApplicationsPage from "\.\/EquipmentFinanceApplicationsPage";/
  );
  assert.match(
    financeWorkspace,
    /import EquipmentFinancePhaseThreeStartRedirectPage from "\.\/EquipmentFinancePhaseThreeStartRedirectPage";/
  );
  assert.doesNotMatch(
    financeWorkspace,
    /const EquipmentFinanceApplicationsPage = lazy/
  );
  assert.doesNotMatch(
    financeWorkspace,
    /const EquipmentFinancePhaseThreeStartRedirectPage = lazy/
  );
  assert.match(
    financeWorkspace,
    /if \(!stage \|\| stage === "applications" \|\| stage === "start"\) \{\s*return page;\s*\}/
  );
  assert.match(
    financeWorkspace,
    /return <Suspense fallback=\{<FinanceStageFallback \/>\}>\{page\}<\/Suspense>;/
  );
  assert.match(startRedirectPage, /EquipmentFinanceOperationalStartImmediatePage/);
  assert.match(startRedirectPage, /axiosClient\.interceptors\.response\.use/);
  assert.match(startRedirectPage, /replace: true/);
  assert.match(immediateStartPage, /RECOVERY_TIMEOUT_MS = 8000/);
  assert.match(immediateStartPage, /<EquipmentFinanceStartWizardPage \/>/);
  assert.doesNotMatch(immediateStartPage, /Preparing secure draft recovery/);
});
