"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_INTERVAL_MS,
  MAX_BATCH_SIZE,
  MIN_INTERVAL_MS,
  SCHEDULER_LOCK_NAME,
  SIMPLE_PUBLISHABLE_TABLES,
  assertSafeIdentifier,
  runPublicContentPublishingCycle,
  schedulerEnabled,
  schedulerIntervalMs,
  startPublicContentScheduler,
  stopPublicContentScheduler,
} = require("../services/publicContentPublishingScheduler");

const repoRoot = path.resolve(__dirname, "../..");
const schedulerSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicContentPublishingScheduler.js"),
  "utf8"
);

const EXPECTED_SIMPLE_TABLES = Object.freeze([
  "public_navigation_items",
  "public_news_articles",
  "public_announcements",
  "public_business_divisions",
  "public_leadership_profiles",
  "public_projects",
  "public_equipment_catalogue",
  "public_testimonials",
  "public_locations",
  "public_company_statistics",
  "public_job_vacancies",
  "public_tenders",
  "public_faqs",
  "public_forms",
]);

test("publishing scheduler remains disabled when both CHALIN ONE website flags are off", async () => {
  const env = {
    FEATURE_PUBLIC_WEBSITE: "false",
    FEATURE_CONTENT_STUDIO: "false",
  };

  assert.equal(schedulerEnabled(env), false);
  assert.deepEqual(await runPublicContentPublishingCycle({ env }), {
    skipped: true,
    reason: "feature_disabled",
    pages_published: 0,
    pages_expired: 0,
    records_published: 0,
    records_expired: 0,
  });
  assert.deepEqual(startPublicContentScheduler({ env }), {
    started: false,
    reason: "feature_disabled",
  });

  stopPublicContentScheduler();
});

test("either public website or Content Studio can activate the scheduler", () => {
  assert.equal(
    schedulerEnabled({ FEATURE_PUBLIC_WEBSITE: "true" }),
    true
  );
  assert.equal(
    schedulerEnabled({ FEATURE_CONTENT_STUDIO: "true" }),
    true
  );
});

test("scheduler interval cannot run more often than once per minute", () => {
  assert.equal(DEFAULT_INTERVAL_MS, 60000);
  assert.equal(MIN_INTERVAL_MS, 60000);
  assert.equal(
    schedulerIntervalMs({ PUBLIC_CONTENT_SCHEDULER_INTERVAL_MS: "1000" }),
    DEFAULT_INTERVAL_MS
  );
  assert.equal(
    schedulerIntervalMs({ PUBLIC_CONTENT_SCHEDULER_INTERVAL_MS: "120000" }),
    120000
  );
  assert.equal(MAX_BATCH_SIZE, 100);
});

test("scheduler table registry exactly matches all simple publishable tables", () => {
  assert.deepEqual(
    SIMPLE_PUBLISHABLE_TABLES.map((entry) => entry.table),
    EXPECTED_SIMPLE_TABLES
  );

  for (const entry of SIMPLE_PUBLISHABLE_TABLES) {
    assert.match(entry.entityType, /^[a-z][a-z0-9_]*$/);
    assert.equal(typeof entry.hasPublishedAt, "boolean");
  }
});

test("dynamic SQL identifiers are allowlisted by format", () => {
  assert.equal(
    assertSafeIdentifier("public_news_articles"),
    "public_news_articles"
  );
  assert.throws(() => assertSafeIdentifier("public_news; DROP TABLE users"), /Unsafe/);
  assert.throws(() => assertSafeIdentifier("public-news"), /Unsafe/);
});

test("scheduler uses advisory locking, UTC dates, transactions and immutable audit records", () => {
  assert.match(SCHEDULER_LOCK_NAME, /chalin03:public-content:scheduler/);
  assert.match(schedulerSource, /SELECT GET_LOCK\(\?, 0\)/);
  assert.match(schedulerSource, /SELECT RELEASE_LOCK\(\?\)/);
  assert.match(schedulerSource, /beginTransaction\(\)/);
  assert.match(schedulerSource, /commit\(\)/);
  assert.match(schedulerSource, /rollback\(\)/);
  assert.match(schedulerSource, /UTC_TIMESTAMP\(\)/);
  assert.match(schedulerSource, /public_content_audit_log/);
  assert.match(schedulerSource, /scheduled_page_published/);
  assert.match(schedulerSource, /scheduled_content_published/);
  assert.match(schedulerSource, /page_expired/);
  assert.match(schedulerSource, /content_expired/);
});

test("missing Phase 2 schema is handled as a safe scheduler skip", () => {
  assert.match(schedulerSource, /ER_NO_SUCH_TABLE/);
  assert.match(schedulerSource, /reason: "schema_not_ready"/);
});
