"use strict";

const { ContentStudioError, positiveInteger, schemaNotReadyError } = require("./contentStudioPageService");

const MEDIA_USAGE_QUERIES = Object.freeze([
  Object.freeze({
    type: "page_version_primary",
    sql: `SELECT pv.id, p.slug AS label
          FROM public_page_versions pv
          JOIN public_pages p ON p.id = pv.page_id
          WHERE pv.primary_media_asset_id = ?
            AND pv.version_status IN ('draft','in_review','approved','scheduled','published')
          LIMIT 25`,
  }),
  Object.freeze({
    type: "page_section_primary",
    sql: `SELECT s.id, CONCAT(p.slug, ':', s.section_key) AS label
          FROM public_page_sections s
          JOIN public_page_versions pv ON pv.id = s.page_version_id
          JOIN public_pages p ON p.id = pv.page_id
          WHERE s.primary_media_asset_id = ?
            AND s.is_enabled = 1
            AND pv.version_status IN ('draft','in_review','approved','scheduled','published')
          LIMIT 25`,
  }),
  Object.freeze({
    type: "page_section_background",
    sql: `SELECT s.id, CONCAT(p.slug, ':', s.section_key) AS label
          FROM public_page_sections s
          JOIN public_page_versions pv ON pv.id = s.page_version_id
          JOIN public_pages p ON p.id = pv.page_id
          WHERE s.background_media_asset_id = ?
            AND s.is_enabled = 1
            AND pv.version_status IN ('draft','in_review','approved','scheduled','published')
          LIMIT 25`,
  }),
  Object.freeze({
    type: "business_division",
    sql: `SELECT id, slug AS label
          FROM public_business_divisions
          WHERE featured_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "leadership_portrait",
    sql: `SELECT id, slug AS label
          FROM public_leadership_profiles
          WHERE portrait_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "leadership_signature",
    sql: `SELECT id, slug AS label
          FROM public_leadership_profiles
          WHERE signature_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "project_featured",
    sql: `SELECT id, slug AS label
          FROM public_projects
          WHERE featured_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "project_gallery",
    sql: `SELECT pm.id, p.slug AS label
          FROM public_project_media pm
          JOIN public_projects p ON p.id = pm.project_id
          WHERE pm.media_asset_id = ?
            AND p.publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "equipment_featured",
    sql: `SELECT id, slug AS label
          FROM public_equipment_catalogue
          WHERE featured_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "news_featured",
    sql: `SELECT id, slug AS label
          FROM public_news_articles
          WHERE featured_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "job_vacancy",
    sql: `SELECT id, slug AS label
          FROM public_job_vacancies
          WHERE featured_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "tender_document",
    sql: `SELECT id, slug AS label
          FROM public_tenders
          WHERE document_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "testimonial_portrait",
    sql: `SELECT id, testimonial_key AS label
          FROM public_testimonials
          WHERE portrait_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
  Object.freeze({
    type: "location_featured",
    sql: `SELECT id, slug AS label
          FROM public_locations
          WHERE featured_media_asset_id = ?
            AND publication_status <> 'archived'
          LIMIT 25`,
  }),
]);

async function getMediaUsage(connection, assetId) {
  const id = positiveInteger(assetId);
  if (!id) {
    throw new ContentStudioError("Invalid media asset ID.", {
      code: "INVALID_PUBLIC_MEDIA_ID",
      statusCode: 400,
    });
  }

  try {
    const usage = [];
    for (const definition of MEDIA_USAGE_QUERIES) {
      const [rows] = await connection.query(definition.sql, [id]);
      for (const row of rows) {
        usage.push({
          type: definition.type,
          id: Number(row.id),
          label: row.label || "",
        });
      }
    }
    return usage;
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function assertMediaUnused(connection, assetId) {
  const usage = await getMediaUsage(connection, assetId);
  if (usage.length > 0) {
    throw new ContentStudioError(
      "This media asset is still used by website content. Replace those references before archiving it.",
      {
        code: "PUBLIC_MEDIA_IN_USE",
        statusCode: 409,
        details: usage.slice(0, 50),
      }
    );
  }
  return true;
}

module.exports = {
  MEDIA_USAGE_QUERIES,
  assertMediaUnused,
  getMediaUsage,
};
