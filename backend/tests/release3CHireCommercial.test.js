const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return readFileSync(join(__dirname, "..", "..", relativePath), "utf8");
}

const migrationPath = "database/migrations/20260717_release3c_hire_commercial_completion.sql";

test("Release 3C migration is additive and covers Hire commercial completion", () => {
  const migration = read(migrationPath);
  for (const table of [
    "hire_rate_cards",
    "hire_quotation_items",
    "hire_contract_items",
    "hire_contract_amendments",
    "hire_deposit_transactions",
    "hire_commercial_approvals",
    "hire_evidence_files",
    "hire_damage_assessments",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const sequence of ["HRTC", "HAMD", "HDEP", "HAPR", "HEVD", "HDMG"]) {
    assert.match(migration, new RegExp(`'${sequence}'`));
  }
  assert.match(migration, /dispatch_number/);
  assert.match(migration, /return_number/);
  assert.match(migration, /release3c_hire_commercial_completion/);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);

  const verification = read(
    "database/migrations/20260717_release3c_hire_commercial_completion_verify.sql"
  );
  assert.match(verification, /release3c_required_tables/);
  assert.match(verification, /cross_location_quotation_items/);
  assert.match(verification, /invalid_commercial_amounts/);
  assert.match(verification, /legacy_quotes_without_items/);
});

test("Release 3C routes enforce location isolation and independent approvals", () => {
  const routes = read("backend/routes/hireCommercialRoutes.js");
  assert.match(routes, /resolveHireLocationScope\(req, \{ requireSelection: true \}\)/);
  for (const permission of [
    "hire.commercial.view",
    "hire.commercial.manage",
    "hire.commercial.approve",
    "hire.commercial.evidence",
    "hire.commercial.damage",
  ]) {
    assert.match(routes, new RegExp(permission.replaceAll(".", "\\.")));
  }
  assert.match(routes, /INDEPENDENT_APPROVAL_REQUIRED/);
  assert.match(routes, /INSUFFICIENT_DEPOSIT_BALANCE/);
  assert.match(routes, /quotation_discount/);
  assert.match(routes, /customer_credit/);
  assert.match(routes, /PDFDocument/);
  assert.match(routes, /nextDocumentNumber\("HAPR"/);
});

test("Legacy Hire routes now use controlled database document sequences", () => {
  const routes = read("backend/routes/equipmentHireRoutes.js");
  for (const code of ["HENQ", "HQUO", "HCON", "HDSP", "HINV", "HRET"]) {
    assert.match(routes, new RegExp(`nextDocumentNumber\\("${code}"`));
  }
  assert.match(routes, /dispatch_number/);
  assert.match(routes, /return_number/);
});

test("Release 3C UI is routed only inside Equipment Hire", () => {
  const app = read("frontend/src/App.jsx");
  const layout = read("frontend/src/layouts/EquipmentHireLayout.jsx");
  const page = read("frontend/src/pages/HireCommercialControlPage.jsx");
  assert.match(app, /HireCommercialControlPage/);
  assert.match(app, /path="commercial-control"/);
  assert.match(layout, /\/equipment-hire-operations\/commercial-control/);
  assert.match(page, /useWorkspaceContext/);
  assert.match(page, /\/hire-commercial\/dashboard/);
  assert.doesNotMatch(page, /selectedBranch|store_id|branch_id/);
});

test("Professional backups dynamically include every Release 3C table", () => {
  const backup = read("backend/routes/backupRoutes.js");
  const safety = read("backend/services/backupSafetyService.js");
  const professional = read("backend/routes/release2FinalRoutes.js");
  for (const table of [
    "hire_rate_cards",
    "hire_quotation_items",
    "hire_contract_items",
    "hire_contract_amendments",
    "hire_deposit_transactions",
    "hire_commercial_approvals",
    "hire_evidence_files",
    "hire_damage_assessments",
  ]) {
    assert.match(professional, new RegExp(`"${table}"`));
  }
  assert.match(backup, /getAllBaseTables/);
  assert.match(backup, /classifyDatabaseTables/);
  assert.match(safety, /currentIncludedTables/);
  assert.match(safety, /Backup is missing current required tables/);
  assert.doesNotMatch(backup, /const PREFERRED_TABLE_ORDER/);
});
