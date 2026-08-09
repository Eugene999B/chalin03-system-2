"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  canonicalInfo,
  evaluateNavigationTarget,
  evaluatePageSeo,
  normalizePublicPath,
  pagePublicPath,
  websiteHealthScore,
} = require("../services/contentStudioWebsiteControlService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioWebsiteControlService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioCoreRoutes.js"),
  "utf8"
);

test("website-control public paths and canonical URLs normalize safely", () => {
  assert.equal(normalizePublicPath("/about/?x=1#team"), "/about");
  assert.equal(normalizePublicPath("//evil.example/path"), null);
  assert.equal(pagePublicPath({ slug: "about", is_homepage: 0 }), "/about");
  assert.equal(pagePublicPath({ slug: "home", is_homepage: 1 }), "/");
  assert.equal(canonicalInfo("http://example.com/about").valid, false);
  assert.equal(canonicalInfo("https://example.com/about").valid, true);
});

test("page SEO diagnostics separate record problems and indexing conflicts", () => {
  const page = evaluatePageSeo({
    id: 7,
    page_key: "about",
    slug: "about",
    publication_status: "published",
    latest_version_id: 12,
    latest_version_status: "published",
    title: "About CHALIN ONE",
    seo_title: "",
    meta_description: "",
    canonical_url: "http://example.com/about",
    robots_directive: "noindex,follow",
    show_in_search: 1,
    show_in_sitemap: 1,
  });
  const codes = page.issues.map((item) => item.code);
  assert.ok(codes.includes("SEO_TITLE_MISSING"));
  assert.ok(codes.includes("META_DESCRIPTION_MISSING"));
  assert.ok(codes.includes("CANONICAL_INVALID"));
  assert.ok(codes.includes("SEARCH_NOINDEX_CONFLICT"));
  assert.ok(codes.includes("SITEMAP_NOINDEX_CONFLICT"));
});

test("navigation audit detects ambiguous and unknown governed targets", () => {
  const page = {
    id: 3,
    page_key: "about",
    slug: "about",
    title: "About",
    publication_status: "draft",
    is_homepage: 0,
  };
  const pageMap = new Map([[3, page]]);
  const pathMap = new Map([["/about", page]]);
  const navMap = new Map();
  const result = evaluateNavigationTarget(
    {
      id: 9,
      navigation_key: "about_link",
      label: "About",
      navigation_location: "header",
      publication_status: "published",
      page_id: 3,
      url: "/missing-target",
    },
    pageMap,
    pathMap,
    navMap
  );
  const codes = result.issues.map((item) => item.code);
  assert.ok(codes.includes("NAVIGATION_DUAL_TARGET"));
  assert.ok(codes.includes("NAVIGATION_PAGE_NOT_PUBLISHED"));
  assert.ok(codes.includes("NAVIGATION_INTERNAL_TARGET_UNKNOWN"));
});

test("health score penalizes critical issues more than warnings and stays bounded", () => {
  const warningOnly = [{ issues: [{ severity: "warning" }] }];
  const criticalOnly = [{ issues: [{ severity: "critical" }] }];
  assert.ok(websiteHealthScore(warningOnly) > websiteHealthScore(criticalOnly));
  assert.equal(websiteHealthScore(Array.from({ length: 20 }, () => ({ issues: [{ severity: "critical" }] }))), 0);
  assert.equal(websiteHealthScore([]), 100);
});

test("website-control service is SELECT-only and route is permission scoped before dynamic page IDs", () => {
  assert.match(serviceSource, /SELECT[\s\S]*FROM public_pages/);
  assert.match(serviceSource, /SELECT n\.\*[\s\S]*FROM public_navigation_items/);
  assert.doesNotMatch(serviceSource, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(serviceSource, /child_process|exec\(|spawn\(|writeFile|unlink/);
  assert.match(routeSource, /"\/pages\/website-control"[\s\S]*requirePermission\("public_content\.view"\)/);
  assert.ok(routeSource.indexOf('"/pages/website-control"') < routeSource.indexOf('"/pages/:pageId"'));
});
