"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  REQUIRED_BROWSER_GATES,
  REQUIRED_SMOKE_CHECKS,
  generateStagingAcceptanceEvidence,
} = require("../scripts/generateChalinOneStagingAcceptanceEvidence");

const COMMIT_SHA = "c".repeat(40);

function releaseEvidence() {
  return {
    report: "CHALIN ONE Release Candidate Evidence",
    commit_sha: COMMIT_SHA,
    environment: {
      mode: "acceptance",
      database_name: "chalin_one_acceptance_filesystem",
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
  };
}

function smokeEvidence() {
  return {
    report: "CHALIN ONE Staging Smoke Test",
    commit_sha: COMMIT_SHA,
    passed: true,
    require_published_content: true,
    contact_form_submission_enabled: true,
    staging: {
      safe: true,
      database_name: "chalin_one_staging_filesystem",
      frontend_host: "preview-filesystem.example-chalin03.com",
      api_host: "api-preview-filesystem.example-chalin03.com",
    },
    checks: REQUIRED_SMOKE_CHECKS.map((name) => ({
      name,
      passed: true,
      ...(name === "Published contact form submission"
        ? { reference_code: "WEB-20260806-123456ABCDEF" }
        : {}),
    })),
  };
}

function browserEvidence() {
  return {
    report: "CHALIN ONE Browser Acceptance",
    commit_sha: COMMIT_SHA,
    frontend_url: "https://preview-filesystem.example-chalin03.com",
    api_url: "https://api-preview-filesystem.example-chalin03.com",
    passed: true,
    gates: Object.fromEntries(
      REQUIRED_BROWSER_GATES.map((key) => [
        key,
        { passed: true, evidence: [`evidence/${key}.md`] },
      ])
    ),
    screenshots: [
      { name: "desktop", path: "screenshots/desktop.png" },
      { name: "tablet", path: "screenshots/tablet.png" },
      { name: "mobile 360", path: "screenshots/mobile-360.png" },
      { name: "content studio", path: "screenshots/studio.png" },
    ],
    sign_off: {
      reviewer: "Independent Reviewer",
      publisher: "Independent Publisher",
      accepted_at: "2026-08-06T18:45:00.000Z",
    },
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("aggregator reads all evidence and writes a private passing report", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chalin-one-staging-evidence-")
  );
  try {
    const releasePath = path.join(directory, "release.json");
    const smokePath = path.join(directory, "smoke.json");
    const browserPath = path.join(directory, "browser.json");
    const outputPath = path.join(directory, "combined.json");
    writeJson(releasePath, releaseEvidence());
    writeJson(smokePath, smokeEvidence());
    writeJson(browserPath, browserEvidence());

    const report = generateStagingAcceptanceEvidence({
      releasePath,
      smokePath,
      browserPath,
      outputPath,
    });

    assert.equal(report.staging_ready, true);
    assert.equal(report.commit_match, true);
    assert.equal(report.database_match, true);
    assert.equal(report.endpoint_match, true);
    assert.equal(report.browser_hosts_separate, true);
    assert.deepEqual(report.failures, []);

    const saved = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(saved.staging_ready, true);
    assert.equal(saved.commit_sha, COMMIT_SHA);
    assert.equal(
      saved.gates.final_staging_smoke.reference_code,
      "WEB-20260806-123456ABCDEF"
    );
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("aggregator still writes diagnostic evidence when a gate fails", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chalin-one-staging-failure-")
  );
  try {
    const releasePath = path.join(directory, "release.json");
    const smokePath = path.join(directory, "smoke.json");
    const browserPath = path.join(directory, "browser.json");
    const outputPath = path.join(directory, "combined.json");
    const browser = browserEvidence();
    browser.gates.permission_boundaries = { passed: false, evidence: [] };
    browser.passed = false;
    writeJson(releasePath, releaseEvidence());
    writeJson(smokePath, smokeEvidence());
    writeJson(browserPath, browser);

    const report = generateStagingAcceptanceEvidence({
      releasePath,
      smokePath,
      browserPath,
      outputPath,
    });

    assert.equal(report.staging_ready, false);
    assert.ok(report.failures.includes("browser_acceptance"));
    const saved = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(saved.staging_ready, false);
    assert.deepEqual(
      saved.gates.browser_acceptance.missing_gates,
      ["permission_boundaries"]
    );
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
