const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MIGRATION_RECORD,
  splitSqlScript,
  validateRepair,
} = require("../scripts/runEquipmentFinanceOpeningDepositFoundationRepair");

const backendRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(backendRoot, "..");
const migrationPath = path.join(
  repositoryRoot,
  "database/migrations/20260805_equipment_finance_opening_deposit_foundation_repair.sql"
);
const verifierPath = path.join(
  repositoryRoot,
  "database/migrations/20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql"
);

const migrationSql = fs.readFileSync(migrationPath, "utf8");
const verifierSql = fs.readFileSync(verifierPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);

test("Opening Deposit foundation repair runs before the final Phase Four maintenance gate", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const repairPosition = maintenance.indexOf(
    "node scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js"
  );
  const phaseFourPosition = maintenance.indexOf(
    "node scripts/runEquipmentFinancePhaseFourStartup.js"
  );

  assert.ok(repairPosition >= 0, "maintenance repair must be registered");
  assert.ok(phaseFourPosition > repairPosition, "repair must run before Phase Four");
});

test("repair migration is additive and covers every route readiness column", () => {
  for (const column of [
    "deposit_completed_at",
    "deposit_completed_by",
    "reservation_activated_at",
    "reservation_activated_by",
    "idempotency_key",
    "credit_application_id",
    "payment_stage",
    "reservation_effect",
  ]) {
    assert.match(migrationSql, new RegExp(`'${column}'`));
    assert.match(verifierSql, new RegExp(`'${column}'`));
  }

  assert.doesNotMatch(migrationSql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migrationSql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migrationSql, /\bUPDATE\s+equipment_sale_/i);
  assert.doesNotMatch(migrationSql, /\bCREATE\s+TRIGGER\b/i);
  assert.doesNotMatch(migrationSql, /\bDROP\s+TRIGGER\b/i);
});

test("repair SQL and verifier split into complete executable statements", () => {
  const migrationStatements = splitSqlScript(migrationSql);
  const verifierStatements = splitSqlScript(verifierSql);

  assert.ok(migrationStatements.length >= 20);
  assert.equal(verifierStatements.length, 4);
  assert.match(migrationStatements.at(-1), new RegExp(MIGRATION_RECORD));
});

test("repair verifier accepts a complete foundation and rejects gaps", () => {
  const goodResults = [
    [{ migration_name: MIGRATION_RECORD }],
    [{ missing_opening_deposit_columns: 0 }],
    [{ missing_opening_deposit_indexes: 0 }],
    [{ duplicate_opening_deposit_idempotency_keys: 0 }],
  ];

  assert.doesNotThrow(() => validateRepair(goodResults));
  assert.throws(
    () =>
      validateRepair([
        goodResults[0],
        [{ missing_opening_deposit_columns: 1 }],
        goodResults[2],
        goodResults[3],
      ]),
    /columns are still missing/i
  );
  assert.throws(
    () =>
      validateRepair([
        goodResults[0],
        goodResults[1],
        goodResults[2],
        [{ duplicate_opening_deposit_idempotency_keys: 1 }],
      ]),
    /duplicate opening deposit idempotency keys/i
  );
});
