"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repositoryRoot, relativePath), "utf8");
}

test("backend package exposes staging smoke and release evidence commands", () => {
  const packageJson = JSON.parse(read("backend/package.json"));
  assert.equal(
    packageJson.scripts["evidence:chalin-one:release"],
    "node scripts/generateChalinOneReleaseEvidence.js"
  );
  assert.equal(
    packageJson.scripts["smoke:chalin-one:staging"],
    "node scripts/runChalinOneStagingSmokeTests.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /generateChalinOneReleaseEvidence|runChalinOneStagingSmokeTests/
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

test("CHALIN ONE CI runs for development pushes, synchronization PRs and release PRs", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
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

test("CI publishes an explicit aggregate commit status for connected verification", () => {
  const workflow = read(".github/workflows/chalin-one-ci.yml");
  assert.match(workflow, /statuses: write/);
  assert.match(workflow, /ci-status-start:/);
  assert.match(workflow, /ci-status-final:/);
  assert.match(workflow, /--arg state pending/);
  assert.match(workflow, /context chalin-one\/ci/);
  assert.match(workflow, /needs\.backend-tests\.result/);
  assert.match(workflow, /needs\.chalin-one-database-acceptance\.result/);
  assert.match(workflow, /needs\.frontend-tests\.result/);
  assert.match(workflow, /\/statuses\/\$\{GITHUB_SHA\}/);
  assert.match(workflow, /CHALIN ONE CI failed; inspect the workflow run/);
  assert.match(workflow, /Backend, MySQL acceptance, frontend tests and build passed/);
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
