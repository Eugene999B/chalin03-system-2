"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const wrapper = fs.readFileSync(
  path.join(
    backendRoot,
    "scripts/runChalinOneGovernedHomepageStagingSmoke.js"
  ),
  "utf8"
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
);

test("governed homepage smoke composes every existing staging check", () => {
  assert.match(wrapper, /runStagingSmokeTests\(\{/);
  assert.match(wrapper, /writeFile: false/);
  assert.match(wrapper, /baseReport\.require_published_content/);
  assert.match(wrapper, /baseReport\.checks\.map/);
  assert.match(wrapper, /check\.name === "Published homepage"/);
  assert.doesNotMatch(wrapper, /filter\(.*checks|slice\(.*checks/);
});

test("governed homepage smoke verifies discovery, privacy and exact page resolution", () => {
  assert.match(wrapper, /\/public\/content\/homepage/);
  assert.match(wrapper, /scanPrivateKeys\(homepage\.body\)/);
  assert.match(wrapper, /encodeURIComponent\(homepageData\.slug\)/);
  assert.match(wrapper, /resolvedData\.slug !== homepageData\.slug/);
  assert.match(wrapper, /resolvedData\.title !== homepageData\.title/);
  assert.match(wrapper, /JSON\.stringify\(resolvedData\.sections \|\| \[\]\)/);
  assert.match(wrapper, /\/public\/i\.test\(homepage\.cache_control\)/);
  assert.match(wrapper, /governed_homepage_discovery: true/);
  assert.match(wrapper, /discovery_endpoint: "\/api\/public\/content\/homepage"/);
});

test("governed homepage smoke writes private evidence and is outside startup", () => {
  assert.match(wrapper, /mode: 0o600/);
  assert.equal(
    packageJson.scripts["smoke:chalin-one:staging"],
    "node scripts/runChalinOneGovernedHomepageStagingSmoke.js"
  );
  assert.doesNotMatch(
    packageJson.scripts.start,
    /runChalinOneGovernedHomepageStagingSmoke/
  );
  assert.doesNotMatch(
    wrapper,
    /Authorization|Bearer|localStorage|sessionStorage|DELETE\s+FROM|UPDATE\s+/i
  );
});
