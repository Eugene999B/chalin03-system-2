const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const cleanupPath = path.join(
  root,
  "backend",
  "scripts",
  "runMiningTrialCleanup.js"
);
const packagePath = path.join(root, "backend", "package.json");
const systemRoutesPath = path.join(
  root,
  "backend",
  "routes",
  "systemRoutes.js"
);

const cleanupSource = fs.readFileSync(cleanupPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const systemRoutesSource = fs.readFileSync(systemRoutesPath, "utf8");
const cleanup = require(cleanupPath);

test("Mining trial cleanup never disables constraints or changes database schema", () => {
  assert.doesNotMatch(cleanupSource, /FOREIGN_KEY_CHECKS/i);
  assert.doesNotMatch(cleanupSource, /\bTRUNCATE\b/i);
  assert.doesNotMatch(cleanupSource, /\bDROP\s+(?:TABLE|DATABASE)\b/i);
  assert.doesNotMatch(cleanupSource, /\bALTER\s+TABLE\b/i);
  assert.match(cleanupSource, /beginTransaction\(\)/);
  assert.match(cleanupSource, /rollback\(\)/);
  assert.match(cleanupSource, /schema_migrations/);
});

test("Mining cleanup protects Spare Parts, Equipment Hire and shared fleet sentinels", () => {
  for (const table of [
    "products",
    "sales",
    "sale_items",
    "debts",
    "expenses",
    "business_locations",
    "hire_contracts",
    "hire_invoices",
    "hire_payments",
    "fleet_assets",
    "fleet_meter_readings",
  ]) {
    assert.ok(cleanup.SENTINEL_TABLES.includes(table), `${table} must be protected`);
  }
  assert.match(
    cleanupSource,
    /assertSameSentinels\(beforeSentinels, afterSentinels\)/
  );
});

test("Mining cleanup orders dependent tables before their parents", () => {
  const order = cleanup.buildDeleteOrder(
    ["mining_sites", "mining_daily_logs", "mining_production_records"],
    [
      {
        child_table: "mining_daily_logs",
        parent_table: "mining_sites",
      },
      {
        child_table: "mining_production_records",
        parent_table: "mining_daily_logs",
      },
    ]
  );

  assert.ok(
    order.indexOf("mining_production_records") <
      order.indexOf("mining_daily_logs")
  );
  assert.ok(
    order.indexOf("mining_daily_logs") < order.indexOf("mining_sites")
  );
});

test("one-time production start is fail-closed and health exposes only cleanup evidence", () => {
  assert.match(
    packageJson.scripts.start,
    /^node scripts\/runMiningTrialCleanup\.js && node /
  );
  assert.match(
    systemRoutesSource,
    /mining_trial_cleanup: miningCleanupStatus\(\)/
  );
  assert.match(
    systemRoutesSource,
    /spare_parts_and_hire_sentinels_verified/
  );
  assert.doesNotMatch(
    systemRoutesSource,
    /database_name: parsed\.database_name/
  );
});
