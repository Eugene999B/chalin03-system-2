"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ChalinOneStagingAcceptanceError,
  REQUIRED_BROWSER_GATES,
  REQUIRED_SMOKE_CHECKS,
  browserEvidence,
  evaluateStagingAcceptance,
  normalizeCommitSha,
  releaseEnvironmentEvidence,
  safeStagingUrl,
  smokeEvidence,
} = require("../scripts/generateChalinOneStagingAcceptanceEvidence");

const COMMIT_SHA = "a".repeat(40);

function releaseFixture(overrides = {}) {
  return {
    report: "CHALIN ONE Release Candidate Evidence",
    commit_sha: COMMIT_SHA,
    environment: {
      mode: "acceptance",
      database_name: "chalin_one_acceptance",
      safe: true,
    },
    release_ready: true,
    gates: {
      migration_record_present: true,
      all_expected_tables_present: true,
      no_pending_self_assigned_approvals: true,
      no_approved_self_decisions: true,
      decisions_have_evidence: true,
      pending_approvals_target_exact_versions: true,
      public_media_ready: true,
      exactly_one_published_homepage: true,
      published_pages_have_versions: true,
      published_navigation_present: true,
      published_public_form_present: true,
      public_settings_present: true,
      no_draft_page_leak: true,
      no_draft_form_leak: true,
    },
    ...overrides,
  };
}

function smokeFixture(overrides = {}) {
  const checks = REQUIRED_SMOKE_CHECKS.map((name) => ({
    name,
    passed: true,
    ...(name === "Published contact form submission"
      ? { reference_code: "WEB-20260806-ABCDEF123456" }
      : {}),
  }));
  return {
    report: "CHALIN ONE Staging Smoke Test",
    commit_sha: COMMIT_SHA,
    passed: true,
    require_published_content: true,
    contact_form_submission_enabled: true,
    staging: { safe: true, database_name: "chalin_one_staging" },
    checks,
    ...overrides,
  };
}

function browserFixture(overrides = {}) {
  const gates = Object.fromEntries(
    REQUIRED_BROWSER_GATES.map((key) => [
      key,
      {
        passed: true,
        evidence: [`evidence/${key}.md`],
      },
    ])
  );
  return {
    report: "CHALIN ONE Browser Acceptance",
    commit_sha: COMMIT_SHA,
    frontend_url: "https://preview.example-chalin03.com",
    api_url: "https://api-preview.example-chalin03.com",
    passed: true,
    gates,
    screenshots: [
      { name: "public desktop", path: "screenshots/public-desktop.png" },
      { name: "public mobile 360", path: "screenshots/public-360.png" },
      { name: "public mobile 430", path: "screenshots/public-430.png" },
      { name: "content studio", path: "screenshots/content-studio.png" },
    ],
    sign_off: {
      reviewer: "Staging Reviewer",
      publisher: "Staging Publisher",
      accepted_at: "2026-08-06T18:30:00.000Z",
    },
    ...overrides,
  };
}

test("complete evidence for one commit passes every staging gate", () => {
  const result = evaluateStagingAcceptance({
    release: releaseFixture(),
    smoke: smokeFixture(),
    browser: browserFixture(),
  });
  assert.equal(result.staging_ready, true);
  assert.equal(result.commit_match, true);
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.gates.automated_release_evidence.environment.mode,
    "acceptance"
  );
  assert.equal(
    result.gates.final_staging_smoke.reference_code,
    "WEB-20260806-ABCDEF123456"
  );
  assert.equal(result.gates.browser_acceptance.screenshot_count, 4);
});

test("release environment must be explicitly safe and isolated", () => {
  assert.deepEqual(
    releaseEnvironmentEvidence({
      mode: "staging",
      database_name: "chalin_one_staging_preview",
      safe: true,
    }),
    {
      passed: true,
      safe: true,
      mode: "staging",
      database_name: "chalin_one_staging_preview",
      database_name_safe: true,
    }
  );
  assert.equal(
    releaseEnvironmentEvidence({
      mode: "staging",
      database_name: "chalin03_db",
      safe: true,
    }).passed,
    false
  );
  assert.equal(
    releaseEnvironmentEvidence({
      mode: "production",
      database_name: "chalin_one_staging",
      safe: true,
    }).passed,
    false
  );
  assert.equal(releaseEnvironmentEvidence("test").passed, false);
});

test("commit identity mismatch blocks staging readiness", () => {
  const result = evaluateStagingAcceptance({
    release: releaseFixture(),
    smoke: smokeFixture({ commit_sha: "b".repeat(40) }),
    browser: browserFixture(),
  });
  assert.equal(result.staging_ready, false);
  assert.equal(result.commit_match, false);
  assert.ok(result.failures.includes("commit_identity"));
});

test("missing final smoke check or invalid reference code blocks readiness", () => {
  const incomplete = smokeFixture();
  incomplete.checks = incomplete.checks.filter(
    (check) => check.name !== "Content Studio deep link"
  );
  const missing = smokeEvidence(incomplete);
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missing_checks, ["Content Studio deep link"]);

  const invalidReference = smokeFixture();
  invalidReference.checks = invalidReference.checks.map((check) =>
    check.name === "Published contact form submission"
      ? { ...check, reference_code: "INVALID" }
      : check
  );
  assert.equal(smokeEvidence(invalidReference).passed, false);
});

test("browser gates require evidence, screenshots and independent sign-off", () => {
  const missingGate = browserFixture();
  missingGate.gates.public_mobile_360 = { passed: true, evidence: [] };
  const missingResult = browserEvidence(missingGate);
  assert.equal(missingResult.passed, false);
  assert.deepEqual(missingResult.missing_gates, ["public_mobile_360"]);

  const sharedApprover = browserFixture({
    sign_off: {
      reviewer: "Same Person",
      publisher: "same person",
      accepted_at: "2026-08-06T18:30:00.000Z",
    },
  });
  assert.equal(browserEvidence(sharedApprover).sign_off_valid, false);
});

test("production, credentialed and non-isolated URLs are rejected", () => {
  assert.throws(
    () => safeStagingUrl("https://chalin03.com", "Frontend"),
    (error) =>
      error instanceof ChalinOneStagingAcceptanceError &&
      error.code ===
        "CHALIN_ONE_STAGING_ACCEPTANCE_PRODUCTION_HOST_BLOCKED"
  );
  assert.throws(
    () =>
      safeStagingUrl(
        "https://user:password@preview.example-chalin03.com",
        "Frontend"
      ),
    (error) =>
      error instanceof ChalinOneStagingAcceptanceError &&
      error.code ===
        "CHALIN_ONE_STAGING_ACCEPTANCE_URL_CREDENTIALS_BLOCKED"
  );
  assert.throws(
    () => safeStagingUrl("https://example.com", "Frontend"),
    (error) =>
      error instanceof ChalinOneStagingAcceptanceError &&
      error.code === "CHALIN_ONE_STAGING_ACCEPTANCE_HOST_NOT_ISOLATED"
  );
});

test("commit SHA validation rejects placeholders and malformed values", () => {
  assert.equal(normalizeCommitSha(COMMIT_SHA), COMMIT_SHA);
  assert.throws(
    () => normalizeCommitSha("CURRENT_COMMIT_SHA"),
    (error) =>
      error instanceof ChalinOneStagingAcceptanceError &&
      error.code === "CHALIN_ONE_STAGING_ACCEPTANCE_COMMIT_INVALID"
  );
});

test("aggregator is offline, non-destructive and exposed through package scripts", () => {
  const backendRoot = path.resolve(__dirname, "..");
  const source = fs.readFileSync(
    path.join(
      backendRoot,
      "scripts/generateChalinOneStagingAcceptanceEvidence.js"
    ),
    "utf8"
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
  );
  assert.doesNotMatch(
    source,
    /require\(["']\.\.\/config\/db|\bfetch\s*\(|axios|child_process|DELETE\s+FROM|UPDATE\s+|INSERT\s+INTO/i
  );
  assert.match(source, /mode: 0o600/);
  assert.match(source, /release_ready === true/);
  assert.match(source, /contact_form_submission_enabled === true/);
  assert.match(source, /screenshots\.length >= 4/);
  assert.match(source, /ACCEPTANCE_DATABASE_PATTERN/);
  assert.match(source, /STAGING_DATABASE_PATTERN/);
  assert.equal(
    packageJson.scripts["evidence:chalin-one:staging"],
    "node scripts/generateChalinOneStagingAcceptanceEvidence.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /generateChalinOneStagingAcceptanceEvidence/
  );
});
