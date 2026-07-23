const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Release 3.1 disposable drill is production-proofed", () => {
  const source = read("backend/scripts/runRelease31DisposableDrill.js");

  assert.match(source, /CONFIRM_RELEASE31_DISPOSABLE_DRILL/);
  assert.match(source, /RUN_RELEASE31_DISPOSABLE_DRILL/);
  assert.match(source, /NODE_ENV=production|nodeEnv === "production"/);
  assert.match(source, /localhost/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /endsWith\("_test"\)/);
  assert.match(source, /Railway-like hosts and database names are forbidden/);
  assert.match(source, /assertDisposableTarget\(config\)/);

  const guardPosition = source.indexOf("assertDisposableTarget(config)");
  const connectionPosition = source.indexOf("mysql.createConnection(config)");
  assert.ok(guardPosition >= 0 && connectionPosition > guardPosition);
});

test("Release 3.1 drill uses controlled migrations and canonical recovery", () => {
  const source = read("backend/scripts/runRelease31DisposableDrill.js");

  assert.match(source, /runControlledDeployment\(\["--apply"\]\)/);
  assert.match(source, /createFullSystemBackup/);
  assert.match(source, /validateFullSystemBackup/);
  assert.match(source, /restoreFullSystemBackup/);
  assert.match(source, /loadCanonicalContract/);
  assert.match(source, /assertIncompleteBackupRejected/);
  assert.match(source, /controlled_migration_history/);
  assert.match(source, /schemaFingerprintSha256/);
  assert.match(source, /securityInvalidation/);
  assert.match(source, /contamination_removed/);
});

test("backend package exposes the guarded disposable drill", () => {
  const packageJson = JSON.parse(read("backend/package.json"));
  assert.equal(
    packageJson.scripts["drill:release31"],
    "node scripts/runRelease31DisposableDrill.js"
  );
});

test("CI runs the drill only inside a disposable MySQL service", () => {
  const workflow = read(".github/workflows/chalin03-verification.yml");

  assert.match(workflow, /database-drill:/);
  assert.match(workflow, /image: mysql:8\.4/);
  assert.match(workflow, /DB_HOST: 127\.0\.0\.1/);
  assert.match(workflow, /DB_NAME: chalin03_release31_test/);
  assert.match(
    workflow,
    /CONFIRM_RELEASE31_DISPOSABLE_DRILL: RUN_RELEASE31_DISPOSABLE_DRILL/
  );
  assert.match(workflow, /run: npm run drill:release31/);
  assert.match(workflow, /release31-disposable-recovery-evidence/);
  assert.doesNotMatch(workflow, /DB_HOST:.*railway/i);
});
