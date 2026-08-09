"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeDestination,
  normalizeRedirectStatus,
  normalizeSourcePath,
  sanitizeRedirectInput,
} = require("../services/contentStudioRedirectService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioRedirectService.js"),
  "utf8"
);
const studioRoutes = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRedirectRoutes.js"),
  "utf8"
);
const studioAggregator = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);
const publicRoutes = fs.readFileSync(
  path.join(repoRoot, "backend/routes/publicRedirectRoutes.js"),
  "utf8"
);
const systemRoutes = fs.readFileSync(
  path.join(repoRoot, "backend/routes/systemRoutes.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(repoRoot, "database/migrations/20260809_chalin_one_public_redirects.sql"),
  "utf8"
);

test("redirect source normalization accepts only exact relative pathnames", () => {
  assert.equal(normalizeSourcePath("/old/about/"), "/old/about");
  assert.equal(normalizeSourcePath("/"), "/");
  assert.throws(
    () => normalizeSourcePath("https://example.com/old"),
    (error) => error?.code === "PUBLIC_REDIRECT_SOURCE_INVALID"
  );
  assert.throws(
    () => normalizeSourcePath("//example.com/old"),
    (error) => error?.code === "PUBLIC_REDIRECT_SOURCE_INVALID"
  );
  assert.throws(
    () => normalizeSourcePath("/old?campaign=x"),
    (error) => error?.code === "PUBLIC_REDIRECT_SOURCE_QUERY_BLOCKED"
  );
});

test("redirect destinations are internal relative paths or safe HTTPS only", () => {
  assert.deepEqual(normalizeDestination("/about/?from=old"), {
    kind: "internal",
    url: "/about?from=old",
    path: "/about",
  });
  assert.equal(normalizeDestination("https://example.com/new").kind, "external_https");
  assert.throws(
    () => normalizeDestination("http://example.com/new"),
    (error) => error?.code === "PUBLIC_REDIRECT_EXTERNAL_HTTPS_REQUIRED"
  );
  assert.throws(
    () => normalizeDestination("javascript:alert(1)"),
    (error) => error?.code === "PUBLIC_REDIRECT_EXTERNAL_HTTPS_REQUIRED"
  );
  assert.throws(
    () => normalizeDestination("https://user:pass@example.com/new"),
    (error) => error?.code === "PUBLIC_REDIRECT_EXTERNAL_HTTPS_REQUIRED"
  );
});

test("redirect draft validation blocks self loops bad windows and unsafe status codes", () => {
  assert.throws(
    () => sanitizeRedirectInput({ source_path: "/old", destination_url: "/old" }),
    (error) => error?.code === "PUBLIC_REDIRECT_SELF_LOOP_BLOCKED"
  );
  assert.throws(
    () => normalizeRedirectStatus(305),
    (error) => error?.code === "PUBLIC_REDIRECT_STATUS_INVALID"
  );
  assert.throws(
    () =>
      sanitizeRedirectInput({
        source_path: "/old",
        destination_url: "/about",
        activate_at: "2026-08-10T10:00:00Z",
        expires_at: "2026-08-09T10:00:00Z",
      }),
    (error) => error?.code === "PUBLIC_REDIRECT_WINDOW_ORDER_INVALID"
  );
});

test("redirect safety service checks occupied routes and bidirectional chains", () => {
  assert.match(serviceSource, /STATIC_PUBLIC_PATHS\.has\(snapshot\.source_path\)/);
  assert.match(serviceSource, /PUBLIC_REDIRECT_STATIC_ROUTE_COLLISION/);
  assert.match(serviceSource, /PUBLIC_REDIRECT_PAGE_COLLISION/);
  assert.match(serviceSource, /PUBLIC_REDIRECT_CHAIN_BLOCKED/);
  assert.match(serviceSource, /PUBLIC_REDIRECT_INBOUND_CHAIN_BLOCKED/);
  assert.match(serviceSource, /rule_status = 'active'/);
  assert.match(serviceSource, /activate_at IS NULL OR activate_at <= UTC_TIMESTAMP\(\)/);
  assert.match(serviceSource, /expires_at IS NULL OR expires_at > UTC_TIMESTAMP\(\)/);
  assert.doesNotMatch(serviceSource, /child_process|exec\(|spawn\(|eval\(/);
});

test("redirect manager separates editor drafts from publisher activation", () => {
  assert.match(studioRoutes, /router\.post\([\s\S]*public_navigation\.manage/);
  assert.match(studioRoutes, /router\.put\([\s\S]*public_navigation\.manage/);
  assert.match(studioRoutes, /\/activate[\s\S]*public_content\.publish/);
  assert.match(studioRoutes, /\/deactivate[\s\S]*public_content\.publish/);
  assert.match(studioRoutes, /\/archive[\s\S]*public_navigation\.manage/);
  assert.match(studioAggregator, /"\/navigation\/redirects", contentStudioRedirectRoutes/);
  assert.ok(
    studioAggregator.indexOf('"/navigation/redirects"') <
      studioAggregator.indexOf('"/navigation", contentStudioNavigationRoutes')
  );
});

test("anonymous resolver is read-only feature-gated and readiness requires the table", () => {
  assert.match(publicRoutes, /router\.get\("\/resolve"/);
  assert.doesNotMatch(publicRoutes, /router\.(?:post|put|patch|delete)/);
  assert.match(systemRoutes, /"\/public\/redirects"[\s\S]*requireFeature\("publicWebsite"\)/);
  assert.match(systemRoutes, /"public_redirect_rules"/);
});

test("redirect migration is additive and seeds no redirect rules", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public_redirect_rules/);
  assert.match(migrationSource, /UNIQUE KEY uq_public_redirect_source_path/);
  assert.match(migrationSource, /CHECK \(redirect_status IN \(301,302,307,308\)\)/);
  assert.doesNotMatch(migrationSource, /INSERT\s+INTO\s+public_redirect_rules/i);
  assert.doesNotMatch(migrationSource, /\b(?:DROP|TRUNCATE)\b/i);
});
