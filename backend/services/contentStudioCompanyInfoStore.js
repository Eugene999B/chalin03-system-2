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
} = require("./contentStudioCompanyInfoSchema");

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
  const base = { ...row };
  if (kind === "division") base.body = parseJson(row.body_json, {});
  if (kind === "location") {
    base.business_hours = parseJson(row.business_hours_json, {});
  }
  if (kind === "faq") base.answer = parseJson(row.answer_json, {});
  if (kind === "vacancy") {
    base.description = parseJson(row.description_json, {});
    base.requirements = parseJson(row.requirements_json, {});
    base.application_instructions = parseJson(
      row.application_instructions_json,
      {}
    );
  }
  if (kind === "tender") {
    base.details = parseJson(row.details_json, {});
    base.submission_instructions = parseJson(
      row.submission_instructions_json,
      {}
    );
  }
  return sanitizeSnapshot(kind, {}, base);
}

async function loadEntityForUpdate(connection, kind, entityId) {
  const { table, label } = configFor(kind);
  const [rows] = await connection.query(
    `SELECT * FROM ${table} WHERE id = ? LIMIT 1 FOR UPDATE`,
    [entityId]
  );
  if (!rows[0]) {
    throw new ContentStudioError(`${label} not found.`, {
      code: "COMPANY_INFO_ENTITY_NOT_FOUND",
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
      code: "COMPANY_INFO_VERSION_NOT_FOUND",
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

async function assertLocation(connection, locationId) {
  if (!locationId) return;
  const [rows] = await connection.query(
    `SELECT id, publication_status
     FROM public_locations
     WHERE id = ? LIMIT 1`,
    [locationId]
  );
  if (!rows[0] || rows[0].publication_status === "archived") {
    throw new ContentStudioError("The selected public location is unavailable.", {
      code: "PUBLIC_LOCATION_NOT_FOUND",
      statusCode: 409,
    });
  }
}

function mediaDefinition(kind, snapshot) {
  if (kind === "division") {
    return snapshot.featured_media_asset_id
      ? [{ id: snapshot.featured_media_asset_id, type: "image" }]
      : [];
  }
  if (kind === "location") {
    return snapshot.featured_media_asset_id
      ? [{ id: snapshot.featured_media_asset_id, type: "image" }]
      : [];
  }
  if (kind === "testimonial") {
    return snapshot.portrait_media_asset_id
      ? [{ id: snapshot.portrait_media_asset_id, type: "image" }]
      : [];
  }
  if (kind === "vacancy") {
    return snapshot.featured_media_asset_id
      ? [{ id: snapshot.featured_media_asset_id, type: "image" }]
      : [];
  }
  if (kind === "tender") {
    return snapshot.document_media_asset_id
      ? [{ id: snapshot.document_media_asset_id, type: "document" }]
      : [];
  }
  return [];
}

async function assertMedia(connection, kind, snapshot, { publicReady = false } = {}) {
  const definitions = mediaDefinition(kind, snapshot);
  if (definitions.length === 0) return;
  const ids = [...new Set(definitions.map((item) => item.id))];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id, media_type, visibility, processing_status, is_active
     FROM public_media_assets
     WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  for (const definition of definitions) {
    const row = byId.get(Number(definition.id));
    if (!row || !booleanValue(row.is_active)) {
      throw new ContentStudioError("A selected media asset is unavailable.", {
        code: "PUBLIC_MEDIA_NOT_FOUND",
        statusCode: 409,
      });
    }
    if (row.media_type !== definition.type) {
      throw new ContentStudioError(
        definition.type === "document"
          ? "Tender attachments must be document media assets."
          : "Featured company information media must be an image asset.",
        { code: "PUBLIC_MEDIA_TYPE_INVALID", statusCode: 409 }
      );
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
}

async function assertReferences(connection, kind, snapshot, options = {}) {
  if (["location", "vacancy", "tender"].includes(kind)) {
    await assertDivision(connection, snapshot.division_id);
  }
  if (kind === "vacancy") {
    await assertLocation(connection, snapshot.location_id);
  }
  await assertMedia(connection, kind, snapshot, options);
}

async function listEntities(kind, options = {}) {
  const { table, entityType, searchSql, orderSql } = configFor(kind);
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
    for (let index = 0; index < count; index += 1) {
      values.push(`%${search}%`);
    }
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  try {
    const [[rows], [countRows]] = await Promise.all([
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
      code: "INVALID_COMPANY_INFO_ENTITY_ID",
      statusCode: 400,
    });
  }
  try {
    const [[entityRows], [versions], [approvals]] = await Promise.all([
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
    if (!entityRows[0]) {
      throw new ContentStudioError(`${label} not found.`, {
        code: "COMPANY_INFO_ENTITY_NOT_FOUND",
        statusCode: 404,
      });
    }
    return {
      entity: entityRows[0],
      current_snapshot: snapshotFromRow(kind, entityRows[0]),
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
      assertJsonSize(snapshot, "Company information snapshot"),
      cleanText(summary, 500) || `Draft version ${versionNumber}`,
      userId || null,
    ]
  );
  return Number(result.insertId);
}

async function insertBaseEntity(connection, kind, snapshot, userId) {
  if (kind === "division") {
    const [result] = await connection.query(
      `INSERT INTO public_business_divisions (
         division_key, slug, name, short_description, body_json,
         featured_media_asset_id, contact_phone, contact_email, sort_order,
         publication_status, publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.division_key,
        snapshot.slug,
        snapshot.name,
        snapshot.short_description,
        assertJsonSize(snapshot.body, "Division body"),
        snapshot.featured_media_asset_id,
        snapshot.contact_phone,
        snapshot.contact_email,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }
  if (kind === "location") {
    const [result] = await connection.query(
      `INSERT INTO public_locations (
         location_key, slug, division_id, name, location_type, address_line,
         city, region, country, latitude, longitude, phone, email,
         business_hours_json, map_url, featured_media_asset_id, sort_order,
         publication_status, publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.location_key,
        snapshot.slug,
        snapshot.division_id,
        snapshot.name,
        snapshot.location_type,
        snapshot.address_line,
        snapshot.city,
        snapshot.region,
        snapshot.country,
        snapshot.latitude,
        snapshot.longitude,
        snapshot.phone,
        snapshot.email,
        assertJsonSize(snapshot.business_hours, "Location business hours"),
        snapshot.map_url,
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
  if (kind === "statistic") {
    const [result] = await connection.query(
      `INSERT INTO public_company_statistics (
         statistic_key, label, display_value, numeric_value, prefix_text,
         suffix_text, source_note, as_of_date, sort_order, publication_status,
         publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.statistic_key,
        snapshot.label,
        snapshot.display_value,
        snapshot.numeric_value,
        snapshot.prefix_text,
        snapshot.suffix_text,
        snapshot.source_note,
        snapshot.as_of_date,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }
  if (kind === "testimonial") {
    const [result] = await connection.query(
      `INSERT INTO public_testimonials (
         testimonial_key, customer_display_name, customer_title, company_name,
         quote_text, rating, portrait_media_asset_id, sort_order,
         publication_status, publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.testimonial_key,
        snapshot.customer_display_name,
        snapshot.customer_title,
        snapshot.company_name,
        snapshot.quote_text,
        snapshot.rating,
        snapshot.portrait_media_asset_id,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }
  if (kind === "faq") {
    const [result] = await connection.query(
      `INSERT INTO public_faqs (
         faq_key, category_label, question, answer_json, sort_order,
         publication_status, publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.faq_key,
        snapshot.category_label,
        snapshot.question,
        assertJsonSize(snapshot.answer, "FAQ answer"),
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }
  if (kind === "vacancy") {
    const [result] = await connection.query(
      `INSERT INTO public_job_vacancies (
         vacancy_key, slug, division_id, location_id, title, employment_type,
         summary, description_json, requirements_json,
         application_instructions_json, application_url, vacancies_count,
         opens_at, closes_at, featured_media_asset_id, publication_status,
         publish_at, expires_at, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        snapshot.vacancy_key,
        snapshot.slug,
        snapshot.division_id,
        snapshot.location_id,
        snapshot.title,
        snapshot.employment_type,
        snapshot.summary,
        assertJsonSize(snapshot.description, "Vacancy description"),
        assertJsonSize(snapshot.requirements, "Vacancy requirements"),
        assertJsonSize(
          snapshot.application_instructions,
          "Vacancy application instructions"
        ),
        snapshot.application_url,
        snapshot.vacancies_count,
        snapshot.opens_at,
        snapshot.closes_at,
        snapshot.featured_media_asset_id,
        snapshot.publish_at,
        snapshot.expires_at,
        userId || null,
        userId || null,
      ]
    );
    return Number(result.insertId);
  }
  const [result] = await connection.query(
    `INSERT INTO public_tenders (
       tender_key, slug, division_id, reference_number, title, summary,
       details_json, submission_instructions_json, opens_at, closes_at,
       document_media_asset_id, publication_status, publish_at, expires_at,
       created_by, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [
      snapshot.tender_key,
      snapshot.slug,
      snapshot.division_id,
      snapshot.reference_number,
      snapshot.title,
      snapshot.summary,
      assertJsonSize(snapshot.details, "Tender details"),
      assertJsonSize(
        snapshot.submission_instructions,
        "Tender submission instructions"
      ),
      snapshot.opens_at,
      snapshot.closes_at,
      snapshot.document_media_asset_id,
      snapshot.publish_at,
      snapshot.expires_at,
      userId || null,
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
  if (kind === "division") {
    await connection.query(
      `UPDATE public_business_divisions
       SET division_key = ?, slug = ?, name = ?, short_description = ?,
           body_json = ?, featured_media_asset_id = ?, contact_phone = ?,
           contact_email = ?, sort_order = ?, publication_status = 'published',
           publish_at = ?, expires_at = ?, published_at = UTC_TIMESTAMP(),
           approved_by = ?, published_by = ?, updated_by = ?,
           updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [
        snapshot.division_key,
        snapshot.slug,
        snapshot.name,
        snapshot.short_description,
        assertJsonSize(snapshot.body, "Division body"),
        snapshot.featured_media_asset_id,
        snapshot.contact_phone,
        snapshot.contact_email,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }
  if (kind === "location") {
    await connection.query(
      `UPDATE public_locations
       SET location_key = ?, slug = ?, division_id = ?, name = ?,
           location_type = ?, address_line = ?, city = ?, region = ?, country = ?,
           latitude = ?, longitude = ?, phone = ?, email = ?, business_hours_json = ?,
           map_url = ?, featured_media_asset_id = ?, sort_order = ?,
           publication_status = 'published', publish_at = ?, expires_at = ?,
           published_at = UTC_TIMESTAMP(), approved_by = ?, published_by = ?,
           updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [
        snapshot.location_key,
        snapshot.slug,
        snapshot.division_id,
        snapshot.name,
        snapshot.location_type,
        snapshot.address_line,
        snapshot.city,
        snapshot.region,
        snapshot.country,
        snapshot.latitude,
        snapshot.longitude,
        snapshot.phone,
        snapshot.email,
        assertJsonSize(snapshot.business_hours, "Location business hours"),
        snapshot.map_url,
        snapshot.featured_media_asset_id,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }
  if (kind === "statistic") {
    await connection.query(
      `UPDATE public_company_statistics
       SET statistic_key = ?, label = ?, display_value = ?, numeric_value = ?,
           prefix_text = ?, suffix_text = ?, source_note = ?, as_of_date = ?,
           sort_order = ?, publication_status = 'published', publish_at = ?,
           expires_at = ?, published_at = UTC_TIMESTAMP(), approved_by = ?,
           published_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.statistic_key,
        snapshot.label,
        snapshot.display_value,
        snapshot.numeric_value,
        snapshot.prefix_text,
        snapshot.suffix_text,
        snapshot.source_note,
        snapshot.as_of_date,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }
  if (kind === "testimonial") {
    await connection.query(
      `UPDATE public_testimonials
       SET testimonial_key = ?, customer_display_name = ?, customer_title = ?,
           company_name = ?, quote_text = ?, rating = ?, portrait_media_asset_id = ?,
           sort_order = ?, publication_status = 'published', publish_at = ?,
           expires_at = ?, published_at = UTC_TIMESTAMP(), approved_by = ?,
           published_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.testimonial_key,
        snapshot.customer_display_name,
        snapshot.customer_title,
        snapshot.company_name,
        snapshot.quote_text,
        snapshot.rating,
        snapshot.portrait_media_asset_id,
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }
  if (kind === "faq") {
    await connection.query(
      `UPDATE public_faqs
       SET faq_key = ?, category_label = ?, question = ?, answer_json = ?,
           sort_order = ?, publication_status = 'published', publish_at = ?,
           expires_at = ?, published_at = UTC_TIMESTAMP(), approved_by = ?,
           published_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        snapshot.faq_key,
        snapshot.category_label,
        snapshot.question,
        assertJsonSize(snapshot.answer, "FAQ answer"),
        snapshot.sort_order,
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }
  if (kind === "vacancy") {
    await connection.query(
      `UPDATE public_job_vacancies
       SET vacancy_key = ?, slug = ?, division_id = ?, location_id = ?, title = ?,
           employment_type = ?, summary = ?, description_json = ?,
           requirements_json = ?, application_instructions_json = ?,
           application_url = ?, vacancies_count = ?, opens_at = ?, closes_at = ?,
           featured_media_asset_id = ?, publication_status = 'published',
           publish_at = ?, expires_at = ?, published_at = UTC_TIMESTAMP(),
           approved_by = ?, published_by = ?, updated_by = ?,
           updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [
        snapshot.vacancy_key,
        snapshot.slug,
        snapshot.division_id,
        snapshot.location_id,
        snapshot.title,
        snapshot.employment_type,
        snapshot.summary,
        assertJsonSize(snapshot.description, "Vacancy description"),
        assertJsonSize(snapshot.requirements, "Vacancy requirements"),
        assertJsonSize(
          snapshot.application_instructions,
          "Vacancy application instructions"
        ),
        snapshot.application_url,
        snapshot.vacancies_count,
        snapshot.opens_at,
        snapshot.closes_at,
        snapshot.featured_media_asset_id,
        snapshot.publish_at,
        snapshot.expires_at,
        approval.decided_by || null,
        userId || null,
        userId || null,
        entityId,
      ]
    );
    return;
  }
  await connection.query(
    `UPDATE public_tenders
     SET tender_key = ?, slug = ?, division_id = ?, reference_number = ?,
         title = ?, summary = ?, details_json = ?, submission_instructions_json = ?,
         opens_at = ?, closes_at = ?, document_media_asset_id = ?,
         publication_status = 'published', publish_at = ?, expires_at = ?,
         published_at = UTC_TIMESTAMP(), approved_by = ?, published_by = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
    [
      snapshot.tender_key,
      snapshot.slug,
      snapshot.division_id,
      snapshot.reference_number,
      snapshot.title,
      snapshot.summary,
      assertJsonSize(snapshot.details, "Tender details"),
      assertJsonSize(
        snapshot.submission_instructions,
        "Tender submission instructions"
      ),
      snapshot.opens_at,
      snapshot.closes_at,
      snapshot.document_media_asset_id,
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
    details: `CHALIN ONE ${kind} ${action}`,
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
