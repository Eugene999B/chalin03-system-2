const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const {
  RESET_CONFIRMATION,
  resolveFinanceResetAvailability,
} = require("../services/installmentCompletionPhaseFourService");

const service = read(
  "backend",
  "services",
  "installmentCompletionPhaseFourService.js"
);
const routes = read(
  "backend",
  "routes",
  "installmentCompletionPhaseFourRoutes.js"
);
const independentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const page = read(
  "frontend",
  "src",
  "pages",
  "InstallmentCompletionPhaseFourPage.jsx"
);
const workspace = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesWorkspacePage.jsx"
);
const layout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);

test("production Finance reset is permanently blocked regardless of flags", () => {
  const availability = resolveFinanceResetAvailability(
    {
      NODE_ENV: "production",
      ALLOW_FINANCE_TEST_RESET: "true",
      MYSQLDATABASE: "railway_test",
    },
    "railway_test"
  );

  assert.equal(availability.enabled, false);
  assert.equal(availability.production_permanently_blocked, true);
  assert.equal(
    availability.code,
    "PRODUCTION_FINANCE_RESET_PERMANENTLY_BLOCKED"
  );
});

test("Finance reset requires a test runtime, explicit flag and test database", () => {
  assert.equal(
    resolveFinanceResetAvailability(
      { NODE_ENV: "development", ALLOW_FINANCE_TEST_RESET: "true" },
      "chalin03_test"
    ).enabled,
    false
  );
  assert.equal(
    resolveFinanceResetAvailability(
      { NODE_ENV: "test", ALLOW_FINANCE_TEST_RESET: "false" },
      "chalin03_test"
    ).enabled,
    false
  );
  assert.equal(
    resolveFinanceResetAvailability(
      { NODE_ENV: "test", ALLOW_FINANCE_TEST_RESET: "true" },
      "chalin03_db"
    ).enabled,
    false
  );
  assert.equal(
    resolveFinanceResetAvailability(
      { NODE_ENV: "test", ALLOW_FINANCE_TEST_RESET: "true" },
      "chalin03_test"
    ).enabled,
    true
  );
  assert.equal(RESET_CONFIRMATION, "RESET FINANCE TEST DATA");
});

test("Phase 4 dry run is read-only and execution remains tightly gated", () => {
  const dryRunStart = service.indexOf("async function buildFinanceResetDryRun");
  const executeStart = service.indexOf("async function executeFinanceTestReset");
  const dryRunSource = service.slice(dryRunStart, executeStart);

  assert.ok(dryRunStart >= 0);
  assert.ok(executeStart > dryRunStart);
  assert.doesNotMatch(dryRunSource, /\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|\bDROP\b/i);
  assert.match(dryRunSource, /read_only: true/);
  assert.match(service, /NODE_ENV=test/);
  assert.match(service, /ALLOW_FINANCE_TEST_RESET=true/);
  assert.match(service, /database name containing _test/);
  assert.match(service, /RESET FINANCE TEST DATA/);
  assert.doesNotMatch(service, /TRUNCATE\s+TABLE/i);
});

test("Phase 4 routes require permissions and original administrator authority", () => {
  assert.match(routes, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(routes, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(routes, /isOriginalSystemAdministrator/);
  assert.match(routes, /EQUIPMENT_FINANCE_TEST_RESET_DRY_RUN/);
  assert.match(routes, /EQUIPMENT_FINANCE_TEST_RESET_EXECUTED/);
  assert.match(routes, /production_reset_executed: false/);
  assert.match(independentRoutes, /installmentCompletionPhaseFourRoutes/);
  assert.match(independentRoutes, /production_finance_reset_blocked: true/);
});

test("Phase 4 completion centre covers the promised final operating scope", () => {
  for (const title of [
    "Final Operations & Reset Centre",
    "Arrears dashboard",
    "Reminders and promises to pay",
    "Default and recovery governance",
    "Completion and ownership transfer",
    "Finance policies and document settings",
    "Finance role permissions",
    "Professional document pack",
    "Finance reset dry run",
    "Fresh installment journey",
  ]) {
    assert.match(
      `${service}\n${page}`,
      new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    );
  }
  assert.match(page, /Production reset is permanently blocked/);
  assert.match(page, /PRODUCTION_FINANCE_RESET_PERMANENTLY_BLOCKED/);
  assert.match(workspace, /InstallmentCompletionPhaseFourPage/);
  assert.match(workspace, /stage === "finalization"/);
  assert.match(layout, /title: "Final Operations & Reset"/);
  assert.match(layout, /stage=finalization/);
});
