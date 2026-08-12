const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(backendRoot, "scripts", "runMissingCreditDebtBackfill20260805.js"),
  "utf8"
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);
const {
  REPAIR_LOCK,
  REPAIR_RECORD,
  REQUIRED_EXACT_NAME_RECOVERY,
  addUtcDays,
  assertExpectedDebtChange,
  assertUnchangedCore,
  debtStatus,
  money,
} = require("../scripts/runMissingCreditDebtBackfill20260805");

test("backfill identity, ordering and one-time production controls are fixed", () => {
  assert.equal(REPAIR_RECORD, "20260805_missing_credit_debt_backfill");
  assert.equal(
    REQUIRED_EXACT_NAME_RECOVERY,
    "20260805_exact_name_receipt_owner_recovery"
  );
  assert.ok(REPAIR_LOCK.length <= 64);
  assert.match(source, /NODE_ENV/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /SELECT GET_LOCK\(\?, 60\) AS acquired/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /rollback/);
  assert.match(source, /schema_migrations/);

  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const exactName = maintenance.indexOf("runExactNameReceiptOwnerRecovery20260805.js");
  const backfill = maintenance.indexOf("runMissingCreditDebtBackfill20260805.js");
  assert.ok(exactName >= 0);
  assert.ok(backfill > exactName);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["repair:missing-credit-debts:20260805:production"],
    "node scripts/runMissingCreditDebtBackfill20260805.js"
  );
});

test("scanner selects only completed outstanding credit-family sales without a linked debt", () => {
  assert.match(source, /LEFT JOIN debts d/);
  assert.match(source, /d\.sale_id = s\.id/);
  assert.match(source, /WHERE d\.id IS NULL/);
  assert.match(source, /s\.sale_status = 'completed'/);
  assert.match(source, /COALESCE\(s\.is_voided, 0\) = 0/);
  assert.match(source, /s\.payment_type IN \('credit', 'mixed', 'installment'\)/);
  assert.match(source, /s\.balance > 0\.005/);
});

test("repair reconnects one exact unlinked debt or inserts one debt from the sale", () => {
  assert.match(source, /sale_id IS NULL/);
  assert.match(source, /DATE\(created_at\) = DATE\(\?\)/);
  assert.match(source, /ABS\(amount_owed - \?\) <= 0\.01/);
  assert.match(source, /multiple_matching_unlinked_debts/);
  assert.match(source, /UPDATE debts/);
  assert.match(source, /INSERT INTO debts/);
  assert.match(source, /verifyOneDebtPerRepairedSale/);
  assert.match(source, /HAVING COUNT\(d\.id\) <> 1/);
});

test("date, money and debt status helpers preserve sale values", () => {
  assert.equal(money("1900"), 1900);
  assert.equal(money("3800.009"), 3800.01);
  assert.equal(debtStatus(1900, 0), "unpaid");
  assert.equal(debtStatus(1000, 900), "partial");
  assert.equal(debtStatus(0, 1900), "paid");
  assert.equal(addUtcDays("2026-07-31", 7), "2026-08-07");
  assert.equal(addUtcDays("2026-08-05", 7), "2026-08-12");
});

test("protected sales, stock and debt-payment values must remain unchanged", () => {
  const before = {
    sale_count: 20,
    sale_total: 50000,
    sale_paid: 40000,
    sale_balance: 10000,
    debt_count: 5,
    debt_owed: 10000,
    debt_paid: 2000,
    debt_balance: 8000,
    payment_count: 3,
    payment_total: 2000,
    product_count: 50,
    stock_quantity: 400,
  };
  const after = {
    ...before,
    debt_count: 6,
    debt_owed: 11900,
    debt_paid: 2000,
    debt_balance: 9900,
  };
  assert.doesNotThrow(() => assertUnchangedCore(before, after));
  assert.doesNotThrow(() =>
    assertExpectedDebtChange(before, after, {
      inserted_count: 1,
      inserted_owed: 1900,
      inserted_paid: 0,
      inserted_balance: 1900,
    })
  );
  assert.throws(
    () => assertUnchangedCore(before, { ...after, stock_quantity: 399 }),
    /stock_quantity/
  );
  assert.throws(
    () => assertUnchangedCore(before, { ...after, payment_total: 1999 }),
    /payment_total/
  );
});

test("backfill cannot delete or financially rewrite protected records", () => {
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
  assert.doesNotMatch(source, /UPDATE\s+sales/i);
  assert.doesNotMatch(source, /UPDATE\s+products/i);
  assert.doesNotMatch(source, /UPDATE\s+debt_payments/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+debt_payments/i);
  assert.doesNotMatch(source, /SET\s+(?:total|amount_owed|amount_paid|balance)\s*=/i);
});
