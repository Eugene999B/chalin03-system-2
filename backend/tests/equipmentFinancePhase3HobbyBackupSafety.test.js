const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const runnerSource = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceOperationalPolishMigration.js"
  ),
  "utf8"
);

const {
  PRESERVED_TABLES,
  RELEASE_CONFIRMATION,
  SNAPSHOT_MANIFEST_TABLE,
  SNAPSHOT_TABLES,
  assertReleaseGates,
} = require("../scripts/runEquipmentFinanceOperationalPolishMigration");

test("Railway Hobby Phase 3 requires the signed system backup without pretending an unavailable SQL export exists", () => {
  assert.doesNotThrow(() =>
    assertReleaseGates({
      NODE_ENV: "production",
      CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED: "true",
      CHALIN03_SIGNED_BACKUP_CONFIRMED: "true",
      CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
    })
  );
  assert.throws(
    () =>
      assertReleaseGates({
        NODE_ENV: "production",
        CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED: "true",
        CHALIN03_MIGRATION_RELEASE: RELEASE_CONFIRMATION,
      }),
    /signed Chalin 03 Professional Backup/
  );
  assert.doesNotMatch(
    runnerSource,
    /if\s*\(\s*!truthy\(env\.CHALIN03_SQL_BACKUP_CONFIRMED\)\s*\)/
  );
});

test("Phase 3 creates one verified database-side safety snapshot for every preserved Finance table", () => {
  assert.equal(SNAPSHOT_MANIFEST_TABLE, "chalin03_phase3_finance_safety_snapshots");
  assert.equal(SNAPSHOT_TABLES.length, 5);
  assert.deepEqual(
    SNAPSHOT_TABLES.map((item) => item.source),
    PRESERVED_TABLES
  );

  const snapshotNames = new Set();
  for (const item of SNAPSHOT_TABLES) {
    assert.match(item.snapshot, /^chalin03_snap_20260731_ops_/);
    assert.ok(item.snapshot.length <= 64, item.snapshot);
    assert.equal(snapshotNames.has(item.snapshot), false, item.snapshot);
    snapshotNames.add(item.snapshot);
    assert.match(item.countColumn, /_rows$/);
  }

  assert.match(runnerSource, /createOrVerifySafetySnapshot/);
  assert.match(runnerSource, /CREATE TABLE IF NOT EXISTS/);
  assert.match(runnerSource, /CREATE TABLE .* LIKE/);
  assert.match(runnerSource, /INSERT IGNORE INTO/);
  assert.match(runnerSource, /snapshot_status = 'ready'/);
  assert.match(runnerSource, /database identity does not match/);
  assert.match(runnerSource, /copied \$\{snapshotCount\} of \$\{sourceCount\} rows/);
});

test("Phase 3 snapshot is completed before migration SQL and destructive reset operations remain absent", () => {
  const snapshotCall = runnerSource.indexOf(
    "await createOrVerifySafetySnapshot(connection, databaseName)"
  );
  const migrationCall = runnerSource.indexOf(
    "await execute(connection, migrationStatements, \"Phase 3 Finance migration\")"
  );

  assert.ok(snapshotCall >= 0);
  assert.ok(migrationCall > snapshotCall);
  assert.doesNotMatch(runnerSource, /database\/schema\.sql/);
  assert.doesNotMatch(runnerSource, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(runnerSource, /DROP\s+DATABASE/i);
  assert.doesNotMatch(runnerSource, /DELETE\s+FROM/i);
});
