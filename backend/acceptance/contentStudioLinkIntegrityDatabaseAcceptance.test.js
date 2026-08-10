"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  RELEASE_CONFIRMATION: REDIRECT_CONFIRMATION,
  runChalinOnePublicRedirectMigration,
} = require("../scripts/runChalinOnePublicRedirectMigration");
const {
  MAX_LINK_REFERENCES,
  MAX_LINK_TARGETS,
  getLinkIntegrityIntelligence,
} = require("../services/contentStudioLinkIntegrityService");

function redirectMigrationEnv() {
  return {
    ...process.env,
    CHALIN_ONE_ALLOW_PUBLIC_REDIRECT_MIGRATION: "true",
    CHALIN_ONE_PUBLIC_REDIRECT_MIGRATION_CONFIRM: REDIRECT_CONFIRMATION,
  };
}

test("Content Studio link-integrity audit executes read-only against migrated acceptance schema", async () => {
  const beforeUsers = Number((await pool.query("SELECT COUNT(*) AS total FROM users"))[0][0]?.total || 0);
  const beforePages = Number((await pool.query("SELECT COUNT(*) AS total FROM public_pages"))[0][0]?.total || 0);

  // Acceptance files must be independently executable. Link integrity reads the
  // governed redirect foundation, so apply that already-approved additive
  // migration here instead of relying on publicRedirectDatabaseAcceptance.test
  // running first alphabetically.
  await runChalinOnePublicRedirectMigration({ env: redirectMigrationEnv() });

  const result = await getLinkIntegrityIntelligence();
  assert.ok(result);
  assert.equal(result.policy.read_only, true);
  assert.equal(result.policy.protected_platform_routes_blocked, true);
  assert.equal(Array.isArray(result.targets), true);
  assert.equal(Array.isArray(result.issues), true);
  assert.ok(result.summary.unique_targets <= MAX_LINK_TARGETS);
  assert.ok(result.summary.references_scanned <= MAX_LINK_REFERENCES);
  assert.equal(result.summary.unique_targets, result.targets.length);
  assert.equal(result.issues.every((item) => item.severity !== "healthy"), true);

  const afterUsers = Number((await pool.query("SELECT COUNT(*) AS total FROM users"))[0][0]?.total || 0);
  const afterPages = Number((await pool.query("SELECT COUNT(*) AS total FROM public_pages"))[0][0]?.total || 0);
  assert.equal(afterUsers, beforeUsers);
  assert.equal(afterPages, beforePages);
});

test.after(async () => {
  await pool.end();
});
