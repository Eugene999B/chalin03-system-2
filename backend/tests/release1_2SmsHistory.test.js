const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function read(relativePath) {
  return readFileSync(join(__dirname, "..", relativePath), "utf8");
}

const migration = read("../database/20260716_sms_report_and_history_archive_migration.sql");
const verification = read("../database/20260716_sms_report_and_history_archive_verify.sql");
const routeSource = read("routes/smsRoutes.js");
const frontendSource = read("../frontend/src/pages/SmsPage.jsx");

test("Release 1.2 migration is additive and preserves SMS records", () => {
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|DATABASE)\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.match(migration, /archived_at/i);
  assert.match(migration, /archived_by/i);
  assert.match(migration, /archive_reason/i);
  assert.match(verification, /invalid_archived_sms_rows/i);
});

test("SMS history clear and restore are administrator-only archive actions", () => {
  assert.match(routeSource, /requireSmsHistoryAdmin/);
  assert.match(routeSource, /\/logs\/archive/);
  assert.match(routeSource, /\/logs\/restore/);
  assert.match(routeSource, /SMS_HISTORY_ARCHIVED/);
  assert.match(routeSource, /SMS_HISTORY_RESTORED/);
  assert.doesNotMatch(routeSource, /DELETE\s+FROM\s+sms_log/i);
});

test("SMS page exposes safe active and archived history controls", () => {
  assert.match(frontendSource, /Clear SMS History/);
  assert.match(frontendSource, /View Archived/);
  assert.match(frontendSource, /Restore Archived History/);
  assert.match(frontendSource, /CLEAR SMS HISTORY/);
  assert.match(frontendSource, /RESTORE SMS HISTORY/);
});
