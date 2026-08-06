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
  PUBLICATION_STATUSES,
  configFor,
  sanitizeSnapshot,
} = require("./contentStudioPortfolioSchema");

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

function snapshotFromRow(kind, row, gallery = []) {
  const base = { ...row };
  if (kind === "leadership") {
    base.biography = parseJson(row.biography_json, {});
    base.social_links = parseJson(row.social_links_json, {});
  } else if (kind === "project") {
    base.body = parseJson(row.body_json, {});
    base.gallery = gallery;
  } else {
    base.specifications = parseJson(row.specifications_json, {});
    base.features = parseJson(row.features_json, []);
  }
  return sanitizeSnapshot(kind, {}, base);
}

async function loadGallery(connection, projectId) {
  const [rows] = await connection.query(
    `SELECT media_asset_id, media_role, caption, sort_order
     FROM public_project_media
     WHERE project_id = ?
     ORDER BY sort_order, id`,
    [projectId]
  );
  return rows.map((row) => ({
    media_asset_id: Number(row.media_asset_id),
    media_role: row.media_role,
    caption: row.caption || null,
    sort_order: Number(row.sort_order || 0),
  }));
}

async function loadEntityForUpdate(connection, kind, entityId) {
  const { table, label } = configFor(kind);
  const [rows] = await connection.query(
    `SELECT * FROM ${table} WHERE id = ? LIMIT 1 FOR UPDATE`,
    [entityId]
  );
  if (!rows[0]) {
    throw new ContentStudioError(`${label} not found.`, {
      code: "PORTFOLIO_ENTITY_NOT_FOUND",
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
    throw new ContentStudioError("Content version not found.", {
      code: "PORTFOLIO_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }
  return rows[0];
}

async function assertDivision(connection, divisionId) {
  if (!divisionId) return;
  const [rows] = await connection.query(
    `SELECT id, publication_status
     FROM public_business_divisions
     WHERE id = ? LIMIT 1`,
    [divisionId]
  );
  if (!rows[0] || rows[0].publication_status === "archived") {
    throw new ContentStudioError(
      "The selected public business division is unavailable.",
      { code: "PUBLIC_DIVISION_NOT_FOUND", statusCode: 409 }
    );
  }
}

function mediaIdsFor(kind, snapshot) {
  if (kind === "leadership") {
    return [
      snapshot.portrait_media_asset_id,
      snapshot.signature_media_asset_id,
    ].filter(Boolean);
  }
  if (kind === "project") {
    return [
      snapshot.featured_media_asset_id,
      ...snapshot.gallery.map((item) => item.media_asset_id),
    ].filter(Boolean);
  }
  return [snapshot.featured_media_asset_id].filter(Boolean);
}

async function assertMedia(
  connection,
  kind,
  snapshot,
  { publicReady = false } = {}
) {
  const ids = [...new Set(mediaIdsFor(kind, snapshot))];
  if (ids.length === 0) return;

  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id, media_type, visibility, processing_status, is_active
     FROM public_media_assets
     WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));

  for (const id of ids) {
    const row = byId.get(Number(id));
    if (!row || !booleanValue(row.is_active)) {
      throw new ContentStudioError("A selected media asset is unavailable.", {
        code: "PUBLIC_MEDIA_NOT_FOUND",
        statusCode: 409,
      });
    }
    if (
      publicReady &&
      (row.visibility !== "public" || row.processing_status !== "ready")
    ) {
      throw new ContentStudioError(
        "Every published media asset must be public, processed and ready.",
        { code: "PUBLIC_MEDIA_NOT_READY", statusCode: 409 }
      );
    }
  }

  const imageOnlyIds =
    kind === "leadership"
      ? [
          snapshot.portrait_media_asset_id,
          snapshot.signature_media_asset_id,
        ].filter(Boolean)
      : [snapshot.featured_media_asset_id].filter(Boolean);

  for (const id of imageOnlyIds) {
    if (byId.get(Number(id))?.media_type !== "image") {
      throw new ContentStudioError(
        "Featured portraits and equipment images must be image assets.",
        { code: "PUBLIC_MEDIA_TYPE_INVALID", statusCode: 409 }
      );
    }
  }
}

async function assertReferences(connection, kind, snapshot, options = {}) {
  if (kind === "project" || kind === "equipment") {
    await assertDivision(connection, snapshot.division_id);
  }
  await assertMedia(connection, kind, snapshot, options);
}

async function listEntities(kind, options = {}) {
  const { table, entityType, searchSql, orderSql } = configFor(kind);
  const limit = clampLimit(options.limit);
  const offset = normalizeOffset(options.offset);
  const values = [];
  const filters = [];
  const status = cleanText(options.status, 40).toLowerCase();

  if (status) {
    if (!PUBLICATION_STATUSES.includes(status)) {
      return { items: [], total: 0, limit, offset };
    }
    filters.push("e.publication_status = ?");
    values.push(status);
  }

  const search = cleanText(options.search, 120);
  if (search) {
    filters.push(searchSql);
    const count = (searchSql.match(/LIKE \?/g) || []).length;
    for (let index = 0; index < count; index += 1) {
      values.push(`%${search}%`);
    }
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [itemResult, countResult] = await Promise.all([
      pool.query(
        `SELECT e.*,
                latest.id AS latest_version_id,
                latest.version_number AS latest_version_number,
                latest.version_status AS latest_version_status,
                latest.snapshot_json AS latest_snapshot_json,
                latest.change_summary AS latest_change_summary
         FROM ${table} e
         LEFT JOIN public_content_versions latest
           ON latest.id = (
             SELECT cv.id
             FROM public_content_versions cv
             WHERE cv.entity_type = ?
               AND cv.entity_id = e.id
             ORDER BY cv.version_number DESC, cv.id DESC
             LIMIT 1
           )
         ${where}
         ORDER BY ${orderSql}
         LIMIT ? OFFSET ?`,
        [entityType, ...values, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) AS total FROM ${table} e ${where}`, values),
    ]);

    const rows = itemResult[0];
    const countRows = countResult[0];
    return {
      items: rows.map((row) => ({
        ...row,
        latest_snapshot: parseJson(row.latest_snapshot_json, null),
        latest_snapshot_json: undefined,
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
      code: "INVALID_PORTFOLIO_ENTITY_ID",
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
        code: "PORTFOLIO_ENTITY_NOT_FOUND",
        statusCode: 404,
      });
    }

    const gallery = kind === "project" ? await loadGallery(pool, id) : [];
    return {
      entity: rows[0],
      current_snapshot: snapshotFromRow(kind, rows[0], gallery),
      versions: versions.map((row) => ({
        ...row,
        snapshot: parseJson(row.snapshot_json, {}),
        snapshot_json: undefined,
      })),
      approvals,
      gallery,
    };
  } catch (error) {
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  }
}

async function insertBaseEntity(connection, kind, snapshot, userId) {
  if (kind === "leadership") {
    const [result] = await connection.query(
      `INSERT INTO public_leadership_profiles (
         profile_key, slug, full_name, position_title, professional_summary,
         biography_json, portrait_media_asset_id, signature_media_asset_id,
         social_links_json, sort_order, publication_status, publish_at,
         expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.profile_key,
        snapshot.slug,
        snapshot.full_name,
        snapshot.position_title,
        snapshot.professional_summary,
        assertJsonSize(snapshot.biography, "Leadership biography"),
        snapshot.portrait_media_asset_id,
        snapshot.signature_media_asset_id,
        assertJsonSize(snapshot.social_links, "Leadership social links"),
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }

  if (kind === "project") {
    const [result] = await connection.query(
      `INSERT INTO public_projects (
         project_key, slug, division_id, title, summary, body_json,
         location_text, operational_status, start_date, end_date,
         featured_media_asset_id, sort_order, publication_status,
         publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.project_key,
        snapshot.slug,
        snapshot.division_id,
        snapshot.title,
        snapshot.summary,
        assertJsonSize(snapshot.body, "Project body"),
        snapshot.location_text,
        snapshot.operational_status,
        snapshot.start_date,
        snapshot.end_date,
        snapshot.featured_media_asset_id,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }

  const [result] = await connection.query(
    `INSERT INTO public_equipment_catalogue (
       equipment_key, slug, division_id, internal_reference_type,
       internal_reference_id, name, manufacturer, model, model_year,
       equipment_category, condition_label, availability_status,
       short_description, specifications_json, features_json, currency_code,
       display_price, show_price, hire_available, finance_available,
       featured_media_asset_id, sort_order, publication_status, publish_at,
       expires_at, created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [
      snapshot.equipment_key,
      snapshot.slug,
      snapshot.division_id,
      snapshot.internal_reference_type,
      snapshot.internal_reference_id,
      snapshot.name,
      snapshot.manufacturer,
      snapshot.model,
      snapshot.model_year,
      snapshot.equipment_category,
      snapshot.condition_label,
      snapshot.availability_status,
      snapshot.short_description,
      assertJsonSize(snapshot.specifications, "Equipment specifications"),
      assertJsonSize(snapshot.features, "Equipment features"),
      snapshot.currency_code,
      snapshot.display_price,
      snapshot.show_price ? 1 : 0,
      snapshot.hire_available ? 1 : 0,
      snapshot.finance_available ? 1 : 0,
      snapshot.featured_media_asset_id,
      snapshot.sort_order,
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
      assertJsonSize(snapshot, "Content snapshot"),
      cleanText(summary, 500) || `Draft version ${versionNumber}`,
      userId || null,
    ]
  );
  return Number(result.insertId);
}

async function platformAudit(
  connection,
  req,
  kind,
  action,
  entityId,
  metadata = null
) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE ${kind} ${action}`,
    entityType: `public_${kind}`,
    entityId,
    actionType: action,
    metadata,
  });
}

async function replaceProjectGallery(connection, projectId, gallery, userId) {
  await connection.query(
    "DELETE FROM public_project_media WHERE project_id = ?",
    [projectId]
  );
  for (const item of gallery) {
    await connection.query(
      `INSERT INTO public_project_media (
         project_id, media_asset_id, media_role, caption, sort_order, created_by
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        item.media_asset_id,
        item.media_role,
        item.caption,
        item.sort_order,
        userId || null,
      ]
    );
  }
}

async function applyPublishedSnapshot(
  connection,
  kind,
  entityId,
  snapshot,
  status,
  approval,
  userId
) {
  const publishedAt = status === "published" ? new Date() : null;

  if (kind === "leadership") {
    await connection.query(
      `UPDATE public_leadership_profiles
       SET profile_key = ?, slug = ?, full_name = ?, position_title = ?,
           professional_summary = ?, biography_json = ?,
           portrait_media_asset_id = ?, signature_media_asset_id = ?,
           social_links_json = ?, sort_order = ?, publication_status = ?,
           publish_at = ?, expires_at = ?, published_at = ?, approved_by = ?,
           published_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.profile_key,
        snapshot.slug,
        snapshot.full_name,
        snapshot.position_title,
        snapshot.professional_summary,
        assertJsonSize(snapshot.biography, "Leadership biography"),
        snapshot.portrait_media_asset_id,
        snapshot.signature_media_asset_id,
        assertJsonSize(snapshot.social_links, "Leadership social links"),
        snapshot.sort_order,
        status,
        snapshot.publish_at,
        snapshot.expires_at,
        publishedAt,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }

  if (kind === "project") {
    await connection.query(
      `UPDATE public_projects
       SET project_key = ?, slug = ?, division_id = ?, title = ?,
           summary = ?, body_json = ?, location_text = ?,
           operational_status = ?, start_date = ?, end_date = ?,
           featured_media_asset_id = ?, sort_order = ?, publication_status = ?,
           publish_at = ?, expires_at = ?, published_at = ?, approved_by = ?,
           published_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.project_key,
        snapshot.slug,
        snapshot.division_id,
        snapshot.title,
        snapshot.summary,
        assertJsonSize(snapshot.body, "Project body"),
        snapshot.location_text,
        snapshot.operational_status,
        snapshot.start_date,
        snapshot.end_date,
        snapshot.featured_media_asset_id,
        snapshot.sort_order,
        status,
        snapshot.publish_at,
        snapshot.expires_at,
        publishedAt,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    await replaceProjectGallery(connection, entityId, snapshot.gallery, userId);
    return;
  }

  await connection.query(
    `UPDATE public_equipment_catalogue
     SET equipment_key = ?, slug = ?, division_id = ?,
         internal_reference_type = ?, internal_reference_id = ?, name = ?,
         manufacturer = ?, model = ?, model_year = ?, equipment_category = ?,
         condition_label = ?, availability_status = ?, short_description = ?,
         specifications_json = ?, features_json = ?, currency_code = ?,
         display_price = ?, show_price = ?, hire_available = ?,
         finance_available = ?, featured_media_asset_id = ?, sort_order = ?,
         publication_status = ?, publish_at = ?, expires_at = ?,
         published_at = ?, approved_by = ?, published_by = ?, updated_by = ?,
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [
      snapshot.equipment_key,
      snapshot.slug,
      snapshot.division_id,
      snapshot.internal_reference_type,
      snapshot.internal_reference_id,
      snapshot.name,
      snapshot.manufacturer,
      snapshot.model,
      snapshot.model_year,
      snapshot.equipment_category,
      snapshot.condition_label,
      snapshot.availability_status,
      snapshot.short_description,
      assertJsonSize(snapshot.specifications, "Equipment specifications"),
      assertJsonSize(snapshot.features, "Equipment features"),
      snapshot.currency_code,
      snapshot.display_price,
      snapshot.show_price ? 1 : 0,
      snapshot.hire_available ? 1 : 0,
      snapshot.finance_available ? 1 : 0,
      snapshot.featured_media_asset_id,
      snapshot.sort_order,
      status,
      snapshot.publish_at,
      snapshot.expires_at,
      publishedAt,
      approval.decided_by || null,
      userId || null,
      userId || null,
      entityId,
    ]
  );
}

module.exports = {
  applyPublishedSnapshot,
  assertReferences,
  clampLimit,
  getEntityDetails,
  insertBaseEntity,
  insertVersion,
  listEntities,
  loadEntityForUpdate,
  loadGallery,
  loadLatestVersion,
  loadVersionForUpdate,
  normalizeOffset,
  platformAudit,
  snapshotFromRow,
};
