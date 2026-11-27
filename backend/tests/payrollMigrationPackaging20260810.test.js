const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const runner = require("../scripts/runPayrollFinancialFoundationMigration");

const repoRoot = path.resolve(__dirname, "../..");
const backendRoot = path.resolve(__dirname, "..");
const canonicalDir = path.join(repoRoot, "database", "migrations");
const packagedDir = path.join(backendRoot, "migrations");
const files = [
  "20260810_payroll_financial_foundation.sql",
  "20260810_payroll_financial_foundation_verify.sql",
];

test("Railway backend artifact contains exact reviewed payroll migration bytes", () => {
  for (const filename of files) {
    const canonical = fs.readFileSync(path.join(canonicalDir, filename));
    const packaged = fs.readFileSync(path.join(packagedDir, filename));
    assert.deepEqual(packaged, canonical, `${filename} must remain byte-for-byte identical to the canonical migration`);
  }
});

test("payroll migration runner resolves only backend-local packaged SQL", () => {
  assert.equal(runner.PACKAGED_MIGRATION_DIR, packagedDir);
  for (const filename of files) {
    assert.equal(runner.migrationPath(filename), path.join(packagedDir, filename));
  }
  assert.doesNotThrow(() => runner.assertPackagedMigrationReady());
  assert.throws(
    () => runner.migrationPath("../database/migrations/20260810_payroll_financial_foundation.sql"),
    /escaped the packaged migration directory/
  );
});

test("production payroll migration remains explicitly backup and release gated", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    enabled: process.env.CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED,
    backup: process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED,
    release: process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE,
  };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED;
    delete process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED;
    delete process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE;
    assert.throws(() => runner.assertAuthorization(), /MIGRATION_ENABLED=true/);

    process.env.CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED = "true";
    assert.throws(() => runner.assertAuthorization(), /fresh signed full-system backup/);

    process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED = "true";
    process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE = "wrong-release";
    assert.throws(() => runner.assertAuthorization(), /20260810_PAYROLL_FOUNDATION/);

    process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE = "20260810_PAYROLL_FOUNDATION";
    assert.doesNotThrow(() => runner.assertAuthorization());
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.enabled === undefined) delete process.env.CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED; else process.env.CHALIN03_PAYROLL_FOUNDATION_MIGRATION_ENABLED = previous.enabled;
    if (previous.backup === undefined) delete process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED; else process.env.CHALIN03_SIGNED_BACKUP_CONFIRMED = previous.backup;
    if (previous.release === undefined) delete process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE; else process.env.CHALIN03_PAYROLL_MIGRATION_RELEASE = previous.release;
  }
});
