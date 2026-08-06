"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ContentStudioError } = require("../services/contentStudioPageService");
const {
  ANNOUNCEMENT_STYLES,
  NEWSROOM_KINDS,
  configFor,
  safeAnnouncementUrl,
  sanitizeAnnouncement,
  sanitizeArticle,
} = require("../services/contentStudioNewsroomSchema");

const repoRoot = path.resolve(__dirname, "../..");
const schemaSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioNewsroomSchema.js"),
  "utf8"
);
const serviceSource = [
  "contentStudioNewsroomStore.js",
  "contentStudioNewsroomDraftWorkflow.js",
  "contentStudioNewsroomReviewWorkflow.js",
  "contentStudioNewsroomPublishWorkflow.js",
  "contentStudioNewsCategoryService.js",
]
  .map((fileName) =>
    fs.readFileSync(path.join(repoRoot, "backend/services", fileName), "utf8")
  )
  .join("\n");
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioNewsroomRoutes.js"),
  "utf8"
);
const aggregatorSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);
const mediaUsageSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaUsageService.js"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260805_chalin_one_public_content_foundation.sql"
  ),
  "utf8"
);

test("Newsroom supports only articles and announcements", () => {
  assert.deepEqual(NEWSROOM_KINDS, ["article", "announcement"]);
  assert.equal(configFor("article").table, "public_news_articles");
  assert.equal(configFor("announcement").table, "public_announcements");
  assert.deepEqual(ANNOUNCEMENT_STYLES, [
    "info",
    "success",
    "warning",
    "urgent",
    "promotion",
  ]);
  assert.throws(
    () => configFor("users"),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "UNSUPPORTED_NEWSROOM_KIND"
  );
});

test("announcement URLs allow only safe relative or credential-free HTTPS links", () => {
  assert.equal(safeAnnouncementUrl("/contact"), "/contact");
  assert.equal(
    safeAnnouncementUrl("https://www.chalin03.com/contact"),
    "https://www.chalin03.com/contact"
  );
  assert.equal(safeAnnouncementUrl("javascript:alert(1)"), null);
  assert.equal(safeAnnouncementUrl("http://example.com"), null);
  assert.equal(safeAnnouncementUrl("//evil.example/path"), null);
  assert.equal(safeAnnouncementUrl("https://user:pass@example.com"), null);
});

test("announcement link labels and URLs are atomic and styles are controlled", () => {
  assert.throws(
    () =>
      sanitizeAnnouncement({
        announcement_key: "notice",
        title: "Notice",
        link_url: "/contact",
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "ANNOUNCEMENT_LINK_INCOMPLETE"
  );
  assert.throws(
    () =>
      sanitizeAnnouncement({
        announcement_key: "notice",
        title: "Notice",
        display_style: "script",
      }),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "INVALID_ANNOUNCEMENT_STYLE"
  );
});

test("news article identity SEO and featured state are normalized", () => {
  const article = sanitizeArticle({
    article_key: "new_branch",
    slug: "new-branch",
    title: "New Branch",
    category_id: 2,
    featured_media_asset_id: 8,
    is_featured: "true",
    seo_title: "New Chalin 03 Branch",
  });
  assert.equal(article.article_key, "new_branch");
  assert.equal(article.slug, "new-branch");
  assert.equal(article.category_id, 2);
  assert.equal(article.featured_media_asset_id, 8);
  assert.equal(article.is_featured, true);
  assert.equal(article.seo_title, "New Chalin 03 Branch");
});

test("category archive checks live articles and version snapshots", () => {
  assert.match(serviceSource, /public_news_articles/);
  assert.match(serviceSource, /publication_status <> 'archived'/);
  assert.match(serviceSource, /entity_type = 'news_article'/);
  assert.match(
    serviceSource,
    /JSON_CONTAINS\(snapshot_json, JSON_OBJECT\('category_id', \?\)\)/
  );
  assert.match(serviceSource, /NEWS_CATEGORY_IN_USE/);
});

test("Newsroom approval uses the exact generic content version foreign key", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public_news_articles/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public_announcements/);
  assert.match(migrationSource, /content_version_id BIGINT UNSIGNED NULL/);
  assert.match(serviceSource, /content_version_id = \?/);
  assert.match(serviceSource, /entity_id, content_version_id, request_type/);
  assert.doesNotMatch(serviceSource, /metadata_json/);
  assert.doesNotMatch(serviceSource, /JSON_EXTRACT/);
});

test("publication requires independent approval and ready public news media", () => {
  assert.match(serviceSource, /CONTENT_SELF_APPROVAL_BLOCKED/);
  assert.match(serviceSource, /CONTENT_APPROVAL_ASSIGNED_ELSEWHERE/);
  assert.match(serviceSource, /APPROVED_REVIEW_REQUIRED/);
  assert.match(serviceSource, /visibility !== "public"/);
  assert.match(serviceSource, /processing_status !== "ready"/);
  assert.match(serviceSource, /NEWS_FEATURED_MEDIA_INVALID/);
  assert.match(serviceSource, /NEWSROOM_SCHEDULING_NOT_READY/);
  assert.match(mediaUsageSource, /news_article_version_snapshot/);
  assert.match(mediaUsageSource, /entity_type = 'news_article'/);
});

test("restore creates unscheduled drafts and archive cancels pending approvals", () => {
  assert.match(serviceSource, /snapshot\.publish_at = null/);
  assert.match(serviceSource, /snapshot\.expires_at = null/);
  assert.match(serviceSource, /version_restored_as_draft/);
  assert.match(serviceSource, /approval_status = 'cancelled'/);
  assert.doesNotMatch(serviceSource, /DELETE FROM public_news_articles/);
  assert.doesNotMatch(serviceSource, /DELETE FROM public_announcements/);
});

test("Newsroom routes separate categories editing review approval and publishing", () => {
  const permissions = [
    "public_content.view",
    "public_content.create",
    "public_content.edit",
    "public_content.review",
    "public_content.approve",
    "public_content.submit",
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
    /router\.use\("\/newsroom", contentStudioNewsroomRoutes\)/
  );
  assert.doesNotMatch(schemaSource, /eval\(|new Function/);
});
