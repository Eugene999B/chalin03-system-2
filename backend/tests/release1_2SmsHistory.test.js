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
const deliveryStatusSource = read("services/smsDeliveryStatusService.js");
const reliabilitySource = read("services/smsReliabilityService.js");
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

test("SMS history archive, restore and permanent deletion are administrator-only", () => {
  assert.match(routeSource, /requireSmsHistoryAdmin/);
  assert.match(routeSource, /\/logs\/archive/);
  assert.match(routeSource, /\/logs\/restore/);
  assert.match(routeSource, /\/logs\/delete-archived/);
  assert.match(routeSource, /SMS_HISTORY_ARCHIVED/);
  assert.match(routeSource, /SMS_HISTORY_RESTORED/);
  assert.match(routeSource, /SMS_HISTORY_PERMANENTLY_DELETED/);
  assert.match(routeSource, /DELETE ARCHIVED SMS/);
  assert.match(routeSource, /DELETE\s+FROM\s+sms_log/i);
  assert.match(routeSource, /archived_at\s+IS\s+NOT\s+NULL/i);
});

test("SMS page exposes archive, restore and permanent-delete controls", () => {
  assert.match(frontendSource, /Clear SMS History/);
  assert.match(frontendSource, /View Archived/);
  assert.match(frontendSource, /Restore Archived History/);
  assert.match(frontendSource, /Permanently Delete Archived SMS/);
  assert.match(frontendSource, /CLEAR SMS HISTORY/);
  assert.match(frontendSource, /RESTORE SMS HISTORY/);
  assert.match(frontendSource, /DELETE ARCHIVED SMS/);
  assert.match(frontendSource, /\/sms\/logs\/delete-archived/);
});

test("Release 1.2.1 uses truthful terminal SMS labels", () => {
  assert.match(deliveryStatusSource, /DEFAULT_LOOKBACK_HOURS = 24/);
  assert.match(deliveryStatusSource, /terminal_lookup_failure/);
  assert.match(deliveryStatusSource, /archived_at IS NULL/);
  assert.match(reliabilitySource, /accepted: "Sent"/);
  assert.match(reliabilitySource, /failed: "Not sent"/);
  assert.match(frontendSource, /accepted: "Sent"/);
  assert.match(frontendSource, /failed: "Not sent"/);
  assert.doesNotMatch(frontendSource, /"Updates automatically"/);
});
