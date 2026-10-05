const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("Finance late-fee scheduler preserves the 48-hour cost-control minimum", () => {
  const source = read("backend", "services", "equipmentFinanceLateFeeScheduler.js");
  assert.match(source, /const MIN_INTERVAL_MINUTES = 48 \* 60;/);
  assert.match(
    source,
    /Math\.max\(\s*MIN_INTERVAL_MINUTES,\s*Number\(process\.env\.EQUIPMENT_FINANCE_LATE_FEE_INTERVAL_MINUTES \|\| MIN_INTERVAL_MINUTES\)\s*\)/
  );
});
