"use strict";

const express = require("express");

const { requirePermission } = require("../middleware/permissionMiddleware");
const {
  archiveMediaAsset,
  getMediaAssetUsage,
} = require("../services/contentStudioMediaArchiveService");
const {
  archiveMediaFolder,
  createMediaFolder,
  listMediaFolders,
  updateMediaFolder,
} = require("../services/contentStudioMediaFolderService");
const {
  getMediaLibraryIntelligence,
  listMediaLibraryAssets,
} = require("../services/contentStudioMediaLibraryService");
const {
  MAX_IMAGE_BYTES,
  registerExternalVideo,
  updateMediaAsset,
  uploadImage,
} = require("../services/contentStudioMediaService");
const {
  PublicMediaStorageError,
} = require("../services/publicMediaStorageService");
const {
  ContentStudioError,
  cleanText,
} = require("../services/contentStudioPageService");

const router = express.Router();
const rawImage = express.raw({
  type: ["image/jpeg", "image/png", "image/webp"],
  limit: MAX_IMAGE_BYTES,
});

function asyncHandler(handler) {
  return function wrappedMediaHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function success(res, req, data, statusCode = 200) {
  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  return res.status(statusCode).json({
    status: "success",
    data,
    request_id: req.requestId || null,
  });
}

function headerOrQuery(req, headerName, queryName, maxLength) {
  return cleanText(req.get(headerName) || req.query?.[queryName], maxLength);
}

function imageMetadata(req) {
  return {
    originalFilename:
      headerOrQuery(req, "x-media-filename", "filename", 255) || "image",
    displayName: headerOrQuery(
      req,
      "x-media-display-name",
      "display_name",
      180
    ),
    altText: headerOrQuery(req, "x-media-alt-text", "alt_text", 500),
    caption: headerOrQuery(req, "x-media-caption", "caption", 5000),
    credit: headerOrQuery(req, "x-media-credit", "credit", 255),
    folderId: headerOrQuery(req, "x-media-folder-id", "folder_id", 30),
  };
}

router.get(
  "/folders",
  requirePermission("public_media.view"),
  asyncHandler(async (req, res) => success(res, req, await listMediaFolders()))
);

router.post(
  "/folders",
  requirePermission("public_media.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await createMediaFolder({ input: req.body, user: req.user, req }),
      201
    )
  )
);

router.patch(
  "/folders/:folderId",
  requirePermission("public_media.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await updateMediaFolder({
        folderId: req.params.folderId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/folders/:folderId/archive",
  requirePermission("public_media.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveMediaFolder({
        folderId: req.params.folderId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

router.get(
  "/intelligence",
  requirePermission("public_media.view"),
  asyncHandler(async (req, res) =>
    success(res, req, await getMediaLibraryIntelligence())
  )
);

router.get(
  "/",
  requirePermission("public_media.view"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await listMediaLibraryAssets({
        mediaType: req.query.media_type,
        visibility: req.query.visibility,
        processingStatus: req.query.processing_status,
        folderId: req.query.folder_id,
        search: req.query.search,
        orientation: req.query.orientation,
        usage: req.query.usage,
        altStatus: req.query.alt_status,
        readiness: req.query.readiness,
        duplicate: req.query.duplicate,
        minWidth: req.query.min_width,
        maxWidth: req.query.max_width,
        minHeight: req.query.min_height,
        maxHeight: req.query.max_height,
        sort: req.query.sort,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    )
  )
);

router.post(
  "/images",
  requirePermission("public_media.manage"),
  rawImage,
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await uploadImage({
        buffer: req.body,
        ...imageMetadata(req),
        user: req.user,
        req,
      }),
      201
    )
  )
);

router.post(
  "/videos",
  requirePermission("public_media.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await registerExternalVideo({ input: req.body, user: req.user, req }),
      201
    )
  )
);

router.get(
  "/:assetId/usage",
  requirePermission("public_media.view"),
  asyncHandler(async (req, res) =>
    success(res, req, await getMediaAssetUsage(req.params.assetId))
  )
);

router.patch(
  "/:assetId",
  requirePermission("public_media.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await updateMediaAsset({
        assetId: req.params.assetId,
        input: req.body,
        user: req.user,
        req,
      })
    )
  )
);

router.post(
  "/:assetId/archive",
  requirePermission("public_media.manage"),
  asyncHandler(async (req, res) =>
    success(
      res,
      req,
      await archiveMediaAsset({
        assetId: req.params.assetId,
        reason: req.body?.reason,
        user: req.user,
        req,
      })
    )
  )
);

router.use((error, req, res, next) => {
  if (
    !(error instanceof ContentStudioError) &&
    !(error instanceof PublicMediaStorageError)
  ) {
    return next(error);
  }

  res.set("Cache-Control", "no-store, private, max-age=0");
  res.set("Pragma", "no-cache");
  return res.status(error.statusCode || 400).json({
    status: "error",
    code: error.code,
    message: error.message,
    details: error.details || [],
    request_id: req.requestId || null,
  });
});

module.exports = router;
