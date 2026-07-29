const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runner = require("../scripts/runEquipmentFinanceProductionMigrations");

const root = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "backend/package.json"), "utf8")
);

function validEnvironment() {
  return {
    NODE_ENV: "production",
    CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED: "true",
    CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
    CHALIN03_SQL_BACKUP_CONFIRMED: "true",
    CHALIN03_MIGRATION_RELEASE: runner.RELEASE_CONFIRMATION,
  };
}

test("Finance runner is locked to one exact release and four ordered migrations", () => {
  assert.equal(
    runner.RELEASE_CONFIRMATION,
    "20260729_EQUIPMENT_FINANCE_COMPLETE"
  );
  assert.equal(
    runner.MIGRATION_LOCK_NAME,
    "chalin03:production-migrations:20260729-equipment-finance"
  );
  assert.deepEqual(
    runner.PRODUCTION_MIGRATION_PLAN.map((item) => item.name),
    [
      "20260729_equipment_credit_application_foundation",
      "20260729_equipment_finance_agreement_activation",
      "20260729_equipment_finance_deposit_reservation",
      "20260729_equipment_finance_final_lifecycle",
    ]
  );
  for (const item of runner.PRODUCTION_MIGRATION_PLAN) {
    assert.match(item.migration, /^20260729_.*\.sql$/);
    assert.match(item.verifier, /^20260729_.*_verify\.sql$/);
    assert.ok(item.expectedProblems.length > 0);
  }
});

test("Finance runner requires production and both verified backups", () => {
  assert.doesNotThrow(() => runner.assertReleaseGates(validEnvironment()));

  for (const key of [
    "NODE_ENV",
    "CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED",
    "CHALIN03_SIGNED_BACKUP_CONFIRMED",
    "CHALIN03_SQL_BACKUP_CONFIRMED",
    "CHALIN03_MIGRATION_RELEASE",
  ]) {
    const env = validEnvironment();
    delete env[key];
    assert.throws(() => runner.assertReleaseGates(env));
  }

  assert.throws(() =>
    runner.assertReleaseGates({
      ...validEnvironment(),
      CHALIN03_MIGRATION_RELEASE: "another-release",
    })
  );
});

test("SQL splitter supports delimiter-protected procedures and triggers", () => {
  const statements = runner.splitSqlScript(`
CREATE TABLE example (id INT);
DELIMITER $$
CREATE PROCEDURE example_proc()
BEGIN
  SELECT 1;
END $$
DELIMITER ;
SELECT 2;
`);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE TABLE example/);
  assert.match(statements[1], /CREATE PROCEDURE example_proc/);
  assert.match(statements[2], /SELECT 2/);
});

test("verifier validation rejects missing, non-numeric and non-zero results", () => {
  const plan = {
    name: "example",
    expectedProblems: ["problem_one", "problem_two"],
  };
  assert.doesNotThrow(() =>
    runner.validateVerifierResults(plan, [
      [{ problem_one: 0 }],
      [{ problem_two: 0 }],
    ])
  );
  assert.throws(() =>
    runner.validateVerifierResults(plan, [[{ problem_one: 1 }], [{ problem_two: 0 }]])
  );
  assert.throws(() =>
    runner.validateVerifierResults(plan, [[{ problem_one: "bad" }], [{ problem_two: 0 }]])
  );
  assert.throws(() => runner.validateVerifierResults(plan, [[{ problem_one: 0 }]]));
});

test("foundation verifier must prove its migration record", () => {
  const plan = runner.PRODUCTION_MIGRATION_PLAN[0];
  const goodResults = [
    [{ migration_name: plan.migrationRecord }],
    ...plan.expectedProblems.map((key) => [{ [key]: 0 }]),
  ];
  assert.doesNotThrow(() => runner.validateVerifierResults(plan, goodResults));

  const badResults = [...goodResults];
  badResults[0] = [{ migration_name: "wrong" }];
  assert.throws(() => runner.validateVerifierResults(plan, badResults));
});

test("Finance migration command is separate from the legacy production runner", () => {
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:production"],
    "node scripts/runEquipmentFinanceProductionMigrations.js"
  );
  assert.equal(
    packageJson.scripts["migrate:production"],
    "node scripts/runProductionMigrations.js"
  );
});
