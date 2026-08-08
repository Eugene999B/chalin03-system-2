"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ALLOWED_SECTION_TYPES,
  ContentStudioError,
  assertJsonSize,
  normalizePageKey,
  normalizeSectionType,
  normalizeSlug,
  sanitizeSections,
  sanitizeVersionInput,
  validatePublishingWindow,
} = require("../services/contentStudioPageService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioPageService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);
const coreRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioCoreRoutes.js"),
  "utf8"
);
const systemRouteSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/systemRoutes.js"),
  "utf8"
);

test("page and section identifiers use controlled URL-safe formats", () => {
  assert.equal(normalizePageKey("Company History"), "company_history");
  assert.equal(normalizePageKey("../../admin"), null);
  assert.equal(normalizeSlug("company-history"), "company-history");
  assert.equal(normalizeSlug("Company History"), null);
  assert.equal(normalizeSectionType("Hero"), "hero");
  assert.equal(normalizeSectionType("unknown-widget"), null);
  assert.ok(ALLOWED_SECTION_TYPES.includes("hero"));
  assert.ok(ALLOWED_SECTION_TYPES.includes("equipment"));
  assert.ok(ALLOWED_SECTION_TYPES.includes("form"));
});

test("section sanitizer rejects unsupported types and duplicate keys", () => {
  assert.throws(
    () =>
      sanitizeSections([
        {
          key: "hero",
          type: "unknown-widget",
        },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "UNSUPPORTED_PAGE_SECTION"
  );

  assert.throws(
    () =>
      sanitizeSections([
        { key: "intro", type: "text" },
        { key: "intro", type: "image" },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "DUPLICATE_PAGE_SECTION_KEY"
  );
});

test("page drafts enforce JSON and section size ceilings", () => {
  assert.throws(
    () => assertJsonSize({ text: "x".repeat(260000) }, "Page body"),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "CONTENT_JSON_TOO_LARGE"
  );

  assert.throws(
    () =>
      sanitizeSections(
        Array.from({ length: 81 }, (_, index) => ({
          key: `section_${index + 1}`,
          type: "text",
        }))
      ),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "TOO_MANY_PAGE_SECTIONS"
  );
});

test("version input requires a title and normalizes page-builder sections", () => {
  assert.throws(
    () => sanitizeVersionInput({ sections: [] }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "PAGE_TITLE_REQUIRED"
  );

  const version = sanitizeVersionInput({
    title: "About Chalin 03",
    body: { introduction: "Company information" },
    settings: { theme: "corporate" },
    sections: [
      {
        key: "hero",
        type: "hero",
        heading: "Built for serious work",
        content: { cta: "Explore our businesses" },
      },
    ],
  });

  assert.equal(version.title, "About Chalin 03");
  assert.equal(version.sections.length, 1);
  assert.equal(version.sections[0].section_key, "hero");
  assert.equal(version.sections[0].section_type, "hero");
});

test("publishing window prevents expiry before publication", () => {
  assert.throws(
    () =>
      validatePublishingWindow(
        new Date("2026-08-10T10:00:00.000Z"),
        new Date("2026-08-10T09:00:00.000Z")
      ),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "INVALID_PUBLISHING_WINDOW"
  );

  assert.doesNotThrow(() =>
    validatePublishingWindow(
      new Date("2026-08-10T10:00:00.000Z"),
      new Date("2026-08-11T10:00:00.000Z")
    )
  );
});

test("page writes are transactional and include both content and platform audit evidence", () => {
  assert.match(serviceSource, /beginTransaction\(\)/);
  assert.match(serviceSource, /commit\(\)/);
  assert.match(serviceSource, /rollback\(\)/);
  assert.match(serviceSource, /public_content_audit_log/);
  assert.match(serviceSource, /writeAuditEvent/);
  assert.match(serviceSource, /PUBLIC_PAGE_CREATED/);
  assert.match(serviceSource, /PUBLIC_PAGE_VERSION_UPDATED/);
  assert.match(serviceSource, /PUBLIC_PAGE_PUBLISHED/);
  assert.match(serviceSource, /PUBLIC_PAGE_VERSION_RESTORED/);
});

test("review workflow blocks self approval and publishing without approved evidence", () => {
  assert.match(serviceSource, /CONTENT_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /Number\(approval\.requested_by\) === Number\(user\?\.id\)/);
  assert.match(serviceSource, /approval_status = 'approved'/);
  assert.match(serviceSource, /APPROVED_REVIEW_REQUIRED/);
  assert.match(serviceSource, /version_status !== "approved"/);
  assert.match(serviceSource, /version_status = 'superseded'/);
});

test("Content Studio scoped router preserves distinct capability permissions", () => {
  const requiredPermissions = [
    "public_content.view",
    "public_content.create",
    "public_content.edit",
    "public_content.submit",
    "public_content.review",
    "public_content.approve",
    "public_content.publish",
    "public_content.restore_version",
    "public_content.archive",
  ];

  assert.match(routeSource, /requireContentStudioRouteScope/);
  assert.match(routeSource, /router\.use\(requireContentStudioRouteScope\)/);
  assert.match(routeSource, /contentStudioCoreRoutes/);

  for (const permission of requiredPermissions) {
    assert.match(coreRouteSource, new RegExp(permission.replace(".", "\\.")));
  }

  assert.match(coreRouteSource, /Cache-Control.*no-store/s);
});

test("Content Studio is feature-gated and session-gated before route execution", () => {
  assert.match(
    systemRouteSource,
    /router\.use\([\s\S]*?"\/content-studio"[\s\S]*?requireFeature\("contentStudio"\)[\s\S]*?requireAuth[\s\S]*?requireContentStudioSession[\s\S]*?contentStudioRoutes/
  );
});
