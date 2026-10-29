const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("Finance boss activity polling cannot run more often than every 30 seconds", () => {
  const source = read("backend", "services", "equipmentFinanceBossAlertDeliveryBootstrap.js");
  assert.match(source, /const MIN_POLL_MS = 30_000;/);
  assert.match(
    source,
    /const POLL_MS = Math\.max\(MIN_POLL_MS, Number\(process\.env\.EQUIPMENT_FINANCE_BOSS_ALERT_POLL_MS\) \|\| 2000\);/
  );
});
