"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  RELEASE_CONFIRMATION,
  MIGRATION_RECORD,
  runChalinOnePublicAnalyticsMigration,
} = require("../scripts/runChalinOnePublicAnalyticsMigration");
const {
  getPublicAnalyticsSummary,
  recordPublicPageView,
} = require("../services/publicAnalyticsService");

function migrationEnv() {
  return {
    ...process.env,
    CHALIN_ONE_ALLOW_PUBLIC_ANALYTICS_MIGRATION: "true",
    CHALIN_ONE_PUBLIC_ANALYTICS_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
  };
}

async function scalar(sql, values = []) {
  const [[row]] = await pool.query(sql, values);
  return Number(Object.values(row || {})[0] || 0);
}

test("public analytics migration is additive, empty by default and idempotent", async () => {
  const beforeUsers = await scalar("SELECT COUNT(*) AS total FROM users");
  const beforePages = await scalar("SELECT COUNT(*) AS total FROM public_pages");

  const first = await runChalinOnePublicAnalyticsMigration({ env: migrationEnv() });
  const second = await runChalinOnePublicAnalyticsMigration({ env: migrationEnv() });

  assert.equal(first.migration, MIGRATION_RECORD);
  assert.equal(second.migration, MIGRATION_RECORD);
  assert.equal(
    await scalar(
      `SELECT COUNT(*) AS total
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'public_analytics_daily'`
    ),
    1
  );
  assert.equal(await scalar("SELECT COUNT(*) AS total FROM public_analytics_daily"), 0);
  assert.equal(
    await scalar(
      "SELECT COUNT(*) AS total FROM schema_migrations WHERE migration_name = ?",
      [MIGRATION_RECORD]
    ),
    1
  );
  assert.equal(await scalar("SELECT COUNT(*) AS total FROM users"), beforeUsers);
  assert.equal(await scalar("SELECT COUNT(*) AS total FROM public_pages"), beforePages);
});

test("analytics stores only aggregate public paths and counters", async () => {
  await pool.query("DELETE FROM public_analytics_daily");

  await recordPublicPageView("/");
  await recordPublicPageView("/");
  await recordPublicPageView("/news/approved-story?campaign=test");
  await recordPublicPageView("/content-studio/pages");
  await recordPublicPageView("/login");

  assert.equal(await scalar("SELECT COUNT(*) AS total FROM public_analytics_daily"), 2);
  assert.equal(
    await scalar(
      "SELECT page_views AS total FROM public_analytics_daily WHERE route_path = '/'"
    ),
    2
  );
  assert.equal(
    await scalar(
      "SELECT page_views AS total FROM public_analytics_daily WHERE route_path = '/news/approved-story'"
    ),
    1
  );
  assert.equal(
    await scalar(
      "SELECT COUNT(*) AS total FROM public_analytics_daily WHERE route_path LIKE '/content-studio%' OR route_path = '/login'"
    ),
    0
  );

  const [columns] = await pool.query(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'public_analytics_daily'
      ORDER BY ORDINAL_POSITION`
  );
  const columnNames = columns.map((row) => row.column_name);
  for (const forbidden of [
    "ip",
    "ip_address",
    "ip_hash",
    "user_agent",
    "cookie_id",
    "visitor_id",
    "user_id",
    "email",
    "phone",
    "form_data",
    "response_json",
  ]) {
    assert.equal(columnNames.includes(forbidden), false, forbidden);
  }

  const summary = await getPublicAnalyticsSummary({ days: 7 });
  assert.equal(summary.totals.page_views, 3);
  assert.equal(summary.totals.public_routes, 2);
  assert.equal(summary.privacy.stores_staff_activity, false);
  assert.equal(summary.privacy.stores_form_content, false);
});

test.after(async () => {
  await pool.end();
});
