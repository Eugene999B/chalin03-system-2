"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  RESERVED_PLATFORM_PREFIXES,
  detailRoute,
  isReservedPlatformPath,
} = require("../services/publicRouteOccupancyService");

const repoRoot = path.resolve(__dirname, "../..");
const publicResolverSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicRedirectRoutes.js"),
  "utf8"
);
const studioRedirectSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRedirectRoutes.js"),
  "utf8"
);

test("operational and secure route prefixes are permanently reserved from redirects", () => {
  for (const pathname of [
    "/login",
    "/staff",
    "/content-studio/login",
    "/intelligence",
    "/owner-recovery",
    "/mining/sites",
    "/mining-operations",
    "/equipment-hire",
    "/equipment-hire-operations/contracts",
    "/equipment-installment-finance/applications",
    "/group-executive-control",
    "/security-centre",
    "/api/public/content/bootstrap",
  ]) {
    assert.equal(isReservedPlatformPath(pathname), true, pathname);
    assert.equal(detailRoute(pathname), null, pathname);
  }
  assert.ok(RESERVED_PLATFORM_PREFIXES.size > 20);
});

test("arbitrary retired public paths and governed public detail paths remain distinguishable", () => {
  assert.equal(isReservedPlatformPath("/old-company-page"), false);
  assert.equal(isReservedPlatformPath("/news/retired-story"), false);
  assert.deepEqual(detailRoute("/news/retired-story"), {
    kind: "news",
    slug: "retired-story",
    section: null,
  });
  assert.deepEqual(detailRoute("/equipment/retired-excavator"), {
    kind: "equipment",
    slug: "retired-excavator",
    section: null,
  });
});

test("both Studio activation and anonymous resolution consult the shared occupancy boundary", () => {
  assert.match(studioRedirectSource, /assertRedirectSourceUnoccupied/);
  assert.match(studioRedirectSource, /assertStoredRuleSourceUnoccupied/);
  assert.match(publicResolverSource, /findPublishedRouteOwner/);
  assert.match(publicResolverSource, /STATIC_PUBLIC_PATHS\.has\(pathname\)/);
});
