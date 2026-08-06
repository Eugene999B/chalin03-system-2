"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  REQUIRED_BROWSER_GATES,
  REQUIRED_SMOKE_CHECKS,
} = require("../scripts/generateChalinOneStagingAcceptanceEvidence");
const {
  generateFinalStagingAcceptanceEvidence,
  navigationHierarchyEvidence,
} = require("../scripts/generateChalinOneFinalStagingAcceptanceEvidence");

const COMMIT_SHA = "d".repeat(40);

function releaseEvidence() {
  return {
    report: "CHALIN ONE Release Candidate Evidence",
    commit_sha: COMMIT_SHA,
    environment: {
      mode: "acceptance",
      database_name: "chalin_one_acceptance_navigation",
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

function smokeEvidence({ includeHierarchy = true } = {}) {
  const checks = REQUIRED_SMOKE_CHECKS.map((name) => ({
    name,
    passed: true,
    ...(name === "Published contact form submission"
      ? { reference_code: "WEB-20260806-A1B2C3D4E5F6" }
      : {}),
  }));
  if (includeHierarchy) {
    checks.push({
      name: "Published navigation hierarchy",
      passed: true,
      status: 200,
      child_count: 7,
      header_child_count: 5,
      footer_child_count: 2,
      parent_keys: ["header_divisions", "footer_about"],
      private_findings: [],
    });
  }
  return {
    report: "CHALIN ONE Staging Smoke Test",
    commit_sha: COMMIT_SHA,
    passed: true,
    governed_homepage_discovery: true,
    governed_navigation_hierarchy: includeHierarchy,
    require_published_content: true,
    contact_form_submission_enabled: true,
    staging: {
      safe: true,
      database_name: "chalin_one_staging_navigation",
      frontend_host: "preview-navigation.example-chalin03.com",
      api_host: "api-preview-navigation.example-chalin03.com",
    },
    checks,
  };
}

function browserEvidence() {
  return {
    report: "CHALIN ONE Browser Acceptance",
    commit_sha: COMMIT_SHA,
    frontend_url: "https://preview-navigation.example-chalin03.com",
    api_url: "https://api-preview-navigation.example-chalin03.com",
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
      { name: "mobile 430", path: "screenshots/mobile-430.png" },
    ],
    sign_off: {
      reviewer: "Independent Reviewer",
      publisher: "Independent Publisher",
      accepted_at: "2026-08-06T21:50:00.000Z",
    },
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function withEvidenceFiles(smoke, callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "chalin-one-final-navigation-evidence-")
  );
  try {
    const releasePath = path.join(directory, "release.json");
    const smokePath = path.join(directory, "smoke.json");
    const browserPath = path.join(directory, "browser.json");
    const outputPath = path.join(directory, "final.json");
    writeJson(releasePath, releaseEvidence());
    writeJson(smokePath, smoke);
    writeJson(browserPath, browserEvidence());
    return callback({ releasePath, smokePath, browserPath, outputPath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("navigation hierarchy evidence requires all governed parents and children", () => {
  const passed = navigationHierarchyEvidence(smokeEvidence());
  assert.equal(passed.passed, true);
  assert.equal(passed.child_count, 7);
  assert.equal(passed.header_child_count, 5);
  assert.equal(passed.footer_child_count, 2);
  assert.equal(passed.parents_complete, true);

  const missing = navigationHierarchyEvidence(
    smokeEvidence({ includeHierarchy: false })
  );
  assert.equal(missing.passed, false);
  assert.equal(missing.smoke_check_present, false);
});

test("complete final evidence passes and writes a private report", () => {
  withEvidenceFiles(smokeEvidence(), (paths) => {
    const report = generateFinalStagingAcceptanceEvidence(paths);
    assert.equal(report.staging_ready, true);
    assert.deepEqual(report.failures, []);
    assert.equal(
      report.gates.published_navigation_hierarchy.passed,
      true
    );
    const saved = JSON.parse(fs.readFileSync(paths.outputPath, "utf8"));
    assert.equal(saved.staging_ready, true);
    assert.equal(saved.report, "CHALIN ONE Final Staging Acceptance Evidence");
    assert.equal(fs.statSync(paths.outputPath).mode & 0o777, 0o600);
  });
});

test("missing hierarchy proof blocks an otherwise complete staging candidate", () => {
  withEvidenceFiles(
    smokeEvidence({ includeHierarchy: false }),
    (paths) => {
      const report = generateFinalStagingAcceptanceEvidence(paths);
      assert.equal(report.staging_ready, false);
      assert.ok(report.failures.includes("published_navigation_hierarchy"));
      assert.equal(
        report.gates.published_navigation_hierarchy.passed,
        false
      );
    }
  );
});

test("npm staging evidence lifecycle automatically applies the final gate", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
  );
  assert.equal(
    packageJson.scripts["evidence:chalin-one:staging"],
    "node scripts/generateChalinOneStagingAcceptanceEvidence.js"
  );
  assert.equal(
    packageJson.scripts["postevidence:chalin-one:staging"],
    "node scripts/generateChalinOneFinalStagingAcceptanceEvidence.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /generateChalinOneFinalStagingAcceptanceEvidence/
  );
});
