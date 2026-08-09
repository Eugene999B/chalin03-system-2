"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  matchesAdvancedFilters,
  normalizeLibraryFilters,
  orientationFor,
  publicReadyFor,
  sortAssets,
} = require("../services/contentStudioMediaLibraryService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaLibraryService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioMediaRoutes.js"),
  "utf8"
);
const archiveSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaArchiveService.js"),
  "utf8"
);

test("Media Library Pro normalizes advanced filters and caps pagination", () => {
  const filters = normalizeLibraryFilters({
    mediaType: "IMAGE",
    visibility: "PUBLIC",
    processingStatus: "ready",
    orientation: "portrait",
    usage: "unused",
    altStatus: "missing",
    readiness: "needs_attention",
    duplicate: "duplicate",
    minWidth: "800",
    maxWidth: "2000",
    sort: "largest",
    limit: 999,
    offset: -10,
  });
  assert.equal(filters.mediaType, "image");
  assert.equal(filters.visibility, "public");
  assert.equal(filters.processingStatus, "ready");
  assert.equal(filters.orientation, "portrait");
  assert.equal(filters.usage, "unused");
  assert.equal(filters.altStatus, "missing");
  assert.equal(filters.readiness, "needs_attention");
  assert.equal(filters.duplicate, "duplicate");
  assert.equal(filters.minWidth, 800);
  assert.equal(filters.maxWidth, 2000);
  assert.equal(filters.sort, "largest");
  assert.equal(filters.limit, 100);
  assert.equal(filters.offset, 0);
});

test("orientation and public readiness fail closed", () => {
  assert.equal(orientationFor({ width: 1600, height: 900 }), "landscape");
  assert.equal(orientationFor({ width: 900, height: 1600 }), "portrait");
  assert.equal(orientationFor({ width: 1000, height: 990 }), "square");
  assert.equal(orientationFor({}), "unknown");

  assert.equal(
    publicReadyFor({
      media_type: "image",
      processing_status: "ready",
      public_url: "https://media.example.com/item.webp",
      alt_text: "Excavator at a project site",
    }),
    true
  );
  assert.equal(
    publicReadyFor({
      media_type: "image",
      processing_status: "ready",
      public_url: "https://media.example.com/item.webp",
      alt_text: "",
    }),
    false
  );
  assert.equal(
    publicReadyFor({
      media_type: "video",
      processing_status: "ready",
      public_url: "http://example.com/video",
    }),
    false
  );
});

test("advanced filters distinguish usage duplicates dimensions and readiness", () => {
  const asset = {
    orientation: "landscape",
    in_use: false,
    has_alt_text: false,
    public_ready: false,
    is_duplicate: true,
    width: 1600,
    height: 900,
  };
  assert.equal(
    matchesAdvancedFilters(asset, {
      orientation: "landscape",
      usage: "unused",
      altStatus: "missing",
      readiness: "needs_attention",
      duplicate: "duplicate",
      minWidth: 1200,
      maxWidth: 2000,
      minHeight: null,
      maxHeight: null,
    }),
    true
  );
  assert.equal(
    matchesAdvancedFilters(asset, {
      orientation: "portrait",
      usage: "",
      altStatus: "",
      readiness: "",
      duplicate: "",
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    }),
    false
  );
});

test("media sorting supports storage and dimension triage", () => {
  const assets = [
    { id: 1, display_name: "B", file_size_bytes: 100, width: 800, created_at: "2026-08-01T00:00:00Z" },
    { id: 2, display_name: "A", file_size_bytes: 500, width: 1600, created_at: "2026-08-02T00:00:00Z" },
  ];
  assert.deepEqual(sortAssets(assets, "largest").map((item) => item.id), [2, 1]);
  assert.deepEqual(sortAssets(assets, "width").map((item) => item.id), [2, 1]);
  assert.deepEqual(sortAssets(assets, "name").map((item) => item.id), [2, 1]);
  assert.deepEqual(sortAssets(assets, "oldest").map((item) => item.id), [1, 2]);
});

test("media intelligence indexes current and versioned references without weakening archive guard", () => {
  for (const marker of [
    "public_page_versions",
    "public_page_sections",
    "public_project_media",
    "public_content_versions",
    "JSON_TABLE",
    "usage_count",
    "duplicate_count",
    "public_ready",
    "missing_alt",
    "unused",
  ]) {
    assert.match(serviceSource, new RegExp(marker));
  }
  assert.match(routeSource, /router\.get\(\s*"\/intelligence"/s);
  assert.match(routeSource, /public_media\.view/);
  assert.match(routeSource, /listMediaLibraryAssets/);
  assert.match(archiveSource, /assertMediaUnused/);
  assert.doesNotMatch(serviceSource, /DELETE FROM|deleteObject\(/);
});
