"use strict";

const { pool } = require("../config/db");
const {
  ContentStudioError,
  cleanText,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  ALLOWED_VISIBILITY,
  isSafeHttpsPublicUrl,
  mapAsset,
} = require("./contentStudioMediaService");

const ALLOWED_MEDIA_TYPES = Object.freeze([
  "image",
  "video",
  "document",
  "audio",
  "other",
]);
const ALLOWED_PROCESSING_STATUSES = Object.freeze([
  "pending",
  "ready",
  "failed",
  "quarantined",
  "archived",
]);
const ALLOWED_ORIENTATIONS = Object.freeze([
  "landscape",
  "portrait",
  "square",
  "unknown",
]);
const ALLOWED_USAGE_FILTERS = Object.freeze(["used", "unused"]);
const ALLOWED_ALT_FILTERS = Object.freeze(["present", "missing"]);
const ALLOWED_READINESS_FILTERS = Object.freeze([
  "public_ready",
  "needs_attention",
]);
const ALLOWED_DUPLICATE_FILTERS = Object.freeze(["duplicate", "unique"]);
const ALLOWED_SORTS = Object.freeze([
  "newest",
  "oldest",
  "name",
  "largest",
  "smallest",
  "width",
]);
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

const DIRECT_USAGE_QUERIES = Object.freeze([
  `SELECT primary_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_page_versions
    WHERE primary_media_asset_id IS NOT NULL
      AND version_status IN ('draft','in_review','approved','scheduled','published')
    GROUP BY primary_media_asset_id`,
  `SELECT s.primary_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_page_sections s
     JOIN public_page_versions pv ON pv.id = s.page_version_id
    WHERE s.primary_media_asset_id IS NOT NULL
      AND s.is_enabled = 1
      AND pv.version_status IN ('draft','in_review','approved','scheduled','published')
    GROUP BY s.primary_media_asset_id`,
  `SELECT s.background_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_page_sections s
     JOIN public_page_versions pv ON pv.id = s.page_version_id
    WHERE s.background_media_asset_id IS NOT NULL
      AND s.is_enabled = 1
      AND pv.version_status IN ('draft','in_review','approved','scheduled','published')
    GROUP BY s.background_media_asset_id`,
  `SELECT featured_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_business_divisions
    WHERE featured_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY featured_media_asset_id`,
  `SELECT portrait_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_leadership_profiles
    WHERE portrait_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY portrait_media_asset_id`,
  `SELECT signature_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_leadership_profiles
    WHERE signature_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY signature_media_asset_id`,
  `SELECT featured_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_projects
    WHERE featured_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY featured_media_asset_id`,
  `SELECT pm.media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_project_media pm
     JOIN public_projects p ON p.id = pm.project_id
    WHERE pm.media_asset_id IS NOT NULL AND p.publication_status <> 'archived'
    GROUP BY pm.media_asset_id`,
  `SELECT featured_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_equipment_catalogue
    WHERE featured_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY featured_media_asset_id`,
  `SELECT featured_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_news_articles
    WHERE featured_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY featured_media_asset_id`,
  `SELECT featured_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_job_vacancies
    WHERE featured_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY featured_media_asset_id`,
  `SELECT document_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_tenders
    WHERE document_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY document_media_asset_id`,
  `SELECT portrait_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_testimonials
    WHERE portrait_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY portrait_media_asset_id`,
  `SELECT featured_media_asset_id AS asset_id, COUNT(*) AS reference_count
     FROM public_locations
    WHERE featured_media_asset_id IS NOT NULL AND publication_status <> 'archived'
    GROUP BY featured_media_asset_id`,
]);

const VERSION_USAGE_FIELDS = Object.freeze([
  Object.freeze({ entityType: "leadership_profile", path: "$.portrait_media_asset_id" }),
  Object.freeze({ entityType: "leadership_profile", path: "$.signature_media_asset_id" }),
  Object.freeze({ entityType: "project", path: "$.featured_media_asset_id" }),
  Object.freeze({ entityType: "equipment", path: "$.featured_media_asset_id" }),
  Object.freeze({ entityType: "news_article", path: "$.featured_media_asset_id" }),
  Object.freeze({ entityType: "business_division", path: "$.featured_media_asset_id" }),
  Object.freeze({ entityType: "location", path: "$.featured_media_asset_id" }),
  Object.freeze({ entityType: "testimonial", path: "$.portrait_media_asset_id" }),
  Object.freeze({ entityType: "job_vacancy", path: "$.featured_media_asset_id" }),
  Object.freeze({ entityType: "tender", path: "$.document_media_asset_id" }),
]);

function enumValue(value, allowed) {
  const normalized = cleanText(value, 60).toLowerCase();
  return allowed.includes(normalized) ? normalized : "";
}

function numericFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeLibraryFilters(options = {}) {
  return {
    mediaType: enumValue(options.mediaType, ALLOWED_MEDIA_TYPES),
    visibility: enumValue(options.visibility, ALLOWED_VISIBILITY),
    processingStatus: enumValue(
      options.processingStatus,
      ALLOWED_PROCESSING_STATUSES
    ),
    orientation: enumValue(options.orientation, ALLOWED_ORIENTATIONS),
    usage: enumValue(options.usage, ALLOWED_USAGE_FILTERS),
    altStatus: enumValue(options.altStatus, ALLOWED_ALT_FILTERS),
    readiness: enumValue(options.readiness, ALLOWED_READINESS_FILTERS),
    duplicate: enumValue(options.duplicate, ALLOWED_DUPLICATE_FILTERS),
    sort: enumValue(options.sort, ALLOWED_SORTS) || "newest",
    search: cleanText(options.search, 180),
    folderId: positiveInteger(options.folderId),
    minWidth: numericFilter(options.minWidth),
    maxWidth: numericFilter(options.maxWidth),
    minHeight: numericFilter(options.minHeight),
    maxHeight: numericFilter(options.maxHeight),
    limit: Math.min(Math.max(Number(options.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT),
    offset: Math.max(Number(options.offset) || 0, 0),
  };
}

function orientationFor(asset = {}) {
  const width = Number(asset.width || 0);
  const height = Number(asset.height || 0);
  if (!width || !height) return "unknown";
  if (Math.abs(width - height) / Math.max(width, height) <= 0.03) return "square";
  return width > height ? "landscape" : "portrait";
}

function publicReadyFor(asset = {}) {
  if (asset.processing_status !== "ready") return false;
  if (!isSafeHttpsPublicUrl(asset.public_url)) return false;
  if (asset.media_type === "image" && !cleanText(asset.alt_text, 500)) return false;
  return true;
}

function addUsageCount(map, assetId, count) {
  const id = Number(assetId || 0);
  if (!Number.isInteger(id) || id <= 0) return;
  map.set(id, Number(map.get(id) || 0) + Math.max(Number(count) || 0, 0));
}

async function getMediaUsageIndex(connection = pool) {
  try {
    const directResults = await Promise.all(
      DIRECT_USAGE_QUERIES.map((sql) => connection.query(sql))
    );
    const versionResults = await Promise.all(
      VERSION_USAGE_FIELDS.map(({ entityType, path }) =>
        connection.query(
          `SELECT
             CAST(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, ?)) AS UNSIGNED) AS asset_id,
             COUNT(*) AS reference_count
           FROM public_content_versions
           WHERE entity_type = ?
             AND version_status IN ('draft','in_review','approved','published')
             AND JSON_EXTRACT(snapshot_json, ?) IS NOT NULL
           GROUP BY CAST(JSON_UNQUOTE(JSON_EXTRACT(snapshot_json, ?)) AS UNSIGNED)`,
          [path, entityType, path, path]
        )
      )
    );
    const [galleryRows] = await connection.query(
      `SELECT jt.asset_id, COUNT(*) AS reference_count
       FROM public_content_versions cv
       JOIN JSON_TABLE(
         cv.snapshot_json,
         '$.gallery[*]' COLUMNS (
           asset_id BIGINT PATH '$.media_asset_id' NULL ON EMPTY NULL ON ERROR
         )
       ) AS jt
       WHERE cv.entity_type = 'project'
         AND cv.version_status IN ('draft','in_review','approved','published')
         AND jt.asset_id IS NOT NULL
       GROUP BY jt.asset_id`
    );

    const usage = new Map();
    for (const result of [...directResults, ...versionResults]) {
      const rows = result[0] || [];
      for (const row of rows) addUsageCount(usage, row.asset_id, row.reference_count);
    }
    for (const row of galleryRows) {
      addUsageCount(usage, row.asset_id, row.reference_count);
    }
    return usage;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function getDuplicateCountMap(connection = pool) {
  try {
    const [rows] = await connection.query(
      `SELECT checksum_sha256, COUNT(*) AS duplicate_count
       FROM public_media_assets
       WHERE is_active = 1
         AND processing_status <> 'archived'
         AND checksum_sha256 IS NOT NULL
         AND checksum_sha256 <> ''
       GROUP BY checksum_sha256
       HAVING COUNT(*) > 1`
    );
    return new Map(
      rows.map((row) => [row.checksum_sha256, Number(row.duplicate_count || 0)])
    );
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

function enrichAsset(row, usageIndex, duplicateMap) {
  const asset = mapAsset(row);
  const duplicateCount = asset.checksum_sha256
    ? Number(duplicateMap.get(asset.checksum_sha256) || 1)
    : 1;
  const usageCount = Number(usageIndex.get(asset.id) || 0);
  const orientation = orientationFor(asset);
  const width = Number(asset.width || 0);
  const height = Number(asset.height || 0);
  return {
    ...asset,
    folder_name: row.folder_name || "",
    usage_count: usageCount,
    in_use: usageCount > 0,
    duplicate_count: duplicateCount,
    is_duplicate: duplicateCount > 1,
    has_alt_text: Boolean(cleanText(asset.alt_text, 500)),
    public_ready: publicReadyFor(asset),
    orientation,
    aspect_ratio: width && height ? Number((width / height).toFixed(3)) : null,
  };
}

function matchesAdvancedFilters(asset, filters) {
  if (filters.orientation && asset.orientation !== filters.orientation) return false;
  if (filters.usage === "used" && !asset.in_use) return false;
  if (filters.usage === "unused" && asset.in_use) return false;
  if (filters.altStatus === "present" && !asset.has_alt_text) return false;
  if (filters.altStatus === "missing" && asset.has_alt_text) return false;
  if (filters.readiness === "public_ready" && !asset.public_ready) return false;
  if (filters.readiness === "needs_attention" && asset.public_ready) return false;
  if (filters.duplicate === "duplicate" && !asset.is_duplicate) return false;
  if (filters.duplicate === "unique" && asset.is_duplicate) return false;
  if (filters.minWidth !== null && Number(asset.width || 0) < filters.minWidth) return false;
  if (filters.maxWidth !== null && Number(asset.width || 0) > filters.maxWidth) return false;
  if (filters.minHeight !== null && Number(asset.height || 0) < filters.minHeight) return false;
  if (filters.maxHeight !== null && Number(asset.height || 0) > filters.maxHeight) return false;
  return true;
}

function sortAssets(items, sort) {
  const copy = [...items];
  copy.sort((left, right) => {
    if (sort === "oldest") {
      return new Date(left.created_at || 0) - new Date(right.created_at || 0);
    }
    if (sort === "name") {
      return String(left.display_name || left.original_filename || "").localeCompare(
        String(right.display_name || right.original_filename || ""),
        "en"
      );
    }
    if (sort === "largest") return Number(right.file_size_bytes || 0) - Number(left.file_size_bytes || 0);
    if (sort === "smallest") return Number(left.file_size_bytes || 0) - Number(right.file_size_bytes || 0);
    if (sort === "width") return Number(right.width || 0) - Number(left.width || 0);
    return new Date(right.created_at || 0) - new Date(left.created_at || 0);
  });
  return copy;
}

async function loadCandidateRows(filters, connection = pool) {
  const where = ["a.is_active = 1", "a.processing_status <> 'archived'"];
  const values = [];
  if (filters.mediaType) {
    where.push("a.media_type = ?");
    values.push(filters.mediaType);
  }
  if (filters.visibility) {
    where.push("a.visibility = ?");
    values.push(filters.visibility);
  }
  if (filters.processingStatus) {
    where.push("a.processing_status = ?");
    values.push(filters.processingStatus);
  }
  if (filters.folderId) {
    where.push("a.folder_id = ?");
    values.push(filters.folderId);
  }
  if (filters.search) {
    const like = `%${filters.search}%`;
    where.push(
      `(a.asset_key LIKE ? OR a.display_name LIKE ? OR a.original_filename LIKE ? OR
        a.alt_text LIKE ? OR a.caption LIKE ? OR a.credit_text LIKE ?)`
    );
    values.push(like, like, like, like, like, like);
  }

  try {
    const [rows] = await connection.query(
      `SELECT a.*, f.name AS folder_name
       FROM public_media_assets a
       LEFT JOIN public_media_folders f
         ON f.id = a.folder_id AND f.is_active = 1
       WHERE ${where.join(" AND ")}`,
      values
    );
    return rows;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function listMediaLibraryAssets(options = {}) {
  const filters = normalizeLibraryFilters(options);
  const [rows, usageIndex, duplicateMap] = await Promise.all([
    loadCandidateRows(filters),
    getMediaUsageIndex(),
    getDuplicateCountMap(),
  ]);
  const enriched = rows
    .map((row) => enrichAsset(row, usageIndex, duplicateMap))
    .filter((asset) => matchesAdvancedFilters(asset, filters));
  const sorted = sortAssets(enriched, filters.sort);
  return {
    items: sorted.slice(filters.offset, filters.offset + filters.limit),
    total: sorted.length,
    limit: filters.limit,
    offset: filters.offset,
  };
}

function compactAsset(asset) {
  return {
    id: asset.id,
    asset_key: asset.asset_key,
    display_name: asset.display_name,
    original_filename: asset.original_filename,
    media_type: asset.media_type,
    public_url: asset.public_url,
    visibility: asset.visibility,
    processing_status: asset.processing_status,
    width: asset.width,
    height: asset.height,
    file_size_bytes: asset.file_size_bytes,
    folder_name: asset.folder_name,
    usage_count: asset.usage_count,
    duplicate_count: asset.duplicate_count,
    public_ready: asset.public_ready,
  };
}

async function getMediaLibraryIntelligence() {
  const filters = normalizeLibraryFilters({ limit: MAX_LIMIT });
  const [rows, usageIndex, duplicateMap] = await Promise.all([
    loadCandidateRows(filters),
    getMediaUsageIndex(),
    getDuplicateCountMap(),
  ]);
  const assets = rows.map((row) => enrichAsset(row, usageIndex, duplicateMap));
  const missingAlt = assets.filter(
    (asset) => asset.media_type === "image" && !asset.has_alt_text
  );
  const unused = assets.filter((asset) => !asset.in_use);
  const duplicates = assets.filter((asset) => asset.is_duplicate);
  const needsAttention = assets.filter((asset) => !asset.public_ready);
  const totalBytes = assets.reduce(
    (sum, asset) => sum + Number(asset.file_size_bytes || 0),
    0
  );

  const duplicateGroups = new Map();
  for (const asset of duplicates) {
    const key = asset.checksum_sha256;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(compactAsset(asset));
  }

  return {
    summary: {
      total: assets.length,
      images: assets.filter((asset) => asset.media_type === "image").length,
      videos: assets.filter((asset) => asset.media_type === "video").length,
      public: assets.filter((asset) => asset.visibility === "public").length,
      private: assets.filter((asset) => asset.visibility === "private").length,
      restricted: assets.filter((asset) => asset.visibility === "restricted").length,
      ready: assets.filter((asset) => asset.processing_status === "ready").length,
      public_ready: assets.filter((asset) => asset.public_ready).length,
      needs_attention: needsAttention.length,
      missing_alt: missingAlt.length,
      used: assets.filter((asset) => asset.in_use).length,
      unused: unused.length,
      duplicate_assets: duplicates.length,
      duplicate_groups: duplicateGroups.size,
      uncategorized: assets.filter((asset) => !asset.folder_id).length,
      total_bytes: totalBytes,
    },
    queues: {
      missing_alt: missingAlt.slice(0, 12).map(compactAsset),
      unused: unused.slice(0, 12).map(compactAsset),
      largest: [...assets]
        .sort((left, right) => Number(right.file_size_bytes || 0) - Number(left.file_size_bytes || 0))
        .slice(0, 12)
        .map(compactAsset),
      duplicates: [...duplicateGroups.entries()].slice(0, 12).map(([checksum, items]) => ({
        checksum_prefix: String(checksum || "").slice(0, 12),
        count: items.length,
        items,
      })),
    },
  };
}

module.exports = {
  ALLOWED_ALT_FILTERS,
  ALLOWED_DUPLICATE_FILTERS,
  ALLOWED_MEDIA_TYPES,
  ALLOWED_ORIENTATIONS,
  ALLOWED_PROCESSING_STATUSES,
  ALLOWED_READINESS_FILTERS,
  ALLOWED_SORTS,
  ALLOWED_USAGE_FILTERS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  enrichAsset,
  getDuplicateCountMap,
  getMediaLibraryIntelligence,
  getMediaUsageIndex,
  listMediaLibraryAssets,
  matchesAdvancedFilters,
  normalizeLibraryFilters,
  orientationFor,
  publicReadyFor,
  sortAssets,
};
