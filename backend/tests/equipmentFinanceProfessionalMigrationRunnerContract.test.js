const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const runner = read(
  "backend",
  "scripts",
  "runEquipmentFinanceProfessionalRebuildMigration.js"
);
const packageJson = JSON.parse(read("backend", "package.json"));
const runbook = read(
  "docs",
  "EQUIPMENT_FINANCE_PROFESSIONAL_REBUILD_PRODUCTION_RUNBOOK.md"
);

test("professional Finance runner is locked to one exact release and migration", () => {
  assert.match(runner, /20260731_EQUIPMENT_FINANCE_PROFESSIONAL/);
  assert.match(runner, /20260731_equipment_finance_professional_rebuild\.sql/);
  assert.match(runner, /20260731_equipment_finance_professional_rebuild_verify\.sql/);
  assert.match(runner, /GET_LOCK/);
  assert.match(runner, /RELEASE_LOCK/);
  assert.match(runner, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runner, /Connected database/);
  assert.match(runner, /does not match CHALIN03_EXPECTED_DATABASE/);
  assert.doesNotMatch(runner, /database\/schema\.sql/);
});

test("professional Finance runner requires production and the signed system backup", () => {
  assert.match(runner, /NODE_ENV=production/);
  assert.match(runner, /CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED/);
  assert.match(runner, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.doesNotMatch(runner, /Confirm the separate verified SQL backup first/);
  assert.match(runner, /CHALIN03_MIGRATION_RELEASE/);
  assert.match(runner, /four approved 20260729 Equipment Finance prerequisite migrations/);
});

test("professional Finance runner creates and verifies a database-side safety snapshot", () => {
  assert.match(runner, /chalin03_migration_safety_snapshots/);
  assert.match(runner, /chalin03_snap_20260731_fin_fleet_assets/);
  assert.match(runner, /chalin03_snap_20260731_fin_sale_agreements/);
  assert.match(runner, /chalin03_snap_20260731_fin_schema_migrations/);
  assert.match(runner, /CREATE TABLE .* LIKE/s);
  assert.match(runner, /INSERT INTO .* SELECT \*/s);
  assert.match(runner, /sourceCount !== snapshotCount/);
  assert.match(runner, /snapshot_status = 'ready'/);
  assert.match(runner, /createOrVerifySafetySnapshot/);
});

test("professional Finance runner rejects every non-zero verifier result", () => {
  for (const result of [
    "missing_professional_finance_tables",
    "missing_professional_finance_columns",
    "missing_professional_finance_indexes",
    "missing_professional_finance_foreign_keys",
    "invalid_professional_finance_settings",
    "duplicate_professional_finance_settings",
    "invalid_professional_finance_documents",
    "invalid_professional_finance_signatures",
    "invalid_professional_finance_payment_alerts",
    "professional_finance_migration_record_missing",
  ]) {
    assert.match(runner, new RegExp(result));
  }
  assert.match(runner, /value !== 0/);
  assert.match(runner, /expected 0/);
});

test("professional Finance migration command is separate from legacy runners", () => {
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:professional:production"],
    "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js"
  );
  assert.match(runbook, /migrate:equipment-finance:professional:production/);
  assert.match(runbook, /Never run `database\/schema\.sql`/);
  assert.match(runbook, /signed Chalin 03 Professional Backup/i);
  assert.match(runbook, /database-side safety snapshot/i);
  assert.match(runbook, /all ten verifier results must be exactly `0`/i);
});
