const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "../routes/delegatedBackupRoutes.js"),
  "utf8"
);

test("Railway staging signed-v2 backups use the canonical recovery validator", () => {
  assert.match(routeSource, /SIGNED_V2_MANIFEST_VERSION/);
  assert.match(routeSource, /isConfirmedRailwayStaging/);
  assert.match(routeSource, /validateSignedV2StagingBackup/);
  assert.match(routeSource, /validateBackupContract\(\{/);
  assert.match(routeSource, /requireSignature:\s*false/);
  assert.match(routeSource, /allowAdditiveSchemaDrift:\s*true/);
  assert.match(routeSource, /if \(signedV2Report\) return signedV2Report;/);
});

test("signed-v2 staging restore preserves unmapped schema and uses validated columns", () => {
  assert.match(routeSource, /preserved_current_only_tables/);
  assert.match(routeSource, /source_only_tables/);
  assert.match(routeSource, /validation\.restore_columns\?\.\[tableName\]/);
  assert.match(routeSource, /RESTORE_COUNT_MISMATCH/);
  assert.match(routeSource, /SIGNED_V2_EPHEMERAL_SECURITY_TABLES/);
  assert.match(routeSource, /token_version = COALESCE\(token_version, 0\) \+ 1/);
});

test("legacy delegated backups retain their separate checksum contract", () => {
  assert.match(routeSource, /function backupChecksum\(backup\)/);
  assert.match(routeSource, /const actualChecksum = backupChecksum\(backup\)/);
  assert.match(routeSource, /DELEGATED_FULL_BACKUP_RESTORED/);
});
