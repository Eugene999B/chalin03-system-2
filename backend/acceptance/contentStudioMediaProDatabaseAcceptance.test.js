"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  getMediaLibraryIntelligence,
  listMediaLibraryAssets,
} = require("../services/contentStudioMediaLibraryService");

async function insertAsset({ key, checksum, altText, size = 1000, width = 1200, height = 800 }) {
  const [result] = await pool.query(
    `INSERT INTO public_media_assets (
       asset_key,
       storage_provider,
       storage_key,
       public_url,
       original_filename,
       display_name,
       media_type,
       mime_type,
       file_extension,
       file_size_bytes,
       width_pixels,
       height_pixels,
       alt_text,
       checksum_sha256,
       visibility,
       processing_status,
       is_active,
       uploaded_by
     ) VALUES (?, 'acceptance', ?, ?, ?, ?, 'image', 'image/webp', 'webp', ?, ?, ?, ?, ?, 'private', 'ready', 1, 1)`,
    [
      key,
      `acceptance/${key}.webp`,
      `https://media.example.com/${key}.webp`,
      `${key}.webp`,
      key,
      size,
      width,
      height,
      altText || null,
      checksum,
    ]
  );
  return Number(result.insertId);
}

test(
  "Media Library Pro intelligence works against isolated MySQL schema",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    const usedAssetId = await insertAsset({
      key: "media_pro_used",
      checksum: "1".repeat(64),
      altText: "Acceptance project image",
      size: 1500,
      width: 1600,
      height: 900,
    });
    const unusedMissingAltId = await insertAsset({
      key: "media_pro_unused",
      checksum: "2".repeat(64),
      altText: "",
      size: 2500,
      width: 900,
      height: 1600,
    });
    const duplicateOneId = await insertAsset({
      key: "media_pro_duplicate_one",
      checksum: "3".repeat(64),
      altText: "Duplicate one",
      size: 3500,
    });
    const duplicateTwoId = await insertAsset({
      key: "media_pro_duplicate_two",
      checksum: "3".repeat(64),
      altText: "Duplicate two",
      size: 3600,
    });

    const [pageResult] = await pool.query(
      `INSERT INTO public_pages (
         page_key, slug, page_type, template_key, menu_title,
         publication_status, created_by, updated_by
       ) VALUES (
         'media_pro_acceptance_page', 'media-pro-acceptance-page',
         'standard', 'standard', 'Media Pro Acceptance',
         'draft', 1, 1
       )`
    );
    const pageId = Number(pageResult.insertId);
    await pool.query(
      `INSERT INTO public_page_versions (
         page_id, version_number, version_status, title,
         primary_media_asset_id, created_by
       ) VALUES (?, 1, 'draft', 'Media Pro Acceptance', ?, 1)`,
      [pageId, usedAssetId]
    );

    const intelligence = await getMediaLibraryIntelligence();
    assert.ok(Number(intelligence.summary.total) >= 4);
    assert.ok(Number(intelligence.summary.used) >= 1);
    assert.ok(Number(intelligence.summary.unused) >= 1);
    assert.ok(Number(intelligence.summary.missing_alt) >= 1);
    assert.ok(Number(intelligence.summary.duplicate_groups) >= 1);
    assert.ok(Number(intelligence.summary.duplicate_assets) >= 2);

    const unused = await listMediaLibraryAssets({
      usage: "unused",
      search: "media_pro_",
      limit: 100,
    });
    const unusedIds = new Set(unused.items.map((item) => Number(item.id)));
    assert.equal(unusedIds.has(unusedMissingAltId), true);
    assert.equal(unusedIds.has(usedAssetId), false);

    const used = await listMediaLibraryAssets({
      usage: "used",
      search: "media_pro_",
      limit: 100,
    });
    assert.equal(
      used.items.some((item) => Number(item.id) === usedAssetId && Number(item.usage_count) > 0),
      true
    );

    const missingAlt = await listMediaLibraryAssets({
      mediaType: "image",
      altStatus: "missing",
      search: "media_pro_",
      limit: 100,
    });
    assert.equal(
      missingAlt.items.some((item) => Number(item.id) === unusedMissingAltId),
      true
    );

    const duplicates = await listMediaLibraryAssets({
      duplicate: "duplicate",
      search: "media_pro_duplicate",
      limit: 100,
    });
    assert.equal(duplicates.items.length, 2);
    assert.deepEqual(
      new Set(duplicates.items.map((item) => Number(item.id))),
      new Set([duplicateOneId, duplicateTwoId])
    );
    assert.equal(duplicates.items.every((item) => Number(item.duplicate_count) === 2), true);
  }
);

test.after(async () => {
  await pool.end();
});
