"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  STAGING_OPERATIONAL_MIGRATIONS,
  ChalinOneStagingOperationalSchemaError,
  assertVerifierZeroResults,
} = require("../scripts/upgradeChalinOneStagingOperationalSchema");

const repoRoot = path.resolve(__dirname, "../..");
const migrationRoot = path.join(repoRoot, "database", "migrations");
const upgraderSource = fs.readFileSync(
  path.join(repoRoot, "backend/scripts/upgradeChalinOneStagingOperationalSchema.js"),
  "utf8"
);
const railwayConfig = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "deploy/chalin-one/railway.staging.json"),
    "utf8"
  )
);

const EXPECTED_MIGRATIONS = Object.freeze([
  "20260810_payroll_financial_foundation",
  "20260810_inventory_traceability_foundation",
  "20260810_inventory_loss_detection_foundation",
  "20260810_inventory_count_snapshot_hardening",
  "20260811_inventory_transfer_traceability",
]);

test("CHALIN ONE staging operational schema follows the reviewed Payroll then Inventory order", () => {
  assert.deepEqual(
    STAGING_OPERATIONAL_MIGRATIONS.map((migration) => migration.record),
    EXPECTED_MIGRATIONS
  );

  for (const migration of STAGING_OPERATIONAL_MIGRATIONS) {
    const migrationPath = path.join(migrationRoot, migration.file);
    const verifierPath = path.join(migrationRoot, migration.verify);
    assert.equal(fs.existsSync(migrationPath), true, `${migration.file} must exist`);
    assert.equal(fs.existsSync(verifierPath), true, `${migration.verify} must exist`);

    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const verifierSql = fs.readFileSync(verifierPath, "utf8");
    assert.match(migrationSql, new RegExp(migration.record));
    assert.match(verifierSql, new RegExp(migration.record));
    for (const field of migration.zero_fields) {
      assert.match(verifierSql, new RegExp(field));
    }
  }
});

test("staging verifier rejects non-zero or incomplete verification output", () => {
  const migration = {
    record: "example",
    zero_fields: ["problem_count", "other_problem_count"],
  };

  assert.doesNotThrow(() =>
    assertVerifierZeroResults(
      [[{ problem_count: 0 }], [{ other_problem_count: 0 }]],
      migration
    )
  );

  assert.throws(
    () =>
      assertVerifierZeroResults(
        [[{ problem_count: 1 }], [{ other_problem_count: 0 }]],
        migration
      ),
    (error) =>
      error instanceof ChalinOneStagingOperationalSchemaError &&
      error.code === "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_VERIFIER_FAILED"
  );

  assert.throws(
    () => assertVerifierZeroResults([[{ problem_count: 0 }]], migration),
    (error) =>
      error instanceof ChalinOneStagingOperationalSchemaError &&
      error.code === "CHALIN_ONE_STAGING_OPERATIONAL_SCHEMA_VERIFIER_INCOMPLETE"
  );
});

test("operational schema upgrader reuses strict Railway staging isolation and never imports production runners", () => {
  const safetyIndex = upgraderSource.indexOf("assertDedicatedRailwayStaging(env)");
  const connectionIndex = upgraderSource.indexOf("pool.getConnection()");
  assert.ok(safetyIndex >= 0, "strict dedicated staging safety check must run");
  assert.ok(
    connectionIndex > safetyIndex,
    "staging identity/isolation must be validated before a DB connection is acquired"
  );
  assert.match(upgraderSource, /SELECT GET_LOCK/);
  assert.match(upgraderSource, /schema_migrations/);
  assert.doesNotMatch(
    upgraderSource,
    /runPayrollFinancialFoundationMigration|runInventoryLossPreventionProductionMigrations/
  );
});

test("Railway staging runs the verified operational upgrade before the API starts", () => {
  const start = railwayConfig.deploy.startCommand;
  const environmentCheck = start.indexOf(
    "verifyChalinOneFullStagingEnvironment.js --mode=runtime"
  );
  const baseBootstrap = start.indexOf("bootstrapChalinOneStaging.js");
  const operationalUpgrade = start.indexOf(
    "upgradeChalinOneStagingOperationalSchema.js"
  );
  const server = start.indexOf("server.js");

  assert.ok(environmentCheck >= 0);
  assert.ok(baseBootstrap > environmentCheck);
  assert.ok(operationalUpgrade > baseBootstrap);
  assert.ok(server > operationalUpgrade);
  assert.doesNotMatch(
    start,
    /runPayrollFinancialFoundationMigration|runInventoryLossPreventionProductionMigrations/
  );
});

test("Inventory staging migration defaults do not silently serialize existing products", () => {
  const foundation = fs.readFileSync(
    path.join(migrationRoot, "20260810_inventory_traceability_foundation.sql"),
    "utf8"
  );
  assert.match(
    foundation,
    /inventory_tracking_mode` VARCHAR\(20\) NOT NULL DEFAULT ''quantity''/
  );
  assert.match(
    foundation,
    /inventory_traceability_state` VARCHAR\(20\) NOT NULL DEFAULT ''off''/
  );
  assert.doesNotMatch(
    foundation,
    /UPDATE\s+products[\s\S]{0,300}inventory_tracking_mode\s*=\s*['"]serialized['"]/i
  );
});
