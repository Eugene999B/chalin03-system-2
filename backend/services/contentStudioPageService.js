"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");

const PAGE_STATUSES = Object.freeze([
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "expired",
  "archived",
]);
const PAGE_VERSION_STATUSES = Object.freeze([
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "superseded",
  "archived",
]);
const APPROVAL_STATUSES = Object.freeze([
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);
const ALLOWED_SECTION_TYPES = Object.freeze([
  "hero",
  "text",
  "image",
  "video",
  "split",
  "statistics",
  "divisions",
  "leadership",
  "projects",
  "equipment",
  "news",
  "testimonials",
  "gallery",
  "cta",
  "contact",
  "faq",
  "form",
  "custom",
]);
const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 100;
const MAX_JSON_LENGTH = 250000;
const MAX_SECTIONS_PER_PAGE = 80;

class ContentStudioError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ContentStudioError";
    this.code = options.code || "CONTENT_STUDIO_ERROR";
    this.statusCode = Number(options.statusCode) || 400;
    this.details = options.details || [];
  }
}

function cleanText(value, maximumLength = 500) {
  if (value === undefined || value === null) return "";

  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase()
  );
}

function normalizePageKey(value) {
  const key = cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) ? key : null;
}

function normalizeSlug(value) {
  const slug = cleanText(value, 180).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function normalizeSectionKey(value) {
  const key = cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) ? key : null;
}

function normalizeSectionType(value) {
  const type = cleanText(value, 100)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ALLOWED_SECTION_TYPES.includes(type) ? type : null;
}

function normalizePageStatus(value) {
  const status = cleanText(value, 40).toLowerCase();
  return PAGE_STATUSES.includes(status) ? status : null;
}

function normalizeVersionStatus(value) {
  const status = cleanText(value, 40).toLowerCase();
  return PAGE_VERSION_STATUSES.includes(status) ? status : null;
}

function normalizeDateTime(value, { allowPast = true } = {}) {
  if (value === undefined || value === null || value === "") return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ContentStudioError("Enter a valid date and time.", {
      code: "INVALID_CONTENT_DATETIME",
      statusCode: 400,
    });
  }

  if (!allowPast && date.getTime() <= Date.now()) {
    throw new ContentStudioError("The scheduled publishing time must be in the future.", {
      code: "PUBLISH_TIME_NOT_FUTURE",
      statusCode: 400,
    });
  }

  return date;
}

function assertJsonSize(value, label) {
  if (value === undefined || value === null) return null;

  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new ContentStudioError(`${label} must contain valid JSON data.`, {
      code: "INVALID_CONTENT_JSON",
      statusCode: 400,
    });
  }

  if (encoded.length > MAX_JSON_LENGTH) {
    throw new ContentStudioError(
      `${label} is too large. Reduce the amount of embedded data.`,
      {
        code: "CONTENT_JSON_TOO_LARGE",
        statusCode: 413,
      }
    );
  }

  return encoded;
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function schemaNotReadyError(error) {
  if (error?.code !== "ER_NO_SUCH_TABLE" && error?.code !== "ER_BAD_FIELD_ERROR") {
    return error;
  }

  return new ContentStudioError(
    "The CHALIN ONE public-content database foundation is not ready in this environment.",
    {
      code: "CONTENT_STUDIO_SCHEMA_NOT_READY",
      statusCode: 503,
    }
  );
}

function duplicateContentError(error) {
  if (error?.code !== "ER_DUP_ENTRY") return error;

  return new ContentStudioError(
    "A page or version with the same unique identity already exists.",
    {
      code: "CONTENT_STUDIO_DUPLICATE",
      statusCode: 409,
    }
  );
}

function clampLimit(value, fallback = DEFAULT_PAGE_LIMIT) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, MAX_PAGE_LIMIT);
}

function normalizeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function sanitizeSections(sections = []) {
  if (!Array.isArray(sections)) {
    throw new ContentStudioError("Page sections must be supplied as a list.", {
      code: "INVALID_PAGE_SECTIONS",
      statusCode: 400,
    });
  }

  if (sections.length > MAX_SECTIONS_PER_PAGE) {
    throw new ContentStudioError(
      `A page may contain no more than ${MAX_SECTIONS_PER_PAGE} sections.`,
      {
        code: "TOO_MANY_PAGE_SECTIONS",
        statusCode: 400,
      }
    );
  }

  const usedKeys = new Set();

  return sections.map((section, index) => {
    const sectionKey =
      normalizeSectionKey(section?.section_key || section?.key) ||
      `section_${index + 1}`;
    const sectionType = normalizeSectionType(
      section?.section_type || section?.type
    );

    if (!sectionType) {
      throw new ContentStudioError(
        `Section ${sectionKey} uses an unsupported section type.`,
        {
          code: "UNSUPPORTED_PAGE_SECTION",
          statusCode: 400,
        }
      );
    }

    if (usedKeys.has(sectionKey)) {
      throw new ContentStudioError(
        `Section key ${sectionKey} is used more than once.`,
        {
          code: "DUPLICATE_PAGE_SECTION_KEY",
          statusCode: 409,
        }
      );
    }
    usedKeys.add(sectionKey);

    return {
      section_key: sectionKey,
      section_type: sectionType,
      heading: cleanText(section?.heading, 255) || null,
      subheading: cleanText(section?.subheading, 500) || null,
      content_json: assertJsonSize(section?.content ?? section?.content_json ?? {}, "Section content"),
      settings_json: assertJsonSize(section?.settings ?? section?.settings_json ?? {}, "Section settings"),
      primary_media_asset_id: positiveInteger(
        section?.primary_media_asset_id || section?.primary_media?.id
      ),
      background_media_asset_id: positiveInteger(
        section?.background_media_asset_id || section?.background_media?.id
      ),
      sort_order: Number.isInteger(Number(section?.sort_order))
        ? Number(section.sort_order)
        : index,
      is_enabled: booleanValue(section?.is_enabled, true) ? 1 : 0,
    };
  });
}

function sanitizeVersionInput(input = {}, { requireTitle = true } = {}) {
  const title = cleanText(input.title, 220);
  if (requireTitle && !title) {
    throw new ContentStudioError("Page title is required.", {
      code: "PAGE_TITLE_REQUIRED",
      statusCode: 400,
    });
  }

  return {
    title: title || null,
    subtitle: cleanText(input.subtitle, 255) || null,
    summary: cleanText(input.summary, 5000) || null,
    body_json: assertJsonSize(input.body ?? input.body_json ?? {}, "Page body"),
    seo_title: cleanText(input.seo_title, 255) || null,
    meta_description: cleanText(input.meta_description, 500) || null,
    canonical_url: cleanText(input.canonical_url, 500) || null,
    robots_directive:
      cleanText(input.robots_directive, 120) || "index,follow",
    primary_media_asset_id: positiveInteger(input.primary_media_asset_id),
    settings_json: assertJsonSize(
      input.settings ?? input.settings_json ?? {},
      "Page settings"
    ),
    change_summary: cleanText(input.change_summary, 500) || null,
    publish_at: normalizeDateTime(input.publish_at),
    expires_at: normalizeDateTime(input.expires_at),
    sections: sanitizeSections(input.sections || []),
  };
}

function validatePublishingWindow(publishAt, expiresAt) {
  if (publishAt && expiresAt && expiresAt.getTime() <= publishAt.getTime()) {
    throw new ContentStudioError(
      "The expiry time must be later than the publishing time.",
      {
        code: "INVALID_PUBLISHING_WINDOW",
        statusCode: 400,
      }
    );
  }
}

async function insertContentAudit(
  connection,
  {
    entityType,
    entityId,
    actionKey,
    actorUserId,
    approvalId = null,
    requestId = null,
    before = null,
    after = null,
    metadata = null,
  }
) {
  await connection.query(
    `INSERT INTO public_content_audit_log (
       entity_type,
       entity_id,
       action_key,
       actor_user_id,
       approval_id,
       request_id,
       before_json,
       after_json,
       metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityId,
      actionKey,
      actorUserId || null,
      approvalId,
      cleanText(requestId, 80) || null,
      before === null ? null : assertJsonSize(before, "Audit before state"),
      after === null ? null : assertJsonSize(after, "Audit after state"),
      metadata === null ? null : assertJsonSize(metadata, "Audit metadata"),
    ]
  );
}

async function writePlatformAudit(connection, req, action, entityType, entityId, metadata) {
  await writeAuditEvent({
    connection,
    req,
    action,
    details: `CHALIN ONE Content Studio ${action}`,
    entityType,
    entityId,
    actionType: action,
    metadata,
  });
}

async function insertSections(connection, pageVersionId, sections) {
  for (const section of sections) {
    await connection.query(
      `INSERT INTO public_page_sections (
         page_version_id,
         section_key,
         section_type,
         heading,
         subheading,
         content_json,
         settings_json,
         primary_media_asset_id,
         background_media_asset_id,
         sort_order,
         is_enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pageVersionId,
        section.section_key,
        section.section_type,
        section.heading,
        section.subheading,
        section.content_json,
        section.settings_json,
        section.primary_media_asset_id,
        section.background_media_asset_id,
        section.sort_order,
        section.is_enabled,
      ]
    );
  }
}

async function loadPageForUpdate(connection, pageId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_pages
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [pageId]
  );

  if (!rows[0]) {
    throw new ContentStudioError("Page not found.", {
      code: "CONTENT_PAGE_NOT_FOUND",
      statusCode: 404,
    });
  }

  return rows[0];
}

async function loadVersionForUpdate(connection, pageId, versionId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM public_page_versions
     WHERE id = ?
       AND page_id = ?
     LIMIT 1
     FOR UPDATE`,
    [versionId, pageId]
  );

  if (!rows[0]) {
    throw new ContentStudioError("Page version not found.", {
      code: "CONTENT_PAGE_VERSION_NOT_FOUND",
      statusCode: 404,
    });
  }

  return rows[0];
}

async function loadVersionSections(connection, versionId) {
  const [rows] = await connection.query(
    `SELECT
       id,
       section_key,
       section_type,
       heading,
       subheading,
       content_json,
       settings_json,
       primary_media_asset_id,
       background_media_asset_id,
       sort_order,
       is_enabled,
       created_at,
       updated_at
     FROM public_page_sections
     WHERE page_version_id = ?
     ORDER BY sort_order, id`,
    [versionId]
  );

  return rows.map((row) => ({
    ...row,
    content_json: parseJson(row.content_json, {}),
    settings_json: parseJson(row.settings_json, {}),
    is_enabled: booleanValue(row.is_enabled),
  }));
}

async function getContentStudioDashboard() {
  try {
    const [[pageCounts], [approvalCounts], [submissionCounts], [mediaCounts]] =
      await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) AS total_pages,
             SUM(publication_status = 'draft') AS draft_pages,
             SUM(publication_status = 'in_review') AS pages_in_review,
             SUM(publication_status = 'approved') AS approved_pages,
             SUM(publication_status = 'scheduled') AS scheduled_pages,
             SUM(publication_status = 'published') AS published_pages,
             SUM(publication_status = 'archived') AS archived_pages
           FROM public_pages`
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total_approvals,
             SUM(approval_status = 'pending') AS pending_approvals,
             SUM(approval_status = 'approved') AS approved_requests,
             SUM(approval_status = 'rejected') AS rejected_requests
           FROM public_content_approvals`
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total_submissions,
             SUM(submission_status = 'new') AS new_submissions,
             SUM(submission_status = 'in_review') AS submissions_in_review,
             SUM(submission_status = 'resolved') AS resolved_submissions
           FROM public_form_submissions`
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total_media,
             SUM(processing_status = 'pending') AS pending_media,
             SUM(processing_status = 'ready') AS ready_media,
             SUM(processing_status = 'quarantined') AS quarantined_media
           FROM public_media_assets`
        ),
      ]);

    return {
      pages: pageCounts[0] || {},
      approvals: approvalCounts[0] || {},
      submissions: submissionCounts[0] || {},
      media: mediaCounts[0] || {},
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function listPages({ status, search, limit, offset } = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const filters = [];
  const values = [];

  if (status) {
    const safeStatus = normalizePageStatus(status);
    if (!safeStatus) {
      throw new ContentStudioError("Choose a valid page status.", {
        code: "INVALID_PAGE_STATUS",
        statusCode: 400,
      });
    }
    filters.push("p.publication_status = ?");
    values.push(safeStatus);
  }

  const searchText = cleanText(search, 120);
  if (searchText) {
    filters.push("(p.page_key LIKE ? OR p.slug LIKE ? OR p.menu_title LIKE ? OR latest.title LIKE ?)");
    const like = `%${searchText}%`;
    values.push(like, like, like, like);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [rows, countRows] = await Promise.all([
      pool.query(
        `SELECT
           p.id,
           p.page_key,
           p.slug,
           p.page_type,
           p.template_key,
           p.menu_title,
           p.publication_status,
           p.publish_at,
           p.expires_at,
           p.published_at,
           p.is_homepage,
           p.show_in_search,
           p.show_in_sitemap,
           p.created_at,
           p.updated_at,
           latest.id AS latest_version_id,
           latest.version_number AS latest_version_number,
           latest.version_status AS latest_version_status,
           latest.title AS latest_title,
           latest.change_summary AS latest_change_summary
         FROM public_pages p
         LEFT JOIN public_page_versions latest
           ON latest.id = (
             SELECT pv.id
             FROM public_page_versions pv
             WHERE pv.page_id = p.id
             ORDER BY pv.version_number DESC, pv.id DESC
             LIMIT 1
           )
         ${where}
         ORDER BY p.is_homepage DESC, p.updated_at DESC, p.id DESC
         LIMIT ? OFFSET ?`,
        [...values, safeLimit, safeOffset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM public_pages p
         LEFT JOIN public_page_versions latest
           ON latest.id = (
             SELECT pv.id
             FROM public_page_versions pv
             WHERE pv.page_id = p.id
             ORDER BY pv.version_number DESC, pv.id DESC
             LIMIT 1
           )
         ${where}`,
        values
      ),
    ]);

    return {
      items: rows[0].map((row) => ({
        ...row,
        is_homepage: booleanValue(row.is_homepage),
        show_in_search: booleanValue(row.show_in_search),
        show_in_sitemap: booleanValue(row.show_in_sitemap),
      })),
      total: Number(countRows[0][0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function getPageDetails(pageId) {
  const id = positiveInteger(pageId);
  if (!id) {
    throw new ContentStudioError("Invalid page ID.", {
      code: "INVALID_PAGE_ID",
      statusCode: 400,
    });
  }

  try {
    const [pageRows, versionRows, approvalRows] = await Promise.all([
      pool.query(
        `SELECT * FROM public_pages WHERE id = ? LIMIT 1`,
        [id]
      ),
      pool.query(
        `SELECT *
         FROM public_page_versions
         WHERE page_id = ?
         ORDER BY version_number DESC, id DESC`,
        [id]
      ),
      pool.query(
        `SELECT
           a.*,
           requester.full_name AS requested_by_name,
           assignee.full_name AS assigned_to_name,
           decider.full_name AS decided_by_name
         FROM public_content_approvals a
         LEFT JOIN users requester ON requester.id = a.requested_by
         LEFT JOIN users assignee ON assignee.id = a.assigned_to
         LEFT JOIN users decider ON decider.id = a.decided_by
         WHERE a.entity_type = 'page'
           AND a.entity_id = ?
         ORDER BY a.id DESC`,
        [id]
      ),
    ]);

    const page = pageRows[0][0];
    if (!page) {
      throw new ContentStudioError("Page not found.", {
        code: "CONTENT_PAGE_NOT_FOUND",
        statusCode: 404,
      });
    }

    const versions = [];
    for (const version of versionRows[0]) {
      versions.push({
        ...version,
        body_json: parseJson(version.body_json, {}),
        settings_json: parseJson(version.settings_json, {}),
        sections: await loadVersionSections(pool, version.id),
      });
    }

    return {
      page: {
        ...page,
        is_homepage: booleanValue(page.is_homepage),
        show_in_search: booleanValue(page.show_in_search),
        show_in_sitemap: booleanValue(page.show_in_sitemap),
      },
      versions,
      approvals: approvalRows[0],
    };
  } catch (error) {
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  }
}

async function createPageDraft({ input, user, req }) {
  const pageKey = normalizePageKey(input?.page_key || input?.key);
  const slug = normalizeSlug(input?.slug);
  const title = cleanText(input?.title, 220);

  if (!pageKey || !slug || !title) {
    throw new ContentStudioError(
      "Page key, URL slug and page title are required and must use safe formats.",
      {
        code: "INVALID_PAGE_IDENTITY",
        statusCode: 400,
      }
    );
  }

  const version = sanitizeVersionInput(input, { requireTitle: true });
  validatePublishingWindow(version.publish_at, version.expires_at);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (booleanValue(input.is_homepage, false)) {
      await connection.query(
        `UPDATE public_pages
         SET is_homepage = 0,
             updated_by = ?,
             updated_at = NOW()
         WHERE is_homepage = 1`,
        [user?.id || null]
      );
    }

    const [pageResult] = await connection.query(
      `INSERT INTO public_pages (
         page_key,
         slug,
         page_type,
         template_key,
         menu_title,
         publication_status,
         is_homepage,
         show_in_search,
         show_in_sitemap,
         created_by,
         updated_by
       ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      [
        pageKey,
        slug,
        cleanText(input.page_type, 80) || "standard",
        cleanText(input.template_key, 100) || "standard",
        cleanText(input.menu_title, 180) || title,
        booleanValue(input.is_homepage, false) ? 1 : 0,
        booleanValue(input.show_in_search, true) ? 1 : 0,
        booleanValue(input.show_in_sitemap, true) ? 1 : 0,
        user?.id || null,
        user?.id || null,
      ]
    );

    const pageId = Number(pageResult.insertId);
    const [versionResult] = await connection.query(
      `INSERT INTO public_page_versions (
         page_id,
         version_number,
         version_status,
         title,
         subtitle,
         summary,
         body_json,
         seo_title,
         meta_description,
         canonical_url,
         robots_directive,
         primary_media_asset_id,
         settings_json,
         change_summary,
         publish_at,
         expires_at,
         created_by
       ) VALUES (?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pageId,
        version.title,
        version.subtitle,
        version.summary,
        version.body_json,
        version.seo_title,
        version.meta_description,
        version.canonical_url,
        version.robots_directive,
        version.primary_media_asset_id,
        version.settings_json,
        version.change_summary || "Initial page draft",
        version.publish_at,
        version.expires_at,
        user?.id || null,
      ]
    );

    const versionId = Number(versionResult.insertId);
    await insertSections(connection, versionId, version.sections);

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: pageId,
      actionKey: "page_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      after: {
        page_key: pageKey,
        slug,
        title,
        version_number: 1,
        section_count: version.sections.length,
      },
    });
    await writePlatformAudit(
      connection,
      req,
      "PUBLIC_PAGE_CREATED",
      "public_page",
      pageId,
      { page_key: pageKey, slug, version_id: versionId }
    );

    await connection.commit();
    return getPageDetails(pageId);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(duplicateContentError(error));
  } finally {
    connection.release();
  }
}

async function createPageVersion({ pageId, input = {}, user, req }) {
  const id = positiveInteger(pageId);
  if (!id) {
    throw new ContentStudioError("Invalid page ID.", {
      code: "INVALID_PAGE_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const page = await loadPageForUpdate(connection, id);

    const [latestRows] = await connection.query(
      `SELECT *
       FROM public_page_versions
       WHERE page_id = ?
       ORDER BY version_number DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [id]
    );
    const latest = latestRows[0];
    if (!latest) {
      throw new ContentStudioError("The page has no source version.", {
        code: "CONTENT_PAGE_VERSION_NOT_FOUND",
        statusCode: 409,
      });
    }

    const sourceSections = await loadVersionSections(connection, latest.id);
    const source = {
      title: latest.title,
      subtitle: latest.subtitle,
      summary: latest.summary,
      body_json: parseJson(latest.body_json, {}),
      seo_title: latest.seo_title,
      meta_description: latest.meta_description,
      canonical_url: latest.canonical_url,
      robots_directive: latest.robots_directive,
      primary_media_asset_id: latest.primary_media_asset_id,
      settings_json: parseJson(latest.settings_json, {}),
      publish_at: latest.publish_at,
      expires_at: latest.expires_at,
      sections: sourceSections,
    };
    const mergedInput = {
      ...source,
      ...input,
      sections: input.sections ?? sourceSections,
      body: input.body ?? input.body_json ?? source.body_json,
      settings: input.settings ?? input.settings_json ?? source.settings_json,
    };
    const version = sanitizeVersionInput(mergedInput, { requireTitle: true });
    validatePublishingWindow(version.publish_at, version.expires_at);
    const nextVersionNumber = Number(latest.version_number) + 1;

    const [result] = await connection.query(
      `INSERT INTO public_page_versions (
         page_id,
         version_number,
         version_status,
         title,
         subtitle,
         summary,
         body_json,
         seo_title,
         meta_description,
         canonical_url,
         robots_directive,
         primary_media_asset_id,
         settings_json,
         change_summary,
         publish_at,
         expires_at,
         created_by
       ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        nextVersionNumber,
        version.title,
        version.subtitle,
        version.summary,
        version.body_json,
        version.seo_title,
        version.meta_description,
        version.canonical_url,
        version.robots_directive,
        version.primary_media_asset_id,
        version.settings_json,
        version.change_summary || `Created from version ${latest.version_number}`,
        version.publish_at,
        version.expires_at,
        user?.id || null,
      ]
    );
    const versionId = Number(result.insertId);
    await insertSections(connection, versionId, version.sections);

    await connection.query(
      `UPDATE public_pages
       SET publication_status = CASE
             WHEN publication_status IN ('published', 'scheduled') THEN publication_status
             ELSE 'draft'
           END,
           updated_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [user?.id || null, id]
    );

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: "page_version_created",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        version_id: latest.id,
        version_number: latest.version_number,
      },
      after: {
        version_id: versionId,
        version_number: nextVersionNumber,
        section_count: version.sections.length,
      },
    });
    await writePlatformAudit(
      connection,
      req,
      "PUBLIC_PAGE_VERSION_CREATED",
      "public_page",
      id,
      { version_id: versionId, version_number: nextVersionNumber }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(duplicateContentError(error));
  } finally {
    connection.release();
  }
}

async function updateDraftVersion({ pageId, versionId, input, user, req }) {
  const id = positiveInteger(pageId);
  const versionRecordId = positiveInteger(versionId);
  if (!id || !versionRecordId) {
    throw new ContentStudioError("Invalid page or version ID.", {
      code: "INVALID_PAGE_VERSION_ID",
      statusCode: 400,
    });
  }

  const versionInput = sanitizeVersionInput(input, { requireTitle: true });
  validatePublishingWindow(versionInput.publish_at, versionInput.expires_at);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const page = await loadPageForUpdate(connection, id);
    const existing = await loadVersionForUpdate(connection, id, versionRecordId);

    if (existing.version_status !== "draft") {
      throw new ContentStudioError(
        "Only a draft version may be edited. Create a new version to change approved or published content.",
        {
          code: "PAGE_VERSION_NOT_EDITABLE",
          statusCode: 409,
        }
      );
    }

    const beforeSections = await loadVersionSections(connection, versionRecordId);
    const before = {
      title: existing.title,
      summary: existing.summary,
      section_count: beforeSections.length,
    };

    await connection.query(
      `UPDATE public_page_versions
       SET title = ?,
           subtitle = ?,
           summary = ?,
           body_json = ?,
           seo_title = ?,
           meta_description = ?,
           canonical_url = ?,
           robots_directive = ?,
           primary_media_asset_id = ?,
           settings_json = ?,
           change_summary = ?,
           publish_at = ?,
           expires_at = ?
       WHERE id = ?
         AND page_id = ?`,
      [
        versionInput.title,
        versionInput.subtitle,
        versionInput.summary,
        versionInput.body_json,
        versionInput.seo_title,
        versionInput.meta_description,
        versionInput.canonical_url,
        versionInput.robots_directive,
        versionInput.primary_media_asset_id,
        versionInput.settings_json,
        versionInput.change_summary,
        versionInput.publish_at,
        versionInput.expires_at,
        versionRecordId,
        id,
      ]
    );

    await connection.query(
      `DELETE FROM public_page_sections WHERE page_version_id = ?`,
      [versionRecordId]
    );
    await insertSections(connection, versionRecordId, versionInput.sections);

    await connection.query(
      `UPDATE public_pages
       SET page_type = ?,
           template_key = ?,
           menu_title = ?,
           slug = ?,
           is_homepage = ?,
           show_in_search = ?,
           show_in_sitemap = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        cleanText(input.page_type, 80) || page.page_type,
        cleanText(input.template_key, 100) || page.template_key,
        cleanText(input.menu_title, 180) || page.menu_title || versionInput.title,
        normalizeSlug(input.slug) || page.slug,
        booleanValue(input.is_homepage, booleanValue(page.is_homepage)) ? 1 : 0,
        booleanValue(input.show_in_search, booleanValue(page.show_in_search)) ? 1 : 0,
        booleanValue(input.show_in_sitemap, booleanValue(page.show_in_sitemap)) ? 1 : 0,
        user?.id || null,
        id,
      ]
    );

    if (booleanValue(input.is_homepage, booleanValue(page.is_homepage))) {
      await connection.query(
        `UPDATE public_pages
         SET is_homepage = 0,
             updated_by = ?,
             updated_at = NOW()
         WHERE id <> ?
           AND is_homepage = 1`,
        [user?.id || null, id]
      );
    }

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: "page_version_updated",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before,
      after: {
        title: versionInput.title,
        summary: versionInput.summary,
        section_count: versionInput.sections.length,
        version_id: versionRecordId,
      },
    });
    await writePlatformAudit(
      connection,
      req,
      "PUBLIC_PAGE_VERSION_UPDATED",
      "public_page",
      id,
      { version_id: versionRecordId }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(duplicateContentError(error));
  } finally {
    connection.release();
  }
}

async function submitPageVersion({ pageId, versionId, assignedTo, note, user, req }) {
  const id = positiveInteger(pageId);
  const versionRecordId = positiveInteger(versionId);
  if (!id || !versionRecordId) {
    throw new ContentStudioError("Invalid page or version ID.", {
      code: "INVALID_PAGE_VERSION_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await loadPageForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, versionRecordId);

    if (version.version_status !== "draft") {
      throw new ContentStudioError("Only a draft may be submitted for review.", {
        code: "PAGE_VERSION_NOT_DRAFT",
        statusCode: 409,
      });
    }

    const [pendingRows] = await connection.query(
      `SELECT id
       FROM public_content_approvals
       WHERE entity_type = 'page'
         AND entity_id = ?
         AND page_version_id = ?
         AND approval_status = 'pending'
       LIMIT 1
       FOR UPDATE`,
      [id, versionRecordId]
    );
    if (pendingRows[0]) {
      throw new ContentStudioError(
        "This page version already has a pending review request.",
        {
          code: "PAGE_REVIEW_ALREADY_PENDING",
          statusCode: 409,
        }
      );
    }

    const [approvalResult] = await connection.query(
      `INSERT INTO public_content_approvals (
         entity_type,
         entity_id,
         page_version_id,
         request_type,
         approval_status,
         requested_by,
         assigned_to,
         request_note
       ) VALUES ('page', ?, ?, 'review', 'pending', ?, ?, ?)`,
      [
        id,
        versionRecordId,
        user?.id || null,
        positiveInteger(assignedTo),
        cleanText(note, 2000) || null,
      ]
    );
    const approvalId = Number(approvalResult.insertId);

    await connection.query(
      `UPDATE public_page_versions
       SET version_status = 'in_review'
       WHERE id = ?`,
      [versionRecordId]
    );
    await connection.query(
      `UPDATE public_pages
       SET publication_status = CASE
             WHEN publication_status IN ('published', 'scheduled') THEN publication_status
             ELSE 'in_review'
           END,
           submitted_by = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [user?.id || null, user?.id || null, id]
    );

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: "page_review_requested",
      actorUserId: user?.id,
      approvalId,
      requestId: req?.requestId,
      after: {
        version_id: versionRecordId,
        version_number: version.version_number,
        approval_id: approvalId,
        assigned_to: positiveInteger(assignedTo),
      },
    });
    await writePlatformAudit(
      connection,
      req,
      "PUBLIC_PAGE_REVIEW_REQUESTED",
      "public_page",
      id,
      { version_id: versionRecordId, approval_id: approvalId }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function listPendingApprovals({ assignedTo, limit, offset } = {}) {
  const safeLimit = clampLimit(limit);
  const safeOffset = normalizeOffset(offset);
  const filters = ["a.approval_status = 'pending'"];
  const values = [];

  if (assignedTo) {
    const userId = positiveInteger(assignedTo);
    if (!userId) {
      throw new ContentStudioError("Invalid assigned user ID.", {
        code: "INVALID_ASSIGNED_USER",
        statusCode: 400,
      });
    }
    filters.push("(a.assigned_to IS NULL OR a.assigned_to = ?)");
    values.push(userId);
  }

  try {
    const [rows] = await pool.query(
      `SELECT
         a.*,
         p.page_key,
         p.slug,
         v.version_number,
         v.title,
         requester.full_name AS requested_by_name,
         assignee.full_name AS assigned_to_name
       FROM public_content_approvals a
       JOIN public_pages p
         ON p.id = a.entity_id
        AND a.entity_type = 'page'
       JOIN public_page_versions v ON v.id = a.page_version_id
       LEFT JOIN users requester ON requester.id = a.requested_by
       LEFT JOIN users assignee ON assignee.id = a.assigned_to
       WHERE ${filters.join(" AND ")}
       ORDER BY a.requested_at ASC, a.id ASC
       LIMIT ? OFFSET ?`,
      [...values, safeLimit, safeOffset]
    );

    return {
      items: rows,
      limit: safeLimit,
      offset: safeOffset,
    };
  } catch (error) {
    throw schemaNotReadyError(error);
  }
}

async function decidePageApproval({ approvalId, decision, note, user, req }) {
  const id = positiveInteger(approvalId);
  const normalizedDecision = cleanText(decision, 20).toLowerCase();

  if (!id || !["approved", "rejected"].includes(normalizedDecision)) {
    throw new ContentStudioError("Choose Approve or Reject for a valid request.", {
      code: "INVALID_APPROVAL_DECISION",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [approvalRows] = await connection.query(
      `SELECT *
       FROM public_content_approvals
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [id]
    );
    const approval = approvalRows[0];

    if (!approval || approval.entity_type !== "page") {
      throw new ContentStudioError("Page approval request not found.", {
        code: "CONTENT_APPROVAL_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (approval.approval_status !== "pending") {
      throw new ContentStudioError("This approval request has already been decided.", {
        code: "CONTENT_APPROVAL_ALREADY_DECIDED",
        statusCode: 409,
      });
    }
    if (Number(approval.requested_by) === Number(user?.id)) {
      throw new ContentStudioError(
        "The person who submitted a page cannot approve the same review request.",
        {
          code: "CONTENT_SELF_APPROVAL_BLOCKED",
          statusCode: 409,
        }
      );
    }
    if (
      approval.assigned_to &&
      Number(approval.assigned_to) !== Number(user?.id)
    ) {
      throw new ContentStudioError(
        "This approval request is assigned to another reviewer.",
        {
          code: "CONTENT_APPROVAL_ASSIGNED_ELSEWHERE",
          statusCode: 403,
        }
      );
    }

    const page = await loadPageForUpdate(connection, approval.entity_id);
    const version = await loadVersionForUpdate(
      connection,
      approval.entity_id,
      approval.page_version_id
    );

    if (version.version_status !== "in_review") {
      throw new ContentStudioError(
        "The linked page version is no longer awaiting review.",
        {
          code: "CONTENT_APPROVAL_STATE_MISMATCH",
          statusCode: 409,
        }
      );
    }

    await connection.query(
      `UPDATE public_content_approvals
       SET approval_status = ?,
           decided_by = ?,
           decision_note = ?,
           decided_at = NOW()
       WHERE id = ?`,
      [normalizedDecision, user?.id || null, cleanText(note, 2000) || null, id]
    );

    if (normalizedDecision === "approved") {
      await connection.query(
        `UPDATE public_page_versions
         SET version_status = 'approved',
             approved_by = ?
         WHERE id = ?`,
        [user?.id || null, version.id]
      );
      await connection.query(
        `UPDATE public_pages
         SET publication_status = CASE
               WHEN publication_status IN ('published', 'scheduled') THEN publication_status
               ELSE 'approved'
             END,
             approved_by = ?,
             updated_by = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [user?.id || null, user?.id || null, page.id]
      );
    } else {
      await connection.query(
        `UPDATE public_page_versions
         SET version_status = 'draft'
         WHERE id = ?`,
        [version.id]
      );
      await connection.query(
        `UPDATE public_pages
         SET publication_status = CASE
               WHEN publication_status IN ('published', 'scheduled') THEN publication_status
               ELSE 'draft'
             END,
             updated_by = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [user?.id || null, page.id]
      );
    }

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: page.id,
      actionKey:
        normalizedDecision === "approved"
          ? "page_review_approved"
          : "page_review_rejected",
      actorUserId: user?.id,
      approvalId: id,
      requestId: req?.requestId,
      before: {
        page_status: page.publication_status,
        version_status: version.version_status,
      },
      after: {
        approval_status: normalizedDecision,
        page_status:
          normalizedDecision === "approved" ? "approved" : "draft",
        version_status:
          normalizedDecision === "approved" ? "approved" : "draft",
        decision_note: cleanText(note, 2000) || null,
      },
    });
    await writePlatformAudit(
      connection,
      req,
      normalizedDecision === "approved"
        ? "PUBLIC_PAGE_REVIEW_APPROVED"
        : "PUBLIC_PAGE_REVIEW_REJECTED",
      "public_page",
      page.id,
      { version_id: version.id, approval_id: id }
    );

    await connection.commit();
    return getPageDetails(page.id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function publishPageVersion({
  pageId,
  versionId,
  publishAt,
  expiresAt,
  user,
  req,
}) {
  const id = positiveInteger(pageId);
  const versionRecordId = positiveInteger(versionId);
  if (!id || !versionRecordId) {
    throw new ContentStudioError("Invalid page or version ID.", {
      code: "INVALID_PAGE_VERSION_ID",
      statusCode: 400,
    });
  }

  const scheduledAt = normalizeDateTime(publishAt);
  const expiryAt = normalizeDateTime(expiresAt);
  validatePublishingWindow(scheduledAt, expiryAt);
  const now = new Date();
  const scheduled = scheduledAt && scheduledAt.getTime() > now.getTime();
  const targetStatus = scheduled ? "scheduled" : "published";
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const page = await loadPageForUpdate(connection, id);
    const version = await loadVersionForUpdate(connection, id, versionRecordId);

    if (version.version_status !== "approved") {
      throw new ContentStudioError(
        "Only an approved page version may be published or scheduled.",
        {
          code: "PAGE_VERSION_NOT_APPROVED",
          statusCode: 409,
        }
      );
    }

    const [approvalRows] = await connection.query(
      `SELECT *
       FROM public_content_approvals
       WHERE entity_type = 'page'
         AND entity_id = ?
         AND page_version_id = ?
         AND approval_status = 'approved'
       ORDER BY decided_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [id, versionRecordId]
    );
    const approval = approvalRows[0];
    if (!approval) {
      throw new ContentStudioError(
        "Publishing requires an approved human review record.",
        {
          code: "APPROVED_REVIEW_REQUIRED",
          statusCode: 409,
        }
      );
    }

    await connection.query(
      `UPDATE public_page_versions
       SET version_status = 'superseded'
       WHERE page_id = ?
         AND id <> ?
         AND version_status IN ('published', 'scheduled')`,
      [id, versionRecordId]
    );

    await connection.query(
      `UPDATE public_page_versions
       SET version_status = ?,
           publish_at = ?,
           expires_at = ?,
           published_at = CASE WHEN ? = 'published' THEN NOW() ELSE NULL END,
           published_by = ?
       WHERE id = ?`,
      [
        targetStatus,
        scheduledAt,
        expiryAt,
        targetStatus,
        user?.id || null,
        versionRecordId,
      ]
    );

    await connection.query(
      `UPDATE public_pages
       SET publication_status = ?,
           publish_at = ?,
           expires_at = ?,
           published_at = CASE WHEN ? = 'published' THEN NOW() ELSE NULL END,
           published_by = ?,
           updated_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        targetStatus,
        scheduledAt,
        expiryAt,
        targetStatus,
        user?.id || null,
        user?.id || null,
        id,
      ]
    );

    await connection.query(
      `UPDATE public_content_approvals
       SET executed_at = NOW()
       WHERE id = ?`,
      [approval.id]
    );

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: scheduled ? "page_scheduled" : "page_published",
      actorUserId: user?.id,
      approvalId: approval.id,
      requestId: req?.requestId,
      before: {
        page_status: page.publication_status,
        version_status: version.version_status,
      },
      after: {
        page_status: targetStatus,
        version_status: targetStatus,
        version_id: versionRecordId,
        publish_at: scheduledAt,
        expires_at: expiryAt,
      },
    });
    await writePlatformAudit(
      connection,
      req,
      scheduled ? "PUBLIC_PAGE_SCHEDULED" : "PUBLIC_PAGE_PUBLISHED",
      "public_page",
      id,
      {
        version_id: versionRecordId,
        approval_id: approval.id,
        publish_at: scheduledAt,
        expires_at: expiryAt,
      }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

async function restorePageVersion({ pageId, versionId, reason, user, req }) {
  const id = positiveInteger(pageId);
  const sourceVersionId = positiveInteger(versionId);
  if (!id || !sourceVersionId) {
    throw new ContentStudioError("Invalid page or version ID.", {
      code: "INVALID_PAGE_VERSION_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await loadPageForUpdate(connection, id);
    const source = await loadVersionForUpdate(connection, id, sourceVersionId);
    const sourceSections = await loadVersionSections(connection, sourceVersionId);

    const [latestRows] = await connection.query(
      `SELECT MAX(version_number) AS latest_version
       FROM public_page_versions
       WHERE page_id = ?
       FOR UPDATE`,
      [id]
    );
    const nextVersionNumber = Number(latestRows[0]?.latest_version || 0) + 1;

    const [result] = await connection.query(
      `INSERT INTO public_page_versions (
         page_id,
         version_number,
         version_status,
         title,
         subtitle,
         summary,
         body_json,
         seo_title,
         meta_description,
         canonical_url,
         robots_directive,
         primary_media_asset_id,
         settings_json,
         change_summary,
         created_by
       ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        nextVersionNumber,
        source.title,
        source.subtitle,
        source.summary,
        source.body_json,
        source.seo_title,
        source.meta_description,
        source.canonical_url,
        source.robots_directive,
        source.primary_media_asset_id,
        source.settings_json,
        cleanText(reason, 500) ||
          `Restored from version ${source.version_number}`,
        user?.id || null,
      ]
    );
    const newVersionId = Number(result.insertId);
    await insertSections(
      connection,
      newVersionId,
      sanitizeSections(sourceSections)
    );

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: "page_version_restored",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: {
        source_version_id: sourceVersionId,
        source_version_number: source.version_number,
      },
      after: {
        version_id: newVersionId,
        version_number: nextVersionNumber,
        version_status: "draft",
      },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await writePlatformAudit(
      connection,
      req,
      "PUBLIC_PAGE_VERSION_RESTORED",
      "public_page",
      id,
      {
        source_version_id: sourceVersionId,
        new_version_id: newVersionId,
      }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(duplicateContentError(error));
  } finally {
    connection.release();
  }
}

async function archivePage({ pageId, reason, user, req }) {
  const id = positiveInteger(pageId);
  if (!id) {
    throw new ContentStudioError("Invalid page ID.", {
      code: "INVALID_PAGE_ID",
      statusCode: 400,
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const page = await loadPageForUpdate(connection, id);

    await connection.query(
      `UPDATE public_pages
       SET publication_status = 'archived',
           expires_at = COALESCE(expires_at, NOW()),
           updated_by = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [user?.id || null, id]
    );
    await connection.query(
      `UPDATE public_page_versions
       SET version_status = CASE
             WHEN version_status = 'published' THEN 'archived'
             WHEN version_status = 'scheduled' THEN 'archived'
             ELSE version_status
           END,
           expires_at = COALESCE(expires_at, NOW())
       WHERE page_id = ?`,
      [id]
    );

    await insertContentAudit(connection, {
      entityType: "page",
      entityId: id,
      actionKey: "page_archived",
      actorUserId: user?.id,
      requestId: req?.requestId,
      before: { publication_status: page.publication_status },
      after: { publication_status: "archived" },
      metadata: { reason: cleanText(reason, 500) || null },
    });
    await writePlatformAudit(
      connection,
      req,
      "PUBLIC_PAGE_ARCHIVED",
      "public_page",
      id,
      { reason: cleanText(reason, 500) || null }
    );

    await connection.commit();
    return getPageDetails(id);
  } catch (error) {
    await connection.rollback();
    if (error instanceof ContentStudioError) throw error;
    throw schemaNotReadyError(error);
  } finally {
    connection.release();
  }
}

module.exports = {
  ALLOWED_SECTION_TYPES,
  APPROVAL_STATUSES,
  ContentStudioError,
  MAX_JSON_LENGTH,
  MAX_SECTIONS_PER_PAGE,
  PAGE_STATUSES,
  PAGE_VERSION_STATUSES,
  archivePage,
  assertJsonSize,
  booleanValue,
  cleanText,
  createPageDraft,
  createPageVersion,
  decidePageApproval,
  duplicateContentError,
  getContentStudioDashboard,
  getPageDetails,
  insertContentAudit,
  listPages,
  listPendingApprovals,
  normalizeDateTime,
  normalizePageKey,
  normalizePageStatus,
  normalizeSectionKey,
  normalizeSectionType,
  normalizeSlug,
  normalizeVersionStatus,
  parseJson,
  positiveInteger,
  publishPageVersion,
  restorePageVersion,
  sanitizeSections,
  sanitizeVersionInput,
  schemaNotReadyError,
  submitPageVersion,
  updateDraftVersion,
  validatePublishingWindow,
};
