const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "runUnpaidReceiptIdentityIsolation20260805.js"),
  "utf8"
);

test("paid-debt snapshot filters grouped aliases outside the aggregate query", () => {
  assert.match(source, /FROM \(\s*SELECT[\s\S]*\) AS protected\s*WHERE protected\.debt_amount_paid/s);
  assert.match(source, /protected\.sale_amount_paid > 0\.005/);
  assert.match(source, /protected\.debt_status IN \('paid', 'partial'\)/);
  assert.match(source, /protected\.payment_count > 0/);
  assert.doesNotMatch(source, /HAVING\s+[\s\S]*COALESCE\(s\.amount_paid/s);
});

test("the repair still changes only customer ownership fields", () => {
  assert.match(source, /UPDATE sales\s+SET customer_id = NULL/s);
  assert.match(source, /UPDATE debts\s+SET customer_id = NULL/s);
  assert.doesNotMatch(source, /UPDATE debts[\s\S]*SET[\s\S]*(amount_owed|amount_paid|balance|status|due_date)\s*=/i);
  assert.doesNotMatch(source, /UPDATE sales[\s\S]*SET[\s\S]*(total|amount_paid|balance)\s*=/i);
});
