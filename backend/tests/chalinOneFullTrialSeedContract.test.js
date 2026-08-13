"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CHALIN_ONE_STAGING_ENVIRONMENT_ID,
  runChalinOneFullTrialSeedIfStaging,
} = require("../scripts/runChalinOneFullTrialSeedIfStaging");
const {
  REQUIRED_TABLES,
  SEED_MARKER,
  SEED_PREFIX,
  STAGING_DATABASE_MARKERS,
} = require("../scripts/seedChalinOneFullTrialData");

test("full-trial launcher skips every environment except dedicated CHALIN ONE staging", async () => {
  let called = false;
  const result = await runChalinOneFullTrialSeedIfStaging({
    env: {
      RAILWAY_ENVIRONMENT_ID: "a28ecb46-420a-4225-b858-efa5d197701e",
    },
    seed: async () => {
      called = true;
      return { status: "seeded" };
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "not-dedicated-chalin-one-staging");
});

test("full-trial launcher delegates only for exact CHALIN ONE staging environment", async () => {
  let called = 0;
  const result = await runChalinOneFullTrialSeedIfStaging({
    env: {
      RAILWAY_ENVIRONMENT_ID: CHALIN_ONE_STAGING_ENVIRONMENT_ID,
    },
    seed: async () => {
      called += 1;
      return { status: "fixture_seeded" };
    },
  });

  assert.equal(called, 1);
  assert.deepEqual(result, { status: "fixture_seeded" });
});

test("full-trial seed covers requested operational module families and preserves staging identity", () => {
  for (const tableName of [
    "products",
    "purchases",
    "sales",
    "returns",
    "stock_transfers",
    "debts",
    "worker_profiles",
    "payroll_entries",
    "mining_sites",
    "mining_production_records",
    "fleet_assets",
    "hire_contracts",
    "hire_invoices",
    "hire_payments",
    "ai_knowledge_sources",
    "ai_knowledge_versions",
  ]) {
    assert.ok(REQUIRED_TABLES.includes(tableName), tableName);
  }

  assert.equal(SEED_MARKER, "chalin_one_full_trial_data_seed_v1");
  assert.equal(SEED_PREFIX, "TRIAL-20260813");
  assert.deepEqual(STAGING_DATABASE_MARKERS, [
    "chalin_one_full_staging_completion_v1",
    "chalin_one_staging_auth_baseline_v1",
    "chalin_one_staging_clean_master_schema_bootstrap_v1",
  ]);
});

test("trial seed does not invent the absent mature Equipment Finance rebuild", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "seedChalinOneFullTrialData.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /INSERT\s+INTO\s+equipment_finance_/i);
  assert.match(source, /Mature Equipment Finance tables that are not yet present/);
  assert.match(source, /buildUnitEventHash/);
  assert.match(source, /version_status:\s*"published"/);
  assert.match(source, /source_status:\s*"active"/);
});
