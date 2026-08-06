"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  ContentStudioError,
  assertJsonSize,
  booleanValue,
  cleanText,
  parseJson,
  positiveInteger,
  schemaNotReadyError,
} = require("./contentStudioPageService");
const {
  configFor,
  sanitizeSnapshot,
} = require("./contentStudioNewsroomSchema");

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function clampLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? Math.min(number, MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function normalizeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function snapshotFromRow(kind, row) {
  const normalizedKind = configFor(kind).kind;
  if (normalizedKind === "article") {
    return sanitizeSnapshot(normalizedKind, {}, {
      ...row,
      body: parseJson(row.body_json, {}),
    });
  }
  return sanitizeSnapshot(normalizedKind, {}, row);
}

async function loadEntityForUpdate(connection, kind, entityId) {
  const { table, label } = configFor(kind);
  const [rows] = await connection.query(
    `SELECT * FROM ${table} WHERE id = ? LIMIT 1 FOR UPDATE`,
    [entityId]
  );
  if (!rows[0]) {
    throw new ContentStudioError(`${label} not found.`, {
      code: "NEWSROOM_ENTITY_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function loadLatestVersion(connection, kind, entityId, forUpdate = false) {
  const { entityType } = configFor(kind);
  const [rows] = await connection.query(
    `SELECT * FROM public_content_versions
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY version_number DESC, id DESC
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [entityType, entityId]
  );
  return rows[0] || null;
}

async function loadVersionForUpdate(connection, kind, entityId, versionId) {
  const { entityType } = configFor(kind);
  const [rows] = await connection.query(
    `SELECT * FROM public_content_versions
     WHERE id = ? AND entity_type = ? AND entity_id = ?
     LIMIT 1 FOR UPDATE`,
    [versionId, entityType, entityId]
  );
  if (!rows[0]) {
    throw new ContentStudioError("Newsroom version not found.", {
      code: "NEWSROOM_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function assertArticleReferences(
  connection,
  snapshot,
  { publicReady = false } = {}
) {
  if (snapshot.category_id) {
    const [rows] = await connection.query(
      `SELECT id FROM public_news_categories
       WHERE id = ? AND is_active = 1 LIMIT 1`,
      [snapshot.category_id]
    );
    if (!rows[0]) {
      throw new ContentStudioError("The selected news category is unavailable.", {
        code: "NEWS_CATEGORY_NOT_FOUND",
        statusCode: 409,
      });
    }
  }

  if (snapshot.featured_media_asset_id) {
    const [rows] = await connection.query(
      `SELECT id, media_type, visibility, processing_status, is_active
       FROM public_media_assets WHERE id = ? LIMIT 1`,
      [snapshot.featured_media_asset_id]
    );
    const media = rows[0];
    if (!media || !booleanValue(media.is_active) || media.media_type !== "image") {
      throw new ContentStudioError(
        "The selected featured media must be an active image.",
        { code: "NEWS_FEATURED_MEDIA_INVALID", statusCode: 409 }
      );
    }
    if (
      publicReady &&
      (media.visibility !== "public" || media.processing_status !== "ready")
    ) {
      throw new ContentStudioError(
        "Published news images must be public, processed and ready.",
        { code: "PUBLIC_MEDIA_NOT_READY", statusCode: 409 }
      );
    }
  }
}

async function assertReferences(connection, kind, snapshot, options = {}) {
  if (configFor(kind).kind === "article") {
    await assertArticleReferences(connection, snapshot, options);
  }
}

async function listEntities(kind, options = {}) {
  const config = configFor(kind);
  const { table, entityType, searchSql, orderSql } = config;
  const limit = clampLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const filters = [];
  const values = [];
  const status = cleanText(options.status, 40).toLowerCase();
  if (status) {
    const allowed = [
      "draft",
      "in_review",
      "approved",
      "scheduled",
      "published",
      "expired",
      "archived",
    ];
    if (!allowed.includes(status)) return { items: [], total: 0, limit, offset };
    filters.push("e.publication_status = ?");
    values.push(status);
  }
  const search = cleanText(options.search, 120);
  if (search) {
    filters.push(searchSql);
    const count = (searchSql.match(/LIKE \?/g) || []).length;
    for (let index = 0; index < count; index += 1) values.push(`%${search}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [[rows], [countRows]] = await Promise.all([
      pool.query(
        `SELECT e.*,
                latest.id AS latest_version_id,
                latest.version_number AS latest_version_number,
                latest.version_status AS latest_version_status,
                latest.change_summary AS latest_change_summary
         FROM ${table} e
         LEFT JOIN public_content_versions latest
           ON latest.id = (
             SELECT cv.id FROM public_content_versions cv
             WHERE cv.entity_type = ? AND cv.entity_id = e.id
             ORDER BY cv.version_number DESC, cv.id DESC LIMIT 1
           )
         ${where}
         ORDER BY ${orderSql}
         LIMIT ? OFFSET ?`,
        [entityType, ...values, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) AS total FROM ${table} e ${where}`, values),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        body: config.kind === "article" ? parseJson(row.body_json, {}) : undefined,
        body_json: undefined,
      })),
      total: Number(countRows[0]?.total || 0),
      limit,
      offset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function getEntityDetails(kind, entityId) {
  const id = positiveInteger(entityId);
  const { table, entityType, label } = configFor(kind);
  if (!id) {
    throw new ContentStudioError(`Invalid ${label.toLowerCase()} ID.`, {
      code: "INVALID_NEWSROOM_ENTITY_ID",
      statusCode: 400,
    });
  }
  try {
    const [[rows], [versions], [approvals]] = await Promise.all([
      pool.query(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id]),
      pool.query(
        `SELECT id, version_number, version_status, snapshot_json,
                change_summary, created_by, created_at
         FROM public_content_versions
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY version_number DESC, id DESC`,
        [entityType, id]
      ),
      pool.query(
        `SELECT id, content_version_id, request_type, approval_status,
                requested_by, assigned_to, decided_by, request_note,
                decision_note, requested_at, expires_at, decided_at, executed_at
         FROM public_content_approvals
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY requested_at DESC, id DESC`,
        [entityType, id]
      ),
    ]);
    if (!rows[0]) {
      throw new ContentStudioError(`${label} not found.`, {
        code: "NEWSROOM_ENTITY_NOT_FOUND",
        statusCode: 404,
      });
    }
    return {
      entity: rows[0],
      current_snapshot: snapshotFromRow(kind, rows[0]),
      versions: versions.map((row) => ({
        ...row,
        snapshot: parseJson(row.snapshot_json, {}),
        snapshot_json: undefined,
      })),
      approvals,
    };
  } catch (error) {
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  }
}

async function insertBaseEntity(connection, kind, snapshot, userId) {
  if (configFor(kind).kind === "article") {
    const [result] = await connection.query(
      `INSERT INTO public_news_articles (
         article_key, slug, category_id, title, excerpt, body_json,
         author_display_name, featured_media_asset_id, is_featured,
         publication_status, publish_at, expires_at, seo_title,
         meta_description, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.article_key,
        snapshot.slug,
        snapshot.category_id,
        snapshot.title,
        snapshot.excerpt,
        assertJsonSize(snapshot.body, "News article body"),
        snapshot.author_display_name,
        snapshot.featured_media_asset_id,
        snapshot.is_featured ? 1 : 0,
        snapshot.publish_at,
        snapshot.expires_at,
        snapshot.seo_title,
        snapshot.meta_description,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }

  const [result] = await connection.query(
    `INSERT INTO public_announcements (
       announcement_key, title, body_text, link_label, link_url,
       display_style, priority, ticker_enabled, publication_status,
       publish_at, expires_at, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [
      snapshot.announcement_key,
      snapshot.title,
      snapshot.body_text,
      snapshot.link_label,
      snapshot.link_url,
      snapshot.display_style,
      snapshot.priority,
      snapshot.ticker_enabled ? 1 : 0,
      snapshot.publish_at,
      snapshot.expires_at,
      userId || null,
      userId || null,
    ]
  );
  return Number(result.insertId);
}

async function insertVersion(
  connection,
  kind,
  entityId,
  versionNumber,
  snapshot,
  summary,
  userId
) {
  const { entityType } = configFor(kind);
  const [result] = await connection.query(
    `INSERT INTO public_content_versions (
       entity_type, entity_id, version_number, version_status,
       snapshot_json, change_summary, created_by
     ) VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    [
      entityType,
      entityId,
      versionNumber,
      assertJsonSize(snapshot, "Newsroom snapshot"),
      cleanText(summary, 500) || `Newsroom draft version ${versionNumber}`,
      userId || null,
    ]
  );
  return Number(result.insertId);
}

async function applyPublishedSnapshot(
  connection,
  kind,
  entityId,
  snapshot,
  approval,
  userId
) {
  if (configFor(kind).kind === "article") {
    await connection.query(
      `UPDATE public_news_articles
       SET article_key = ?, slug = ?, category_id = ?, title = ?, excerpt = ?,
           body_json = ?, author_display_name = ?, featured_media_asset_id = ?,
           is_featured = ?, publication_status = 'published', publish_at = ?,
           expires_at = ?, published_at = UTC_TIMESTAMP(), seo_title = ?,
           meta_description = ?, approved_by = ?, published_by = ?,
           updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.article_key,
        snapshot.slug,
        snapshot.category_id,
        snapshot.title,
        snapshot.excerpt,
        assertJsonSize(snapshot.body, "News article body"),
        snapshot.author_display_name,
        snapshot.featured_media_asset_id,
        snapshot.is_featured ? 1 : 0,
        snapshot.publish_at,
        snapshot.expires_at,
        snapshot.seo_title,
        snapshot.meta_description,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }

  await connection.query(
    `UPDATE public_announcements
     SET announcement_key = ?, title = ?, body_text = ?, link_label = ?,
         link_url = ?, display_style = ?, priority = ?, ticker_enabled = ?,
         publication_status = 'published', publish_at = ?, expires_at = ?,
         published_at = UTC_TIMESTAMP(), approved_by = ?, published_by = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [
      snapshot.announcement_key,
      snapshot.title,
      snapshot.body_text,
      snapshot.link_label,
      snapshot.link_url,
      snapshot.display_style,
      snapshot.priority,
      snapshot.ticker_enabled ? 1 : 0,
      snapshot.publish_at,
      snapshot.expires_at,
      approval.decided_by || null,
      userId || null,
      userId || null,
      entityId,
    ]
  );
}

async function platformAudit(connection, req, kind, action, entityId, metadata) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE Newsroom ${kind} ${action}`,
    entityType: `public_${kind}`,
    entityId,
    actionType: action,
    metadata,
  });
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  applyPublishedSnapshot,
  assertArticleReferences,
  assertReferences,
  clampLimit,
  getEntityDetails,
  insertBaseEntity,
  insertVersion,
  listEntities,
  loadEntityForUpdate,
  loadLatestVersion,
  loadVersionForUpdate,
  normalizeOffset,
  platformAudit,
  snapshotFromRow,
};
