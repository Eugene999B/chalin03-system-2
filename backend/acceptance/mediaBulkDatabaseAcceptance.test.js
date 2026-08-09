"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  bulkArchiveMediaAssets,
  bulkUpdateMediaAssets,
} = require("../services/contentStudioMediaBulkService");

const user = Object.freeze({ id: 1, full_name: "Media Cleanup Acceptance" });
const req = Object.freeze({ requestId: "media-cleanup-db-acceptance", headers: {} });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const created = { assetIds: [], folderIds: [], pageId: null };

async function insertFolder(name) {
  const [result] = await pool.query(
    `INSERT INTO public_media_folders
       (folder_key, name, description, is_active, created_by, updated_by)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [`media_cleanup_${suffix}_${name.toLowerCase()}`, `Cleanup ${name}`, "Atomic cleanup acceptance", user.id, user.id]
  );
  const id = Number(result.insertId);
  created.folderIds.push(id);
  return id;
}

async function insertAsset(name, { altText = "Acceptance media", visibility = "private" } = {}) {
  const assetKey = `cleanup_${suffix}_${name.toLowerCase()}`;
  const [result] = await pool.query(
    `INSERT INTO public_media_assets (
       folder_id, asset_key, storage_provider, storage_key, public_url,
       original_filename, display_name, media_type, mime_type, file_extension,
       file_size_bytes, width_pixels, height_pixels, alt_text, checksum_sha256,
       visibility, processing_status, metadata_json, is_active, uploaded_by
     ) VALUES (
       NULL, ?, 'acceptance', ?, ?, ?, ?, 'image', 'image/webp', 'webp',
       2048, 1200, 800, ?, ?, ?, 'ready', JSON_OBJECT('acceptance', true), 1, ?
     )`,
    [
      assetKey,
      `acceptance/${assetKey}.webp`,
      `https://media.example.com/${assetKey}.webp`,
      `${assetKey}.webp`,
      `Cleanup ${name}`,
      altText || null,
      "a".repeat(60) + String(created.assetIds.length).padStart(4, "0"),
      visibility,
      user.id,
    ]
  );
  const id = Number(result.insertId);
  created.assetIds.push(id);
  return id;
}

async function readAsset(id) {
  const [rows] = await pool.query(
    `SELECT id, folder_id, visibility, processing_status, is_active
     FROM public_media_assets WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0];
}

test(
  "Media Cleanup bulk metadata and archive are atomic against isolated MySQL",
  { timeout: 120000 },
  async () => {
    const [[databaseRow]] = await pool.query("SELECT DATABASE() AS database_name");
    assert.match(
      String(databaseRow?.database_name || ""),
      /^chalin_one_acceptance(?:_[a-z0-9_]+)?$/i
    );

    const sourceFolder = await insertFolder("Source");
    const targetFolder = await insertFolder("Target");
    const firstId = await insertAsset("First");
    const referencedId = await insertAsset("Referenced");
    const missingAltId = await insertAsset("MissingAlt", { altText: "" });

    await bulkUpdateMediaAssets({
      input: {
        asset_ids: [firstId, referencedId, missingAltId],
        folder_id: sourceFolder,
      },
      user,
      req,
    });
    assert.equal(Number((await readAsset(firstId)).folder_id), sourceFolder);
    assert.equal(Number((await readAsset(referencedId)).folder_id), sourceFolder);

    await bulkUpdateMediaAssets({
      input: {
        asset_ids: [firstId, referencedId],
        folder_id: targetFolder,
        visibility: "restricted",
      },
      user,
      req,
    });
    assert.equal(Number((await readAsset(firstId)).folder_id), targetFolder);
    assert.equal((await readAsset(firstId)).visibility, "restricted");
    assert.equal((await readAsset(referencedId)).visibility, "restricted");

    await assert.rejects(
      () =>
        bulkUpdateMediaAssets({
          input: {
            asset_ids: [firstId, missingAltId],
            visibility: "public",
          },
          user,
          req,
        }),
      (error) => error?.code === "PUBLIC_MEDIA_BULK_ALT_TEXT_REQUIRED"
    );
    // The first asset was eligible, but the second was not. Atomic validation
    // means the first asset must still retain its previous visibility.
    assert.equal((await readAsset(firstId)).visibility, "restricted");
    assert.equal((await readAsset(missingAltId)).visibility, "private");

    const [pageResult] = await pool.query(
      `INSERT INTO public_pages
         (page_key, slug, page_type, template_key, menu_title, publication_status,
          is_homepage, show_in_search, show_in_sitemap, created_by, updated_by)
       VALUES (?, ?, 'standard', 'standard', 'Media cleanup acceptance', 'draft',
               0, 0, 0, ?, ?)`,
      [`media_cleanup_${suffix}`, `media-cleanup-${suffix}`, user.id, user.id]
    );
    created.pageId = Number(pageResult.insertId);
    await pool.query(
      `INSERT INTO public_page_versions
         (page_id, version_number, version_status, title, robots_directive,
          primary_media_asset_id, change_summary, created_by)
       VALUES (?, 1, 'draft', 'Media cleanup acceptance', 'noindex,nofollow', ?,
               'Reference safety acceptance', ?)`,
      [created.pageId, referencedId, user.id]
    );

    await assert.rejects(
      () =>
        bulkArchiveMediaAssets({
          input: {
            asset_ids: [firstId, referencedId],
            reason: "Atomic archive should fail because one asset is referenced",
          },
          user,
          req,
        }),
      (error) => error?.code === "PUBLIC_MEDIA_IN_USE"
    );
    // The unused first asset must not be partially archived when the second
    // asset fails the exact reference check.
    assert.equal(Number((await readAsset(firstId)).is_active), 1);
    assert.notEqual((await readAsset(firstId)).processing_status, "archived");
    assert.equal(Number((await readAsset(referencedId)).is_active), 1);

    const archived = await bulkArchiveMediaAssets({
      input: {
        asset_ids: [firstId],
        reason: "Confirmed unused acceptance asset",
      },
      user,
      req,
    });
    assert.equal(archived.archived, 1);
    assert.equal(archived.storage_deleted, false);
    assert.equal(Number((await readAsset(firstId)).is_active), 0);
    assert.equal((await readAsset(firstId)).processing_status, "archived");
  }
);

test.after(async () => {
  try {
    if (created.pageId) {
      await pool.query("DELETE FROM public_pages WHERE id = ?", [created.pageId]);
    }
    if (created.assetIds.length) {
      await pool.query(
        `DELETE FROM public_media_assets WHERE id IN (${created.assetIds.map(() => "?").join(",")})`,
        created.assetIds
      );
    }
    if (created.folderIds.length) {
      await pool.query(
        `DELETE FROM public_media_folders WHERE id IN (${created.folderIds.map(() => "?").join(",")})`,
        created.folderIds
      );
    }
  } finally {
    await pool.end();
  }
});
