const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const scriptPath = path.join(
  backendDir,
  "scripts",
  "runMasterMickeyMergeProfileVisibilityRetry20260806.js"
);
const oldScriptPath = path.join(
  backendDir,
  "scripts",
  "runMasterMickeyMergeProfileVisibility20260806.js"
);
const bootstrapPath = path.join(
  backendDir,
  "services",
  "exportWorkbookSafetyBootstrap.js"
);
const source = fs.readFileSync(scriptPath, "utf8");
const oldSource = fs.readFileSync(oldScriptPath, "utf8");
const bootstrapSource = fs.readFileSync(bootstrapPath, "utf8");
const {
  REPAIR_RECORD,
  REQUIRED_ISOLATION_REPAIR,
  TARGET_DATE,
  TARGET_NAME,
  TARGET_RECEIPT,
  TARGET_TOTAL,
  assertSnapshotChange,
} = require(scriptPath);

test("targets only the exact detached July 31 Master Mickey receipt", () => {
  assert.equal(TARGET_RECEIPT, "CHL-MAIN-20260731-103020-7928");
  assert.equal(TARGET_NAME, "MASTER MICKEY");
  assert.equal(TARGET_TOTAL, 1900);
  assert.equal(TARGET_DATE, "2026-07-31");
  assert.equal(REPAIR_RECORD, "20260806_master_mickey_merge_profile_visibility");
  assert.equal(REQUIRED_ISOLATION_REPAIR, "20260805_unpaid_receipt_identity_isolation");
  assert.match(source, /WHERE s\.receipt_number = \?/);
  assert.doesNotMatch(source, /Expected exactly one existing saved MASTER MICKEY profile/);
  assert.match(oldSource, /Expected exactly one existing saved MASTER MICKEY profile/);
});

test("paid, partial, payment-linked and returned receipts remain protected", () => {
  assert.match(source, /\["paid", "partial"\]\.includes/);
  assert.match(source, /payment_count/);
  assert.match(source, /payment_total/);
  assert.match(source, /FROM debt_payments/);
  assert.match(source, /FROM returns WHERE branch_id = \? AND sale_id = \?/);
  assert.match(source, /target receipt unexpectedly has a phone number/i);
});

test("retry creates one receipt-owned profile and updates only two hidden IDs", () => {
  assert.match(source, /INSERT INTO customers \(branch_id, name, phone, location, created_at, updated_at\)/);
  const updates = [...source.matchAll(/UPDATE\s+(sales|debts)\s+SET\s+([\s\S]*?)\s+WHERE/gi)];
  assert.equal(updates.length, 2);
  assert.deepEqual(
    updates.map((match) => [
      match[1].toLowerCase(),
      match[2].replace(/\s+/g, " ").trim(),
    ]),
    [
      ["sales", "customer_id = ?"],
      ["debts", "customer_id = ?"],
    ]
  );
  assert.doesNotMatch(source, /DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE/i);
  assert.doesNotMatch(source, /SET\s+(?:amount_owed|amount_paid|balance|status|total|quantity)\s*=/i);
});

test("financial, payment, stock and closing totals remain unchanged", () => {
  const before = {
    customer_count: 100,
    sale_count: 645,
    sale_total: 500000,
    sale_paid: 400000,
    sale_balance: 100000,
    unlinked_sale_count: 21,
    debt_count: 201,
    debt_owed: 700000,
    debt_paid: 214649,
    debt_balance: 485351,
    unlinked_debt_count: 21,
    payment_count: 50,
    payment_total: 214649,
    product_count: 1000,
    stock_quantity: 5000,
    daily_closing_count: 20,
  };
  const after = {
    ...before,
    customer_count: 101,
    unlinked_sale_count: 20,
    unlinked_debt_count: 20,
  };
  assert.doesNotThrow(() => assertSnapshotChange(before, after, true));
  assert.throws(
    () => assertSnapshotChange(before, { ...after, debt_balance: 485352 }, true),
    /debt_balance/
  );
  assert.throws(
    () => assertSnapshotChange(before, { ...after, payment_total: 214650 }, true),
    /payment_total/
  );
});

test("production bootstrap bypasses the failed profile-count runner", () => {
  assert.match(bootstrapSource, /spawnSync\(process\.execPath, \[scriptPath\]/);
  assert.match(bootstrapSource, /runMasterMickeyMergeProfileVisibilityRetry20260806\.js/);
  assert.doesNotMatch(
    bootstrapSource,
    /["']runMasterMickeyMergeProfileVisibility20260806\.js["']/
  );
  assert.match(bootstrapSource, /NODE_ENV/);
  assert.match(bootstrapSource, /shell:\s*false/);
  assert.match(bootstrapSource, /stdio:\s*"inherit"/);
  assert.match(bootstrapSource, /runMasterMickeyMergeProfileVisibility\(\);\s*installExportWorkbookSafety\(\);/s);
});