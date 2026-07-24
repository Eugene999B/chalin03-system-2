const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return readFileSync(join(__dirname, "..", "..", relativePath), "utf8");
}

const migrationPath = "database/migrations/20260717_release3b_mining_operations_control.sql";

test("Release 3B migration is additive and includes every Mining control table", () => {
  const migration = read(migrationPath);
  for (const table of [
    "mining_stockpiles",
    "mining_stockpile_movements",
    "mining_dispatches",
    "mining_fuel_tanks",
    "mining_fuel_transactions",
    "mining_fuel_reconciliations",
    "mining_contractors",
    "mining_shift_crews",
    "mining_shift_crew_members",
    "mining_site_closings",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /release3b_mining_operations_control/);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);

  const verification = read(
    "database/migrations/20260717_release3b_mining_operations_control_verify.sql"
  );
  assert.match(verification, /release3b_required_tables/);
  assert.match(verification, /invalid_stockpile_balances/);
  assert.match(verification, /invalid_fuel_tank_balances/);
  assert.match(verification, /cross_site_dispatch_stockpiles/);
});

test("Release 3B routes enforce site scope, explicit permissions and independent approvals", () => {
  const routes = read("backend/routes/miningControlRoutes.js");
  assert.match(routes, /resolveMiningSiteScope\(req, \{ requireSelection: true \}\)/);
  for (const permission of [
    "mining.stockpiles.view",
    "mining.stockpiles.manage",
    "mining.dispatch.view",
    "mining.dispatch.manage",
    "mining.dispatch.approve",
    "mining.fuel_control.view",
    "mining.fuel_control.manage",
    "mining.fuel_control.approve",
    "mining.workforce.view",
    "mining.workforce.manage",
    "mining.workforce.approve",
    "mining.closing.view",
    "mining.closing.manage",
    "mining.closing.approve",
  ]) {
    assert.match(routes, new RegExp(permission.replaceAll(".", "\\.")));
  }
  assert.match(routes, /INDEPENDENT_APPROVAL_REQUIRED/);
  assert.match(routes, /INSUFFICIENT_STOCKPILE_BALANCE/);
  assert.match(routes, /INSUFFICIENT_FUEL_BALANCE/);
  assert.match(routes, /movement_id/);
  assert.match(routes, /PDFDocument/);
});

test("Release 3B UI is routed inside Mining and does not reuse Spare Parts store context", () => {
  const app = read("frontend/src/App.jsx");
  const layout = read("frontend/src/layouts/MiningLayout.jsx");
  const page = read("frontend/src/pages/MiningControlCentrePage.jsx");
  const axios = read("frontend/src/api/axiosClient.js");
  assert.match(app, /path="control-centre"/);
  assert.match(layout, /\/mining\/control-centre/);
  assert.match(page, /useWorkspaceContext/);
  assert.match(page, /\/mining-control\/dashboard/);
  assert.match(axios, /chalin03_active_context_mining/);
  assert.match(axios, /Branch headers are sent only for the Spare Parts workspace/);
});

test("Release 3B backup scope automatically preserves every durable Mining table", () => {
  const backup = read("backend/routes/backupRoutes.js");
  const safety = read("backend/services/backupSafetyService.js");
  assert.match(backup, /getAllBaseTables/);
  assert.match(backup, /information_schema\.TABLES/);
  assert.match(backup, /classifyDatabaseTables/);
  assert.match(safety, /currentIncludedTables/);
  assert.match(safety, /Backup is missing current required tables/);
  assert.doesNotMatch(backup, /const PREFERRED_TABLE_ORDER/);
});
