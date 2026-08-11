const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MIGRATION_LOCK_NAME,
  PRODUCTION_MIGRATION_PLAN,
  RELEASE_CONFIRMATION,
  assertReleaseGates,
  splitSqlScript,
  validateVerifierResults,
} = require("../scripts/runInventoryLossPreventionProductionMigrations");

const root = path.resolve(__dirname, "..");
const runnerSource = fs.readFileSync(
  path.join(root, "scripts/runInventoryLossPreventionProductionMigrations.js"),
  "utf8"
);
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);

function approvedEnv() {
  return {
    NODE_ENV: "production",
    CHALIN03_INVENTORY_MIGRATIONS_ENABLED: "true",
    CHALIN03_INVENTORY_RELEASE_AUTHORIZED: "true",
    CHALIN03_INVENTORY_MIGRATION_REHEARSAL_CONFIRMED: "true",
    CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
    CHALIN03_SQL_BACKUP_CONFIRMED: "true",
    CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
    CHALIN03_EXPECTED_DATABASE: "approved_inventory_database",
  };
}

test("Inventory production runner pins the exact four migration stages in order", () => {
  assert.equal(RELEASE_CONFIRMATION, "20260811_INVENTORY_LOSS_PREVENTION_TRACEABILITY");
  assert.match(MIGRATION_LOCK_NAME, /inventory-traceability/);
  assert.deepEqual(
    PRODUCTION_MIGRATION_PLAN.map((item) => item.name),
    [
      "20260810_inventory_traceability_foundation",
      "20260810_inventory_loss_detection_foundation",
      "20260810_inventory_count_snapshot_hardening",
      "20260811_inventory_transfer_traceability",
    ]
  );
  for (const item of PRODUCTION_MIGRATION_PLAN) {
    assert.equal(item.migrationRecord, item.name);
    assert.equal(item.migration, `${item.name}.sql`);
    assert.equal(item.verifier, `${item.name}_verify.sql`);
  }
});

test("Inventory production runner requires authorization, rehearsal and both fresh backup confirmations", () => {
  const env = approvedEnv();
  assert.doesNotThrow(() => assertReleaseGates(env));

  const requiredFlags = [
    "CHALIN03_INVENTORY_MIGRATIONS_ENABLED",
    "CHALIN03_INVENTORY_RELEASE_AUTHORIZED",
    "CHALIN03_INVENTORY_MIGRATION_REHEARSAL_CONFIRMED",
    "CHALIN03_SIGNED_BACKUP_CONFIRMED",
    "CHALIN03_SQL_BACKUP_CONFIRMED",
  ];
  for (const flag of requiredFlags) {
    const rejected = { ...env, [flag]: "false" };
    assert.throws(() => assertReleaseGates(rejected));
  }

  assert.throws(() =>
    assertReleaseGates({ ...env, NODE_ENV: "development" })
  );
  assert.throws(() =>
    assertReleaseGates({ ...env, CHALIN03_MIGRATION_RELEASE: "wrong-release" })
  );
  assert.throws(() =>
    assertReleaseGates({ ...env, CHALIN03_EXPECTED_DATABASE: "" })
  );
});

test("Inventory verifier validation requires the exact database and zero PASS results", () => {
  const passing = [
    [{ selected_database: "approved_inventory_database", verified_at: new Date() }],
    [{ problem_count: 0, result: "PASS" }],
    [{ problem_count: "0", result: "PASS" }],
  ];
  assert.doesNotThrow(() =>
    validateVerifierResults(
      passing,
      "approved_inventory_database",
      "inventory-test"
    )
  );

  assert.throws(() =>
    validateVerifierResults(passing, "another_database", "inventory-test")
  );
  assert.throws(() =>
    validateVerifierResults(
      [
        [{ selected_database: "approved_inventory_database" }],
        [{ problem_count: 1, result: "FAIL" }],
      ],
      "approved_inventory_database",
      "inventory-test"
    )
  );
  assert.throws(() =>
    validateVerifierResults(
      [
        [{ selected_database: "approved_inventory_database" }],
        [{ problem_count: 0, result: "FAIL" }],
      ],
      "approved_inventory_database",
      "inventory-test"
    )
  );
});

test("Inventory SQL splitter preserves procedure bodies and delimiter boundaries", () => {
  const statements = splitSqlScript(`
CREATE TABLE IF NOT EXISTS example_table (id INT);
DELIMITER $$
CREATE PROCEDURE example_proc()
BEGIN
  SELECT 1;
END$$
DELIMITER ;
SELECT 2;
`);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS example_table/);
  assert.match(statements[1], /CREATE PROCEDURE example_proc/);
  assert.match(statements[1], /SELECT 1;/);
  assert.match(statements[2], /SELECT 2/);
});

test("runner skips already-applied markers but always verifies and never runs at API startup", () => {
  assert.match(runnerSource, /priorMarkerCount === 0/);
  assert.match(runnerSource, /Skipping already-applied migration/);
  assert.match(runnerSource, /verifier will still run/i);
  assert.match(runnerSource, /GET_LOCK\(\?, 30\)/);
  assert.match(runnerSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /schema_migrations/);
  assert.doesNotMatch(serverSource, /runInventoryLossPreventionProductionMigrations/);
});

test("package exposes a deliberate one-command Inventory production runner", () => {
  assert.equal(
    packageJson.scripts["migrate:inventory-loss-prevention:production"],
    "node scripts/runInventoryLossPreventionProductionMigrations.js"
  );
});
