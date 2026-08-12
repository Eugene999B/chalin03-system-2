const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const migration = read("database/migrations/20260810_payroll_financial_foundation.sql");
const verify = read("database/migrations/20260810_payroll_financial_foundation_verify.sql");
const service = read("backend/services/payrollFoundationService.js");
const routes = read("backend/routes/payrollFoundationRoutes.js");
const permissions = read("backend/security/permissionCatalog.js");
const server = read("backend/server.js");
const backup = read("backend/routes/release2FinalRoutes.js");
const resetDatabase = read("backend/scripts/resetDatabaseFromBackup.js");
const restoredDatabase = read("backend/scripts/verifyRestoredDatabase.js");
const packageJson = JSON.parse(read("backend/package.json"));

const payrollTables = [
  "payroll_statutory_rule_versions",
  "payroll_compensation_profiles",
  "payroll_recurring_components",
  "payroll_periods",
  "payroll_entries",
  "payroll_entry_lines",
  "payroll_salary_payments",
  "payroll_adjustment_requests",
  "payroll_worker_loans",
  "payroll_loan_transactions",
  "payroll_payslips",
];

const payrollPermissions = [
  "payroll.view",
  "payroll.manage",
  "payroll.prepare",
  "payroll.approve",
  "payroll.pay",
  "payroll.payslip.issue",
  "payroll.adjust",
  "payroll.audit",
];

test("payroll migration is additive, immutable-history oriented and complete", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.match(migration, /INSERT INTO schema_migrations/);
  assert.doesNotMatch(migration, /ALTER TABLE worker_profiles/i);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  for (const table of payrollTables) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(verify, new RegExp(table));
  }
  assert.match(migration, /idempotency_key VARCHAR\(191\) NOT NULL/);
  assert.match(migration, /snapshot_json JSON NOT NULL/);
  assert.match(migration, /checksum_sha256 CHAR\(64\) NOT NULL/);
});

test("salary access is separated from ordinary worker permissions", () => {
  for (const permission of payrollPermissions) {
    assert.match(permissions, new RegExp(permission.replaceAll(".", "\\.")));
  }
  assert.match(permissions, /const PAYROLL_PERMISSIONS/);
  assert.doesNotMatch(permissions, /manager:\s*\[[^\]]*"payroll\.approve"/s);
  assert.match(routes, /requirePermission\("payroll\.view"\)/);
  assert.match(routes, /requirePermission\("payroll\.manage"\)/);
  assert.match(routes, /requirePermission\("payroll\.prepare"\)/);
  assert.match(routes, /requirePermission\("payroll\.approve"\)/);
});

test("compensation history is effective-dated, category-isolated and maker-checker protected", () => {
  assert.match(service, /WHERE id = \?[\s\S]*AND workspace_code = \?/);
  assert.match(service, /PAYROLL_WORKER_CATEGORY_MISMATCH/);
  assert.match(service, /PAYROLL_PROFILE_SELF_APPROVAL_FORBIDDEN/);
  assert.match(service, /previousDate\(profile\.effective_from\)/);
  assert.match(service, /superseded_by_profile_id/);
  assert.match(routes, /PAYROLL_COMPENSATION_DRAFT_CREATED/);
  assert.match(routes, /PAYROLL_COMPENSATION_APPROVED/);
  assert.match(routes, /salary_is_separate_from_worker_profile_permissions: true/);
});

test("statutory rules are versioned data rather than hard-coded rates", () => {
  assert.match(migration, /payroll_statutory_rule_versions/);
  assert.match(migration, /configuration_json JSON NOT NULL/);
  assert.match(service, /JSON\.stringify\(configuration\)/);
  assert.match(routes, /No tax or contribution rate was hard-coded into application logic/);
  assert.doesNotMatch(service, /PAYE.*(?:0\.\d+|\d+%)/i);
});

test("payroll tables are protected by selective workforce/category backup scopes", () => {
  assert.match(backup, /const PAYROLL_WORKFORCE_TABLES/);
  assert.match(backup, /workforce: new Set\(\[[\s\S]*\.\.\.PAYROLL_WORKFORCE_TABLES/);
  assert.match(backup, /spare_parts: \[[\s\S]*\.\.\.PAYROLL_WORKFORCE_TABLES/);
  assert.match(backup, /mining: \[[\s\S]*\.\.\.PAYROLL_WORKFORCE_TABLES/);
  assert.match(backup, /equipment_hire: \[[\s\S]*\.\.\.PAYROLL_WORKFORCE_TABLES/);
});

test("restore inventories preserve every payroll foundation table", () => {
  for (const table of payrollTables) {
    assert.match(resetDatabase, new RegExp(table));
    assert.match(restoredDatabase, new RegExp(table));
  }
  assert.match(migration, /fk_payroll_component_profile[\s\S]*ON DELETE RESTRICT/);
});

test("payroll API is explicit and production startup remains API-only", () => {
  assert.match(server, /const payrollFoundationRoutes = require\("\.\/routes\/payrollFoundationRoutes"\)/);
  assert.match(server, /app\.use\("\/api\/payroll"/);
  assert.match(server, /app\.use\("\/api\/payroll", sensitiveAdminLimiter\)/);
  assert.equal(packageJson.scripts.start, "node -r ./services/exportWorkbookSafetyBootstrap.js server.js");
  assert.equal(
    packageJson.scripts["migrate:payroll-foundation:production"],
    "node scripts/runPayrollFinancialFoundationMigration.js"
  );
  assert.doesNotMatch(packageJson.scripts.start, /payroll|migration|repair/i);
});
