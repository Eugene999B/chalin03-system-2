"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("public renderer consumes the governed navigation hierarchy", () => {
  const app = read("frontend/src/chalin-one/public-site/PublicWebsiteApp.jsx");
  const navigation = read(
    "frontend/src/chalin-one/public-site/PublicNavigation.jsx"
  );
  const css = read("frontend/src/chalin-one/public-site/publicNavigation.css");

  assert.match(app, /<PublicNavigation/);
  assert.match(app, /<PublicFooterNavigation/);
  assert.match(navigation, /buildPublicNavigationTree/);
  assert.match(navigation, /parent_key/);
  assert.match(navigation, /MAX_NAVIGATION_DEPTH/);
  assert.match(navigation, /NAVIGATION_CYCLE|ancestors\.includes/);
  assert.match(navigation, /aria-expanded/);
  assert.match(navigation, /event\.key === "Escape"/);
  assert.match(navigation, /opens_new_tab/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /\.pw-submenu\[data-open="true"\]/);
  assert.doesNotMatch(navigation, /dangerouslySetInnerHTML|eval\(|<iframe/);
});

test("frontend test and JSX compilation paths include navigation hierarchy", () => {
  const packageJson = JSON.parse(read("frontend/package.json"));
  const syntax = read("frontend/scripts/contentStudioJsxSyntaxTests.mjs");
  const contract = read("frontend/scripts/publicNavigationHierarchyTests.mjs");

  assert.match(
    packageJson.scripts.test,
    /node scripts\/publicNavigationHierarchyTests\.mjs/
  );
  assert.match(syntax, /public-site\/PublicNavigation\.jsx/);
  assert.match(contract, /bootstrap serializer preserves parent and new-tab/);
  assert.match(contract, /orphaned|orphans/);
});

test("database acceptance publishes exact-version child navigation safely", () => {
  const acceptance = read(
    "backend/acceptance/publicNavigationHierarchyDatabaseAcceptance.test.js"
  );
  const packageJson = JSON.parse(read("backend/package.json"));

  for (const marker of [
    "createNavigationDraft",
    "parent_id: parentId",
    "submitNavigationVersion",
    "decideNavigationApproval",
    "publishNavigationVersion",
    "getPublicBootstrap",
    "acceptance_projects_child",
    "acceptance_external_child",
    "opens_new_tab",
    "parent_key",
    "collectPrivateFields",
    "navigation_item_published",
  ]) {
    assert.match(acceptance, new RegExp(marker));
  }
  assert.equal(
    packageJson.scripts["test:chalin-one:db"],
    "node --test --test-concurrency=1 acceptance/*.test.js"
  );
  assert.doesNotMatch(
    acceptance,
    /DROP TABLE|DROP DATABASE|TRUNCATE|DELETE FROM|UPDATE\s+public_navigation_items/i
  );
});
