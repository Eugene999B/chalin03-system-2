from pathlib import Path
import json

ROOT = Path('.')


def replace_once(path, old, new):
    file_path = ROOT / path
    source = file_path.read_text(encoding='utf-8')
    if source.count(old) != 1:
        raise RuntimeError(f'Expected one match in {path}, found {source.count(old)}')
    file_path.write_text(source.replace(old, new), encoding='utf-8')


# Every external reference must be cleared explicitly before parent Mining rows
# are removed. CASCADE and SET NULL must not silently mutate shared tables.
replace_once(
    'backend/scripts/runMiningTrialCleanup.js',
    '    if (count > 0 && ["RESTRICT", "NO ACTION"].includes(key.delete_rule)) {\n      blockers.push({ ...key, count });\n    }',
    '    if (count > 0) {\n      blockers.push({ ...key, count });\n    }'
)

package_path = ROOT / 'backend/package.json'
package = json.loads(package_path.read_text(encoding='utf-8'))
package['scripts']['start'] = (
    'node scripts/runMiningTrialCleanup.js && '
    'node -r ./services/exportWorkbookSafetyBootstrap.js server.js'
)
package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')

replace_once(
    'backend/routes/systemRoutes.js',
    'const express = require("express");\n',
    'const express = require("express");\nconst fs = require("node:fs");\n'
)

replace_once(
    'backend/routes/systemRoutes.js',
    'const router = express.Router();\nconst startedAt = Date.now();\n',
    '''const router = express.Router();
const startedAt = Date.now();
const MINING_CLEANUP_STATUS_PATH =
  process.env.CHALIN03_MINING_CLEANUP_STATUS_PATH ||
  "/tmp/chalin03-mining-trial-cleanup-status.json";

function miningCleanupStatus() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(MINING_CLEANUP_STATUS_PATH, "utf8")
    );
    return {
      marker: parsed.marker || null,
      status: parsed.status || "unknown",
      recorded_at: parsed.recorded_at || null,
      deleted_row_count: Number(parsed.deleted_row_count || 0),
      spare_parts_and_hire_sentinels_verified: Boolean(
        parsed.spare_parts_and_hire_sentinels_verified
      ),
    };
  } catch {
    return null;
  }
}
'''
)

replace_once(
    'backend/routes/systemRoutes.js',
    '    request_id: req.requestId || null,\n  });\n});',
    '    request_id: req.requestId || null,\n    mining_trial_cleanup: miningCleanupStatus(),\n  });\n});'
)

test_path = ROOT / 'backend/tests/miningTrialCleanupContract.test.js'
test_path.write_text(r'''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const cleanupPath = path.join(root, "backend", "scripts", "runMiningTrialCleanup.js");
const packagePath = path.join(root, "backend", "package.json");
const systemRoutesPath = path.join(root, "backend", "routes", "systemRoutes.js");

const cleanupSource = fs.readFileSync(cleanupPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const systemRoutesSource = fs.readFileSync(systemRoutesPath, "utf8");
const cleanup = require(cleanupPath);

test("Mining trial cleanup never disables constraints or uses destructive schema commands", () => {
  assert.doesNotMatch(cleanupSource, /FOREIGN_KEY_CHECKS/i);
  assert.doesNotMatch(cleanupSource, /\bTRUNCATE\b/i);
  assert.doesNotMatch(cleanupSource, /\bDROP\s+(?:TABLE|DATABASE)\b/i);
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
  assert.match(cleanupSource, /assertSameSentinels\(beforeSentinels, afterSentinels\)/);
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

  assert.ok(order.indexOf("mining_production_records") < order.indexOf("mining_daily_logs"));
  assert.ok(order.indexOf("mining_daily_logs") < order.indexOf("mining_sites"));
});

test("one-time production start is fail-closed and health exposes only cleanup evidence", () => {
  assert.match(
    packageJson.scripts.start,
    /^node scripts\/runMiningTrialCleanup\.js && node /,
  );
  assert.match(systemRoutesSource, /mining_trial_cleanup: miningCleanupStatus\(\)/);
  assert.match(systemRoutesSource, /spare_parts_and_hire_sentinels_verified/);
  assert.doesNotMatch(systemRoutesSource, /database_name: parsed\.database_name/);
});
''', encoding='utf-8')

release_path = ROOT / 'docs/MINING_TRIAL_DATA_CLEANUP_RELEASE.md'
release_path.write_text('''# Mining Trial Data Cleanup Release

This is a one-time, System Administrator-authorized production cleanup for Mining trial data only.

## Protected data

The cleanup takes before-and-after row-count sentinels for Spare Parts, Equipment Hire, users, business locations and shared fleet records. Any change to those sentinels rolls back the entire transaction and prevents the backend from starting.

## Mining scope

The runner dynamically discovers every `mining_%` base table, reads the live foreign-key graph, clears explicitly Mining-scoped shared rows, deletes child tables before parents, and verifies all Mining tables are empty before committing.

It does not disable foreign keys, truncate tables, drop schema objects, delete business locations, delete users, or delete shared fleet assets.

## One-time evidence

A `schema_migrations` marker named `20260726_mining_trial_data_cleanup` prevents a second execution. The temporary health evidence is removed immediately after production verification.
''', encoding='utf-8')
