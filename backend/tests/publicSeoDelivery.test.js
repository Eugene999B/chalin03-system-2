"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAX_SITEMAP_URLS,
  dedupeSitemapItems,
  pageSitemapPath,
  robotsAllowsSitemap,
  sitemapItem,
} = require("../services/publicSeoDeliveryService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicSeoDeliveryService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicSeoRoutes.js"),
  "utf8"
);
const parentRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicRedirectRoutes.js"),
  "utf8"
);

test("governed Page sitemap paths match the actual public route model", () => {
  assert.equal(pageSitemapPath({ slug: "home", is_homepage: 1 }), "/");
  assert.equal(pageSitemapPath({ slug: "about", is_homepage: 0 }), "/about");
  assert.equal(
    pageSitemapPath({ slug: "community-impact", is_homepage: 0 }),
    "/pages/community-impact"
  );
  assert.equal(pageSitemapPath({ slug: "bad slug", is_homepage: 0 }), "");
});

test("published page robots policy excludes noindex records from sitemap", () => {
  assert.equal(robotsAllowsSitemap("index,follow"), true);
  assert.equal(robotsAllowsSitemap("NOINDEX, follow"), false);
  assert.equal(robotsAllowsSitemap("noarchive,follow"), true);
});

test("sitemap dedupe keeps one route and the newest valid last-modified value", () => {
  const result = dedupeSitemapItems([
    sitemapItem("/news/update", "news", "2026-08-01T00:00:00Z"),
    sitemapItem("/news/update", "page", "2026-08-08T00:00:00Z"),
    sitemapItem("/about", "static", null),
  ]);
  assert.equal(result.length, 2);
  assert.equal(
    result.find((item) => item.path === "/news/update").last_modified,
    "2026-08-08T00:00:00.000Z"
  );
  assert.equal(MAX_SITEMAP_URLS, 50000);
});

test("SEO inventory is read-only and applies publication, sitemap and noindex policy", () => {
  assert.match(serviceSource, /p\.show_in_sitemap = 1/);
  assert.match(serviceSource, /robotsAllowsSitemap\(row\.robots_directive\)/);
  assert.match(serviceSource, /publicationPredicate\("p"\)/);
  assert.match(serviceSource, /publicationPredicate\("a"\)/);
  assert.match(serviceSource, /publicationPredicate\("e"\)/);
  assert.match(serviceSource, /public_job_vacancies/);
  assert.match(serviceSource, /public_tenders/);
  assert.doesNotMatch(serviceSource, /FROM public_forms|JOIN public_forms/);
  assert.doesNotMatch(serviceSource, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(serviceSource, /child_process|exec\(|spawn\(|writeFile|unlink/);
});

test("technical SEO inventory route is GET-only and inherits public edge support gate", () => {
  assert.match(routeSource, /router\.get\("\/inventory"/);
  assert.match(routeSource, /PUBLIC_SEO_READ_RATE_LIMIT_MAX/);
  assert.doesNotMatch(routeSource, /router\.(?:post|put|patch|delete)/);
  assert.match(parentRouteSource, /router\.use\("\/seo", publicSeoRoutes\)/);
  assert.match(parentRouteSource, /const publicSeoRoutes = require\("\.\/publicSeoRoutes"\)/);
});
