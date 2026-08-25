const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runner = require("../scripts/runEquipmentFinanceProductionMigrations");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("backend/package.json"));
const runnerSource = read("backend/scripts/runEquipmentFinanceProductionMigrations.js");
const runnerGuide = read("docs/EQUIPMENT_FINANCE_PRODUCTION_MIGRATION_RUNNER.md");
const migrationIndex = read("database/migrations/README.md");

function validEnvironment() {
  return {
    NODE_ENV: "production",
    CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED: "true",
    CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
    CHALIN03_SQL_BACKUP_CONFIRMED: "true",
    CHALIN03_MIGRATION_RELEASE: runner.RELEASE_CONFIRMATION,
  };
}

test("Finance runner is locked to one exact release and ordered migration plan", () => {
  assert.equal(
    runner.RELEASE_CONFIRMATION,
    "20260825_EQUIPMENT_FINANCE_POLICY_HARDENING"
  );
  assert.equal(
    runner.MIGRATION_LOCK_NAME,
    "chalin03:production-migrations:20260825-equipment-finance-policy-hardening"
  );
  assert.deepEqual(
    runner.PRODUCTION_MIGRATION_PLAN.map((item) => item.name),
    [
      "20260729_equipment_credit_application_foundation",
      "20260729_equipment_finance_agreement_activation",
      "20260729_equipment_finance_deposit_reservation",
      "20260805_equipment_finance_opening_deposit_foundation_repair",
      "20260803_equipment_finance_phase4_deposit_reservation_integrity",
      "20260729_equipment_finance_final_lifecycle",
      "20260825_equipment_finance_policy_hardening",
    ]
  );
  assert.match(
    runner.PRODUCTION_MIGRATION_PLAN.at(-1).verifier,
    /^20260825_equipment_finance_policy_hardening_verify\.sql$/
  );
  for (const item of runner.PRODUCTION_MIGRATION_PLAN) {
    assert.ok(item.migration.endsWith(".sql"));
    assert.ok(item.verifier.endsWith("_verify.sql"));
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

test("Finance runner requires exact database identity and advisory locking", () => {
  assert.match(runnerSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /Set CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /SELECT GET_LOCK\(\?, 30\) AS acquired/);
  assert.match(runnerSource, /SELECT RELEASE_LOCK\(\?\) AS released/);
  assert.match(runnerSource, /multipleStatements: false/);
  assert.doesNotMatch(runnerSource, /database\/schema\.sql/);
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
      [{ migration_name: "example" }],
      [{ problem_one: 0 }],
      [{ problem_two: 0 }],
    ])
  );
  assert.throws(() =>
    runner.validateVerifierResults(plan, [[{ migration_name: "example" }], [{ problem_one: 1 }], [{ problem_two: 0 }]])
  );
  assert.throws(() =>
    runner.validateVerifierResults(plan, [[{ migration_name: "example" }], [{ problem_one: "bad" }], [{ problem_two: 0 }]])
  );
  assert.throws(() =>
    runner.validateVerifierResults(plan, [[{ migration_name: "example" }], [{ problem_one: 0 }]])
  );
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

test("policy hardening verifier is part of the approved plan", () => {
  const plan = runner.PRODUCTION_MIGRATION_PLAN.at(-1);
  assert.equal(plan.name, "20260825_equipment_finance_policy_hardening");
  assert.deepEqual(plan.expectedProblems, [
    "missing_policy_columns",
    "missing_policy_indexes",
    "missing_policy_triggers",
  ]);
  const goodResults = [
    [{ migration_name: plan.migrationRecord }],
    [{ missing_policy_columns: 0 }],
    [{ missing_policy_indexes: 0 }],
    [{ missing_policy_triggers: 0 }],
  ];
  assert.doesNotThrow(() => runner.validateVerifierResults(plan, goodResults));
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

test("runner documentation preserves the non-automatic safety contract", () => {
  for (const expected of [
    "npm run migrate:equipment-finance:production",
    "CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=true",
    "CHALIN03_SIGNED_BACKUP_CONFIRMED=true",
    "CHALIN03_SQL_BACKUP_CONFIRMED=true",
    "CHALIN03_MIGRATION_RELEASE=20260825_EQUIPMENT_FINANCE_POLICY_HARDENING",
    "CHALIN03_EXPECTED_DATABASE",
    "The runner is **not automatic**",
    "All approved Equipment Finance migrations and verifiers passed.",
    "set `CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=false`",
    "never run `database/schema.sql`",
  ]) {
    assert.match(runnerGuide, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  for (const filename of [
    "20260729_equipment_credit_application_foundation.sql",
    "20260729_equipment_finance_agreement_activation.sql",
    "20260729_equipment_finance_deposit_reservation.sql",
    "20260805_equipment_finance_opening_deposit_foundation_repair.sql",
    "20260803_equipment_finance_phase4_deposit_reservation_integrity.sql",
    "20260729_equipment_finance_final_lifecycle.sql",
    "20260825_equipment_finance_policy_hardening.sql",
  ]) {
    assert.match(runnerGuide, new RegExp(filename.replaceAll(".", "\\.")));
    assert.match(migrationIndex, new RegExp(filename.replaceAll(".", "\\.")));
  }

  assert.match(migrationIndex, /Complete approved-credit lifecycle/);
  assert.match(
    migrationIndex,
    /docs\/EQUIPMENT_FINANCE_PRODUCTION_MIGRATION_RUNNER\.md/
  );
});
