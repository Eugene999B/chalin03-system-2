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
