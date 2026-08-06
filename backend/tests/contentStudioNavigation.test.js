"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ContentStudioError } = require("../services/contentStudioPageService");
const {
  NAVIGATION_LOCATIONS,
  normalizeNavigationKey,
  normalizeNavigationLocation,
  normalizeNavigationUrl,
  sanitizeNavigationSnapshot,
} = require("../services/contentStudioNavigationService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioNavigationService.js"),
  "utf8"
);
const archiveSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioNavigationArchiveService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioNavigationRoutes.js"),
  "utf8"
);
const mainRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260805_chalin_one_public_content_foundation.sql"
  ),
  "utf8"
);

test("navigation identities and locations use controlled values", () => {
  assert.equal(normalizeNavigationKey("About Us"), "about_us");
  assert.equal(normalizeNavigationKey("../../admin"), null);
  assert.equal(normalizeNavigationLocation("HEADER"), "header");
  assert.equal(normalizeNavigationLocation("sidebar"), null);
  assert.deepEqual(NAVIGATION_LOCATIONS, [
    "header",
    "footer",
    "mobile",
    "utility",
  ]);
});

test("navigation URL validation blocks script schemes and embedded credentials", () => {
  assert.equal(normalizeNavigationUrl("/about"), "/about");
  assert.equal(
    normalizeNavigationUrl("https://www.chalin03.com/contact"),
    "https://www.chalin03.com/contact"
  );
  assert.equal(
    normalizeNavigationUrl("mailto:info@chalin03.com"),
    "mailto:info@chalin03.com"
  );
  assert.equal(
    normalizeNavigationUrl("tel:+233240000000"),
    "tel:+233240000000"
  );
  assert.equal(normalizeNavigationUrl("javascript:alert(1)"), null);
  assert.equal(normalizeNavigationUrl("https://user:pass@example.com"), null);
  assert.equal(normalizeNavigationUrl("//evil.example/path"), null);
});

test("navigation snapshots require a page or safe URL target", () => {
  assert.throws(
    () =>
      sanitizeNavigationSnapshot({
        key: "about",
        location: "header",
        label: "About",
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "NAVIGATION_TARGET_REQUIRED"
  );

  const snapshot = sanitizeNavigationSnapshot({
    key: "about",
    location: "header",
    label: "About",
    url: "/about",
    opens_new_tab: false,
  });
  assert.equal(snapshot.navigation_key, "about");
  assert.equal(snapshot.navigation_location, "header");
  assert.equal(snapshot.url, "/about");
  assert.equal(snapshot.opens_new_tab, false);
});

test("navigation approval SQL matches the Phase 2 schema contract", () => {
  assert.match(migrationSource, /content_version_id BIGINT UNSIGNED NULL/);
  assert.doesNotMatch(
    migrationSource.match(
      /CREATE TABLE IF NOT EXISTS public_content_approvals[\s\S]*?ENGINE=InnoDB/
    )?.[0] || "",
    /metadata_json/
  );
  assert.match(serviceSource, /content_version_id = \?/);
  assert.match(serviceSource, /entity_id, content_version_id, request_type/);
  assert.doesNotMatch(serviceSource, /metadata_json/);
  assert.doesNotMatch(serviceSource, /JSON_EXTRACT/);
});

test("generic navigation versions never write nonexistent actor timestamp columns", () => {
  assert.doesNotMatch(
    serviceSource,
    /public_content_versions[\s\S]{0,250}approved_by/
  );
  assert.doesNotMatch(
    serviceSource,
    /public_content_versions[\s\S]{0,250}approved_at/
  );
  assert.doesNotMatch(
    serviceSource,
    /public_content_versions[\s\S]{0,250}published_by/
  );
  assert.doesNotMatch(
    serviceSource,
    /public_content_versions[\s\S]{0,250}published_at/
  );
  assert.doesNotMatch(
    serviceSource,
    /public_navigation_items[\s\S]{0,300}submitted_by/
  );
});

test("published navigation remains unchanged until an approved snapshot is applied", () => {
  assert.match(serviceSource, /public_content_versions/);
  assert.match(serviceSource, /version_status = 'draft'/);
  assert.match(serviceSource, /version_status = 'in_review'/);
  assert.match(serviceSource, /version_status !== "approved"/);
  assert.match(serviceSource, /APPROVED_REVIEW_REQUIRED/);
  assert.match(serviceSource, /snapshot_json/);
  assert.match(serviceSource, /PUBLIC_NAVIGATION_ITEM_PUBLISHED/);
  assert.match(serviceSource, /version_status = 'superseded'/);
});

test("navigation review blocks self approval and assigned-reviewer bypass", () => {
  assert.match(serviceSource, /CONTENT_SELF_APPROVAL_BLOCKED/);
  assert.match(
    serviceSource,
    /Number\(approval\.requested_by\) === Number\(user\?\.id\)/
  );
  assert.match(serviceSource, /CONTENT_APPROVAL_ASSIGNED_ELSEWHERE/);
});

test("navigation hierarchy validates parents, cycles and maximum depth", () => {
  assert.match(serviceSource, /NAVIGATION_SELF_PARENT_BLOCKED/);
  assert.match(serviceSource, /NAVIGATION_PARENT_NOT_FOUND/);
  assert.match(serviceSource, /NAVIGATION_CYCLE_BLOCKED/);
  assert.match(serviceSource, /NAVIGATION_CYCLE_DETECTED/);
  assert.match(serviceSource, /NAVIGATION_DEPTH_EXCEEDED/);
  assert.match(serviceSource, /MAX_PARENT_DEPTH = 20/);
});

test("parent archive is blocked transactionally while active children remain", () => {
  assert.match(archiveSource, /beginTransaction\(\)/);
  assert.match(archiveSource, /FOR UPDATE/);
  assert.match(archiveSource, /parent_id = \?/);
  assert.match(archiveSource, /publication_status <> 'archived'/);
  assert.match(archiveSource, /NAVIGATION_ACTIVE_CHILDREN_BLOCK_ARCHIVE/);
  assert.match(archiveSource, /rollback\(\)/);
});

test("navigation routes separate menu editing from review and publishing", () => {
  assert.match(routeSource, /public_navigation\.view/);
  assert.match(routeSource, /public_navigation\.manage/);
  assert.match(routeSource, /public_content\.submit/);
  assert.match(routeSource, /public_content\.approve/);
  assert.match(routeSource, /public_content\.publish/);
  assert.match(routeSource, /archiveNavigationItemSafely/);
  assert.match(
    mainRouteSource,
    /router\.use\("\/navigation", contentStudioNavigationRoutes\)/
  );
});
