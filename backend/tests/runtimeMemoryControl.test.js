const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const dbSource = fs.readFileSync(
  path.join(__dirname, "..", "config", "db.js"),
  "utf8"
);
const lateFeeSource = fs.readFileSync(
  path.join(__dirname, "..", "services", "equipmentFinanceLateFeeScheduler.js"),
  "utf8"
);

test("database pool has bounded connection and queue limits", () => {
  assert.match(dbSource, /const DB_CONNECTION_LIMIT = Math\.max\(/);
  assert.match(dbSource, /Math\.min\(Number\(process\.env\.DB_CONNECTION_LIMIT \|\| 5\), 5\)/);
  assert.match(dbSource, /const DB_QUEUE_LIMIT = Math\.max\(/);
  assert.match(dbSource, /Math\.min\(Number\(process\.env\.DB_QUEUE_LIMIT \|\| 50\), 50\)/);
  assert.match(dbSource, /connectionLimit: DB_CONNECTION_LIMIT/);
  assert.match(dbSource, /queueLimit: DB_QUEUE_LIMIT/);
});

test("late fee scheduler cannot run more often than every 48 hours", () => {
  assert.match(lateFeeSource, /const MIN_INTERVAL_MINUTES = 48 \* 60;/);
  assert.match(lateFeeSource, /Math\.max\(\s*MIN_INTERVAL_MINUTES/);
});
