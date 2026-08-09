"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAX_BULK_MEDIA_ASSETS,
  normalizeAssetIds,
  normalizeBulkUpdate,
} = require("../services/contentStudioMediaBulkService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioMediaBulkService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioMediaRoutes.js"),
  "utf8"
);

test("bulk media identifiers are deduplicated and strictly capped", () => {
  assert.equal(MAX_BULK_MEDIA_ASSETS, 50);
  assert.deepEqual(normalizeAssetIds([3, "3", 2, 0, -1, "bad"]), [3, 2]);
  assert.throws(() => normalizeAssetIds([]), (error) => error?.code === "PUBLIC_MEDIA_BULK_IDS_REQUIRED");
  assert.throws(
    () => normalizeAssetIds(Array.from({ length: 51 }, (_, index) => index + 1)),
    (error) => error?.code === "PUBLIC_MEDIA_BULK_LIMIT_EXCEEDED"
  );
});

test("bulk metadata accepts only explicit governed folder or visibility changes", () => {
  assert.throws(
    () => normalizeBulkUpdate({}),
    (error) => error?.code === "PUBLIC_MEDIA_BULK_CHANGE_REQUIRED"
  );
  assert.deepEqual(normalizeBulkUpdate({ folder_id: null }), {
    folderProvided: true,
    folderId: null,
    visibilityProvided: false,
    visibility: undefined,
  });
  assert.equal(normalizeBulkUpdate({ visibility: "PUBLIC" }).visibility, "public");
  assert.throws(
    () => normalizeBulkUpdate({ visibility: "internet" }),
    (error) => error?.code === "PUBLIC_MEDIA_VISIBILITY_INVALID"
  );
});

test("bulk cleanup is transactional fail-closed and never deletes stored objects", () => {
  assert.match(serviceSource, /beginTransaction\(\)/);
  assert.match(serviceSource, /FOR UPDATE/);
  assert.match(serviceSource, /assertCanBecomePublic/);
  assert.match(serviceSource, /PUBLIC_MEDIA_BULK_ALT_TEXT_REQUIRED/);
  assert.match(serviceSource, /for \(const asset of assets\) \{\s*await assertMediaUnused/s);
  assert.match(serviceSource, /await connection\.rollback/);
  assert.match(serviceSource, /storage_deleted:\s*false/);
  assert.doesNotMatch(serviceSource, /deleteObject|unlink|rmSync|child_process|exec\(|spawn\(/);
});

test("bulk routes require media management and are declared before dynamic asset IDs", () => {
  assert.match(routeSource, /"\/bulk\/update"[\s\S]*requirePermission\("public_media\.manage"\)/);
  assert.match(routeSource, /"\/bulk\/archive"[\s\S]*requirePermission\("public_media\.manage"\)/);
  assert.ok(routeSource.indexOf('"/bulk/update"') < routeSource.indexOf('"/:assetId/usage"'));
  assert.ok(routeSource.indexOf('"/bulk/archive"') < routeSource.indexOf('"/:assetId/usage"'));
});
