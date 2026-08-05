const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CLEANUP_LOCK,
  CLEANUP_RECORD,
  HIDDEN_ACTION_TYPE,
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

test("unshared Finance test machines are deleted without touching other businesses", () => {
  assert.match(cleanupSource, /DELETE FROM equipment_media WHERE asset_id = \?/);
  assert.match(cleanupSource, /DELETE FROM fleet_meter_readings/);
  assert.match(cleanupSource, /source_type = 'finance_machine_register'/);
  assert.match(cleanupSource, /DELETE FROM fleet_assets WHERE id = \?/);
  assert.match(cleanupSource, /beginTransaction\(\)/);
  assert.match(cleanupSource, /await db\.commit\(\)/);
  assert.match(cleanupSource, /await db\.rollback\(\)/);
  assert.doesNotMatch(cleanupSource, /DELETE\s+FROM\s+hire_/i);
  assert.doesNotMatch(cleanupSource, /DELETE\s+FROM\s+mining_/i);
  assert.doesNotMatch(cleanupSource, /DELETE\s+FROM\s+(?:sales|sale_items|products|purchases|expenses)\b/i);
  assert.doesNotMatch(cleanupSource, /\bTRUNCATE\b|\bDROP\s+TABLE\b|FOREIGN_KEY_CHECKS/i);
});

test("shared machines remain in their real business but disappear from Finance", () => {
  assert.equal(
    retainedPurpose([{ table: "mining_equipment_assignments" }]),
    "company_operations"
  );
  assert.equal(
    retainedPurpose([{ table: "hire_contract_assets" }]),
    "hire_only"
  );
  assert.equal(HIDDEN_ACTION_TYPE, "equipment.finance.machine.reset_hidden");
  assert.match(cleanupSource, /sharedReferences\.length === 0/);
  assert.match(cleanupSource, /operational_purpose = \?/);
  assert.match(cleanupSource, /THEN 'not_for_sale'/);
  assert.match(cleanupSource, /EQUIPMENT_FINANCE_MACHINE_RESET_HIDDEN/);
});

test("Finance bootstrap exposes only registered and non-hidden machines", () => {
  assert.match(visibilitySource, /FROM activity_log registration/);
  assert.match(visibilitySource, /registration\.action_type = \?/);
  assert.match(visibilitySource, /NOT EXISTS/);
  assert.match(visibilitySource, /equipment\.finance\.machine\.reset_hidden/);
  assert.match(visibilitySource, /payload\.machines\.filter/);
  assert.match(visibilitySource, /finance_registered_excavators_only: true/);
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

test("Railway runs excavator cleanup after the reset and before API traffic", () => {
  const start = packageJson.scripts.start;
  const reset = start.indexOf(
    "runUserAuthorizedInstallmentRestartResetLockFix20260805.js"
  );
  const cleanup = start.indexOf(
    "runUserAuthorizedInstallmentExcavatorCleanup20260805.js"
  );
  const server = start.indexOf("exportWorkbookSafetyBootstrap.js server.js");
  assert.ok(reset >= 0);
  assert.ok(cleanup > reset);
  assert.ok(server > cleanup);
  assert.equal(
    packageJson.scripts["reset:equipment-finance:excavators:production"],
    "node scripts/runUserAuthorizedInstallmentExcavatorCleanup20260805.js"
  );
});
