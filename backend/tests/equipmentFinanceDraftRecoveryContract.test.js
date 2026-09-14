const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (...parts) =>
  fs.readFileSync(path.join(backendRoot, ...parts), "utf8");
const readProject = (...parts) =>
  fs.readFileSync(path.join(projectRoot, ...parts), "utf8");

const recoveryRoute = readBackend(
  "routes",
  "equipmentFinanceDraftRecoveryRoutes.js"
);
const phaseOneRoute = readBackend("routes", "equipmentFinancePhaseOneRoutes.js");
const independentRouter = readBackend(
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const applicationsPage = readProject(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceApplicationsPage.jsx"
);
const operationalStart = readProject(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceOperationalStartImmediatePage.jsx"
);
const wizard = readProject(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceStartWizardPage.jsx"
);

test("company-wide draft recovery owns list, detail and edit before legacy handlers", () => {
  assert.match(
    independentRouter,
    /router\.use\("\/credit-applications", equipmentFinanceDraftRecoveryRoutes\)/
  );
  assert.ok(
    independentRouter.indexOf("equipmentFinanceDraftRecoveryRoutes);") <
      independentRouter.indexOf("router.use(equipmentFinancePhaseOneRoutes)")
  );
  assert.match(recoveryRoute, /router\.get\("\/", requirePermission/);
  assert.match(recoveryRoute, /router\.get\("\/:id", requirePermission/);
  assert.match(recoveryRoute, /router\.put\("\/:id", requirePermission/);
  assert.doesNotMatch(
    recoveryRoute,
    /INNER JOIN business_locations origin ON origin\.id = application\.hire_location_id/
  );
  assert.match(
    recoveryRoute,
    /LEFT JOIN business_locations origin ON origin\.id = asset\.hire_location_id/
  );
});

test("application list is paginated, searchable and never contains image bytes", () => {
  assert.match(recoveryRoute, /LIMIT \? OFFSET \?/);
  assert.match(recoveryRoute, /page_size/);
  assert.match(recoveryRoute, /application\.application_date >= \?/);
  assert.match(recoveryRoute, /application\.application_date <= \?/);
  assert.match(recoveryRoute, /list_contains_image_bytes: false/);
  assert.match(recoveryRoute, /CASE WHEN COALESCE\(asset\.main_image_url, ''\)/);
  assert.match(recoveryRoute, /"\/:id\/image"/);
  assert.match(applicationsPage, /AbortController/);
  assert.match(applicationsPage, /page_size: PAGE_SIZE/);
  assert.match(applicationsPage, /date_from/);
  assert.match(applicationsPage, /date_to/);
  assert.doesNotMatch(
    applicationsPage,
    /application\.main_image_url \? <img src=\{application\.main_image_url\}/
  );
});

test("created application query opens the exact record and drafts resume in place", () => {
  assert.match(applicationsPage, /query\.get\("application"\)/);
  assert.match(applicationsPage, /requestedApplicationId/);
  assert.match(applicationsPage, /Resume Draft/);
  assert.match(applicationsPage, /Edit Draft/);
  assert.match(applicationsPage, /Save Draft/);
  assert.match(applicationsPage, /known_version/);
  assert.match(recoveryRoute, /FINANCE_APPLICATION_VERSION_CONFLICT/);
  assert.match(recoveryRoute, /action_type, from_status, to_status/);
  assert.match(recoveryRoute, /'updated'/);
});

test("withdraw and cancel release application-level excavator blocking", () => {
  assert.match(recoveryRoute, /"\/:id\/withdraw"/);
  assert.match(recoveryRoute, /"\/:id\/cancel"/);
  assert.match(recoveryRoute, /application_status = 'withdrawn'/);
  assert.match(phaseOneRoute, /application_status IN \('draft','submitted','under_review','changes_requested','approved'\)/);
  assert.doesNotMatch(
    phaseOneRoute,
    /application\.application_status NOT IN \('declined','withdrawn'\)/
  );
  assert.match(phaseOneRoute, /blocking_application_number/);
  assert.match(phaseOneRoute, /blocking_agreement_number/);
});

test("Finance autosave uses one state-driven key without polling or opening lock", () => {
  assert.match(operationalStart, /chalin03\.finance\.start-installment\.v2/);
  assert.match(operationalStart, /chalin03\.finance\.start-installment\.v1/);
  assert.match(operationalStart, /LEGACY_DRAFT_KEY/);
  assert.match(operationalStart, /localStorage\.setItem\(DRAFT_KEY/);
  assert.match(operationalStart, /chalin03:finance-draft-change/);
  assert.match(operationalStart, /recoverInBackground/);
  assert.match(operationalStart, /<EquipmentFinanceStartWizardPage \/>/);
  assert.doesNotMatch(operationalStart, /Preparing secure draft recovery/);
  assert.doesNotMatch(operationalStart, /window\.setInterval/);
  assert.match(wizard, /chalin03:finance-draft-change/);
  assert.match(applicationsPage, /window\.setTimeout\(\(\) => saveEdit/);
});
