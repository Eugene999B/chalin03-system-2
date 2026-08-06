"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ContentStudioError } = require("../services/contentStudioPageService");
const {
  EQUIPMENT_AVAILABILITY,
  PORTFOLIO_KINDS,
  PROJECT_STATUSES,
  configFor,
  normalizeDateOnly,
  normalizeMoney,
  safeHttpsUrl,
  sanitizeEquipment,
  sanitizeLeadership,
  sanitizeProject,
  sanitizeProjectGallery,
} = require("../services/contentStudioPortfolioService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = [
  "contentStudioPortfolioSchema.js",
  "contentStudioPortfolioStore.js",
  "contentStudioPortfolioDraftWorkflow.js",
  "contentStudioPortfolioReviewWorkflow.js",
  "contentStudioPortfolioPublishWorkflow.js",
]
  .map((fileName) =>
    fs.readFileSync(path.join(repoRoot, "backend/services", fileName), "utf8")
  )
  .join("\n");
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioPortfolioRoutes.js"),
  "utf8"
);
const aggregatorSource = fs.readFileSync(
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

test("portfolio manager supports only the three approved public content kinds", () => {
  assert.deepEqual(PORTFOLIO_KINDS, ["leadership", "project", "equipment"]);
  assert.equal(configFor("leadership").table, "public_leadership_profiles");
  assert.equal(configFor("project").table, "public_projects");
  assert.equal(configFor("equipment").table, "public_equipment_catalogue");
  assert.throws(
    () => configFor("users"),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "UNSUPPORTED_PORTFOLIO_KIND"
  );
});

test("leadership profiles require identity and safe HTTPS or contact links", () => {
  const profile = sanitizeLeadership({
    profile_key: "managing_director",
    slug: "managing-director",
    full_name: "Ama Mensah",
    position_title: "Managing Director",
    social_links: {
      linkedin: "https://www.linkedin.com/in/ama",
      email: "mailto:ama@example.com",
    },
  });
  assert.equal(profile.full_name, "Ama Mensah");
  assert.equal(profile.social_links.email, "mailto:ama@example.com");
  assert.equal(safeHttpsUrl("http://example.com"), null);
  assert.equal(safeHttpsUrl("javascript:alert(1)"), null);
  assert.throws(
    () =>
      sanitizeLeadership({
        profile_key: "director",
        slug: "director",
        full_name: "A",
        position_title: "Director",
        social_links: { website: "http://unsafe.example" },
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "INVALID_LEADERSHIP_LINK"
  );
});

test("project dates, statuses and gallery identities are validated", () => {
  assert.deepEqual(PROJECT_STATUSES, [
    "planned",
    "active",
    "paused",
    "completed",
    "cancelled",
  ]);
  assert.equal(normalizeDateOnly("2026-08-06", "Date"), "2026-08-06");
  assert.throws(
    () => normalizeDateOnly("2026-02-31", "Date"),
    /valid calendar date/i
  );
  assert.throws(
    () =>
      sanitizeProject({
        project_key: "mine_one",
        slug: "mine-one",
        title: "Mine One",
        start_date: "2026-08-10",
        end_date: "2026-08-09",
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "INVALID_PROJECT_DATE_RANGE"
  );
  assert.throws(
    () =>
      sanitizeProjectGallery([
        { media_asset_id: 2, role: "gallery" },
        { media_asset_id: 2, role: "gallery" },
      ]),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "DUPLICATE_PROJECT_GALLERY_MEDIA"
  );
});

test("equipment publication validates price, year, currency and internal references", () => {
  assert.ok(EQUIPMENT_AVAILABILITY.includes("available"));
  assert.equal(normalizeMoney("1900.456"), 1900.46);
  assert.throws(() => normalizeMoney(-1), /non-negative amount/i);

  const item = sanitizeEquipment({
    equipment_key: "cat_320",
    slug: "cat-320",
    name: "CAT 320 Excavator",
    model_year: 2025,
    currency_code: "ghs",
    display_price: 100000,
    show_price: true,
    internal_reference_type: "fleet_asset",
    internal_reference_id: 9,
  });
  assert.equal(item.currency_code, "GHS");
  assert.equal(item.show_price, true);
  assert.equal(item.internal_reference_id, 9);

  assert.throws(
    () =>
      sanitizeEquipment({
        equipment_key: "bad_ref",
        slug: "bad-ref",
        name: "Bad Reference",
        internal_reference_type: "fleet_asset",
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "EQUIPMENT_REFERENCE_ID_REQUIRED"
  );
  assert.throws(
    () =>
      sanitizeEquipment({
        equipment_key: "price_missing",
        slug: "price-missing",
        name: "Price Missing",
        show_price: true,
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "EQUIPMENT_PUBLIC_PRICE_REQUIRED"
  );
});

test("portfolio approval workflow uses the real generic-version foreign key", () => {
  assert.match(migrationSource, /content_version_id BIGINT UNSIGNED NULL/);
  assert.match(serviceSource, /content_version_id = \?/);
  assert.match(serviceSource, /entity_id, content_version_id, request_type/);
  assert.doesNotMatch(serviceSource, /metadata_json/);
  assert.doesNotMatch(serviceSource, /JSON_EXTRACT/);
  assert.doesNotMatch(
    serviceSource,
    /public_content_versions[\s\S]{0,250}(approved_by|approved_at|published_by|published_at)/
  );
});

test("publishing requires independent approval and public-ready media", () => {
  assert.match(serviceSource, /CONTENT_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /CONTENT_APPROVAL_ASSIGNED_ELSEWHERE/);
  assert.match(serviceSource, /APPROVED_REVIEW_REQUIRED/);
  assert.match(serviceSource, /visibility !== "public"/);
  assert.match(serviceSource, /processing_status !== "ready"/);
  assert.match(serviceSource, /PUBLIC_MEDIA_NOT_READY/);
  assert.match(serviceSource, /SCHEDULED_LIVE_UPDATE_BLOCKED/);
});

test("project gallery changes are isolated in versions and applied only during publication", () => {
  assert.match(serviceSource, /snapshot_json/);
  assert.match(serviceSource, /replaceProjectGallery/);
  assert.match(
    serviceSource,
    /DELETE FROM public_project_media WHERE project_id = \?/
  );
  assert.match(serviceSource, /INSERT INTO public_project_media/);
  assert.match(
    serviceSource,
    /applyPublishedSnapshot[\s\S]*replaceProjectGallery/
  );
});

test("restoration creates an unscheduled draft and archive cancels pending reviews", () => {
  assert.match(serviceSource, /snapshot\.publish_at = null/);
  assert.match(serviceSource, /snapshot\.expires_at = null/);
  assert.match(serviceSource, /version_restored_as_draft/);
  assert.match(serviceSource, /approval_status = 'cancelled'/);
  assert.match(
    serviceSource,
    /version_status IN \('draft','in_review','approved','published'\)/
  );
});

test("portfolio routes separate reading, editing, approval, publishing and restoration", () => {
  const permissions = [
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
  for (const permission of permissions) {
    assert.match(routeSource, new RegExp(permission.replace(".", "\\.")));
  }
  assert.match(routeSource, /Cache-Control.*no-store/s);
  assert.match(
    aggregatorSource,
    /router\.use\("\/portfolio", contentStudioPortfolioRoutes\)/
  );
});
