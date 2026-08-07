"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  EXPECTED_TABLES: ACTION_TABLES,
  MIGRATION_RECORD: ACTION_RECORD,
  RELEASE_CONFIRMATION: ACTION_CONFIRMATION,
  runChalinOneAiActionGovernanceMigration,
} = require("../scripts/runChalinOneAiActionGovernanceMigration");
const {
  EXPECTED_TABLES: SCHEDULED_TABLES,
  MIGRATION_RECORD: SCHEDULED_RECORD,
  RELEASE_CONFIRMATION: SCHEDULED_CONFIRMATION,
  runChalinOneAiScheduledGovernanceMigration,
} = require("../scripts/runChalinOneAiScheduledGovernanceMigration");
const {
  EXPECTED_TABLES: GUIDE_TABLES,
  MIGRATION_RECORD: GUIDE_RECORD,
  RELEASE_CONFIRMATION: GUIDE_CONFIRMATION,
  runChalinOnePublicGuideFoundationMigration,
} = require("../scripts/runChalinOnePublicGuideFoundationMigration");
const {
  EXPECTED_TABLES: PORTAL_TABLES,
  MIGRATION_RECORD: PORTAL_RECORD,
  RELEASE_CONFIRMATION: PORTAL_CONFIRMATION,
  runChalinOnePortalSecurityFoundationMigration,
} = require("../scripts/runChalinOnePortalSecurityFoundationMigration");

function acceptanceEnv(extra) {
  return {
    ...process.env,
    NODE_ENV: "test",
    ...extra,
  };
}

async function assertTablesExist(tableNames) {
  const placeholders = tableNames.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const actual = new Set(rows.map((row) => row.table_name));
  assert.deepEqual(tableNames.filter((tableName) => !actual.has(tableName)), []);
}

async function assertMigrationRecorded(migrationRecord) {
  const [rows] = await pool.query(
    `SELECT migration_name
     FROM schema_migrations
     WHERE migration_name = ?`,
    [migrationRecord]
  );
  assert.equal(rows.length, 1);
}

test(
  "CHALIN ONE governed AI, Guide and portal foundations migrate twice and verify on isolated MySQL",
  { timeout: 120000 },
  async () => {
    const actionEnv = acceptanceEnv({
      CHALIN_ONE_ALLOW_AI_ACTION_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_AI_ACTION_MIGRATION_CONFIRM: ACTION_CONFIRMATION,
    });
    const actionFirst = await runChalinOneAiActionGovernanceMigration({ env: actionEnv });
    const actionSecond = await runChalinOneAiActionGovernanceMigration({ env: actionEnv });
    assert.equal(actionFirst.production, false);
    assert.equal(actionSecond.verified_table_count, ACTION_TABLES.length);
    assert.equal(actionSecond.executed_proposal_count, 0);
    await assertTablesExist(ACTION_TABLES);
    await assertMigrationRecorded(ACTION_RECORD);

    const scheduledEnv = acceptanceEnv({
      CHALIN_ONE_ALLOW_AI_SCHEDULED_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_AI_SCHEDULED_MIGRATION_CONFIRM: SCHEDULED_CONFIRMATION,
    });
    const scheduledFirst = await runChalinOneAiScheduledGovernanceMigration({ env: scheduledEnv });
    const scheduledSecond = await runChalinOneAiScheduledGovernanceMigration({ env: scheduledEnv });
    assert.equal(scheduledFirst.production, false);
    assert.equal(scheduledSecond.verified_table_count, SCHEDULED_TABLES.length);
    assert.equal(scheduledSecond.scheduled_run_count, 0);
    await assertTablesExist(SCHEDULED_TABLES);
    await assertMigrationRecorded(SCHEDULED_RECORD);

    const guideEnv = acceptanceEnv({
      CHALIN_ONE_ALLOW_PUBLIC_GUIDE_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_PUBLIC_GUIDE_MIGRATION_CONFIRM: GUIDE_CONFIRMATION,
    });
    const guideFirst = await runChalinOnePublicGuideFoundationMigration({ env: guideEnv });
    const guideSecond = await runChalinOnePublicGuideFoundationMigration({ env: guideEnv });
    assert.equal(guideFirst.production, false);
    assert.equal(guideSecond.verified_table_count, GUIDE_TABLES.length);
    await assertTablesExist(GUIDE_TABLES);
    await assertMigrationRecorded(GUIDE_RECORD);

    const portalEnv = acceptanceEnv({
      CHALIN_ONE_ALLOW_PORTAL_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_PORTAL_MIGRATION_CONFIRM: PORTAL_CONFIRMATION,
    });
    const portalFirst = await runChalinOnePortalSecurityFoundationMigration({ env: portalEnv });
    const portalSecond = await runChalinOnePortalSecurityFoundationMigration({ env: portalEnv });
    assert.equal(portalFirst.production, false);
    assert.equal(portalSecond.verified_table_count, PORTAL_TABLES.length);
    assert.equal(portalSecond.raw_identity_columns_present, false);
    await assertTablesExist(PORTAL_TABLES);
    await assertMigrationRecorded(PORTAL_RECORD);
  }
);

test.after(async () => {
  await pool.end();
});
