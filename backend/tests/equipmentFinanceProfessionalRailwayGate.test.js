const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendDir, "package.json"), "utf8")
);
const runnerSource = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runEquipmentFinanceProfessionalRebuildMigration.js"
  ),
  "utf8"
);

const EXPECTED_START =
  "node scripts/runEquipmentFinanceProfessionalRebuildMigration.js && node -r ./services/exportWorkbookSafetyBootstrap.js server.js";

test("Railway startup is fail-closed behind the exact professional Finance migration", () => {
  assert.equal(packageJson.scripts.start, EXPECTED_START);
  assert.ok(
    packageJson.scripts.start.indexOf(
      "runEquipmentFinanceProfessionalRebuildMigration.js"
    ) < packageJson.scripts.start.indexOf("server.js")
  );
});

test("professional Finance Railway gate requires signed backup, safety snapshot and exact release identity", () => {
  assert.match(
    runnerSource,
    /CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED/
  );
  assert.match(runnerSource, /CHALIN03_SIGNED_BACKUP_CONFIRMED/);
  assert.match(runnerSource, /chalin03_migration_safety_snapshots/);
  assert.match(runnerSource, /createOrVerifySafetySnapshot/);
  assert.doesNotMatch(
    runnerSource,
    /Confirm the separate verified SQL backup first/
  );
  assert.match(
    runnerSource,
    /20260731_EQUIPMENT_FINANCE_PROFESSIONAL/
  );
  assert.match(runnerSource, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(runnerSource, /GET_LOCK/);
  assert.match(
    runnerSource,
    /Professional Equipment Installment Finance migration verified successfully/
  );
});

test("professional Finance Railway gate cannot run destructive production reset operations", () => {
  assert.doesNotMatch(runnerSource, /database\/schema\.sql/);
  assert.doesNotMatch(runnerSource, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(runnerSource, /DROP\s+DATABASE/i);
  assert.doesNotMatch(runnerSource, /DELETE\s+FROM/i);
  assert.match(runnerSource, /INSERT IGNORE INTO/);
});
