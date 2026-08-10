const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CLEANUP_LOCK,
  CLEANUP_RECORD,
  PREVIOUS_RESET_RECORD,
  REGISTER_ACTION_TYPE,
  retainedPurpose,
} = require("../scripts/runUserAuthorizedInstallmentExcavatorCleanup20260805");

const backendRoot = path.resolve(__dirname, "..");
const cleanupSource = fs.readFileSync(
  path.join(
    backendRoot,
    "scripts",
    "runUserAuthorizedInstallmentExcavatorCleanup20260805.js"
  ),
  "utf8"
);
const cleanupStartupSource = fs.readFileSync(
  path.join(
    backendRoot,
    "scripts",
    "runInstallmentExcavatorCleanupBestEffortStartup20260805.js"
  ),
  "utf8"
);
const visibilitySource = fs.readFileSync(
  path.join(
    backendRoot,
    "routes",
    "equipmentFinanceMachineVisibilityRoutes.js"
  ),
  "utf8"
);
const independentRoutes = fs.readFileSync(
  path.join(backendRoot, "routes", "equipmentFinanceIndependentRoutes.js"),
  "utf8"
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);

test("excavator cleanup is one-time, production-only and lock-safe", () => {
  assert.equal(
    CLEANUP_RECORD,
    "20260805_user_authorized_installment_finance_excavator_cleanup"
  );
  assert.equal(
    PREVIOUS_RESET_RECORD,
    "20260805_user_authorized_equipment_installment_restart_reset"
  );
  assert.ok(CLEANUP_LOCK.length <= 64, "MySQL advisory lock must not exceed 64 characters");
  assert.match(cleanupSource, /resolveExecutionMode\(environment\) !== "execute_once"/);
  assert.match(cleanupSource, /migrationApplied\(db, CLEANUP_RECORD\)/);
  assert.match(cleanupSource, /migrationApplied\(db, PREVIOUS_RESET_RECORD\)/);
  assert.match(cleanupSource, /SELECT GET_LOCK\(\?, 60\) AS acquired/);
  assert.match(cleanupSource, /INSERT INTO schema_migrations/);
  assert.match(cleanupSource, /visible_finance_excavators: visibleCount/);
});

test("only excavators registered through Installment Finance are selected", () => {
  assert.equal(REGISTER_ACTION_TYPE, "equipment.finance.machine.register");
  assert.match(cleanupSource, /FROM activity_log registration/);
  assert.match(cleanupSource, /registration\.entity_type = 'fleet_asset'/);
  assert.match(cleanupSource, /registration\.action_type = \?/);
  assert.match(cleanupSource, /registration\.workspace_code = 'equipment_installment_finance'/);
  assert.doesNotMatch(
    cleanupSource,
    /SELECT\s+\*\s+FROM\s+fleet_assets\s*(?:;|ORDER|WHERE\s+is_active)/i
  );
});

test("unshared Finance test machines are retired without deleting shared asset rows", () => {
  assert.match(cleanupSource, /is_active = FALSE/);
  assert.match(cleanupSource, /sale_status = 'cancelled'/);
  assert.match(cleanupSource, /main_image_url = NULL/);
  assert.match(cleanupSource, /UPDATE equipment_media/);
  assert.match(cleanupSource, /file_url.*\?/s);
  assert.match(cleanupSource, /DELETE FROM fleet_meter_readings/);
  assert.match(cleanupSource, /source_type = 'finance_machine_register'/);
  assert.doesNotMatch(cleanupSource, /DELETE FROM fleet_assets/i);
  assert.doesNotMatch(cleanupSource, /DELETE FROM equipment_media/i);
  assert.match(cleanupSource, /beginTransaction\(\)/);
  assert.match(cleanupSource, /await db\.commit\(\)/);
  assert.match(cleanupSource, /await db\.rollback\(\)/);
  assert.doesNotMatch(cleanupSource, /DELETE\s+FROM\s+hire_/i);
  assert.doesNotMatch(cleanupSource, /DELETE\s+FROM\s+mining_/i);
  assert.doesNotMatch(cleanupSource, /DELETE\s+FROM\s+(?:sales|sale_items|products|purchases|expenses)\b/i);
  assert.doesNotMatch(cleanupSource, /\bTRUNCATE\b|\bDROP\s+TABLE\b|FOREIGN_KEY_CHECKS/i);
});

test("shared machines remain in their real business but leave Finance sale visibility", () => {
  assert.equal(
    retainedPurpose([{ table: "mining_equipment_assignments" }]),
    "company_operations"
  );
  assert.equal(
    retainedPurpose([{ table: "hire_contract_assets" }]),
    "hire_only"
  );
  assert.match(cleanupSource, /sharedReferences\.length === 0/);
  assert.match(cleanupSource, /operational_purpose = \?/);
  assert.match(cleanupSource, /THEN 'not_for_sale'/);
  assert.match(cleanupSource, /preserveSharedAssetOutsideFinance/);
});

test("Finance bootstrap falls back to the completed operational reset cutoff", () => {
  assert.match(visibilitySource, /LEFT JOIN schema_migrations cleanup/);
  assert.match(visibilitySource, /LEFT JOIN schema_migrations operational_reset/);
  assert.match(visibilitySource, /cleanup\.migration_name = \?/);
  assert.match(visibilitySource, /operational_reset\.migration_name = \?/);
  assert.match(visibilitySource, /registration\.created_at >= cleanup\.applied_at/);
  assert.match(
    visibilitySource,
    /registration\.created_at >= operational_reset\.applied_at/
  );
  assert.match(visibilitySource, /asset\.is_active = TRUE/);
  assert.match(visibilitySource, /payload\.machines\.filter/);
  assert.match(visibilitySource, /finance_registered_excavators_only: true/);
  assert.match(visibilitySource, /finance_cleanup_cutoff_enabled: true/);
  assert.match(
    visibilitySource,
    /finance_operational_reset_fallback_enabled: true/
  );
  assert.match(visibilitySource, /visibility filter failed closed/);

  const visibilityIndex = independentRoutes.indexOf(
    "router.use(equipmentFinanceMachineVisibilityRoutes)"
  );
  const bootstrapIndex = independentRoutes.indexOf(
    "router.use(equipmentFinanceCriticalEntryRoutes)"
  );
  assert.ok(visibilityIndex >= 0, "Finance visibility middleware must be mounted");
  assert.ok(
    bootstrapIndex > visibilityIndex,
    "visibility middleware must wrap the critical bootstrap before it sends machines"
  );
});

test("cleanup remains best-effort maintenance without ever blocking normal API startup", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /node scripts\/runUserAuthorizedInstallmentExcavatorCleanup20260805\.js/,
    "The fail-closed one-time command must not directly block API startup"
  );
  assert.doesNotMatch(
    maintenance,
    /node scripts\/runUserAuthorizedInstallmentExcavatorCleanup20260805\.js/,
    "The fail-closed one-time command must not block controlled maintenance"
  );
  assert.match(
    maintenance,
    /node scripts\/runInstallmentExcavatorCleanupBestEffortStartup20260805\.js/
  );
  assert.match(cleanupStartupSource, /try \{/);
  assert.match(cleanupStartupSource, /catch \(error\)/);
  assert.match(cleanupStartupSource, /process\.exitCode = 0/);
  assert.match(
    cleanupStartupSource,
    /operational-reset visibility cutoff/
  );
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:production"],
    "node scripts/runUserAuthorizedInstallmentExcavatorCleanup20260805.js"
  );
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:startup-safe"],
    "node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js"
  );
});
