const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PRODUCTION_MIGRATION_PLAN,
  RELEASE_CONFIRMATION,
  assertProductionConfirmation,
  splitSqlScript,
  validateVerifierResults,
} = require("../scripts/runProductionMigrations");

const migrationsDir = path.resolve(__dirname, "../../database/migrations");

function readMigration(filename) {
  return fs.readFileSync(path.join(migrationsDir, filename), "utf8");
}

test("production migration plan contains only the two approved release migrations", () => {
  assert.deepEqual(
    PRODUCTION_MIGRATION_PLAN.map((item) => item.name),
    [
      "20260725_phase1_financial_control_hardening",
      "20260725_post_phase1_audit_signoff_readiness",
    ]
  );
});

test("SQL parser preserves stored procedure bodies and removes DELIMITER directives", () => {
  for (const item of PRODUCTION_MIGRATION_PLAN) {
    const statements = splitSqlScript(readMigration(item.migration));
    assert.ok(statements.length > 5);
    assert.equal(statements.some((sql) => /\bDELIMITER\b/i.test(sql)), false);
    assert.equal(
      statements.filter((sql) => /CREATE\s+PROCEDURE/i.test(sql)).length,
      2
    );
    assert.ok(statements.some((sql) => /DROP\s+PROCEDURE/i.test(sql)));
  }
});

test("all verifier scripts parse as read-only SELECT statements", () => {
  for (const item of PRODUCTION_MIGRATION_PLAN) {
    const statements = splitSqlScript(readMigration(item.verifier));
    assert.ok(statements.length >= 4);
    for (const statement of statements) {
      const withoutComment = statement.replace(/^\s*--.*$/gm, "").trim();
      assert.match(withoutComment, /^(?:WITH\b|SELECT\b)/i);
      assert.doesNotMatch(
        withoutComment,
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|RENAME)\b/i
      );
    }
  }
});

test("production confirmation fails closed", () => {
  assert.throws(() => assertProductionConfirmation({}), /NODE_ENV=production/);
  assert.throws(
    () => assertProductionConfirmation({ NODE_ENV: "production" }),
    /CHALIN03_PRODUCTION_MIGRATIONS_ENABLED/
  );
  assert.throws(
    () =>
      assertProductionConfirmation({
        NODE_ENV: "production",
        CHALIN03_PRODUCTION_MIGRATIONS_ENABLED: "true",
      }),
    /CHALIN03_SIGNED_BACKUP_CONFIRMED/
  );
  assert.doesNotThrow(() =>
    assertProductionConfirmation({
      NODE_ENV: "production",
      CHALIN03_PRODUCTION_MIGRATIONS_ENABLED: "true",
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
    })
  );
});

test("financial verifier rejects invalid rows and accepts complete evidence", () => {
  const plan = PRODUCTION_MIGRATION_PLAN[0];
  const valid = [
    [{ migration_name: plan.name }],
    [
      "is_voided",
      "void_reason",
      "void_reference",
      "voided_by",
      "voided_at",
      "void_approved_by",
      "void_approved_at",
      "is_reversal",
      "reversal_of_expense_id",
      "reversal_reference",
    ].map((COLUMN_NAME) => ({ COLUMN_NAME })),
    [
      "idx_expense_void_status",
      "uq_expense_void_reference",
      "idx_expense_void_approval",
      "uq_expense_reversal_source",
      "uq_expense_reversal_reference",
    ].map((INDEX_NAME) => ({ INDEX_NAME })),
    [{ invalid_void_rows: 0 }],
    [{ invalid_reversal_rows: 0 }],
  ];

  assert.doesNotThrow(() => validateVerifierResults(plan, valid));
  const invalid = structuredClone(valid);
  invalid[3][0].invalid_void_rows = 1;
  assert.throws(
    () => validateVerifierResults(plan, invalid),
    /invalid voided expense rows/
  );
});

test("audit readiness verifier requires zero missing schema", () => {
  const plan = PRODUCTION_MIGRATION_PLAN[1];
  const detailRows = [
    "branch_id",
    "purchases_checked",
    "returns_checked",
    "transfers_checked",
    "sms_checked",
    "stock_ledger_checked",
    "backup_checked",
    "maintenance_checked",
  ].map((COLUMN_NAME) => ({ TABLE_NAME: "audit_signoffs", COLUMN_NAME }));
  detailRows.push({
    TABLE_NAME: "audit_reapproval_log",
    COLUMN_NAME: "branch_id",
  });

  const valid = [
    [{ migration_name: plan.name }],
    [{ missing_audit_readiness_columns: 0 }],
    [{ missing_audit_readiness_indexes: 0 }],
    detailRows,
  ];

  assert.doesNotThrow(() => validateVerifierResults(plan, valid));
  const invalid = structuredClone(valid);
  invalid[2][0].missing_audit_readiness_indexes = 1;
  assert.throws(
    () => validateVerifierResults(plan, invalid),
    /missing indexes/
  );
});
