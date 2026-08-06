"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const homepageService = fs.readFileSync(
  path.join(backendRoot, "services/publicHomepageService.js"),
  "utf8"
);
const publicRoutes = fs.readFileSync(
  path.join(backendRoot, "routes/publicContentRoutes.js"),
  "utf8"
);

test("homepage discovery is published-only and reuses the safe page renderer", () => {
  assert.match(homepageService, /p\.is_homepage = 1/);
  assert.match(homepageService, /publicationPredicate\("p"\)/);
  assert.match(homepageService, /ORDER BY p\.published_at DESC, p\.id DESC/);
  assert.match(homepageService, /LIMIT 1/);
  assert.match(homepageService, /return slug \? getPublicPageBySlug\(slug\) : null/);
  assert.match(homepageService, /schemaNotReadyError\(error\)/);
  assert.doesNotMatch(
    homepageService,
    /SELECT\s+\*|internal_page_version_id|approval|created_by|updated_by/i
  );
});

test("homepage route is explicit, cached and declared before generic page slugs", () => {
  const homepageRoute = publicRoutes.indexOf('router.get("/homepage"');
  const genericPageRoute = publicRoutes.indexOf('router.get("/pages/:slug"');
  assert.ok(homepageRoute >= 0);
  assert.ok(genericPageRoute > homepageRoute);
  assert.match(publicRoutes, /const page = await getPublicHomepage\(\)/);
  assert.match(publicRoutes, /notFound\(res, req, "Homepage"\)/);
  assert.match(publicRoutes, /success\(res, req, page, \{ cacheSeconds: 120 \}\)/);
});
