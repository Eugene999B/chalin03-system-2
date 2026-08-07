"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ChalinOneReleaseEvidenceError,
  assertEvidenceEnvironment,
  releaseGates,
} = require("../scripts/generateChalinOneReleaseEvidence");
const {
  PRIVATE_KEYS,
  PUBLIC_FLAG_KEYS,
  apiRoot,
  normalizeBaseUrl,
  scanPrivateKeys,
} = require("../scripts/runChalinOneStagingSmokeTests");
const {
  STAGING_CONFIRMATION,
} = require("../scripts/verifyChalinOneStagingEnvironment");

function stagingEnvironment(overrides = {}) {
  return {
    NODE_ENV: "staging",
    CHALIN_ONE_STAGING_CONFIRM: STAGING_CONFIRMATION,
    DB_HOST: "127.0.0.1",
    DB_NAME: "chalin_one_staging_release_ci",
    FRONTEND_URL: "https://preview-release.example-chalin03.com",
    CHALIN_ONE_STAGING_API_URL:
      "https://api-preview-release.example-chalin03.com",
    FEATURE_PUBLIC_WEBSITE: "true",
    FEATURE_CONTENT_STUDIO: "true",
    FEATURE_AI_ENABLED: "false",
    FEATURE_CHALIN_COPILOT: "false",
    FEATURE_CHALIN_EXECUTIVE: "false",
    FEATURE_CHALIN_GUIDE: "false",
    FEATURE_CUSTOMER_PORTAL: "false",
    FEATURE_SUPPLIER_PORTAL: "false",
    FEATURE_APPLICANT_PORTAL: "false",
    FEATURE_AI_ACTIONS: "false",
    FEATURE_AI_SCHEDULED_JOBS: "false",
    PUBLIC_MEDIA_STORAGE_PROVIDER: "local",
    PUBLIC_MEDIA_LOCAL_ROOT: "./tmp/release-staging-media",
    PUBLIC_FORM_IP_HASH_SECRET: "r".repeat(80),
    CHALIN_ONE_STAGING_AUTHOR_USER_ID: "21",
    CHALIN_ONE_STAGING_REVIEWER_USER_ID: "22",
    CHALIN_ONE_STAGING_PUBLISHER_USER_ID: "23",
    CHALIN_ONE_ALLOW_SCHEMA_MIGRATION: "false",
    CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM: "",
    ...overrides,
  };
}

test("release evidence accepts only isolated acceptance or verified staging databases", () => {
  const acceptance = assertEvidenceEnvironment(
    { NODE_ENV: "test" },
    "chalin_one_acceptance"
  );
  assert.equal(acceptance.mode, "acceptance");
  assert.equal(acceptance.safe, true);

  const staging = assertEvidenceEnvironment(
    stagingEnvironment(),
    "chalin_one_staging_release_ci"
  );
  assert.equal(staging.mode, "staging");
  assert.equal(staging.safe, true);

  assert.throws(
    () =>
      assertEvidenceEnvironment(
        stagingEnvironment(),
        "chalin_one_staging_wrong_database"
      ),
    (error) => {
      assert.equal(error instanceof ChalinOneReleaseEvidenceError, true);
      assert.equal(
        error.code,
        "CHALIN_ONE_RELEASE_EVIDENCE_DATABASE_MISMATCH"
      );
      return true;
    }
  );
});

test("release gates require complete publication and governance evidence", () => {
  const complete = releaseGates({
    migrationApplied: true,
    missingTables: [],
    approvals: {
      pending_self_assigned: 0,
      approved_self_decisions: 0,
      decisions_missing_evidence: 0,
      pending_without_exact_version: 0,
    },
    media: { public_not_ready: 0 },
    integrity: {
      published_homepages: 1,
      published_pages_without_published_version: 0,
      published_navigation: 2,
      published_forms: 1,
      active_public_settings: 4,
      draft_page_leaks: 0,
      draft_form_leaks: 0,
    },
  });
  assert.equal(complete.release_ready, true);
  assert.equal(Object.values(complete.gates).every(Boolean), true);

  const incomplete = releaseGates({
    migrationApplied: true,
    missingTables: [],
    approvals: {
      pending_self_assigned: 1,
      approved_self_decisions: 0,
      decisions_missing_evidence: 0,
      pending_without_exact_version: 0,
    },
    media: { public_not_ready: 0 },
    integrity: {
      published_homepages: 0,
      published_pages_without_published_version: 0,
      published_navigation: 0,
      published_forms: 0,
      active_public_settings: 0,
      draft_page_leaks: 0,
      draft_form_leaks: 0,
    },
  });
  assert.equal(incomplete.release_ready, false);
  assert.equal(incomplete.gates.no_pending_self_assigned_approvals, false);
  assert.equal(incomplete.gates.exactly_one_published_homepage, false);
});

test("staging smoke URL helpers preserve the dedicated API boundary", () => {
  assert.equal(
    normalizeBaseUrl("https://preview.example-chalin03.com/"),
    "https://preview.example-chalin03.com"
  );
  assert.equal(
    apiRoot("https://api-preview.example-chalin03.com"),
    "https://api-preview.example-chalin03.com/api"
  );
  assert.equal(
    apiRoot("https://api-preview.example-chalin03.com/api/"),
    "https://api-preview.example-chalin03.com/api"
  );
  assert.throws(
    () => normalizeBaseUrl("http://preview.example-chalin03.com"),
    /require HTTPS/i
  );
});

test("public response scanner detects private field names recursively", () => {
  const findings = scanPrivateKeys({
    data: {
      media: { storage_key: "private/object.webp" },
      submission: { ip_hash: "hash", user_agent: "browser" },
      nested: [{ token: "unsafe" }],
    },
  });
  assert.deepEqual(findings, [
    "data.media.storage_key",
    "data.submission.ip_hash",
    "data.submission.user_agent",
    "data.nested.0.token",
  ]);
  assert.equal(PRIVATE_KEYS.has("storage_key"), true);
  assert.deepEqual([...PUBLIC_FLAG_KEYS], [
    "publicWebsite",
    "chalinGuide",
    "customerPortal",
    "supplierPortal",
    "applicantPortal",
  ]);
});

test("release tools stay credential-free and staging writes are explicitly gated", () => {
  const evidenceSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../scripts/generateChalinOneReleaseEvidence.js"
    ),
    "utf8"
  );
  const smokeSource = fs.readFileSync(
    path.resolve(__dirname, "../scripts/runChalinOneStagingSmokeTests.js"),
    "utf8"
  );

  assert.doesNotMatch(
    evidenceSource,
    /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i
  );
  assert.match(evidenceSource, /mode:\s*0o600/);
  assert.match(evidenceSource, /draft_page_leaks/);
  assert.match(evidenceSource, /pending_self_assigned/);

  assert.doesNotMatch(smokeSource, /Authorization|Bearer|Cookie|localStorage/);
  assert.match(smokeSource, /CHALIN_ONE_STAGING_SMOKE_SUBMIT_FORM/);
  assert.match(smokeSource, /!submitContactForm \|\| requirePublished/);
  assert.match(smokeSource, /public\/content\/forms\/contact\/submissions/);
  assert.match(smokeSource, /method:\s*["']POST["']/i);
  assert.match(smokeSource, /features\/staff/);
  assert.match(smokeSource, /content-studio/);
  assert.match(smokeSource, /__chalin_one_unpublished_probe__/);
});
