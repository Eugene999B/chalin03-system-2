const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const migrationRunner = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceCompanyWideStabilizationMigration.js"
  ),
  "utf8"
);
const stabilizationStartup = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceCompanyWideStabilizationStartup.js"
  ),
  "utf8"
);
const triggerStartup = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceCompanyWideTriggerCorrectionStartup.js"
  ),
  "utf8"
);
const packageJson = fs.readFileSync(path.join(backendDir, "package.json"), "utf8");

test("Railway Hobby stabilization requires the signed website backup and database identity", () => {
  assert.match(migrationRunner, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(migrationRunner, /CHALIN03_EXPECTED_DATABASE/);
  assert.doesNotMatch(
    migrationRunner,
    /if\s*\(\s*!truthy\(.*CHALIN03_SQL_BACKUP_CONFIRMED/
  );
  assert.doesNotMatch(stabilizationStartup, /CHALIN03_SQL_BACKUP_CONFIRMED/);
  assert.doesNotMatch(triggerStartup, /CHALIN03_SQL_BACKUP_CONFIRMED/);
});

test("stabilization snapshots every affected Finance table before applying SQL", () => {
  for (const table of [
    "equipment_credit_applications",
    "equipment_sales_quotations",
    "equipment_sales_quotation_items",
    "equipment_sale_agreements",
    "equipment_asset_sale_locks",
    "equipment_sale_payments",
    "equipment_deliveries",
    "equipment_ownership_transfers",
    "equipment_sales_reminder_log",
  ]) {
    assert.match(migrationRunner, new RegExp(table));
  }
  assert.match(migrationRunner, /snapshot_status/);
  assert.match(migrationRunner, /CREATE TABLE/);
  assert.match(migrationRunner, /INSERT IGNORE INTO/);
  assert.match(migrationRunner, /assertPreservedCounts/);
  assert.ok(
    migrationRunner.indexOf("createOrVerifySafetySnapshot") <
      migrationRunner.indexOf("migrationStatements")
  );
});

test("Railway startup remains fail-closed until both migration records and trigger definitions verify", () => {
  assert.match(stabilizationStartup, /migrationRecordExists/);
  assert.match(stabilizationStartup, /validateVerifierResults/);
  assert.match(triggerStartup, /verifyTriggers/);
  assert.match(triggerStartup, /still depends on a Hire location comparison/);
  assert.match(triggerStartup, /does not force company-wide Finance location to NULL/);
  assert.match(packageJson, /runEquipmentFinanceCompanyWideStabilizationStartup\.js/);
  assert.match(packageJson, /runEquipmentFinanceCompanyWideTriggerCorrectionStartup\.js/);
});

test("company-wide release never invokes reset schema or destructive rollback SQL", () => {
  for (const source of [migrationRunner, stabilizationStartup, triggerStartup]) {
    assert.doesNotMatch(source, /database\/schema\.sql/);
    assert.doesNotMatch(source, /TRUNCATE\s+TABLE/i);
    assert.doesNotMatch(source, /DROP\s+DATABASE/i);
    assert.doesNotMatch(source, /DELETE\s+FROM/i);
  }
});
