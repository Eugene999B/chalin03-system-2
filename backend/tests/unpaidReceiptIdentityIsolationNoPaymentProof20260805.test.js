const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "runUnpaidReceiptIdentityIsolation20260805.js"),
  "utf8"
);

test("identity isolation never writes debt payments or financial columns", () => {
  assert.doesNotMatch(source, /INSERT\s+INTO\s+debt_payments/i);
  assert.doesNotMatch(source, /UPDATE\s+debt_payments/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+debt_payments/i);
  assert.match(source, /SET customer_id = NULL/);
  assert.match(source, /assertCoreUnchanged\(beforeCore, afterCore\)/);
});
