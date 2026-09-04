const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendDir, "package.json"), "utf8")
);
const scriptPath = path.join(
  backendDir,
  "scripts",
  "runZeroPaymentCreditDebtVisibilityRepair20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const {
  REPAIR_RECORD,
  REQUIRED_BACKFILL_RECORD,
  assertCoreUnchanged,
  assertProtectedDebtsUnchanged,
  computedOutstanding,
  isProtectedDebt,
  normalizeProtectedDebt,
} = require(scriptPath);

test("zero-payment credit receipts use total minus paid, not the corrupted sale balance", () => {
  assert.equal(computedOutstanding(1900, 0), 1900);
  assert.equal(computedOutstanding(3800, 0), 3800);
  assert.equal(computedOutstanding(4000, 200), 3800);
  assert.equal(computedOutstanding(1900, 1900), 0);
  assert.match(source, /\(total - amount_paid\) > 0\.005/);
  assert.match(source, /amount_paid <= 0\.005/);
});

test("blank phone numbers never block an unpaid credit debt from becoming visible", () => {
  assert.match(source, /const customerPhone = cleanText\(sale\.customer_phone, 30\) \|\| null/);
  assert.match(source, /phone_required: false/);
  assert.doesNotMatch(source, /customer_phone\s+IS\s+NOT\s+NULL/i);
  assert.doesNotMatch(source, /customer_phone\s*<>\s*''/i);
});

test("paid, partial and payment-linked debts are always protected", () => {
  assert.equal(isProtectedDebt({ status: "paid", amount_paid: 0, payment_count: 0 }), true);
  assert.equal(isProtectedDebt({ status: "partial", amount_paid: 0, payment_count: 0 }), true);
  assert.equal(isProtectedDebt({ status: "unpaid", amount_paid: 1, payment_count: 0 }), true);
  assert.equal(isProtectedDebt({ status: "unpaid", amount_paid: 0, payment_count: 1 }), true);
  assert.equal(isProtectedDebt({ status: "unpaid", amount_paid: 0, payment_count: 0, payment_total: 5 }), true);
  assert.equal(isProtectedDebt({ status: "unpaid", amount_paid: 0, payment_count: 0, payment_total: 0 }), false);
  assert.match(source, /paid_partial_or_payment_linked_debt_protected/);
  assert.match(source, /status IN \('paid', 'partial'\)/);
  assert.match(source, /NOT EXISTS \([\s\S]*FROM debt_payments/);
});

test("protected debt snapshots fail closed on any paid-debt mutation", () => {
  const protectedRow = normalizeProtectedDebt({
    id: 5,
    branch_id: 1,
    sale_id: 20,
    customer_id: 2,
    customer_name: "Paid Customer",
    customer_phone: "",
    amount_owed: 100,
    amount_paid: 100,
    balance: 0,
    status: "paid",
    due_date: "2026-08-05",
    payment_count: 1,
    payment_total: 100,
  });
  assert.doesNotThrow(() =>
    assertProtectedDebtsUnchanged([protectedRow], [{ ...protectedRow }])
  );
  assert.throws(
    () =>
      assertProtectedDebtsUnchanged(
        [protectedRow],
        [{ ...protectedRow, balance: 1 }]
      ),
    /paid, partially paid, or payment-linked debt changed/i
  );
});

test("the repair cannot change sales, stock, payments or daily-closing records", () => {
  const snapshot = {
    sale_count: 10,
    sale_total: 20000,
    sale_paid: 10000,
    sale_balance: 10000,
    product_count: 50,
    stock_quantity: 500,
    payment_count: 8,
    payment_total: 6000,
    daily_closing_count: 3,
  };
  assert.doesNotThrow(() => assertCoreUnchanged(snapshot, { ...snapshot }));
  assert.throws(
    () => assertCoreUnchanged(snapshot, { ...snapshot, payment_total: 6001 }),
    /payment_total/
  );
  assert.doesNotMatch(source, /UPDATE\s+sales/i);
  assert.doesNotMatch(source, /UPDATE\s+products/i);
  assert.doesNotMatch(source, /UPDATE\s+debt_payments/i);
  assert.doesNotMatch(source, /UPDATE\s+daily_closings/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(sales|debts|debt_payments|products|daily_closings)/i);
});

test("the one-time visibility repair runs after backfill in controlled maintenance", () => {
  assert.equal(REPAIR_RECORD, "20260805_zero_payment_credit_debt_visibility_repair");
  assert.equal(REQUIRED_BACKFILL_RECORD, "20260805_missing_credit_debt_backfill");
  assert.equal(
    packageJson.scripts["repair:zero-payment-credit-debt-visibility:20260805:production"],
    "node scripts/runZeroPaymentCreditDebtVisibilityRepair20260805.js"
  );
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const backfillIndex = maintenance.indexOf(
    "runMissingCreditDebtBackfill20260805.js"
  );
  const repairIndex = maintenance.indexOf(
    "runZeroPaymentCreditDebtVisibilityRepair20260805.js"
  );
  assert.ok(backfillIndex >= 0);
  assert.ok(repairIndex > backfillIndex);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.match(source, /schema_migrations/);
  assert.match(source, /GET_LOCK/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /rollback/);
});
