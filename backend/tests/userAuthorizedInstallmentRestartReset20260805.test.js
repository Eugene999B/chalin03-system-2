const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PRESERVED_DOMAINS,
  RESET_RECORD,
  buildInstallmentAgreementPredicate,
  resolveExecutionMode,
  safeIdentifier,
  uniqueNumericIds,
} = require("../scripts/runUserAuthorizedInstallmentRestartReset20260805");

const backendRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(
    backendRoot,
    "scripts",
    "runUserAuthorizedInstallmentRestartReset20260805.js"
  ),
  "utf8"
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);

test("the authorized reset executes only in production and only once", () => {
  assert.equal(resolveExecutionMode({ NODE_ENV: "production" }), "execute_once");
  assert.equal(
    resolveExecutionMode({ NODE_ENV: "development" }),
    "skip_non_production"
  );
  assert.equal(resolveExecutionMode({ NODE_ENV: "test" }), "skip_non_production");
  assert.equal(
    RESET_RECORD,
    "20260805_user_authorized_equipment_installment_restart_reset"
  );
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /SELECT GET_LOCK\(\?, 60\) AS acquired/);
  assert.match(source, /resetAlreadyApplied/);
  assert.match(source, /INSERT INTO schema_migrations/);
});

test("agreement selection is restricted to Installment Finance records", () => {
  const predicate = buildInstallmentAgreementPredicate(
    new Set(["sale_type", "activation_source", "credit_application_id"])
  );
  assert.match(predicate, /sale_type = 'installment'/);
  assert.match(predicate, /activation_source = 'approved_credit_application'/);
  assert.match(predicate, /credit_application_id IS NOT NULL/);
  assert.doesNotMatch(predicate, /hire_contract|hire_job|sales\s*=|cash/);
});

test("the reset is transactional and contains no schema destruction", () => {
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /await db\.commit\(\)/);
  assert.match(source, /await db\.rollback\(\)/);
  assert.match(source, /deleteRowsByIds/);
  assert.match(source, /restoreFleetAssets/);
  assert.match(source, /remaining\.applications !== 0/);
  assert.match(source, /remaining\.agreements !== 0/);
  assert.doesNotMatch(source, /\bTRUNCATE\b/i);
  assert.doesNotMatch(source, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(source, /FOREIGN_KEY_CHECKS/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(?:sales|sale_items|products|purchases|expenses|hire_contracts|hire_jobs|mining_)/i);
});

test("shared businesses, identities and configuration remain preserved", () => {
  const preserved = PRESERVED_DOMAINS.join("\n");
  for (const expected of [
    "Spare Parts",
    "Mining Operations",
    "Equipment Hire",
    "shared customer identities",
    "fleet asset identities",
    "users, roles, permissions",
    "Finance settings",
    "system audit",
  ]) {
    assert.match(preserved, new RegExp(expected, "i"));
  }
});

test("identifier and id helpers reject unsafe or duplicate input", () => {
  assert.equal(safeIdentifier("equipment_sale_agreements"), "`equipment_sale_agreements`");
  assert.throws(() => safeIdentifier("equipment_sale_agreements; DROP TABLE users"));
  assert.deepEqual(uniqueNumericIds([1, "1", 2, 0, -1, "x", 2]), [1, 2]);
});

test("controlled maintenance runs the completed reset and safe cleanup attempt in order", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const phaseSix = maintenance.indexOf(
    "node scripts/runEquipmentFinancePhaseSixPerformanceStartup.js"
  );
  const reset = maintenance.indexOf(
    "node scripts/runUserAuthorizedInstallmentRestartResetLockFix20260805.js"
  );
  const cleanupRecovery = maintenance.indexOf(
    "node scripts/runInstallmentExcavatorCleanupBestEffortStartup20260805.js"
  );

  assert.ok(phaseSix >= 0, "Phase Six schema startup must remain registered");
  assert.ok(reset > phaseSix, "reset must run after all Finance schema startups");
  assert.ok(cleanupRecovery > reset, "safe cleanup recovery must follow the completed reset");
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.doesNotMatch(
    maintenance,
    /node scripts\/runUserAuthorizedInstallmentExcavatorCleanup20260805\.js/
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
