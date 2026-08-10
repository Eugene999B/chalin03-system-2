"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  classifyInternalTarget,
  extractInternalLinks,
  normalizeInternalTarget,
} = require("../services/contentStudioLinkIntegrityService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioLinkIntegrityService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioLinkIntegrityRoutes.js"),
  "utf8"
);
const studioRoutesSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);

test("internal link extraction finds governed CTA fields markdown and JSX-style attributes", () => {
  const result = extractInternalLinks({
    hero: {
      primary_cta_url: "/contact?intent=mining#start",
      external_url: "https://example.com/outside",
    },
    copy: "Read [the project](/projects/alpha) or <a href=\"/about\">about us</a>.",
    unrelated: "This paragraph does not contain a link.",
  });

  const paths = result.references.map((item) => item.path);
  assert.ok(paths.includes("/contact"));
  assert.ok(paths.includes("/projects/alpha"));
  assert.ok(paths.includes("/about"));
  assert.equal(paths.includes("https://example.com/outside"), false);
  const contact = result.references.find((item) => item.path === "/contact");
  assert.equal(contact.query, "?intent=mining");
  assert.equal(contact.hash, "#start");
});

test("internal link normalization fails closed and removes duplicate slashes and trailing slash", () => {
  assert.equal(normalizeInternalTarget("//evil.example/path"), null);
  assert.equal(normalizeInternalTarget("https://example.com/path"), null);
  assert.equal(normalizeInternalTarget("javascript:alert(1)"), null);
  assert.equal(normalizeInternalTarget("/projects//alpha/").path, "/projects/alpha");
});

test("link classification distinguishes public redirect unpublished private legacy and broken targets", () => {
  const context = {
    publishedPaths: new Map([["/about", "static"]]),
    redirects: new Map([["/old-about", { id: 4, destination_url: "/about", redirect_status: 301 }]]),
    activePages: new Map([["/pages/future", { id: 8, publication_status: "draft" }]]),
  };

  assert.equal(classifyInternalTarget("/about", context).status, "healthy");
  assert.equal(classifyInternalTarget("/old-about", context).code, "REDIRECTED_INTERNAL_LINK");
  assert.equal(classifyInternalTarget("/pages/future", context).code, "UNPUBLISHED_PAGE_LINK");
  assert.equal(classifyInternalTarget("/staff", context).code, "PRIVATE_ROUTE_LINK");
  assert.equal(classifyInternalTarget("/content-studio/pages", context).code, "PRIVATE_ROUTE_LINK");
  assert.equal(classifyInternalTarget("/website/about", context).code, "LEGACY_WEBSITE_LINK");
  assert.equal(classifyInternalTarget("/does-not-exist", context).code, "BROKEN_INTERNAL_LINK");
});

test("link-integrity backend remains bounded SELECT-only and permission scoped", () => {
  assert.match(serviceSource, /MAX_LINK_TARGETS = 500/);
  assert.match(serviceSource, /MAX_LINK_REFERENCES = 1500/);
  assert.match(serviceSource, /MAX_TRAVERSAL_DEPTH = 12/);
  assert.match(serviceSource, /public_page_versions/);
  assert.match(serviceSource, /public_page_sections/);
  assert.match(serviceSource, /public_redirect_rules/);
  assert.doesNotMatch(serviceSource, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.match(routeSource, /requirePermission\("public_content\.view"\)/);
  assert.match(routeSource, /getLinkIntegrityIntelligence/);
  assert.doesNotMatch(routeSource, /router\.(?:post|put|patch|delete)\(/);
  assert.match(studioRoutesSource, /router\.use\("\/pages\/link-integrity", contentStudioLinkIntegrityRoutes\)/);
  assert.ok(
    studioRoutesSource.indexOf('router.use("/pages/link-integrity"') <
      studioRoutesSource.indexOf('router.use("/", contentStudioCoreRoutes)')
  );
});
