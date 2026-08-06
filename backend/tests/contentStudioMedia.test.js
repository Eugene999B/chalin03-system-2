"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const {
  PublicMediaStorageError,
  getStorageConfig,
  publicUrl,
  safeStorageKey,
  signR2Request,
  validateStorageConfig,
} = require("../services/publicMediaStorageService");
const {
  ALLOWED_IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  generateImageVariants,
  isSafeHttpsPublicUrl,
  normalizeVisibility,
  safeExternalVideoUrl,
} = require("../services/contentStudioMediaService");
const {
  MAX_FOLDER_DEPTH,
  normalizeFolderKey,
} = require("../services/contentStudioMediaFolderService");

const repoRoot = path.resolve(__dirname, "../..");
const storageSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicMediaStorageService.js"),
  "utf8"
);
const mediaSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaService.js"),
  "utf8"
);
const usageSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaUsageService.js"),
  "utf8"
);
const folderSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaFolderService.js"),
  "utf8"
);
const archiveSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaArchiveService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioMediaRoutes.js"),
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

test("media storage keys reject traversal and control characters", () => {
  assert.equal(
    safeStorageKey("public-media/images/item/w480.webp"),
    "public-media/images/item/w480.webp"
  );
  assert.throws(
    () => safeStorageKey("../../users.json"),
    (error) =>
      error instanceof PublicMediaStorageError &&
      error.code === "UNSAFE_MEDIA_STORAGE_KEY"
  );
  assert.throws(() => safeStorageKey("media/\u0000file"), /Unsafe/);
});

test("production media storage fails closed unless R2 is completely configured", () => {
  assert.throws(
    () =>
      validateStorageConfig({
        NODE_ENV: "production",
        PUBLIC_MEDIA_STORAGE_PROVIDER: "local",
      }),
    (error) =>
      error instanceof PublicMediaStorageError &&
      error.code === "PUBLIC_MEDIA_STORAGE_NOT_CONFIGURED"
  );

  const env = {
    NODE_ENV: "production",
    PUBLIC_MEDIA_STORAGE_PROVIDER: "r2",
    CLOUDFLARE_R2_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_R2_BUCKET: "chalin03-public-media",
    CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key",
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-key",
    PUBLIC_MEDIA_PUBLIC_BASE_URL: "https://media.chalin03.com",
  };
  const config = validateStorageConfig(env);
  assert.equal(config.provider, "r2");
  assert.equal(config.publicBaseUrl, "https://media.chalin03.com");

  const localConfig = getStorageConfig({
    NODE_ENV: "development",
    PUBLIC_MEDIA_STORAGE_PROVIDER: "local",
    PUBLIC_MEDIA_PUBLIC_BASE_URL: "https://media.example.com",
  });
  assert.equal(publicUrl(localConfig, "images/test.webp"), null);
});

test("R2 signing is deterministic and credential values never enter the URL", () => {
  const config = validateStorageConfig({
    NODE_ENV: "production",
    PUBLIC_MEDIA_STORAGE_PROVIDER: "r2",
    CLOUDFLARE_R2_ACCOUNT_ID: "b".repeat(32),
    CLOUDFLARE_R2_BUCKET: "chalin03-public-media",
    CLOUDFLARE_R2_ACCESS_KEY_ID: "ACCESS123",
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: "SECRET456",
    PUBLIC_MEDIA_PUBLIC_BASE_URL: "https://media.chalin03.com",
  });
  const first = signR2Request({
    config,
    method: "PUT",
    storageKey: "public-media/images/test/w480.webp",
    body: Buffer.from("image"),
    contentType: "image/webp",
    now: new Date("2026-08-06T08:00:00.000Z"),
  });
  const second = signR2Request({
    config,
    method: "PUT",
    storageKey: "public-media/images/test/w480.webp",
    body: Buffer.from("image"),
    contentType: "image/webp",
    now: new Date("2026-08-06T08:00:00.000Z"),
  });
  assert.deepEqual(first, second);
  assert.match(first.url, /^https:\/\/b{32}\.r2\.cloudflarestorage\.com\//);
  assert.doesNotMatch(first.url, /ACCESS123|SECRET456/);
  assert.match(first.headers.authorization, /^AWS4-HMAC-SHA256 Credential=ACCESS123\//);
  assert.equal(first.headers["x-amz-date"], "20260806T080000Z");
});

test("image processing accepts only decoded JPEG PNG or WebP and re-encodes WebP", async () => {
  assert.deepEqual(ALLOWED_IMAGE_FORMATS, ["jpeg", "png", "webp"]);
  assert.equal(MAX_IMAGE_BYTES, 12 * 1024 * 1024);
  assert.equal(MAX_IMAGE_PIXELS, 40_000_000);

  const onePixelPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 40, g: 80, b: 120, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const variants = await generateImageVariants(onePixelPng, "img_test");
  assert.equal(variants.length, 1);
  assert.equal(variants[0].mime_type, "image/webp");
  assert.equal(variants[0].width, 1);
  assert.match(variants[0].storage_key, /public-media\/images\/img_test\/w1\.webp/);
});

test("external video and public URL validation are HTTPS and host allowlisted", () => {
  assert.equal(
    safeExternalVideoUrl("https://www.youtube.com/watch?v=abc", {}),
    "https://www.youtube.com/watch?v=abc"
  );
  assert.equal(safeExternalVideoUrl("http://youtube.com/watch?v=abc", {}), null);
  assert.equal(safeExternalVideoUrl("https://evil.example/video", {}), null);
  assert.equal(
    safeExternalVideoUrl("https://video.company.example/item", {
      PUBLIC_MEDIA_VIDEO_HOSTS: "company.example",
    }),
    "https://video.company.example/item"
  );
  assert.equal(isSafeHttpsPublicUrl("https://media.chalin03.com/x.webp"), true);
  assert.equal(isSafeHttpsPublicUrl("http://media.chalin03.com/x.webp"), false);
  assert.equal(isSafeHttpsPublicUrl("https://user:pass@example.com/x"), false);
  assert.equal(normalizeVisibility("PUBLIC"), "public");
  assert.equal(normalizeVisibility("unknown"), "private");
});

test("media database writes match the Phase 2 asset schema and roll back stored variants", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public_media_assets/);
  assert.match(migrationSource, /storage_provider VARCHAR\(50\) NOT NULL/);
  assert.match(migrationSource, /metadata_json JSON NULL/);
  assert.match(mediaSource, /beginTransaction\(\)/);
  assert.match(mediaSource, /commit\(\)/);
  assert.match(mediaSource, /rollback\(\)/);
  assert.match(mediaSource, /for \(const item of uploaded\)/);
  assert.match(mediaSource, /deleteObject\(\{ storageKey: item\.storage_key/);
  assert.match(mediaSource, /checksum_sha256/);
  assert.match(mediaSource, /source_format: "decoded_and_reencoded"/);
  assert.match(mediaSource, /PUBLIC_MEDIA_ALT_TEXT_REQUIRED/);
});

test("asset usage covers every current public media relationship before archive", () => {
  const expectedTables = [
    "public_page_versions",
    "public_page_sections",
    "public_business_divisions",
    "public_leadership_profiles",
    "public_projects",
    "public_project_media",
    "public_equipment_catalogue",
    "public_news_articles",
    "public_job_vacancies",
    "public_tenders",
    "public_testimonials",
    "public_locations",
  ];
  for (const table of expectedTables) {
    assert.match(usageSource, new RegExp(table));
  }
  assert.match(usageSource, /PUBLIC_MEDIA_IN_USE/);
  assert.match(archiveSource, /assertMediaUnused/);
  assert.match(archiveSource, /storage_deleted: false/);
  assert.doesNotMatch(archiveSource, /deleteObject/);
});

test("media folders block cycles deep nesting children and non-empty archive", () => {
  assert.equal(normalizeFolderKey("Project Photos"), "project_photos");
  assert.equal(normalizeFolderKey("../../private"), null);
  assert.equal(MAX_FOLDER_DEPTH, 20);
  assert.match(folderSource, /PUBLIC_MEDIA_FOLDER_SELF_PARENT/);
  assert.match(folderSource, /PUBLIC_MEDIA_FOLDER_CYCLE/);
  assert.match(folderSource, /PUBLIC_MEDIA_FOLDER_DEPTH_EXCEEDED/);
  assert.match(folderSource, /PUBLIC_MEDIA_FOLDER_HAS_CHILDREN/);
  assert.match(folderSource, /PUBLIC_MEDIA_FOLDER_NOT_EMPTY/);
});

test("media routes use raw image bodies and separate view from management", () => {
  assert.match(routeSource, /express\.raw/);
  assert.match(routeSource, /image\/jpeg/);
  assert.match(routeSource, /image\/png/);
  assert.match(routeSource, /image\/webp/);
  assert.match(routeSource, /public_media\.view/);
  assert.match(routeSource, /public_media\.manage/);
  assert.match(routeSource, /PublicMediaStorageError/);
  assert.match(routeSource, /Cache-Control.*no-store/s);
  assert.match(
    aggregatorSource,
    /router\.use\("\/media", contentStudioMediaRoutes\)/
  );
});

test("storage implementation uses SigV4 and never shells out or executes user input", () => {
  assert.match(storageSource, /AWS4-HMAC-SHA256/);
  assert.match(storageSource, /r2\.cloudflarestorage\.com/);
  assert.doesNotMatch(storageSource, /child_process|exec\(|spawn\(/);
  assert.doesNotMatch(mediaSource, /eval\(|new Function/);
});
