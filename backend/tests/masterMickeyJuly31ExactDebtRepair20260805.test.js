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
  "runMasterMickeyJuly31ExactDebtRepair20260805.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const repair = require(scriptPath);

function targetSale(overrides = {}) {
  return {
    receipt_number: repair.TARGET_RECEIPT,
    customer_name: repair.TARGET_NAME,
    total: repair.TARGET_TOTAL,
    amount_paid: 0,
    payment_type: "credit",
    sale_status: "completed",
    is_voided: 0,
    created_at: new Date("2026-07-31T10:30:20.000Z"),
    ...overrides,
  };
}

test("repair is restricted to the exact July 31 Master Mickey receipt", () => {
  assert.equal(repair.TARGET_RECEIPT, "CHL-MAIN-20260731-103020-7928");
  assert.equal(repair.TARGET_NAME, "MASTER MICKEY");
  assert.equal(repair.TARGET_DATE, "2026-07-31");
  assert.equal(repair.TARGET_TOTAL, 1900);
  assert.doesNotThrow(() => repair.validateTargetSale(targetSale()));
  assert.throws(
    () => repair.validateTargetSale(targetSale({ customer_name: "OTHER CUSTOMER" })),
    /not exactly MASTER MICKEY/
  );
  assert.throws(
    () => repair.validateTargetSale(targetSale({ total: 3800 })),
    /not GHS 1900\.00/
  );
});

test("any real payment evidence blocks the repair", () => {
  assert.doesNotThrow(() =>
    repair.assertTargetHasNoPaymentEvidence([
      { amount_paid: 0, payment_count: 0, payment_total: 0, status: "paid" },
    ])
  );
  assert.throws(
    () =>
      repair.assertTargetHasNoPaymentEvidence([
        { amount_paid: 1, payment_count: 0, payment_total: 0 },
      ]),
    /real payment evidence/
  );
  assert.throws(
    () =>
      repair.assertTargetHasNoPaymentEvidence([
        { amount_paid: 0, payment_count: 1, payment_total: 1900 },
      ]),
    /real payment evidence/
  );
});

test("status-only paid debt can be corrected only when money and payment rows are zero", () => {
  assert.match(source, /amount_paid = 0/);
  assert.match(source, /balance = \?/);
  assert.match(source, /status = 'unpaid'/);
  assert.match(source, /WHERE id = \? AND branch_id = \? AND sale_id = \?/);
  assert.match(source, /SELECT COUNT\(\*\) AS return_count FROM returns/);
  assert.match(source, /The target receipt has a return record and is protected/);
  assert.match(source, /Multiple debts are linked to the July 31 receipt/);
});

test("repair cannot mutate sales, stock, payments, closings or other customer debts", () => {
  assert.doesNotMatch(source, /UPDATE\s+sales/i);
  assert.doesNotMatch(source, /UPDATE\s+products/i);
  assert.doesNotMatch(source, /UPDATE\s+debt_payments/i);
  assert.doesNotMatch(source, /UPDATE\s+daily_closings/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+debts/i);
  assert.doesNotMatch(source, /MERGE_CUSTOMER_IDENTITIES/);
  assert.match(source, /assertOtherDebtsUnchanged/);
  assert.match(source, /assertCoreUnchanged/);
  assert.match(source, /paid_debts_changed: false/);
  assert.match(source, /debt_payments_changed: false/);
});

test("controlled maintenance runs exact repair after visibility repair", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const visibility = maintenance.indexOf(
    "runZeroPaymentCreditDebtVisibilityRepair20260805.js"
  );
  const exact = maintenance.indexOf("runMasterMickeyJuly31ExactDebtRepair20260805.js");
  assert.ok(visibility >= 0);
  assert.ok(exact > visibility);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts[
      "repair:master-mickey-july31-exact-debt:20260805:production"
    ],
    "node scripts/runMasterMickeyJuly31ExactDebtRepair20260805.js"
  );
  assert.equal(packageJson.dependencies.cors, "^2.8.5");
});
