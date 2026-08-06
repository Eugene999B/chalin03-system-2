"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  EXPECTED_NAVIGATION_HIERARCHY,
  verifyPublishedNavigationHierarchy,
} = require("../scripts/runChalinOneGovernedHomepageStagingSmoke");
const {
  ChalinOneStagingSmokeError,
} = require("../scripts/runChalinOneStagingSmokeTests");

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

function completeNavigation() {
  return [
    { key: "header_divisions", parent_key: null, location: "header" },
    { key: "footer_about", parent_key: null, location: "footer" },
    ...EXPECTED_NAVIGATION_HIERARCHY.map((item) => ({ ...item })),
  ];
}

test("governed homepage smoke composes every existing staging check", () => {
  assert.match(wrapper, /runStagingSmokeTests\(\{/);
  assert.match(wrapper, /writeFile: false/);
  assert.match(wrapper, /baseReport\.require_published_content/);
  assert.match(wrapper, /baseReport\.checks/);
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

test("governed smoke accepts the complete published navigation hierarchy", () => {
  const result = verifyPublishedNavigationHierarchy(completeNavigation());
  assert.deepEqual(result, {
    child_count: 7,
    header_child_count: 5,
    footer_child_count: 2,
    parent_keys: ["header_divisions", "footer_about"],
  });
});

test("governed smoke rejects missing children and wrong parents", () => {
  const missing = completeNavigation().filter(
    (item) => item.key !== "header_division_finance"
  );
  assert.throws(
    () => verifyPublishedNavigationHierarchy(missing),
    (error) =>
      error instanceof ChalinOneStagingSmokeError &&
      error.code === "CHALIN_ONE_STAGING_NAVIGATION_HIERARCHY_FAILED"
  );

  const wrongParent = completeNavigation().map((item) =>
    item.key === "footer_company_news"
      ? { ...item, parent_key: "header_divisions" }
      : item
  );
  assert.throws(
    () => verifyPublishedNavigationHierarchy(wrongParent),
    (error) =>
      error instanceof ChalinOneStagingSmokeError &&
      error.code === "CHALIN_ONE_STAGING_NAVIGATION_HIERARCHY_FAILED"
  );
});

test("governed smoke records hierarchy evidence and privacy", () => {
  assert.match(wrapper, /\/public\/content\/bootstrap/);
  assert.match(wrapper, /verifyPublishedNavigationHierarchy/);
  assert.match(wrapper, /scanPrivateKeys\(bootstrap\.body\)/);
  assert.match(wrapper, /Published navigation hierarchy/);
  assert.match(wrapper, /governed_navigation_hierarchy: true/);
  assert.match(wrapper, /header_child_count/);
  assert.match(wrapper, /footer_child_count/);
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
