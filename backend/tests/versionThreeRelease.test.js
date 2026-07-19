const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  APP_RELEASE_LABEL,
  APP_RELEASE_NAME,
  APP_VERSION,
  BACKUP_MANIFEST_VERSION,
} = require("../config/version");

const delegatedBackupSource = fs.readFileSync(
  path.resolve(__dirname, "../routes/delegatedBackupRoutes.js"),
  "utf8"
);
const systemRouteSource = fs.readFileSync(
  path.resolve(__dirname, "../routes/systemRoutes.js"),
  "utf8"
);

test("Version Three release identity is stable", () => {
  assert.equal(APP_VERSION, "3.0.0");
  assert.equal(APP_RELEASE_NAME, "Version Three");
  assert.equal(APP_RELEASE_LABEL, "Version Three · v3.0.0");
  assert.equal(BACKUP_MANIFEST_VERSION, "chalin03-version-3-delegated-v1");
});

test("backup and diagnostics use the Version Three manifest identity", () => {
  assert.match(delegatedBackupSource, /BACKUP_MANIFEST_VERSION/);
  assert.match(systemRouteSource, /BACKUP_MANIFEST_VERSION/);
  assert.doesNotMatch(delegatedBackupSource, /release-3f-d/);
  assert.doesNotMatch(systemRouteSource, /release-3f-d/);
});
