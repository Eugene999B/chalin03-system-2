const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "backend", "package.json"), "utf8")
);
const releaseEvidence = fs.readFileSync(
  path.join(root, "docs", "MINING_TRIAL_DATA_CLEANUP_RELEASE.md"),
  "utf8"
);

test("completed Mining cleanup runner cannot execute again from application startup", () => {
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    fs.existsSync(
      path.join(root, "backend", "scripts", "runMiningTrialCleanup.js")
    ),
    false
  );
});

test("Mining cleanup release evidence retains production commit and durable marker", () => {
  assert.match(
    releaseEvidence,
    /1165c031f62850f1de86b44ae3848217c9b99632/
  );
  assert.match(releaseEvidence, /20260726_mining_trial_data_cleanup/);
  assert.match(releaseEvidence, /Spare Parts/);
  assert.match(releaseEvidence, /Equipment Hire/);
  assert.match(releaseEvidence, /shared-fleet/);
});
