const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const dailyClosingSource = read("routes/dailyClosingRoutes.js");
const salesSource = read("routes/saleRoutes.js");
const activitySource = read("routes/activityRoutes.js");
const backupSource = read("routes/backupRoutes.js");
const backupSafetySource = read("services/backupSafetyService.js");
const smsSource = read("routes/smsRoutes.js");
const migrationSource = fs.readFileSync(
  path.resolve(root, "..", "database", "20260714_cash_control_security_migration.sql"),
  "utf8"
);

test("Daily Closing requires independent counts and keeps denominations optional", () => {
  assert.match(dailyClosingSource, /Every counted\/confirmed channel must be entered manually/);
  assert.match(dailyClosingSource, /counted_confirmed/);
  assert.match(dailyClosingSource, /hasDenominationEvidence/);
  assert.match(dailyClosingSource, /Optional cash denomination total GHS/);
  assert.match(dailyClosingSource, /Cash Drawer Control was removed from the current business workflow/);
  assert.match(dailyClosingSource, /const cashControls = getCashControls\(\{\}\)/);
});

test("Daily Closing supports independent manager verification and revision history", () => {
  assert.match(dailyClosingSource, /\/:id\/verify/);
  assert.match(dailyClosingSource, /The person who submitted the closing cannot verify the same closing/);
  assert.match(dailyClosingSource, /daily_closing_revisions/);
  assert.match(dailyClosingSource, /stale_after_close/);
});

test("Completed sale changes require independent approval and preserve complete evidence", () => {
  assert.match(salesSource, /approver_username/);
  assert.match(salesSource, /approver_password/);
  assert.match(salesSource, /sale_change_history/);
  assert.match(salesSource, /before_snapshot_json/);
  assert.match(salesSource, /after_snapshot_json/);
  assert.match(salesSource, /A new sale cannot be added after Daily Closing/);
});

test("Activity Log has grouped Excel PDF Word and CSV exports", () => {
  assert.match(activitySource, /export\.xlsx/);
  assert.match(activitySource, /export\.pdf/);
  assert.match(activitySource, /export\.doc/);
  assert.match(activitySource, /authentication/);
  assert.match(activitySource, /products_inventory/);
  assert.match(activitySource, /daily_closing/);
});

test("Backup dynamically includes new accounting evidence tables", () => {
  for (const table of [
    "sale_payment_allocations",
    "sale_change_history",
    "daily_closing_revisions",
  ]) {
    assert.match(migrationSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(backupSource, /information_schema\.TABLES/);
  assert.match(backupSource, /classifyDatabaseTables/);
  assert.match(backupSafetySource, /currentIncludedTables/);
  assert.match(backupSafetySource, /Backup is missing current required tables/);
  assert.doesNotMatch(backupSource, /const PREFERRED_TABLE_ORDER/);
});

test("Clean-hands Daily Closing reports include security flags and immutable revisions", () => {
  assert.match(dailyClosingSource, /Security Flags/);
  assert.match(dailyClosingSource, /Closing Revisions/);
  assert.match(dailyClosingSource, /CLEAN-HANDS SECURITY AND ERROR INDICATORS/);
  assert.match(dailyClosingSource, /IMMUTABLE DAILY CLOSING REVISION HISTORY/);
  assert.match(dailyClosingSource, /payment_method.*Method/s);
});

test("Legacy and changed closings cannot be presented as independently verified", () => {
  assert.match(dailyClosingSource, /counted_confirmed/);
  assert.match(dailyClosingSource, /stale_after_close/);
  assert.match(dailyClosingSource, /cannot be verified until the variance and revision history are reviewed/);
});

test("Changed closings have a controlled reconciliation path before re-verification", () => {
  assert.match(dailyClosingSource, /\/:id\/reconcile/);
  assert.match(dailyClosingSource, /The person who submitted the closing cannot reconcile its post-closing revision/);
  assert.match(dailyClosingSource, /Post-closing changes reconciled/);
  assert.match(dailyClosingSource, /verification_status = 'revised'/);
});

test("Daily Closing summary calculations support transactional reconciliation", () => {
  assert.match(dailyClosingSource, /calculateClosingSummary\(branchId, closingDate, cashControlSource = \{\}, connection = pool\)/);
  assert.match(dailyClosingSource, /await connection\.query/);
});

const returnsSource = read("routes/returnRoutes.js");
const exportSource = read("routes/exportRoutes.js");

test("Financial returns require exact refund channel and protected approval", () => {
  assert.match(returnsSource, /allowedReturnTypes = new Set\(\["stock_only", "refund"\]\)/);
  assert.match(returnsSource, /Refund approver must be an active administrator or manager/);
  assert.match(returnsSource, /const samePerson = Number\(approver\.id\) === Number\(currentUserId\)/);
  assert.match(returnsSource, /samePerson && approverRole !== "admin"/);
  assert.match(returnsSource, /Only a System Administrator can approve their own financial refund/);
  assert.match(returnsSource, /refund_reference/);
  assert.match(returnsSource, /markClosingStale/);
  assert.match(migrationSource, /refund_method.*ENUM\('none','cash','momo','bank','other'\)/s);
});

test("Returns exports and closing reports show protected refund evidence", () => {
  assert.match(exportSource, /Returns Summary/);
  assert.match(exportSource, /Returns Detail/);
  assert.match(exportSource, /Refund Channel/);
  assert.match(exportSource, /Approved By/);
  assert.match(dailyClosingSource, /Returns & Refunds/);
  assert.match(dailyClosingSource, /refund_cash/);
  assert.match(dailyClosingSource, /refund_momo/);
});

test("Daily Closing calculation subtracts approved refunds from exact channels", async () => {
  const dailyClosingModule = require("../routes/dailyClosingRoutes");
  const { calculateClosingSummary } = dailyClosingModule._test;

  const connection = {
    async query(sql) {
      if (sql.includes("FROM branches")) {
        return [[{ id: 1, code: "MAIN", name: "Main Store", location: "Dunkwa" }]];
      }
      if (sql.includes("FROM sales s") && sql.includes("sale_payment_allocations")) {
        return [[{
          id: 1,
          receipt_number: "TEST-001",
          customer_name: "TEST CUSTOMER",
          customer_phone: "",
          subtotal: 200,
          discount_amount: 0,
          tax_amount: 0,
          total: 200,
          payment_type: "mixed",
          amount_tendered: 150,
          amount_paid: 180,
          change_due: 0,
          balance: 20,
          allocation_cash: 100,
          allocation_momo: 30,
          allocation_bank: 20,
          allocation_other: 0,
          allocation_count: 3,
          debt_payments_after_sale: 30,
          created_at: "2026-07-14T12:00:00Z",
          staff_name: "Cashier",
        }]];
      }
      if (sql.includes("FROM debt_payments")) {
        return [[
          { id: 1, amount: 50, payment_method: "cash", paid_at: "2026-07-14T13:00:00Z" },
          { id: 2, amount: 10, payment_method: "momo", paid_at: "2026-07-14T13:10:00Z" },
        ]];
      }
      if (sql.includes("FROM expenses e")) {
        return [[
          { id: 1, category: "Transport", amount: 15, payment_method: "cash", created_at: "2026-07-14T14:00:00Z" },
          { id: 2, category: "Data", amount: 5, payment_method: "momo", created_at: "2026-07-14T14:10:00Z" },
        ]];
      }
      if (sql.includes("FROM returns r")) {
        return [[
          { id: 1, quantity: 1, return_type: "refund", refund_amount: 5, refund_method: "cash", returned_at: "2026-07-14T15:00:00Z", product_name: "Part A" },
          { id: 2, quantity: 1, return_type: "refund", refund_amount: 2, refund_method: "momo", returned_at: "2026-07-14T15:10:00Z", product_name: "Part B" },
        ]];
      }
      if (sql.includes("FROM sale_change_history")) return [[]];
      if (sql.includes("COALESCE(s.is_voided")) return [[]];
      throw new Error(`Unexpected Daily Closing test query: ${sql.slice(0, 120)}`);
    },
  };

  const summary = await calculateClosingSummary(
    1,
    "2026-07-14",
    {
      opening_cash_float: 20,
      other_cash_in: 10,
      cash_deposits: 20,
      cash_withdrawals: 5,
      other_cash_out: 0,
    },
    connection
  );

  assert.equal(summary.expected_cash, 135);
  assert.equal(summary.expected_momo, 33);
  assert.equal(summary.expected_bank, 20);
  assert.equal(summary.expected_other, 0);
  assert.equal(summary.expected_total, 188);
  assert.equal(summary.refund_total, 7);
  assert.equal(summary.sales_received, 150);
  assert.equal(summary.credit_created, 50);
  assert.equal(summary.mixed_sales, 150);
  assert.equal(summary.sales_transactions[0].current_amount_paid, 180);
  assert.equal(summary.sales_transactions[0].debt_payments_after_sale, 30);
  assert.equal(summary.sales_transactions[0].amount_paid, 150);
  assert.equal(summary.sales_transactions[0].balance, 50);
});

test("Daily Closing treats Credit and Mixed as classifications and sends owner summary after commit", () => {
  assert.match(
    dailyClosingSource,
    /Credit and Mixed are sale classifications, not extra settlement channels/
  );
  assert.match(
    dailyClosingSource,
    /Later debt payments are removed from the original sale receipt/
  );
  assert.match(dailyClosingSource, /sendOwnerSmsAlert/);
  assert.match(dailyClosingSource, /smsType: "daily_summary"/);
  assert.match(
    dailyClosingSource,
    /Closing remains saved, but the boss summary SMS failed/
  );
});

test("Manual boss summary uses the official saved Daily Closing snapshot", () => {
  assert.match(
    smsSource,
    /Complete Daily Closing for this store and date before sending the official boss summary SMS/
  );
  assert.match(smsSource, /FROM daily_closings dc/);
  assert.match(smsSource, /Official Daily Closing/);
  assert.doesNotMatch(
    smsSource.slice(
      smsSource.indexOf('"/daily-summary"'),
      smsSource.indexOf('"/custom"')
    ),
    /SUM\(s\.amount_paid\)/
  );
});

test("Daily Closing and new sales serialize on the selected store row", () => {
  assert.match(dailyClosingSource, /SELECT id FROM branches WHERE id = \? LIMIT 1 FOR UPDATE/);
  assert.match(salesSource, /Serialize new sales against Daily Closing/);
  assert.match(salesSource, /SELECT id FROM branches WHERE id = \? LIMIT 1 FOR UPDATE/);
  assert.match(dailyClosingSource, /calculateClosingSummary\([\s\S]*cashControls,[\s\S]*connection/);
});

test("Protected sale voids keep branch approval scope and block complex histories", () => {
  assert.match(salesSource, /currentUserId: req\.user\.id,[\s\S]*branchId,[\s\S]*approverUsername/);
  assert.match(salesSource, /already has a protected return or refund/);
  assert.match(salesSource, /already has debt-payment history/);
});
