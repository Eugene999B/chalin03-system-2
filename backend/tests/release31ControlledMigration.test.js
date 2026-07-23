const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  loadManifest,
  parseArguments,
  productionApproval,
  splitSqlStatements,
  stripSqlComments,
  verificationRowProblems,
} = require("../scripts/runControlledMigrations");

const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function readBackend(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function readRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("controlled migration manifest is ordered, checksummed and fully paired", () => {
  const manifest = loadManifest();
  assert.equal(manifest.manifestVersion, "1");
  assert.deepEqual(
    manifest.migrations.map((entry) => entry.name),
    [
      "20260723_release31_database_safety_guards",
      "20260723_release31_worker_identity_readiness",
      "20260723_release31_runtime_schema_baseline",
    ]
  );

  for (const entry of manifest.migrations) {
    assert.match(entry.migrationChecksum, /^[a-f0-9]{64}$/);
    assert.match(entry.verificationChecksum, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(entry.verifyPath));
    if (entry.mode === "sql") assert.ok(fs.existsSync(entry.migrationPath));
  }
});

test("SQL splitter preserves trigger bodies under custom delimiters", () => {
  const source = `
DELIMITER $$
CREATE TRIGGER example BEFORE INSERT ON sales
FOR EACH ROW
BEGIN
  IF NEW.id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'blocked';
  END IF;
END $$
DELIMITER ;
SELECT 'PASS' AS status;
`;
  const statements = splitSqlStatements(source);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE TRIGGER example/);
  assert.match(statements[0], /END IF;/);
  assert.match(statements[1], /SELECT 'PASS'/);
});

test("verification result evaluation fails closed", () => {
  assert.deepEqual(verificationRowProblems([{ status: "PASS", problem_count: 0 }]), []);
  assert.equal(
    verificationRowProblems([{ status: "FAIL", problem_count: 2 }]).length,
    1
  );
  assert.equal(verificationRowProblems([{ ready: 0 }]).length, 1);
});

test("production SQL migration requires backup, approver and change ticket", () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    MIGRATION_BACKUP_SHA256: process.env.MIGRATION_BACKUP_SHA256,
    MIGRATION_APPROVED_BY: process.env.MIGRATION_APPROVED_BY,
    MIGRATION_CHANGE_TICKET: process.env.MIGRATION_CHANGE_TICKET,
  };

  try {
    process.env.NODE_ENV = "production";
    delete process.env.MIGRATION_BACKUP_SHA256;
    delete process.env.MIGRATION_APPROVED_BY;
    delete process.env.MIGRATION_CHANGE_TICKET;

    assert.throws(
      () =>
        productionApproval({
          name: "20260723_release31_database_safety_guards",
          mode: "sql",
          backupRequired: true,
        }),
      /MIGRATION_BACKUP_SHA256/
    );

    process.env.MIGRATION_BACKUP_SHA256 = "a".repeat(64);
    process.env.MIGRATION_APPROVED_BY = "Original System Administrator";
    process.env.MIGRATION_CHANGE_TICKET = "CHALIN03-REL31";
    const approval = productionApproval({
      name: "20260723_release31_database_safety_guards",
      mode: "sql",
      backupRequired: true,
    });
    assert.equal(approval.backupAttestation, "a".repeat(64));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Railway startup runs guarded controlled migrations and never preloads repair code", () => {
  const packageJson = JSON.parse(readBackend("package.json"));
  assert.match(packageJson.scripts.start, /runControlledDeployment\.js --deployment/);
  assert.match(packageJson.scripts.start, /&& node server\.js$/);
  assert.match(packageJson.scripts["migrate:apply"], /runControlledDeployment\.js --apply/);
  assert.doesNotMatch(packageJson.scripts.start, /equipmentSalesCommercialBootstrap/);

  const bootstrap = readBackend("scripts/runControlledDeployment.js");
  assert.match(bootstrap, /productionApproval/);
  assert.match(bootstrap, /controlled_migration_history_bootstrap/);
  assert.match(bootstrap, /MIGRATION_BACKUP_SHA256|backupAttestation/);
  assert.match(bootstrap, /GET_LOCK/);

  const server = readBackend("server.js");
  assert.match(server, /requireEquipmentSalesReadiness/);
  assert.match(server, /\/api\/auth\/biometrics/);
  assert.match(server, /LEGACY_PASSKEYS_RETIRED/);
  assert.doesNotMatch(server, /passkeyRoutes/);
  assert.doesNotMatch(server, /backupRoutes/);
});

test("startup schema services are verification-only", () => {
  for (const relativePath of [
    "services/branchSchemaReadinessService.js",
    "services/workerIdentityService.js",
    "services/workerHrLetterSchemaService.js",
    "services/employmentDocumentSchemaService.js",
    "services/passkeySchemaService.js",
    "services/equipmentSalesSchemaService.js",
    "services/groupConfigurationService.js",
  ]) {
    const source = stripSqlComments(readBackend(relativePath));
    assert.doesNotMatch(source, /CREATE\s+TABLE/i, relativePath);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i, relativePath);
    assert.doesNotMatch(source, /DROP\s+(?:TABLE|TRIGGER|PROCEDURE)/i, relativePath);
  }
});

test("controlled Release 3.1 SQL is additive, backed up and verified read-only", () => {
  for (const migrationName of [
    "20260723_release31_database_safety_guards",
    "20260723_release31_worker_identity_readiness",
  ]) {
    const migration = readRepo(`database/migrations/${migrationName}.sql`);
    const verification = readRepo(
      `database/migrations/${migrationName}_verify.sql`
    );

    assert.match(migration, /ADDITIVE MIGRATION ONLY/i);
    assert.match(migration, /BACKUP REQUIRED/i);
    assert.match(migration, /INSERT (?:IGNORE )?INTO schema_migrations/i);
    assert.doesNotMatch(migration, /DROP\s+(?:DATABASE|SCHEMA|TABLE)/i);
    assert.doesNotMatch(migration, /TRUNCATE/i);
    assert.doesNotMatch(migration, /DELETE\s+FROM/i);

    const executableVerification = stripSqlComments(verification);
    assert.doesNotMatch(
      executableVerification,
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|CALL|EXECUTE|PREPARE|DEALLOCATE|SET)\b/i
    );
  }
});

test("equipment and installment guards permit only the protected restore session", () => {
  const migration = readRepo(
    "database/migrations/20260723_release31_database_safety_guards.sql"
  );
  const guardCount = (
    migration.match(/@@SESSION\.FOREIGN_KEY_CHECKS = 1/g) || []
  ).length;
  assert.ok(guardCount >= 6);
  assert.match(migration, /trg_hire_contract_asset_sale_guard_before_insert/);
  assert.match(migration, /trg_equipment_sale_agreement_hire_guard_before_insert/);
  assert.match(migration, /trg_spare_parts_installment_retired_agreement_insert/);
});

test("settings reads cannot create configuration rows", () => {
  const source = stripSqlComments(readBackend("routes/settingsRoutes.js"));
  const getStart = source.indexOf('router.get("/"');
  const putStart = source.indexOf('router.put("/"');
  assert.ok(getStart >= 0 && putStart > getStart);
  const getRoute = source.slice(getStart, putStart);
  assert.doesNotMatch(getRoute, /INSERT\s+INTO/i);
  assert.doesNotMatch(getRoute, /UPDATE\s+/i);
  assert.match(getRoute, /STORE_SETTINGS_NOT_CONFIGURED/);
});

test("argument parser defaults to plan and recognizes deployment apply", () => {
  assert.deepEqual(parseArguments([]), { mode: "plan", deployment: false });
  assert.deepEqual(parseArguments(["--deployment"]), {
    mode: "apply",
    deployment: true,
  });
});
