"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioNavigationRoutes.js"),
  "utf8"
);
const serviceSource = fs.readFileSync(
  path.join(
    repoRoot,
    "backend/services/contentStudioNavigationApprovalService.js"
  ),
  "utf8"
);

test("Navigation exposes a protected pending-approval list", () => {
  assert.match(routeSource, /router\.get\(\s*"\/approvals"/s);
  assert.match(routeSource, /requirePermission\("public_content\.review"\)/);
  assert.match(routeSource, /listNavigationApprovals/);
});

test("Navigation approval list uses exact content versions", () => {
  assert.match(serviceSource, /a\.content_version_id/);
  assert.match(serviceSource, /JOIN public_content_versions cv ON cv\.id = a\.content_version_id/);
  assert.match(serviceSource, /a\.entity_type = 'navigation_item'/);
  assert.match(serviceSource, /a\.approval_status = 'pending'/);
  assert.match(serviceSource, /snapshot: parseJson\(row\.snapshot_json, \{\}\)/);
});

test("Navigation approval list supports assignment, safe pagination and a stable list envelope", () => {
  assert.match(serviceSource, /a\.assigned_to = \?/);
  assert.match(serviceSource, /Math\.min\(number, 100\)/);
  assert.match(serviceSource, /LIMIT \? OFFSET \?/);
  assert.match(serviceSource, /const items = rows\.map/);
  assert.match(serviceSource, /return \{\s*items,\s*total: items\.length,\s*limit,\s*offset,?\s*\}/s);
});

test("Navigation approval service does not mutate approval state", () => {
  assert.doesNotMatch(serviceSource, /UPDATE public_content_approvals/);
  assert.doesNotMatch(serviceSource, /DELETE FROM/);
  assert.doesNotMatch(serviceSource, /INSERT INTO/);
});
