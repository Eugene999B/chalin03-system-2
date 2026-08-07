"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repositoryRoot, relativePath), "utf8");
}

test("backend package exposes governed staging smoke and release evidence commands", () => {
  const packageJson = JSON.parse(read("backend/package.json"));
  assert.equal(
    packageJson.scripts["evidence:chalin-one:release"],
    "node scripts/generateChalinOneReleaseEvidence.js"
  );
  assert.equal(
    packageJson.scripts["smoke:chalin-one:staging"],
    "node scripts/runChalinOneGovernedHomepageStagingSmoke.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /generateChalinOneReleaseEvidence|runChalinOneGovernedHomepageStagingSmoke/
  );
});

test("database acceptance generates and preserves a machine-readable artifact", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
  assert.match(
    workflow,
    /name: Generate machine-readable release evidence[\s\S]*npm run evidence:chalin-one:release/
  );
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(
    workflow,
    /path: backend\/artifacts\/chalin-one-release-evidence\.json/
  );
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /retention-days: 30/);
});

test("CHALIN ONE CI runs for development pushes, manual verification and release PRs", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /push:\s*\n\s*branches:\s*\n\s*- chalin-one/
  );
  assert.match(
    workflow,
    /pull_request:\s*\n\s*branches:\s*\n\s*- chalin-one\s*\n\s*- main\s*\n\s*- production/
  );
  assert.match(workflow, /cancel-in-progress: true/);
});

test("CI publishes aggregate status against the real candidate commit", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
  assert.match(workflow, /statuses: write/);
  assert.match(workflow, /ci-status-start:/);
  assert.match(workflow, /ci-status-final:/);
  assert.match(
    workflow,
    /CHALIN_ONE_STATUS_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/
  );
  assert.match(workflow, /--arg state pending/);
  assert.match(workflow, /context chalin-one\/ci/);
  assert.match(workflow, /needs\.backend-tests\.result/);
  assert.match(workflow, /needs\.chalin-one-database-acceptance\.result/);
  assert.match(workflow, /needs\.frontend-tests\.result/);
  assert.match(
    workflow,
    /\/statuses\/\$\{CHALIN_ONE_STATUS_SHA\}/
  );
  assert.doesNotMatch(workflow, /\/statuses\/\$\{GITHUB_SHA\}/);
  assert.match(workflow, /CHALIN ONE CI failed; inspect the workflow run/);
  assert.match(
    workflow,
    /Backend, public\/AI MySQL acceptance, frontend tests and build passed/
  );
});

test("CI always uploads a compact aggregate result artifact", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
  assert.match(workflow, /name: Generate aggregate CHALIN ONE summary/);
  assert.match(workflow, /chalin-one-ci-summary\.json/);
  assert.match(workflow, /commit_sha: \$commit_sha/);
  assert.match(workflow, /database_acceptance: \$database/);
  assert.match(workflow, /name: Upload aggregate CHALIN ONE summary/);
  assert.match(
    workflow,
    /name: chalin-one-ci-summary-\$\{\{ env\.CHALIN_ONE_STATUS_SHA \}\}/
  );
  assert.match(
    workflow,
    /path: backend\/artifacts\/chalin-one-ci-summary\.json/
  );
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /retention-days: 30/);
});

test("generated evidence stays outside source control", () => {
  const gitignore = read(".gitignore");
  assert.match(gitignore, /^backend\/artifacts\/$/m);

  const evidenceDoc = read(
    "docs/chalin-one/CHALIN_ONE_RELEASE_CANDIDATE_EVIDENCE.md"
  );
  assert.match(evidenceDoc, /release_ready/);
  assert.match(evidenceDoc, /CHALIN_ONE_STAGING_REQUIRE_PUBLISHED=true/);
  assert.match(evidenceDoc, /do not authorize/i);
});
