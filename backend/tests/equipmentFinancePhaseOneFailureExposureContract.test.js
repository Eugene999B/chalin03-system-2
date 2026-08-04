const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const critical = read(
  "backend",
  "routes",
  "equipmentFinanceCriticalEntryRoutes.js"
);
const diagnostics = read(
  "backend",
  "services",
  "equipmentFinancePhaseOneDiagnosticsService.js"
);
const applications = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceApplicationsPage.jsx"
);
const axiosClient = read("frontend", "src", "api", "axiosClient.js");

test("application query failures are real 503 responses, never fake empty success", () => {
  const failureStart = critical.indexOf(
    'console.error("Critical Finance application register failed:"'
  );
  assert.ok(failureStart >= 0);
  const failureBlock = critical.slice(failureStart, failureStart + 2600);
  assert.match(failureBlock, /res\.status\(503\)\.json/);
  assert.match(failureBlock, /operator_message: failure\.operator_message/);
  assert.match(failureBlock, /request_id: req\.requestId/);
  assert.match(failureBlock, /retryable: true/);
  assert.doesNotMatch(failureBlock, /applications:\s*\[\]/);
  assert.doesNotMatch(failureBlock, /summary:\s*\{\s*drafts:\s*0/);
  assert.match(critical, /empty_results_are_never_substituted_for_errors: true/);
});

test("the failed query connection is released before a second diagnostic connection", () => {
  const failureStart = critical.indexOf(
    'console.error("Critical Finance application register failed:"'
  );
  const catchStart = critical.lastIndexOf("} catch (error) {", failureStart);
  const catchBlock = critical.slice(catchStart, failureStart);
  const releaseIndex = catchBlock.indexOf("connection.release()");
  const readinessIndex = catchBlock.indexOf("await applicationReadiness()");
  assert.ok(releaseIndex >= 0);
  assert.ok(readinessIndex > releaseIndex);
  assert.match(catchBlock, /connection = null/);
});

test("readiness inspects actual application, quotation and approval requirements", () => {
  assert.match(diagnostics, /equipment_credit_applications/);
  assert.match(diagnostics, /equipment_sales_quotations/);
  assert.match(diagnostics, /equipment_sales_quotation_items/);
  assert.match(diagnostics, /equipment_credit_application_kyc/);
  assert.match(diagnostics, /equipment_credit_application_decisions/);
  assert.match(diagnostics, /proposed_interval_days/);
  assert.match(diagnostics, /proposed_non_working_day_rule/);
  assert.match(diagnostics, /proposed_periodic_amount/);
  assert.match(diagnostics, /nullable_columns: Object\.freeze\(\["hire_location_id"\]\)/);
  assert.match(diagnostics, /SELECT VERSION\(\) AS database_version/);
  assert.match(diagnostics, /finance_window_probe/);
  assert.match(diagnostics, /register_query_compiles/);
  assert.match(diagnostics, /PHASE_ONE_MIGRATION/);
});

test("Applications page shows diagnostics and retry instead of zero totals", () => {
  assert.match(applications, /const \[listFailure, setListFailure\] = useState\(null\)/);
  assert.match(applications, /const \[hasLoadedList, setHasLoadedList\] = useState\(false\)/);
  assert.match(applications, /payload\.status !== "success"/);
  assert.match(applications, /Application register could not be verified/);
  assert.match(applications, /Diagnostic code:/);
  assert.match(applications, /Request ID:/);
  assert.match(applications, /Retry application check/);
  assert.match(applications, /No zero totals are being shown/);
  assert.match(applications, /\{hasLoadedList \? \(/);
  assert.match(
    applications,
    /!loading && hasLoadedList && !listFailure && !applications\.length/
  );
});

test("readiness timeout is no longer converted to ready true", () => {
  assert.match(axiosClient, /FINANCE_READINESS_TIMEOUT_MS = 8000/);
  assert.doesNotMatch(axiosClient, /buildFinanceReadinessFallback/);
  assert.doesNotMatch(axiosClient, /reason: "readiness_timeout"/);
  assert.doesNotMatch(
    axiosClient,
    /requestPath === FINANCE_READINESS_PATH[\s\S]*Promise\.resolve/
  );
  assert.match(applications, /code: payload\.code \|\| "FINANCE_READINESS_TIMEOUT"/);
});
